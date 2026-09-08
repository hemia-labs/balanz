import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { CfdiParseResult } from '../src/modules/cfdi-parser';
import type { ClaimResult } from '../src/modules/ingestion/services/ingestion-job.repository';
import { DurableWorkerError } from '../src/modules/ingestion/workers/worker-error';
import { ObjectStorageError } from '../src/modules/object-storage/object-storage.errors';
import type { ObjectStoragePort } from '../src/modules/object-storage/ports/object-storage.port';
import type { MalwareScannerPort } from '../src/modules/malware-scanner/ports/malware-scanner.port';
import { MalwareScannerError } from '../src/modules/malware-scanner/malware-scanner.errors';
import type { CfdiParserPort } from '../src/modules/cfdi-parser';
import { CfdiParserError } from '../src/modules/cfdi-parser';
import { ManualXmlJobHandler } from '../src/modules/cfdi/workers/manual-xml-job.handler';
import type { CfdiWorkerPersistenceService } from '../src/modules/cfdi/workers/cfdi-worker-persistence.service';

const claim: ClaimResult = {
  jobId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  clientAccountId: '33333333-3333-4333-8333-333333333333',
  legalEntityId: '44444444-4444-4444-8444-444444444444',
  sourceType: 'manual_xml',
  uploadId: '55555555-5555-4555-8555-555555555555',
  rootObjectId: '66666666-6666-4666-8666-666666666666',
  requestedByMembershipId: '77777777-7777-4777-8777-777777777777',
  correlationId: '88888888-8888-4888-8888-888888888888',
  attemptCount: 1,
  queueAgeSeconds: 0,
  version: 2,
  recovered: false,
  workerId: 'worker:test',
  leaseToken: 'worker:test:lease',
};

const objectBytes = Buffer.from('x'.repeat(42), 'utf8');
const objectSha256 = createHash('sha256').update(objectBytes).digest('hex');

const input = {
  objectId: claim.rootObjectId!,
  objectKey: 'objects/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sha256: objectSha256,
  sizeBytes: objectBytes.length,
  lifecycleState: 'uploaded',
  scanStatus: 'pending',
  legalEntityRfc: 'AAA010101AAA',
  itemId: '99999999-9999-4999-8999-999999999999',
  itemStatus: 'pending',
  itemResult: null,
  hasIssues: false,
};

const parsed = {
  parserVersion: 'balanz-cfdi-saxes/1.0.0',
  schemaVersion: 'sat-cfdi-4.0+tfd-1.1+pagos-2.0+nomina-1.2@2026-09-03',
  sizeBytes: 42,
  document: {
    issuer: { rfc: 'AAA010101AAA' },
    receiver: { rfc: 'BBB010101BBB' },
  },
} as unknown as CfdiParseResult;

async function consumeBytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const value of stream as AsyncIterable<unknown>) {
    if (typeof value === 'string' || value instanceof Uint8Array) {
      chunks.push(Buffer.from(value));
      continue;
    }
    throw new Error('Synthetic stream emitted an unsupported chunk');
  }
  return Buffer.concat(chunks);
}

function setup(overrides?: {
  storage?: Partial<ObjectStoragePort>;
  scanner?: Partial<MalwareScannerPort>;
  parser?: Partial<CfdiParserPort>;
  persistence?: Partial<CfdiWorkerPersistenceService>;
}) {
  const storage = {
    openReadStream: jest
      .fn()
      .mockImplementation(() => Promise.resolve(Readable.from([objectBytes]))),
    ...overrides?.storage,
  } as unknown as jest.Mocked<ObjectStoragePort>;
  const scanner = {
    scan: jest.fn().mockResolvedValue({
      verdict: 'clean',
      scanner: 'clamav',
      durationMs: 1,
      sizeBytes: 42,
    }),
    ...overrides?.scanner,
  } as unknown as jest.Mocked<MalwareScannerPort>;
  const parser = {
    parse: jest.fn().mockResolvedValue(parsed),
    ...overrides?.parser,
  } as unknown as jest.Mocked<CfdiParserPort>;
  const persistence = {
    loadAndBegin: jest.fn().mockResolvedValue(input),
    recordCleanScan: jest.fn().mockResolvedValue(undefined),
    prepareParsing: jest.fn().mockResolvedValue(undefined),
    publishMalware: jest
      .fn()
      .mockResolvedValue({ completion: 'completed_with_issues' }),
    publishRejected: jest
      .fn()
      .mockResolvedValue({ completion: 'completed_with_issues' }),
    publishParsed: jest.fn().mockResolvedValue({ completion: 'completed' }),
    ...overrides?.persistence,
  } as unknown as jest.Mocked<CfdiWorkerPersistenceService>;
  return {
    storage,
    scanner,
    parser,
    persistence,
    handler: new ManualXmlJobHandler(storage, scanner, parser, persistence),
  };
}

