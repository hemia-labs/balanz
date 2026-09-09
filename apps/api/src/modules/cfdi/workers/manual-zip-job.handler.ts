import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FiscalMetricsService } from '../../../common/observability/fiscal-metrics.service';
import type { ClaimResult } from '../../ingestion/services/ingestion-job.repository';
import type { IngestionJobHandler } from '../../ingestion/workers/ingestion-job.registry';
import { DurableWorkerError } from '../../ingestion/workers/worker-error';
import { MALWARE_SCANNER_PORT } from '../../malware-scanner/malware-scanner.tokens';
import type {
  MalwareScannerPort,
  MalwareScanResult,
} from '../../malware-scanner/ports/malware-scanner.port';
import { OBJECT_STORAGE_PORT } from '../../object-storage/object-storage.tokens';
import type { ObjectStoragePort } from '../../object-storage/ports/object-storage.port';
import { ObjectStorageError } from '../../object-storage/object-storage.errors';
import { MalwareScannerError } from '../../malware-scanner/malware-scanner.errors';
import { CfdiWorkerPersistenceService } from './cfdi-worker-persistence.service';
import { XmlObjectProcessor } from './xml-object.processor';
import {
  ZipExtractor,
  ZIP_LIMITS,
  type InspectedArchive,
} from './zip-extractor';
import {
  ZipWorkerPersistenceService,
  hashStream,
  type ReservedZipEntry,
} from './zip-worker-persistence.service';

