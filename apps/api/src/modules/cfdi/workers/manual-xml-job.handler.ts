import { Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual, type Hash } from 'node:crypto';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CFDI_PARSER_PORT,
  CfdiParserError,
  type CfdiParserPort,
} from '../../cfdi-parser';
import type { ClaimResult } from '../../ingestion/services/ingestion-job.repository';
import type {
  IngestionJobHandler,
  IngestionJobHandlerResult,
} from '../../ingestion/workers/ingestion-job.registry';
import { DurableWorkerError } from '../../ingestion/workers/worker-error';
import { MalwareScannerError } from '../../malware-scanner/malware-scanner.errors';
import { MALWARE_SCANNER_PORT } from '../../malware-scanner/malware-scanner.tokens';
import type { MalwareScannerPort } from '../../malware-scanner/ports/malware-scanner.port';
import { ObjectStorageError } from '../../object-storage/object-storage.errors';
import { OBJECT_STORAGE_PORT } from '../../object-storage/object-storage.tokens';
import type { ObjectStoragePort } from '../../object-storage/ports/object-storage.port';
import { CfdiWorkerPersistenceService } from './cfdi-worker-persistence.service';

@Injectable()
export class ManualXmlJobHandler implements IngestionJobHandler {
  readonly source = 'manual_xml' as const;

