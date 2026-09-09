import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ManualZipJobHandler } from '../src/modules/cfdi/workers/manual-zip-job.handler';
import { XmlObjectProcessor } from '../src/modules/cfdi/workers/xml-object.processor';
import {
  hashStream,
  type ZipWorkerPersistenceService,
  type ReservedZipEntry,
} from '../src/modules/cfdi/workers/zip-worker-persistence.service';
import type { CfdiWorkerPersistenceService } from '../src/modules/cfdi/workers/cfdi-worker-persistence.service';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import type {
  ObjectStoragePort,
  ObjectStorageWriteInput,
} from '../src/modules/object-storage/ports/object-storage.port';
import type { MalwareScannerPort } from '../src/modules/malware-scanner/ports/malware-scanner.port';
import type { ClaimResult } from '../src/modules/ingestion/services/ingestion-job.repository';
import { DurableWorkerError } from '../src/modules/ingestion/workers/worker-error';
import {
  CfdiParserError,
  type CfdiParserPort,
  type CfdiParseResult,
} from '../src/modules/cfdi-parser';
import { makeZip } from './fixtures/zip-fixture';

const claim: ClaimResult = {
  jobId: randomUUID(),
  organizationId: randomUUID(),
  clientAccountId: randomUUID(),
  legalEntityId: randomUUID(),
  sourceType: 'manual_zip',
  uploadId: randomUUID(),
  rootObjectId: randomUUID(),
  requestedByMembershipId: randomUUID(),
  correlationId: randomUUID(),
  attemptCount: 1,
  queueAgeSeconds: 0,
  version: 1,
  recovered: false,
  workerId: 'test-worker',
  leaseToken: 'test-worker:lease',
};
const signal = () => new AbortController().signal;
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
function setup(bytes: Buffer) {
  const objects = new Map([['root', bytes]]);
  const results = new Map<string, string>();
  const reservations = new Map<number, ReservedZipEntry>();
  const storage = {
    openReadStream: jest.fn((key: string) =>
      Promise.resolve(Readable.from([objects.get(key)!])),
    ),
    openReadRange: jest.fn((key: string, start: number, end: number) =>
      Promise.resolve(Readable.from([objects.get(key)!.subarray(start, end)])),
    ),
    head: jest.fn((key: string) =>
      Promise.resolve(
        objects.has(key) ? { sizeBytes: objects.get(key)!.length } : null,
      ),
    ),
    putStream: jest.fn(async (input: ObjectStorageWriteInput) => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.body)
        chunks.push(Buffer.from(chunk as Uint8Array));
      const data = Buffer.concat(chunks);
      objects.set(input.objectKey!, data);
      return { sha256: digest(data), sizeBytes: data.length };
    }),
  } as unknown as jest.Mocked<ObjectStoragePort>;
  const persistence = {
    load: jest.fn().mockResolvedValue({
      objectId: claim.rootObjectId,
      objectKey: 'root',
      sha256: digest(bytes),
      sizeBytes: bytes.length,
      scanStatus: 'pending',
    }),
    boundary: jest.fn().mockResolvedValue(undefined),
    stage: jest.fn().mockResolvedValue(undefined),
    rootScan: jest.fn().mockResolvedValue(undefined),
    reject: jest.fn().mockResolvedValue(undefined),
    reserve: jest.fn(
      (_job: ClaimResult, entry: { ordinal: number; xml: boolean }) => {
        const existing = reservations.get(entry.ordinal);
        if (existing)
          return Promise.resolve({
            ...existing,
            terminal: results.has(existing.itemId),
          });
        const item = {
          itemId: `item-${entry.ordinal}`,
          objectId: entry.xml ? `object-${entry.ordinal}` : null,
          objectKey: entry.xml ? `object-${entry.ordinal}` : null,
          terminal: false,
        };
        reservations.set(entry.ordinal, item);
        return Promise.resolve(item);
      },
    ),
    extracted: jest.fn((_job: ClaimResult, item: ReservedZipEntry) => {
      if (!item.objectId) results.set(item.itemId, 'unsupported');
      return Promise.resolve();
    }),
    completion: jest.fn(() =>
      Promise.resolve(
        [...results.values()].some(
          (result) => result !== 'incorporated' && result !== 'duplicate',
        )
          ? 'completed_with_issues'
          : 'completed',
      ),
    ),
  } as unknown as jest.Mocked<ZipWorkerPersistenceService>;
  const xmlPersistence = {
    loadAndBegin: jest.fn((_job: ClaimResult, id: string) => {
      const item = [...reservations.values()].find(
        (item) => item.itemId === id,
      )!;
      const data = objects.get(item.objectKey!)!;
      return Promise.resolve({
        itemId: id,
        objectId: item.objectId,
        objectKey: item.objectKey,
        sha256: digest(data),
        sizeBytes: data.length,
        scanStatus: 'pending',
        itemStatus: 'pending',
        legalEntityRfc: 'AAA010101AAA',
      });
    }),
    recordCleanScan: jest.fn().mockResolvedValue(undefined),
    prepareParsing: jest.fn().mockResolvedValue(undefined),
    publishParsed: jest.fn((_job: ClaimResult, input: { itemId: string }) => {
      results.set(input.itemId, 'incorporated');
      return Promise.resolve({ completion: 'completed' });
    }),
    publishRejected: jest.fn(
      (_job: ClaimResult, input: { itemId: string }, result: string) => {
        results.set(input.itemId, result);
        return Promise.resolve({ completion: 'completed_with_issues' });
      },
    ),
    publishMalware: jest.fn((_job: ClaimResult, input: { itemId: string }) => {
      results.set(input.itemId, 'invalid');
      return Promise.resolve({ completion: 'completed_with_issues' });
    }),
  } as unknown as jest.Mocked<CfdiWorkerPersistenceService>;
  const scanner = {
    scan: jest.fn(async (stream: Readable) => ({
      verdict: 'clean',
      sizeBytes: (await hashStream(stream)).sizeBytes,
    })),
  } as unknown as jest.Mocked<MalwareScannerPort>;
  const parser = {
    parse: jest.fn(
      async (stream: Readable) =>
        ({
          sizeBytes: (await hashStream(stream)).sizeBytes,
          document: {
            issuer: { rfc: 'AAA010101AAA' },
            receiver: { rfc: 'BBB010101BBB' },
          },
        }) as CfdiParseResult,
    ),
  } as unknown as jest.Mocked<CfdiParserPort>;
  const handler = new ManualZipJobHandler(
    storage,
    scanner,
    persistence,
    xmlPersistence,
    new XmlObjectProcessor(storage, scanner, parser, xmlPersistence),
    new FiscalMetricsService(),
  );
  return {
    handler,
    storage,
    persistence,
    xmlPersistence,
    scanner,
    parser,
    objects,
    results,
    reservations,
  };
}
describe('manual_zip handler with real streaming extractor and shared XML processor', () => {
  it('processes multiple XML after root and individual scans', async () => {
    const s = setup(
      makeZip([
        { name: 'a.xml', body: Buffer.from('<a/>') },
        { name: 'b.xml', body: Buffer.from('<b/>') },
      ]),
    );
    expect(await s.handler.handle(claim, signal())).toBe('completed');
    expect(s.scanner.scan).toHaveBeenCalledTimes(3);
    expect(s.parser.parse).toHaveBeenCalledTimes(2);
  });
  it('preserves valid entries around invalid XML and non-XML', async () => {
    const s = setup(
      makeZip([
        { name: 'a.xml', body: Buffer.from('<a/>') },
        { name: 'bad.xml', body: Buffer.from('<') },
        { name: 'c.xml', body: Buffer.from('<c/>') },
        { name: 'note.txt', body: Buffer.from('ok') },
      ]),
    );
    s.parser.parse.mockImplementationOnce(async (stream) => {
      await hashStream(stream);
      throw new CfdiParserError('XML_MALFORMED', 'synthetic invalid XML');
    });
    expect(await s.handler.handle(claim, signal())).toBe(
      'completed_with_issues',
    );
    expect(
      [...s.results.values()].filter((r) => r === 'incorporated'),
    ).toHaveLength(2);
    expect(s.results.size).toBe(4);
  });
  it('malware in root prevents all extraction and parsing', async () => {
    const s = setup(makeZip([{ name: 'a.xml', body: Buffer.from('<a/>') }]));
    s.scanner.scan.mockImplementation(async (stream) => ({
      verdict: 'infected',
      sizeBytes: (await hashStream(stream)).sizeBytes,
      scanner: 'clamav',
      durationMs: 1,
      signature: 'synthetic-test',
    }));
    await expect(s.handler.handle(claim, signal())).rejects.toMatchObject({
      code: 'MALWARE_DETECTED',
    });
    expect(s.persistence.rootScan).toHaveBeenCalledWith(claim, 'infected');
    expect(s.storage.openReadRange).not.toHaveBeenCalled();
    expect(s.parser.parse).not.toHaveBeenCalled();
  });
  it('localized malware is an item result and never reaches parser', async () => {
    const s = setup(
      makeZip([
        { name: 'a.xml', body: Buffer.from('<a/>') },
        { name: 'b.xml', body: Buffer.from('<b/>') },
      ]),
    );
    let scans = 0;
    s.scanner.scan.mockImplementation(async (stream) => ({
      verdict: ++scans === 2 ? 'infected' : 'clean',
      sizeBytes: (await hashStream(stream)).sizeBytes,
      scanner: 'clamav',
      durationMs: 1,
      signature: 'synthetic-test',
    }));
    expect(await s.handler.handle(claim, signal())).toBe(
      'completed_with_issues',
    );
    expect(s.xmlPersistence.publishMalware).toHaveBeenCalledTimes(1);
    expect(s.parser.parse).toHaveBeenCalledTimes(1);
  });
  it('structural rejection publishes no CFDI even with a valid first XML', async () => {
    const s = setup(
      makeZip([
        { name: 'a.xml', body: Buffer.from('<a/>') },
        { name: 'hidden.bin', body: makeZip([]) },
      ]),
    );
    await expect(s.handler.handle(claim, signal())).rejects.toMatchObject({
      code: 'ZIP_NESTED',
    });
    expect(s.parser.parse).not.toHaveBeenCalled();
    expect(s.persistence.reject).toHaveBeenCalledWith(claim, 'ZIP_NESTED');
  });
  it.each(['ZIP_CANCELLED', 'JOB_LEASE_LOST'])(
    'honors %s before extraction and terminal publication',
    async (code) => {
      const s = setup(makeZip([{ name: 'a.xml' }]));
      s.persistence.boundary.mockRejectedValueOnce(
        new DurableWorkerError(code, { retryable: false }),
      );
      await expect(s.handler.handle(claim, signal())).rejects.toMatchObject({
        code,
      });
      expect(s.storage.putStream).not.toHaveBeenCalled();
      expect(s.persistence.completion).not.toHaveBeenCalled();
    },
  );
  it('reexecution preserves items and avoids parsing terminal results again', async () => {
    const s = setup(
      makeZip([
        { name: 'a.xml', body: Buffer.from('<a/>') },
        { name: 'note.txt' },
      ]),
    );
    await s.handler.handle(claim, signal());
    await s.handler.handle(
      { ...claim, recovered: true, attemptCount: 2 },
      signal(),
    );
    expect(s.reservations.size).toBe(2);
    expect(s.storage.putStream).toHaveBeenCalledTimes(1);
    expect(s.parser.parse).toHaveBeenCalledTimes(1);
  });
  it('reuses an extracted object after a crash before parsing', async () => {
    const s = setup(makeZip([{ name: 'a.xml', body: Buffer.from('<a/>') }]));
    s.xmlPersistence.loadAndBegin.mockRejectedValueOnce(
      new DurableWorkerError('OBJECT_STORAGE_UNAVAILABLE', { retryable: true }),
    );
    await expect(s.handler.handle(claim, signal())).rejects.toMatchObject({
      retryable: true,
    });
    await s.handler.handle(claim, signal());
    expect(s.storage.putStream).toHaveBeenCalledTimes(1);
    expect(s.parser.parse).toHaveBeenCalledTimes(1);
  });
  it('does not publish after losing lease between XML entries', async () => {
    const s = setup(
      makeZip([
        { name: 'a.xml', body: Buffer.from('<a/>') },
        { name: 'b.xml', body: Buffer.from('<b/>') },
      ]),
    );
    s.persistence.boundary.mockImplementation(() =>
      s.results.size
        ? Promise.reject(
            new DurableWorkerError('JOB_LEASE_LOST', { retryable: false }),
          )
        : Promise.resolve(),
    );
    await expect(s.handler.handle(claim, signal())).rejects.toMatchObject({
      code: 'JOB_LEASE_LOST',
    });
    expect(s.results.size).toBe(1);
    expect(s.persistence.completion).not.toHaveBeenCalled();
  });
});