@Injectable()
export class ManualZipJobHandler implements IngestionJobHandler {
  readonly source = 'manual_zip' as const;
  constructor(
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT) private readonly scanner: MalwareScannerPort,
    private readonly persistence: ZipWorkerPersistenceService,
    private readonly xmlPersistence: CfdiWorkerPersistenceService,
    private readonly xml: XmlObjectProcessor,
    private readonly metrics: FiscalMetricsService,
  ) {}

  async handle(job: ClaimResult, signal: AbortSignal) {
    let archive: InspectedArchive | undefined;
    try {
      const root = await this.persistence.load(job);
      if (root.sizeBytes > ZIP_LIMITS.compressed)
        throw new DurableWorkerError('ZIP_LIMIT_EXCEEDED', {
          retryable: false,
        });
      if (root.scanStatus === 'infected')
        throw new DurableWorkerError('MALWARE_DETECTED', { retryable: false });
      // Always scan and verify the entire root before inspecting or extracting.
      const source = await this.storage.openReadStream(root.objectKey, signal);
      const hash = createHash('sha256');
      let size = 0;
      const integrity = new Transform({
        transform(
          chunk: Buffer,
          _encoding: BufferEncoding,
          done: TransformCallback,
        ) {
          size += chunk.length;
          if (size > ZIP_LIMITS.compressed || size > root.sizeBytes)
            return done(
              new DurableWorkerError('ZIP_LIMIT_EXCEEDED', {
                retryable: false,
              }),
            );
          hash.update(chunk);
          done(null, chunk);
        },
      });
      const pump = pipeline(source, integrity, { signal });
      void pump.catch(() => undefined);
      let scan: MalwareScanResult;
      try {
        scan = await this.scanner.scan(integrity, { signal });
        for await (const rest of integrity) void rest;
        await pump;
        if (size !== root.sizeBytes || hash.digest('hex') !== root.sha256)
          throw new DurableWorkerError('OBJECT_HASH_MISMATCH', {
            retryable: false,
          });
      } finally {
        source.destroy();
        integrity.destroy();
        await pump.catch(() => undefined);
      }
      await this.persistence.rootScan(job, scan.verdict);
      if (scan.verdict === 'infected')
        throw new DurableWorkerError('MALWARE_DETECTED', { retryable: false });
      await this.persistence.boundary(job);
      signal.throwIfAborted();
      await this.persistence.stage(job, 'extracting');
      const extractor = new ZipExtractor(this.storage);
      const started = Date.now();
      archive = await extractor.inspect(root.objectKey, root.sizeBytes, signal);
      const reservations = new Map<number, ReservedZipEntry>();
      for (const entry of archive.entries)
        reservations.set(
          entry.ordinal,
          await this.persistence.reserve(job, entry),
        );
      const uncompressed = await extractor.extract(
        archive,
        signal,
        async (entry, stream) => {
          const item = reservations.get(entry.ordinal)!;
          let result: Awaited<ReturnType<typeof hashStream>>;
          if (!item.objectKey || item.terminal)
            result = await hashStream(stream);
          else {
            const existing = await this.storage.head(item.objectKey);
            if (existing) {
              if (existing.sizeBytes !== entry.uncompressedSize)
                throw new DurableWorkerError('OBJECT_HASH_MISMATCH', {
                  retryable: false,
                });
              result = await hashStream(stream);
              const actual = await hashStream(
                await this.storage.openReadStream(item.objectKey, signal),
                entry.uncompressedSize,
              );
              if (
                result.sha256 !== actual.sha256 ||
                result.sizeBytes !== actual.sizeBytes
              )
                throw new DurableWorkerError('OBJECT_HASH_MISMATCH', {
                  retryable: false,
                });
            } else
              result = await this.storage.putStream({
                body: stream,
                objectKey: item.objectKey,
                contentType: 'application/xml',
                expectedSizeBytes: entry.uncompressedSize,
                signal,
              });
          }
          await this.persistence.extracted(job, item, entry, result);
        },
        () => this.persistence.boundary(job),
      );
      this.metrics.increment('zip_uncompressed_bytes_total', {}, uncompressed);
      this.metrics.increment(
        'zip_entries_inspected_total',
        {},
        archive.entries.length,
      );
      this.metrics.observe(
        'zip_expansion_ratio',
        {},
        uncompressed / root.sizeBytes,
      );
      this.metrics.observe(
        'zip_extraction_duration_seconds',
        {},
        (Date.now() - started) / 1000,
      );
      // Only after every entry passed real decompression/CRC/global checks may
      // an XML reach the shared scanner/parser/domain transaction.
      await this.persistence.stage(job, 'parsing');
      for (const item of reservations.values()) {
        signal.throwIfAborted();
        await this.persistence.boundary(job);
        if (!item.objectId || item.terminal) continue;
        const input = await this.xmlPersistence.loadAndBegin(job, item.itemId);
        await this.xml.process(job, input, signal);
      }
      signal.throwIfAborted();
      return await this.persistence.completion(job);
    } catch (error) {
      if (signal.aborted)
        throw new DurableWorkerError('WORKER_SHUTDOWN', { retryable: true });
      if (error instanceof DurableWorkerError) {
        if (
          [
            'ZIP_CORRUPT',
            'ZIP_LIMIT_EXCEEDED',
            'ZIP_UNSAFE_ENTRY',
            'ZIP_ENCRYPTED',
            'ZIP_NESTED',
            'OBJECT_HASH_MISMATCH',
          ].includes(error.code)
        ) {
          await this.persistence.reject(job, error.code);
          this.metrics.increment('zip_structural_rejections_total', {});
        }
        throw error;
      }
      if (error instanceof ObjectStorageError)
        throw new DurableWorkerError(
          error.code === 'OBJECT_STORAGE_NOT_FOUND'
            ? 'JOB_ROOT_OBJECT_UNAVAILABLE'
            : 'OBJECT_STORAGE_UNAVAILABLE',
          { retryable: error.code !== 'OBJECT_STORAGE_NOT_FOUND' },
        );
      if (error instanceof MalwareScannerError)
        throw new DurableWorkerError('MALWARE_SCANNER_UNAVAILABLE', {
          retryable: true,
        });
      throw error;
    } finally {
      archive?.zip.close();
    }
  }
}