  constructor(
    @Inject(OBJECT_STORAGE_PORT)
    private readonly storage: ObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT)
    private readonly scanner: MalwareScannerPort,
    @Inject(CFDI_PARSER_PORT)
    private readonly parser: CfdiParserPort,
    private readonly persistence: CfdiWorkerPersistenceService,
  ) {}

  async handle(
    job: ClaimResult,
    signal: AbortSignal,
  ): Promise<IngestionJobHandlerResult> {
    const input = await this.persistence.loadAndBegin(job);
    if (input.itemStatus === 'terminal' && input.itemResult) {
      return input.hasIssues || isIssueResult(input.itemResult)
        ? 'completed_with_issues'
        : 'completed';
    }
    this.assertNotAborted(signal);

    if (input.scanStatus === 'infected') {
      return (await this.persistence.publishMalware(job, input)).completion;
    }
    if (!['clean', 'bypassed'].includes(input.scanStatus)) {
      try {
        const scan = await this.consumeVerifiedObject(
          input,
          signal,
          (scanStream) => this.scanner.scan(scanStream, { signal }),
        );
        if (scan.sizeBytes !== input.sizeBytes) {
          throw new DurableWorkerError('OBJECT_HASH_MISMATCH', {
            retryable: false,
          });
        }
        if (scan.verdict === 'infected') {
          return (await this.persistence.publishMalware(job, input)).completion;
        }
        await this.persistence.recordCleanScan(job, input, scan.verdict);
      } catch (error) {
        throw this.infrastructureError(error, signal);
      }
    } else {
      await this.persistence.prepareParsing(job);
    }

    this.assertNotAborted(signal);
    try {
      const parsed = await this.consumeVerifiedObject(
        input,
        signal,
        (parseStream) => this.parser.parse(parseStream, { signal }),
      );
      if (parsed.sizeBytes !== input.sizeBytes) {
        throw new DurableWorkerError('OBJECT_HASH_MISMATCH', {
          retryable: false,
        });
      }
      if (
        input.legalEntityRfc !== parsed.document.issuer.rfc &&
        input.legalEntityRfc !== parsed.document.receiver.rfc
      ) {
        return (
          await this.persistence.publishRejected(
            job,
            input,
            'foreign',
            'CFDI_RFC_FOREIGN',
            parsed,
          )
        ).completion;
      }
      return (await this.persistence.publishParsed(job, input, parsed))
        .completion;
    } catch (error) {
      if (error instanceof CfdiParserError) {
        if (error.code === 'PARSER_ABORTED') {
          this.assertNotAborted(signal);
          throw new DurableWorkerError('PARSER_INTERNAL_ERROR', {
            retryable: true,
          });
        }
        if (error.code === 'PARSER_INTERNAL_ERROR') {
          throw new DurableWorkerError(error.code, { retryable: true });
        }
        const result =
          error.code === 'CFDI_VERSION_UNSUPPORTED' ||
          error.code === 'COMPLEMENT_UNSUPPORTED'
            ? 'unsupported'
            : 'invalid';
        return (
          await this.persistence.publishRejected(job, input, result, error.code)
        ).completion;
      }
      throw this.infrastructureError(error, signal);
    }
  }

  /**
   * Hashes the exact stream observed by a downstream scanner/parser and only
   * returns its result after the whole object has been consumed and verified.
   * This keeps the verification streaming and prevents a same-size object
   * substitution from reaching a terminal publication.
   */
  private async consumeVerifiedObject<TResult>(
    input: { objectKey: string; sha256: string; sizeBytes: number },
    signal: AbortSignal,
    consume: (stream: Readable) => Promise<TResult>,
  ): Promise<TResult> {
    const source = await this.storage.openReadStream(input.objectKey, signal);
    const integrity = new ObjectReadIntegrityTransform();
    const pump = pipeline(source, integrity);
    // The consumer owns the readable side. Observe the pump immediately so a
    // fast storage rejection cannot become an unhandled promise rejection.
    void pump.catch(() => undefined);

    try {
      const result = await consume(integrity);

      // Production ports consume to EOF. Draining here also makes lightweight
      // contract fakes deterministic without weakening the size/hash checks.
      if (!integrity.readableEnded && !integrity.destroyed) {
        for await (const ignoredChunk of integrity) {
          // Integrity is updated in the transform; no payload is retained.
          void ignoredChunk;
        }
      }
      await pump;
      integrity.assertMatches(input.sha256, input.sizeBytes);
      return result;
    } catch (error) {
      source.destroy();
      integrity.destroy();
      await pump.catch(() => undefined);
      throw error;
    }
  }

  private infrastructureError(
    error: unknown,
    signal: AbortSignal,
  ): DurableWorkerError {
    this.assertNotAborted(signal);
    if (error instanceof DurableWorkerError) return error;
    if (error instanceof ObjectStorageError) {
      switch (error.code) {
        case 'OBJECT_STORAGE_LIMIT_EXCEEDED':
          return new DurableWorkerError('INGESTION_FILE_TOO_LARGE', {
            retryable: false,
          });
        case 'OBJECT_STORAGE_SIZE_MISMATCH':
          return new DurableWorkerError('OBJECT_HASH_MISMATCH', {
            retryable: false,
          });
        case 'OBJECT_STORAGE_INVALID_CONFIGURATION':
        case 'OBJECT_STORAGE_UNSUPPORTED_OPERATION':
          return new DurableWorkerError('CONFIGURATION_INVALID', {
            retryable: false,
          });
        case 'OBJECT_STORAGE_INVALID_KEY':
        case 'OBJECT_STORAGE_NOT_FOUND':
          return new DurableWorkerError('JOB_ROOT_OBJECT_UNAVAILABLE', {
            retryable: false,
          });
        case 'OBJECT_STORAGE_CONFLICT':
          return new DurableWorkerError('JOB_STATE_CONFLICT', {
            retryable: false,
          });
        case 'OBJECT_STORAGE_UNAVAILABLE':
          return new DurableWorkerError('OBJECT_STORAGE_UNAVAILABLE', {
            retryable: true,
          });
      }
    }
    if (error instanceof MalwareScannerError) {
      switch (error.code) {
        case 'MALWARE_SCANNER_INVALID_CONFIGURATION':
          return new DurableWorkerError('CONFIGURATION_INVALID', {
            retryable: false,
          });
        case 'MALWARE_SCANNER_LIMIT_EXCEEDED':
          return new DurableWorkerError('INGESTION_FILE_TOO_LARGE', {
            retryable: false,
          });
        case 'MALWARE_SCANNER_PROTOCOL_ERROR':
        case 'MALWARE_SCANNER_ABORTED':
          return new DurableWorkerError('MALWARE_SCANNER_UNAVAILABLE', {
            retryable: true,
          });
        case 'MALWARE_SCANNER_TIMEOUT':
        case 'MALWARE_SCANNER_UNAVAILABLE':
          return new DurableWorkerError(error.code, { retryable: true });
      }
    }
    return new DurableWorkerError('UNEXPECTED_WORKER_ERROR', {
      retryable: true,
    });
  }

  private assertNotAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DurableWorkerError('WORKER_SHUTDOWN', { retryable: true });
    }
  }
}

class ObjectReadIntegrityTransform extends Transform {
  private readonly hash: Hash = createHash('sha256');
  private sizeBytes = 0;
  private finalized = false;

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.sizeBytes += bytes.length;
    this.hash.update(bytes);
    callback(null, bytes);
  }

  assertMatches(expectedSha256: string, expectedSizeBytes: number): void {
    if (this.finalized) {
      throw new DurableWorkerError('OBJECT_HASH_MISMATCH', {
        retryable: false,
      });
    }
    this.finalized = true;
    const actualDigest = this.hash.digest();
    const expectedDigest = /^[0-9a-f]{64}$/i.test(expectedSha256)
      ? Buffer.from(expectedSha256, 'hex')
      : Buffer.alloc(0);
    const hashMatches =
      expectedDigest.length === actualDigest.length &&
      timingSafeEqual(expectedDigest, actualDigest);

    if (this.sizeBytes !== expectedSizeBytes || !hashMatches) {
      throw new DurableWorkerError('OBJECT_HASH_MISMATCH', {
        retryable: false,
      });
    }
  }
}

function isIssueResult(result: string): boolean {
  return ['foreign', 'invalid', 'unsupported', 'internal_error'].includes(
    result,
  );
}
