import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import type { Request } from 'express';
import type { Repository } from 'typeorm';
import type { RequestContext } from '../src/common/decorators/request-context.decorator';
import type { ClientAccountScopeService } from '../src/modules/client-accounts/client-account-scope.service';
import {
  LegalEntity,
  LegalEntityStatus,
} from '../src/modules/client-accounts/entities/legal-entity.entity';
import type { XmlUploadService as XmlUploadServiceType } from '../src/modules/cfdi/services/xml-upload.service';
import { XmlUploadService } from '../src/modules/cfdi/services/xml-upload.service';
import {
  IngestionAdmissionLimitError,
  type ConfirmUploadInput,
  type IngestionIdempotencyRepository,
  type UploadIntentRecord,
} from '../src/modules/ingestion/services/ingestion-idempotency.repository';
import type { ObjectStoragePort } from '../src/modules/object-storage/ports/object-storage.port';
import { ObjectStorageError } from '../src/modules/object-storage/object-storage.errors';
import type { OpaqueObjectKeyFactory } from '../src/modules/object-storage/services/opaque-object-key.factory';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

const ids = {
  organization: '11111111-1111-4111-8111-111111111111',
  account: '22222222-2222-4222-8222-222222222222',
  entity: '33333333-3333-4333-8333-333333333333',
  membership: '44444444-4444-4444-8444-444444444444',
  session: '55555555-5555-4555-8555-555555555555',
  user: '66666666-6666-4666-8666-666666666666',
  upload: '77777777-7777-4777-8777-777777777777',
  object: '88888888-8888-4888-8888-888888888888',
  job: '99999999-9999-4999-8999-999999999999',
};

const tenant: SessionAuthorizationContext = {
  userId: ids.user,
  sessionId: ids.session,
  organizationId: ids.organization,
  membershipId: ids.membership,
  role: 'accountant',
  permissions: ['ingestion.create'],
  assignedAccountIds: [ids.account],
  accountAccessMode: 'assigned',
  mfaVerifiedAt: null,
  reauthenticatedAt: null,
  requiresMfa: false,
  mfaStatus: 'disabled',
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  tenantActive: true,
  reauthenticationRequiredActions: [],
};

const requestContext: RequestContext = {
  correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ipAddress: '127.0.0.1',
};

function httpBody(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected HTTP ${status} ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect(httpBody(error)).toMatchObject({ code });
  }
}

interface MultipartPart {
  filename?: string;
  fieldName?: string;
  mimeType?: string;
  value: string | Buffer;
}

function multipartRequest(parts: MultipartPart[]): Request {
  const boundary = '----balanz-phase-one-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const field = part.fieldName ?? 'file';
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    if (part.filename !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${field}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.mimeType ?? 'application/xml'}\r\n\r\n`,
          'utf8',
        ),
      );
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${field}"\r\n\r\n`,
          'utf8',
        ),
      );
    }
    chunks.push(
      Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value),
    );
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  const stream = Readable.from(chunks, { autoDestroy: false }) as Request;
  stream.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
  return stream;
}