describe('ManualXmlJobHandler', () => {
  it('streams the verified object bytes through both scanner and parser', async () => {
    const scannerBytes: Buffer[] = [];
    const parserBytes: Buffer[] = [];
    const dependencies = setup({
      scanner: {
        scan: jest.fn().mockImplementation(async (stream: Readable) => {
          scannerBytes.push(await consumeBytes(stream));
          return {
            verdict: 'clean',
            scanner: 'clamav',
            durationMs: 1,
            sizeBytes: objectBytes.length,
          };
        }),
      },
      parser: {
        parse: jest.fn().mockImplementation(async (stream: Readable) => {
          parserBytes.push(await consumeBytes(stream));
          return parsed;
        }),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).resolves.toBe('completed');
    expect(scannerBytes).toEqual([objectBytes]);
    expect(parserBytes).toEqual([objectBytes]);
  });

  it('scans before parsing and publishes a supported CFDI', async () => {
    const dependencies = setup();

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).resolves.toBe('completed');

    expect(dependencies.scanner.scan).toHaveBeenCalledTimes(1);
    expect(dependencies.persistence.recordCleanScan).toHaveBeenCalledWith(
      claim,
      input,
      'clean',
    );
    expect(dependencies.parser.parse).toHaveBeenCalledTimes(1);
    expect(dependencies.persistence.publishParsed).toHaveBeenCalledWith(
      claim,
      input,
      parsed,
    );
    expect(dependencies.storage.openReadStream).toHaveBeenCalledTimes(2);
    expect(dependencies.scanner.scan.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.parser.parse.mock.invocationCallOrder[0],
    );
  });

  it('does not rescan a durable clean object after a worker restart', async () => {
    const resumed = { ...input, scanStatus: 'clean' };
    const dependencies = setup({
      persistence: {
        loadAndBegin: jest.fn().mockResolvedValue(resumed),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).resolves.toBe('completed');
    expect(dependencies.scanner.scan).not.toHaveBeenCalled();
    expect(dependencies.persistence.prepareParsing).toHaveBeenCalledWith(claim);
    expect(dependencies.storage.openReadStream).toHaveBeenCalledTimes(1);
    expect(dependencies.persistence.publishParsed).toHaveBeenCalledWith(
      claim,
      resumed,
      parsed,
    );
  });

  it('publishes malware without invoking the parser', async () => {
    const dependencies = setup({
      scanner: {
        scan: jest.fn().mockResolvedValue({
          verdict: 'infected',
          scanner: 'clamav',
          durationMs: 1,
          sizeBytes: 42,
          signature: 'Synthetic.Test',
        }),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).resolves.toBe('completed_with_issues');
    expect(dependencies.persistence.publishMalware).toHaveBeenCalled();
    expect(dependencies.parser.parse).not.toHaveBeenCalled();
  });

  it('does not reopen an object already durably classified as infected', async () => {
    const infected = { ...input, scanStatus: 'infected' };
    const dependencies = setup({
      persistence: {
        loadAndBegin: jest.fn().mockResolvedValue(infected),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).resolves.toBe('completed_with_issues');
    expect(dependencies.storage.openReadStream).not.toHaveBeenCalled();
    expect(dependencies.scanner.scan).not.toHaveBeenCalled();
    expect(dependencies.persistence.publishMalware).toHaveBeenCalledWith(
      claim,
      infected,
    );
  });

  it('resumes a terminal durable item without re-reading storage', async () => {
    const dependencies = setup({
      persistence: {
        loadAndBegin: jest.fn().mockResolvedValue({
          ...input,
          itemStatus: 'terminal',
          itemResult: 'duplicate',
        }),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).resolves.toBe('completed');
    expect(dependencies.storage.openReadStream).not.toHaveBeenCalled();
  });

  it('classifies a foreign RFC without persisting a CFDI', async () => {
    const dependencies = setup({
      parser: {
        parse: jest.fn().mockResolvedValue({
          ...parsed,
          document: {
            ...parsed.document,
            issuer: { rfc: 'CCC010101CCC' },
            receiver: { rfc: 'DDD010101DDD' },
          },
        }),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).resolves.toBe('completed_with_issues');
    expect(dependencies.persistence.publishRejected).toHaveBeenCalledWith(
      claim,
      input,
      'foreign',
      'CFDI_RFC_FOREIGN',
      expect.any(Object),
    );
    expect(dependencies.persistence.publishParsed).not.toHaveBeenCalled();
  });

  it.each([
    ['CFDI_VERSION_UNSUPPORTED', 'unsupported'],
    ['XML_MALFORMED', 'invalid'],
    ['XML_SECURITY_VIOLATION', 'invalid'],
    ['CFDI_UUID_INVALID', 'invalid'],
  ] as const)('publishes parser code %s as %s', async (code, result) => {
    const dependencies = setup({
      parser: {
        parse: jest
          .fn()
          .mockRejectedValue(new CfdiParserError(code, 'safe parser error')),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).resolves.toBe('completed_with_issues');
    expect(dependencies.persistence.publishRejected).toHaveBeenCalledWith(
      claim,
      input,
      result,
      code,
    );
  });

  it('keeps storage failures retryable with a stable code', async () => {
    const dependencies = setup({
      storage: {
        openReadStream: jest
          .fn()
          .mockRejectedValue(
            new ObjectStorageError(
              'OBJECT_STORAGE_UNAVAILABLE',
              'synthetic outage',
            ),
          ),
      },
    });

    try {
      await dependencies.handler.handle(claim, new AbortController().signal);
      throw new Error('Expected handler to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DurableWorkerError);
      expect(error).toMatchObject({
        code: 'OBJECT_STORAGE_UNAVAILABLE',
        retryable: true,
      });
    }
  });

  it.each([
    ['OBJECT_STORAGE_LIMIT_EXCEEDED', 'INGESTION_FILE_TOO_LARGE'],
    ['OBJECT_STORAGE_SIZE_MISMATCH', 'OBJECT_HASH_MISMATCH'],
    ['OBJECT_STORAGE_INVALID_CONFIGURATION', 'CONFIGURATION_INVALID'],
    ['OBJECT_STORAGE_UNSUPPORTED_OPERATION', 'CONFIGURATION_INVALID'],
    ['OBJECT_STORAGE_INVALID_KEY', 'JOB_ROOT_OBJECT_UNAVAILABLE'],
    ['OBJECT_STORAGE_NOT_FOUND', 'JOB_ROOT_OBJECT_UNAVAILABLE'],
    ['OBJECT_STORAGE_CONFLICT', 'JOB_STATE_CONFLICT'],
  ] as const)(
    'maps permanent storage error %s to non-retryable %s',
    async (adapterCode, durableCode) => {
      const dependencies = setup({
        storage: {
          openReadStream: jest
            .fn()
            .mockRejectedValue(
              new ObjectStorageError(adapterCode, 'private adapter detail'),
            ),
        },
      });

      await expect(
        dependencies.handler.handle(claim, new AbortController().signal),
      ).rejects.toMatchObject({ code: durableCode, retryable: false });
      expect(dependencies.parser.parse).not.toHaveBeenCalled();
    },
  );

  it('keeps a scanner outage retryable and does not parse unscanned bytes', async () => {
    const dependencies = setup({
      scanner: {
        scan: jest
          .fn()
          .mockRejectedValue(
            new MalwareScannerError(
              'MALWARE_SCANNER_UNAVAILABLE',
              'synthetic outage',
            ),
          ),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'MALWARE_SCANNER_UNAVAILABLE',
      retryable: true,
    });
    expect(dependencies.parser.parse).not.toHaveBeenCalled();
    expect(dependencies.persistence.publishParsed).not.toHaveBeenCalled();
  });

  it.each([
    ['MALWARE_SCANNER_INVALID_CONFIGURATION', 'CONFIGURATION_INVALID'],
    ['MALWARE_SCANNER_LIMIT_EXCEEDED', 'INGESTION_FILE_TOO_LARGE'],
  ] as const)(
    'maps permanent scanner error %s to non-retryable %s',
    async (adapterCode, durableCode) => {
      const dependencies = setup({
        scanner: {
          scan: jest
            .fn()
            .mockRejectedValue(
              new MalwareScannerError(adapterCode, 'private scanner detail'),
            ),
        },
      });

      await expect(
        dependencies.handler.handle(claim, new AbortController().signal),
      ).rejects.toMatchObject({ code: durableCode, retryable: false });
      expect(dependencies.parser.parse).not.toHaveBeenCalled();
    },
  );

  it.each([
    'MALWARE_SCANNER_PROTOCOL_ERROR',
    'MALWARE_SCANNER_ABORTED',
  ] as const)(
    'maps transient scanner error %s to the stable unavailable code',
    async (adapterCode) => {
      const dependencies = setup({
        scanner: {
          scan: jest
            .fn()
            .mockRejectedValue(
              new MalwareScannerError(adapterCode, 'private scanner detail'),
            ),
        },
      });

      await expect(
        dependencies.handler.handle(claim, new AbortController().signal),
      ).rejects.toMatchObject({
        code: 'MALWARE_SCANNER_UNAVAILABLE',
        retryable: true,
      });
      expect(dependencies.parser.parse).not.toHaveBeenCalled();
    },
  );

  it('rejects a scan byte-count mismatch without parsing', async () => {
    const dependencies = setup({
      scanner: {
        scan: jest.fn().mockResolvedValue({
          verdict: 'clean',
          scanner: 'clamav',
          durationMs: 1,
          sizeBytes: 41,
        }),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'OBJECT_HASH_MISMATCH',
      retryable: false,
    });
    expect(dependencies.parser.parse).not.toHaveBeenCalled();
    expect(dependencies.persistence.recordCleanScan).not.toHaveBeenCalled();
  });

  it('rejects a same-size storage substitution observed by the scanner', async () => {
    const substitutedBytes = Buffer.from(
      'y'.repeat(objectBytes.length),
      'utf8',
    );
    const dependencies = setup({
      storage: {
        openReadStream: jest
          .fn()
          .mockResolvedValue(Readable.from([substitutedBytes])),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'OBJECT_HASH_MISMATCH',
      retryable: false,
    });
    expect(substitutedBytes).toHaveLength(objectBytes.length);
    expect(dependencies.persistence.recordCleanScan).not.toHaveBeenCalled();
    expect(dependencies.parser.parse).not.toHaveBeenCalled();
    expect(dependencies.persistence.publishParsed).not.toHaveBeenCalled();
  });

  it('does not publish an infected terminal result for substituted bytes', async () => {
    const substitutedBytes = Buffer.from(
      'm'.repeat(objectBytes.length),
      'utf8',
    );
    const dependencies = setup({
      storage: {
        openReadStream: jest
          .fn()
          .mockResolvedValue(Readable.from([substitutedBytes])),
      },
      scanner: {
        scan: jest.fn().mockResolvedValue({
          verdict: 'infected',
          scanner: 'clamav',
          durationMs: 1,
          sizeBytes: objectBytes.length,
          signature: 'Synthetic.Test',
        }),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'OBJECT_HASH_MISMATCH',
      retryable: false,
    });
    expect(dependencies.persistence.publishMalware).not.toHaveBeenCalled();
    expect(dependencies.persistence.publishParsed).not.toHaveBeenCalled();
  });

  it('rejects a same-size substitution between scanning and parsing', async () => {
    const substitutedBytes = Buffer.from(
      'z'.repeat(objectBytes.length),
      'utf8',
    );
    const dependencies = setup({
      storage: {
        openReadStream: jest
          .fn()
          .mockResolvedValueOnce(Readable.from([objectBytes]))
          .mockResolvedValueOnce(Readable.from([substitutedBytes])),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'OBJECT_HASH_MISMATCH',
      retryable: false,
    });
    expect(substitutedBytes).toHaveLength(objectBytes.length);
    expect(dependencies.persistence.recordCleanScan).toHaveBeenCalledTimes(1);
    expect(dependencies.parser.parse).toHaveBeenCalledTimes(1);
    expect(dependencies.persistence.publishParsed).not.toHaveBeenCalled();
  });

  it('rejects a parser byte-count mismatch before publishing fiscal data', async () => {
    const dependencies = setup({
      parser: {
        parse: jest.fn().mockResolvedValue({ ...parsed, sizeBytes: 41 }),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'OBJECT_HASH_MISMATCH',
      retryable: false,
    });
    expect(dependencies.persistence.publishParsed).not.toHaveBeenCalled();
  });

  it('keeps an internal parser failure retryable without exposing its detail', async () => {
    const xmlCanary = '<Comprobante SYNTHETIC_XML_LOG_CANARY="secret" />';
    const dependencies = setup({
      parser: {
        parse: jest
          .fn()
          .mockRejectedValue(
            new CfdiParserError('PARSER_INTERNAL_ERROR', xmlCanary),
          ),
      },
    });

    try {
      await dependencies.handler.handle(claim, new AbortController().signal);
      throw new Error('Expected the handler to reject');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PARSER_INTERNAL_ERROR',
        retryable: true,
        safeDetail: undefined,
      });
      expect(JSON.stringify(error)).not.toContain(xmlCanary);
    }
    expect(dependencies.persistence.publishRejected).not.toHaveBeenCalled();
  });

  it('preserves lease fencing failures from the persistence publication', async () => {
    const dependencies = setup({
      persistence: {
        publishParsed: jest
          .fn()
          .mockRejectedValue(
            new DurableWorkerError('JOB_LEASE_LOST', { retryable: false }),
          ),
      },
    });

    await expect(
      dependencies.handler.handle(claim, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'JOB_LEASE_LOST', retryable: false });
  });

  it('stops before infrastructure work when its lease signal is aborted', async () => {
    const dependencies = setup();
    const abort = new AbortController();
    abort.abort();

    await expect(
      dependencies.handler.handle(claim, abort.signal),
    ).rejects.toMatchObject({ code: 'WORKER_SHUTDOWN' });
    expect(dependencies.storage.openReadStream).not.toHaveBeenCalled();
  });
});