function setup(options?: {
  maxBytes?: number;
  intentOutcome?: 'created' | 'replayed';
  apiPrefix?: string;
  replayBytes?: string | Buffer;
}) {
  const objectKey = 'objects/aa/synthetic-key';
  const replayBytes = Buffer.isBuffer(options?.replayBytes)
    ? options.replayBytes
    : Buffer.from(options?.replayBytes ?? '<Comprobante />');
  const now = new Date('2026-09-03T10:00:00.000Z');
  const intentValue: UploadIntentRecord = {
    uploadId: ids.upload,
    objectId: ids.object,
    objectKey,
    originalFilename: 'invoice.xml',
    declaredMimeType: 'application/xml',
    state: options?.intentOutcome === 'replayed' ? 'confirmed' : 'receiving',
    actualSizeBytes:
      options?.intentOutcome === 'replayed' ? String(replayBytes.length) : null,
    actualSha256:
      options?.intentOutcome === 'replayed'
        ? createHash('sha256').update(replayBytes).digest('hex')
        : null,
    storageEtag: null,
    storageVersionId: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    receiverVersion: options?.intentOutcome === 'replayed' ? null : 1,
    responseStatus: 201,
    responseReference: `/api/v1/ingestion-uploads/${ids.upload}`,
  };
  const entity = {
    id: ids.entity,
    organizationId: ids.organization,
    clientAccountId: ids.account,
    rfc: 'AAA010101AAA',
    legalName: 'Synthetic Entity',
    status: LegalEntityStatus.ACTIVE,
  } as LegalEntity;
  const legalEntities = {
    findOne: jest.fn().mockResolvedValue(entity),
  } as unknown as jest.Mocked<Repository<LegalEntity>>;
  const accountScope = {
    requireAccessibleAccount: jest.fn().mockResolvedValue({ id: ids.account }),
  } as unknown as jest.Mocked<ClientAccountScopeService>;
  const idempotency = {
    createUploadIntent: jest.fn().mockResolvedValue({
      outcome: options?.intentOutcome ?? 'created',
      value: intentValue,
    }),
    claimUploadReceiver: jest.fn().mockResolvedValue({
      outcome: 'busy',
      value: intentValue,
    }),
    renewUploadReceiver: jest
      .fn()
      .mockImplementation(
        (_scope: unknown, _uploadId: string, version: number) =>
          Promise.resolve(version + 1),
      ),
    confirmUpload: jest.fn().mockResolvedValue({
      outcome: options?.intentOutcome ?? 'created',
      value: {
        ...intentValue,
        state: 'confirmed',
        responseStatus: 200,
        responseReference: `/api/v1/ingestion-uploads/${ids.upload}`,
      },
    }),
    createJob: jest.fn().mockResolvedValue({
      outcome: options?.intentOutcome ?? 'created',
      value: {
        jobId: ids.job,
        status: 'queued',
        responseStatus: 202,
        responseReference: `/api/v1/ingestions/${ids.job}`,
      },
    }),
    failUpload: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<IngestionIdempotencyRepository>;
  const objectKeys = {
    create: jest.fn().mockReturnValue(objectKey),
  } as unknown as jest.Mocked<OpaqueObjectKeyFactory>;
  const storage = {
    putStream: jest.fn(async ({ body }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      return {
        provider: 'local' as const,
        objectKey,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    head: jest.fn().mockResolvedValue(null),
    openReadStream: jest.fn().mockResolvedValue(Readable.from([replayBytes])),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ObjectStoragePort>;
  const config = {
    get: jest.fn().mockReturnValue(options?.apiPrefix ?? 'api/v1'),
    getOrThrow: jest.fn().mockReturnValue({
      storage: { driver: 'local', s3: {} },
      worker: { leaseSeconds: 90, heartbeatSeconds: 30 },
      limits: {
        directUploadXmlCount: 1,
        xmlBytes: options?.maxBytes ?? 5 * 1024 * 1024,
      },
    }),
  } as unknown as ConfigService;
  const service: XmlUploadServiceType = new XmlUploadService(
    legalEntities,
    accountScope,
    idempotency,
    objectKeys,
    storage,
    config,
  );
  return {
    service,
    legalEntities,
    accountScope,
    idempotency,
    intentValue,
    objectKeys,
    storage,
  };
}

describe('XmlUploadService', () => {
  it('streams one XML and returns the durable 202 representation', async () => {
    const dependencies = setup();
    const xml = '<?xml version="1.0"?><Comprobante />';

    await expect(
      dependencies.service.upload(
        ids.entity,
        'upload-key-1',
        multipartRequest([{ filename: 'invoice.xml', value: xml }]),
        tenant,
        requestContext,
      ),
    ).resolves.toEqual({
      uploadId: ids.upload,
      objectId: ids.object,
      jobId: ids.job,
      status: 'queued',
      links: {
        ingestion: `/api/v1/ingestions/${ids.job}`,
        items: `/api/v1/ingestions/${ids.job}/items`,
      },
      correlationId: requestContext.correlationId,
    });
    expect(dependencies.storage.putStream).toHaveBeenCalledTimes(1);
    expect(dependencies.idempotency.confirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId: ids.upload,
        actualSizeBytes: String(Buffer.byteLength(xml)),
        actualSha256: createHash('sha256').update(xml).digest('hex'),
        detectedMimeType: 'application/xml',
      }),
    );
    expect(dependencies.idempotency.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        rootObjectId: ids.object,
        initialItem: {
          objectId: ids.object,
          safeFilename: 'invoice.xml',
          sha256: createHash('sha256').update(xml).digest('hex'),
        },
      }),
    );
    expect(dependencies.idempotency.renewUploadReceiver).not.toHaveBeenCalled();
  });

  it('hashes a replay without replacing the immutable stored object', async () => {
    const dependencies = setup({ intentOutcome: 'replayed' });
    const xml = '<Comprobante />';

    await dependencies.service.upload(
      ids.entity,
      'upload-key-replay',
      multipartRequest([{ filename: 'replay.xml', value: xml }]),
      tenant,
      requestContext,
    );

    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
    expect(dependencies.objectKeys.create).toHaveBeenCalledTimes(1);
    expect(dependencies.idempotency.confirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        actualSizeBytes: String(Buffer.byteLength(xml)),
        actualSha256: createHash('sha256').update(xml).digest('hex'),
      }),
    );
  });

  it('reclaims an interrupted receiver and verifies the durable stored bytes before confirming', async () => {
    const xml = '<Comprobante Origen="durable" />';
    const dependencies = setup({ replayBytes: xml });
    const replayedReceiving: UploadIntentRecord = {
      ...dependencies.intentValue,
      state: 'receiving',
      receiverVersion: null,
    };
    dependencies.idempotency.createUploadIntent.mockResolvedValueOnce({
      outcome: 'replayed',
      value: replayedReceiving,
    });
    dependencies.idempotency.claimUploadReceiver.mockResolvedValueOnce({
      outcome: 'claimed',
      value: { ...replayedReceiving, receiverVersion: 2, version: 2 },
    });
    dependencies.storage.head.mockResolvedValueOnce({
      provider: 'local',
      objectKey: dependencies.intentValue.objectKey,
      sizeBytes: Buffer.byteLength(xml),
    });

    await expect(
      dependencies.service.upload(
        ids.entity,
        'upload-key-reclaim',
        multipartRequest([{ filename: 'invoice.xml', value: xml }]),
        tenant,
        requestContext,
      ),
    ).resolves.toMatchObject({
      uploadId: ids.upload,
      objectId: ids.object,
      jobId: ids.job,
    });

    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
    expect(dependencies.storage.openReadStream).toHaveBeenCalledWith(
      dependencies.intentValue.objectKey,
    );
    expect(dependencies.idempotency.confirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverVersion: 2,
        actualSizeBytes: String(Buffer.byteLength(xml)),
        actualSha256: createHash('sha256').update(xml).digest('hex'),
      }),
    );
  });

  it('rejects same-size replacement bytes while recovering an interrupted upload', async () => {
    const storedXml = '<Comprobante Origen="stored-A" />';
    const incomingXml = '<Comprobante Origen="stored-B" />';
    expect(Buffer.byteLength(incomingXml)).toBe(Buffer.byteLength(storedXml));
    const dependencies = setup({ replayBytes: storedXml });
    const replayedReceiving: UploadIntentRecord = {
      ...dependencies.intentValue,
      state: 'receiving',
      receiverVersion: null,
    };
    dependencies.idempotency.createUploadIntent.mockResolvedValueOnce({
      outcome: 'replayed',
      value: replayedReceiving,
    });
    dependencies.idempotency.claimUploadReceiver.mockResolvedValueOnce({
      outcome: 'claimed',
      value: { ...replayedReceiving, receiverVersion: 2, version: 2 },
    });
    dependencies.storage.head.mockResolvedValueOnce({
      provider: 'local',
      objectKey: dependencies.intentValue.objectKey,
      sizeBytes: Buffer.byteLength(storedXml),
    });

    await expectHttpError(
      dependencies.service.upload(
        ids.entity,
        'upload-key-reclaim-conflict',
        multipartRequest([{ filename: 'invoice.xml', value: incomingXml }]),
        tenant,
        requestContext,
      ),
      409,
      'IDEMPOTENCY_CONFLICT',
    );

    expect(dependencies.storage.openReadStream).toHaveBeenCalledWith(
      dependencies.intentValue.objectKey,
    );
    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
    expect(dependencies.storage.delete).not.toHaveBeenCalled();
    expect(dependencies.idempotency.failUpload).not.toHaveBeenCalled();
    expect(dependencies.idempotency.confirmUpload).not.toHaveBeenCalled();
    expect(dependencies.idempotency.createJob).not.toHaveBeenCalled();
  });

  it('returns one durable result for concurrent uploads with the same key and bytes', async () => {
    const dependencies = setup();
    const xml = '<?xml version="1.0"?><Comprobante Total="116.00" />';
    const xmlBytes = Buffer.from(xml);
    const xmlSha256 = createHash('sha256').update(xmlBytes).digest('hex');
    const now = new Date('2026-09-03T10:00:00.000Z');
    let durableIntent: UploadIntentRecord = {
      uploadId: ids.upload,
      objectId: ids.object,
      objectKey: 'objects/aa/synthetic-key',
      originalFilename: 'invoice.xml',
      declaredMimeType: 'application/xml',
      state: 'receiving',
      actualSizeBytes: null,
      actualSha256: null,
      storageEtag: null,
      storageVersionId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      receiverVersion: 1,
      responseStatus: 201,
      responseReference: `/api/v1/ingestion-uploads/${ids.upload}`,
    };
    let intentCalls = 0;
    let jobCreated = false;
    let resolveConfirmed: (() => void) | undefined;
    const confirmed = new Promise<void>((resolve) => {
      resolveConfirmed = resolve;
    });
    dependencies.idempotency.createUploadIntent.mockImplementation(() => {
      intentCalls += 1;
      return Promise.resolve({
        outcome:
          intentCalls === 1 ? ('created' as const) : ('replayed' as const),
        value: {
          ...durableIntent,
          receiverVersion: intentCalls === 1 ? 1 : null,
        },
      });
    });
    dependencies.idempotency.claimUploadReceiver.mockImplementation(() =>
      confirmed.then(() => ({
        outcome: 'busy' as const,
        value: { ...durableIntent, receiverVersion: null },
      })),
    );
    dependencies.idempotency.confirmUpload.mockImplementation(
      (input: ConfirmUploadInput) => {
        const outcome =
          durableIntent.state === 'confirmed'
            ? ('replayed' as const)
            : ('created' as const);
        durableIntent = {
          ...durableIntent,
          state: 'confirmed',
          actualSizeBytes: input.actualSizeBytes,
          actualSha256: input.actualSha256,
          version: 2,
          receiverVersion: null,
          responseStatus: 200,
        };
        resolveConfirmed?.();
        return Promise.resolve({ outcome, value: durableIntent });
      },
    );
    dependencies.idempotency.createJob.mockImplementation(() => {
      const outcome = jobCreated ? ('replayed' as const) : ('created' as const);
      jobCreated = true;
      return Promise.resolve({
        outcome,
        value: {
          jobId: ids.job,
          status: 'queued' as const,
          responseStatus: 202,
          responseReference: `/api/v1/ingestions/${ids.job}`,
        },
      });
    });

    const [first, replay] = await Promise.all([
      dependencies.service.upload(
        ids.entity,
        'same-concurrent-key',
        multipartRequest([{ filename: 'invoice.xml', value: xml }]),
        tenant,
        requestContext,
      ),
      dependencies.service.upload(
        ids.entity,
        'same-concurrent-key',
        multipartRequest([{ filename: 'invoice.xml', value: xml }]),
        tenant,
        {
          ...requestContext,
          correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      ),
    ]);

    expect(replay).toMatchObject({
      uploadId: first.uploadId,
      objectId: first.objectId,
      jobId: first.jobId,
      status: first.status,
      links: first.links,
    });
    expect(dependencies.storage.putStream).toHaveBeenCalledTimes(1);
    expect(dependencies.idempotency.createUploadIntent).toHaveBeenCalledTimes(
      2,
    );
    expect(dependencies.idempotency.confirmUpload).toHaveBeenCalledTimes(2);
    expect(dependencies.idempotency.createJob).toHaveBeenCalledTimes(2);
    expect(
      dependencies.idempotency.confirmUpload.mock.calls.map(
        ([input]) => input.actualSha256,
      ),
    ).toEqual([xmlSha256, xmlSha256]);
  });

  it('normalizes the configured global prefix in response links', async () => {
    const dependencies = setup({ apiPrefix: '/internal/v2/' });

    await expect(
      dependencies.service.upload(
        ids.entity,
        'upload-key-prefix',
        multipartRequest([
          { filename: 'invoice.xml', value: '<Comprobante />' },
        ]),
        tenant,
        requestContext,
      ),
    ).resolves.toMatchObject({
      links: {
        ingestion: `/internal/v2/ingestions/${ids.job}`,
        items: `/internal/v2/ingestions/${ids.job}/items`,
      },
    });
  });

  it('accepts multipart media type casing without weakening MIME checks', async () => {
    const dependencies = setup();
    const request = multipartRequest([
      { filename: 'invoice.xml', value: '<Comprobante />' },
    ]);
    request.headers['content-type'] = request.headers['content-type']
      ?.replace('multipart/form-data', 'Multipart/Form-Data')
      .replace('boundary=', 'Boundary=');

    await expect(
      dependencies.service.upload(
        ids.entity,
        'upload-key-content-type-case',
        request,
        tenant,
        requestContext,
      ),
    ).resolves.toMatchObject({ status: 'queued' });
  });

  it('maps a different payload on the same key to stable 409', async () => {
    const dependencies = setup({
      intentOutcome: 'replayed',
      replayBytes: '<Comprobante />',
    });

    await expectHttpError(
      dependencies.service.upload(
        ids.entity,
        'upload-key-conflict',
        multipartRequest([
          { filename: 'different.xml', value: '<Different />' },
        ]),
        tenant,
        requestContext,
      ),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
    expect(dependencies.idempotency.confirmUpload).not.toHaveBeenCalled();
    expect(dependencies.idempotency.createJob).not.toHaveBeenCalled();
  });

  it('maps the transactional active-job guard to stable 429', async () => {
    const dependencies = setup();
    dependencies.idempotency.createJob.mockRejectedValueOnce(
      new IngestionAdmissionLimitError('user'),
    );

    await expectHttpError(
      dependencies.service.upload(
        ids.entity,
        'upload-key-active-limit',
        multipartRequest([
          { filename: 'invoice.xml', value: '<Comprobante />' },
        ]),
        tenant,
        requestContext,
      ),
      429,
      'INGESTION_ACTIVE_JOB_LIMIT',
    );
  });

  it('rejects a false declared MIME before reserving storage', async () => {
    const dependencies = setup();
    const promise = dependencies.service.upload(
      ids.entity,
      'upload-key-mime',
      multipartRequest([
        {
          filename: 'invoice.xml',
          mimeType: 'application/pdf',
          value: '<Comprobante />',
        },
      ]),
      tenant,
      requestContext,
    );

    await expectHttpError(promise, 415, 'INGESTION_UNSUPPORTED_MEDIA_TYPE');
    expect(dependencies.idempotency.createUploadIntent).not.toHaveBeenCalled();
    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
  });

  it('observes an early file rejection while the multipart request remains open', async () => {
    const dependencies = setup();
    const boundary = '----balanz-slow-invalid-mime-boundary';
    const request = new PassThrough() as Request & PassThrough;
    request.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const upload = dependencies.service.upload(
      ids.entity,
      'upload-key-slow-invalid-mime',
      request,
      tenant,
      requestContext,
    );
    let settled = false;
    void upload.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    request.write(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="invoice.xml"\r\n' +
        'Content-Type: application/pdf\r\n\r\n' +
        '<Comprobante',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    request.end(` />\r\n--${boundary}--\r\n`);

    await expectHttpError(upload, 415, 'INGESTION_UNSUPPORTED_MEDIA_TYPE');
    expect(dependencies.idempotency.createUploadIntent).not.toHaveBeenCalled();
    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
  });

  it('rejects false XML bytes and cleans the newly written object', async () => {
    const dependencies = setup();

    await expectHttpError(
      dependencies.service.upload(
        ids.entity,
        'upload-key-detected-mime',
        multipartRequest([
          {
            filename: 'not-xml.xml',
            mimeType: 'application/xml',
            value: '%PDF-1.7 synthetic',
          },
        ]),
        tenant,
        requestContext,
      ),
      415,
      'INGESTION_UNSUPPORTED_MEDIA_TYPE',
    );
    expect(dependencies.storage.delete).toHaveBeenCalledWith(
      'objects/aa/synthetic-key',
    );
    expect(dependencies.idempotency.failUpload).toHaveBeenCalledWith(
      expect.any(Object),
      ids.upload,
      'INGESTION_UNSUPPORTED_MEDIA_TYPE',
      requestContext.correlationId,
      1,
    );
  });

  it.each([
    ['OBJECT_STORAGE_LIMIT_EXCEEDED', 413, 'INGESTION_FILE_TOO_LARGE'],
    ['OBJECT_STORAGE_SIZE_MISMATCH', 422, 'OBJECT_HASH_MISMATCH'],
    ['OBJECT_STORAGE_CONFLICT', 409, 'JOB_STATE_CONFLICT'],
    ['OBJECT_STORAGE_INVALID_CONFIGURATION', 500, 'CONFIGURATION_INVALID'],
    ['OBJECT_STORAGE_INVALID_KEY', 500, 'CONFIGURATION_INVALID'],
    ['OBJECT_STORAGE_NOT_FOUND', 500, 'CONFIGURATION_INVALID'],
    ['OBJECT_STORAGE_UNSUPPORTED_OPERATION', 500, 'CONFIGURATION_INVALID'],
    ['OBJECT_STORAGE_UNAVAILABLE', 503, 'OBJECT_STORAGE_UNAVAILABLE'],
  ] as const)(
    'maps internal storage code %s to safe HTTP %s/%s',
    async (storageCode, status, publicCode) => {
      const dependencies = setup();
      dependencies.storage.putStream.mockRejectedValueOnce(
        new ObjectStorageError(storageCode, '<internal storage detail>'),
      );

      await expectHttpError(
        dependencies.service.upload(
          ids.entity,
          `upload-key-storage-${status}-${storageCode}`,
          multipartRequest([
            { filename: 'invoice.xml', value: '<Comprobante />' },
          ]),
          tenant,
          requestContext,
        ),
        status,
        publicCode,
      );
    },
  );

  it('maps a server-generated object-key failure before storage is called', async () => {
    const dependencies = setup();
    dependencies.objectKeys.create.mockImplementationOnce(() => {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_KEY',
        '<opaque key internals>',
      );
    });

    await expectHttpError(
      dependencies.service.upload(
        ids.entity,
        'upload-key-invalid-object-key',
        multipartRequest([
          { filename: 'invoice.xml', value: '<Comprobante />' },
        ]),
        tenant,
        requestContext,
      ),
      500,
      'CONFIGURATION_INVALID',
    );
    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
  });

  it('deletes partial bytes and marks the intent failed when the stream exceeds the limit', async () => {
    const dependencies = setup({ maxBytes: 16 });
    const promise = dependencies.service.upload(
      ids.entity,
      'upload-key-limit',
      multipartRequest([
        {
          filename: 'too-large.xml',
          value: '<Comprobante>too large</Comprobante>',
        },
      ]),
      tenant,
      requestContext,
    );

    await expectHttpError(promise, 413, 'INGESTION_FILE_TOO_LARGE');
    expect(dependencies.storage.delete).toHaveBeenCalledWith(
      'objects/aa/synthetic-key',
    );
    expect(dependencies.idempotency.failUpload).toHaveBeenCalledWith(
      {
        organizationId: ids.organization,
        clientAccountId: ids.account,
        legalEntityId: ids.entity,
        membershipId: ids.membership,
      },
      ids.upload,
      'INGESTION_FILE_TOO_LARGE',
      requestContext.correlationId,
      1,
    );
  });

  it('settles an aborted request and cleans a completed partial object intent', async () => {
    const dependencies = setup();
    const boundary = '----balanz-aborted-boundary';
    const request = new PassThrough() as Request & PassThrough;
    request.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const upload = dependencies.service.upload(
      ids.entity,
      'upload-key-aborted',
      request,
      tenant,
      requestContext,
    );
    request.write(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="invoice.xml"\r\n' +
        'Content-Type: application/xml\r\n\r\n' +
        '<Comprobante />\r\n' +
        `--${boundary}\r\n`,
    );
    while (dependencies.storage.putStream.mock.results.length === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await dependencies.storage.putStream.mock.results[0].value;
    request.emit('aborted');

    await expectHttpError(upload, 408, 'INGESTION_UPLOAD_ABORTED');
    expect(dependencies.storage.delete).toHaveBeenCalledWith(
      'objects/aa/synthetic-key',
    );
    expect(dependencies.idempotency.failUpload).toHaveBeenCalledWith(
      expect.any(Object),
      ids.upload,
      'INGESTION_UPLOAD_ABORTED',
      requestContext.correlationId,
      1,
    );
  });

  it('classifies an abort propagated through an in-flight storage stream', async () => {
    const dependencies = setup();
    const boundary = '----balanz-inflight-abort-boundary';
    const request = new PassThrough() as Request & PassThrough;
    request.headers = {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const upload = dependencies.service.upload(
      ids.entity,
      'upload-key-inflight-abort',
      request,
      tenant,
      requestContext,
    );
    request.write(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="invoice.xml"\r\n' +
        'Content-Type: application/xml\r\n\r\n' +
        '<Comprobante',
    );
    while (dependencies.storage.putStream.mock.results.length === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    request.emit('aborted');

    await expectHttpError(upload, 408, 'INGESTION_UPLOAD_ABORTED');
    expect(dependencies.idempotency.failUpload).toHaveBeenCalledWith(
      expect.any(Object),
      ids.upload,
      'INGESTION_UPLOAD_ABORTED',
      requestContext.correlationId,
      1,
    );
  });

  it('fails an already-aborted request before creating an upload intent', async () => {
    const dependencies = setup();
    const request = multipartRequest([
      { filename: 'invoice.xml', value: '<Comprobante />' },
    ]);
    Object.defineProperty(request, 'aborted', { value: true });

    await expectHttpError(
      dependencies.service.upload(
        ids.entity,
        'upload-key-already-aborted',
        request,
        tenant,
        requestContext,
      ),
      408,
      'INGESTION_UPLOAD_ABORTED',
    );
    expect(dependencies.idempotency.createUploadIntent).not.toHaveBeenCalled();
  });

  it('rejects a second multipart file instead of silently accepting the first', async () => {
    const dependencies = setup();
    const promise = dependencies.service.upload(
      ids.entity,
      'upload-key-two-files',
      multipartRequest([
        { filename: 'first.xml', value: '<First />' },
        { filename: 'second.xml', value: '<Second />' },
      ]),
      tenant,
      requestContext,
    );

    await expectHttpError(promise, 400, 'INGESTION_TOO_MANY_FILES');
    expect(dependencies.storage.delete).toHaveBeenCalledWith(
      'objects/aa/synthetic-key',
    );
    expect(dependencies.idempotency.failUpload).toHaveBeenCalledWith(
      expect.any(Object),
      ids.upload,
      'INGESTION_TOO_MANY_FILES',
      requestContext.correlationId,
      1,
    );
  });

  it('rejects multipart fields and cleans the accepted file', async () => {
    const dependencies = setup();
    const promise = dependencies.service.upload(
      ids.entity,
      'upload-key-field',
      multipartRequest([
        { filename: 'first.xml', value: '<First />' },
        { fieldName: 'description', value: 'not allowed' },
      ]),
      tenant,
      requestContext,
    );

    await expectHttpError(promise, 400, 'INGESTION_UNSUPPORTED_MEDIA_TYPE');
    expect(dependencies.storage.delete).toHaveBeenCalledWith(
      'objects/aa/synthetic-key',
    );
  });

  it('requires a printable idempotency key before doing tenant or stream work', async () => {
    const dependencies = setup();
    const request = multipartRequest([
      { filename: 'invoice.xml', value: '<Comprobante />' },
    ]);

    await expect(
      dependencies.service.upload(
        ids.entity,
        ' leading-space',
        request,
        tenant,
        requestContext,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(dependencies.legalEntities.findOne).not.toHaveBeenCalled();
    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
  });

  it('returns a non-enumerating 404 when account assignment is absent', async () => {
    const dependencies = setup();
    dependencies.accountScope.requireAccessibleAccount.mockRejectedValueOnce(
      new Error('account assignment missing'),
    );

    await expectHttpError(
      dependencies.service.upload(
        ids.entity,
        'upload-key-no-scope',
        multipartRequest([
          { filename: 'invoice.xml', value: '<Comprobante />' },
        ]),
        tenant,
        requestContext,
      ),
      404,
      'RESOURCE_NOT_FOUND',
    );
    expect(dependencies.storage.putStream).not.toHaveBeenCalled();
  });
});
