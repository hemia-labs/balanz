import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { ZipUploadService } from '../src/modules/cfdi/services/zip-upload.service';
import type { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import type { ClientAccountScopeService } from '../src/modules/client-accounts/client-account-scope.service';
import type { IngestionIdempotencyRepository } from '../src/modules/ingestion/services/ingestion-idempotency.repository';
import type {
  ObjectStoragePort,
  ObjectStorageWriteInput,
} from '../src/modules/object-storage/ports/object-storage.port';
import { OpaqueObjectKeyFactory } from '../src/modules/object-storage/services/opaque-object-key.factory';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';
import type { RequestContext } from '../src/common/decorators/request-context.decorator';
import fiscalConfig from '../src/config/fiscal-platform.config';
import { hashStream } from '../src/modules/cfdi/workers/zip-worker-persistence.service';
import { makeZip } from './fixtures/zip-fixture';

const tenant = {
  organizationId: randomUUID(),
  membershipId: randomUUID(),
} as SessionAuthorizationContext;
const entityId = randomUUID(),
  accountId = randomUUID(),
  uploadId = randomUUID(),
  objectId = randomUUID(),
  jobId = randomUUID();
const context = { correlationId: randomUUID() } as RequestContext;
const bytes = makeZip([{ name: 'a.xml', body: Buffer.from('<a/>') }]);
const sha = createHash('sha256').update(bytes).digest('hex');
const dto = {
  filename: 'paquete.zip',
  mimeType: 'application/zip',
  sizeBytes: bytes.length,
  sha256: sha,
};
function setup() {
  const row = {
    id: uploadId,
    object_id: objectId,
    object_key: 'opaque-root',
    client_account_id: accountId,
    legal_entity_id: entityId,
    state: 'pending',
    expected_size_bytes: String(bytes.length),
    expected_sha256: sha,
    declared_mime_type: 'application/zip',
    write_valid: true,
    upload_valid: true,
  };
  const query = jest.fn((sql: string) =>
    Promise.resolve(
      sql.includes('SELECT client_account_id')
        ? [{ client_account_id: accountId }]
        : [row],
    ),
  );
  const transactions = {
    run: jest.fn((_scope: unknown, work: (manager: EntityManager) => unknown) =>
      work({ query } as unknown as EntityManager),
    ),
  } as unknown as FiscalTenantTransactionService;
  const accounts = {
    requireAccessibleAccountWithManager: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ClientAccountScopeService>;
  const idempotency = {
    createUploadIntent: jest.fn().mockResolvedValue({
      outcome: 'created',
      value: {
        uploadId,
        objectId,
        objectKey: 'opaque-root',
        state: 'pending',
      },
    }),
    confirmUpload: jest.fn().mockResolvedValue({ outcome: 'created' }),
    claimUploadReceiver: jest.fn().mockResolvedValue({
      outcome: 'claimed',
      value: { state: 'receiving', receiverVersion: 2 },
    }),
    renewUploadReceiver: jest.fn().mockResolvedValue(3),
    releaseZipConfirmation: jest.fn().mockResolvedValue(undefined),
    createJob: jest
      .fn()
      .mockResolvedValue({ value: { jobId, status: 'queued' } }),
  } as unknown as jest.Mocked<IngestionIdempotencyRepository>;
  const storage = {
    head: jest.fn().mockResolvedValue({
      sizeBytes: bytes.length,
      checksumSha256: 'untrusted-metadata',
    }),
    openReadStream: jest.fn(() =>
      Promise.resolve(
        Readable.from([bytes.subarray(0, 10), bytes.subarray(10)]),
      ),
    ),
    putStream: jest.fn((input: ObjectStorageWriteInput) =>
      hashStream(input.body),
    ),
  } as unknown as jest.Mocked<ObjectStoragePort>;
  const config = fiscalConfig();
  config.storage.driver = 'local';
  const service = () =>
    new ZipUploadService(
      transactions,
      accounts,
      idempotency,
      new OpaqueObjectKeyFactory(),
      storage,
      new ConfigService({ fiscalPlatform: config }),
    );
  const request = () =>
    Object.assign(Readable.from([bytes.subarray(0, 10), bytes.subarray(10)]), {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(bytes.length),
      },
    }) as Request;
  return {
    config,
    row,
    query,
    transactions,
    accounts,
    idempotency,
    storage,
    service,
    request,
  };
}
async function expectCode(
  promise: Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await promise;
    throw new Error('Expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toMatchObject({ code });
  }
}
describe('ZIP upload service trust boundaries', () => {
  it.each(['failed', 'cancelled', 'expired'])(
    'does not wait or read storage for an upload in %s state',
    async (state) => {
      const s = setup();
      s.idempotency.claimUploadReceiver.mockResolvedValue({
        outcome: 'busy',
        value: { state, receiverVersion: null },
      } as never);
      await expectCode(
        s.service().confirm(uploadId, 'key', tenant, context),
        409,
        'UPLOAD_NOT_CONFIRMABLE',
      );
      expect(s.storage.head).not.toHaveBeenCalled();
      expect(s.idempotency.createJob).not.toHaveBeenCalled();
    },
  );
  it('only the durable owner touches storage while concurrent confirmation recovers later', async () => {
    const s = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    s.storage.head.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { sizeBytes: bytes.length } as never;
    });
    s.idempotency.claimUploadReceiver
      .mockResolvedValueOnce({
        outcome: 'claimed',
        value: { state: 'receiving', receiverVersion: 2 },
      } as never)
      .mockResolvedValueOnce({
        outcome: 'busy',
        value: { state: 'receiving', receiverVersion: null },
      } as never);
    const first = s.service().confirm(uploadId, 'key', tenant, context);
    await started;
    try {
      await expectCode(
        s.service().confirm(uploadId, 'key', tenant, context),
        409,
        'UPLOAD_CONFIRM_IN_PROGRESS',
      );
      expect(s.storage.head).toHaveBeenCalledTimes(1);
      expect(s.storage.openReadStream).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await first;
    s.row.state = 'confirmed';
    expect(
      (await s.service().confirm(uploadId, 'key', tenant, context)).jobId,
    ).toBe(jobId);
    expect(s.storage.openReadStream).toHaveBeenCalledTimes(1);
  });
  it('a confirmation completed between scope read and claim replays without reading bytes', async () => {
    const s = setup();
    s.idempotency.claimUploadReceiver.mockResolvedValue({
      outcome: 'busy',
      value: { state: 'confirmed', receiverVersion: null },
    } as never);
    expect(
      (await s.service().confirm(uploadId, 'key', tenant, context)).jobId,
    ).toBe(jobId);
    expect(s.storage.head).not.toHaveBeenCalled();
  });
  it('heartbeat loss fences confirmation and never releases another owner', async () => {
    jest.useFakeTimers();
    try {
      const s = setup();
      s.config.worker.heartbeatSeconds = 1;
      s.idempotency.renewUploadReceiver.mockResolvedValue(null);
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      s.storage.head.mockImplementationOnce(async () => {
        entered();
        await gate;
        return { sizeBytes: bytes.length } as never;
      });
      const confirming = s.service().confirm(uploadId, 'key', tenant, context);
      await started;
      await jest.advanceTimersByTimeAsync(1000);
      release();
      await expectCode(confirming, 409, 'UPLOAD_CONFIRM_IN_PROGRESS');
      expect(s.idempotency.confirmUpload).not.toHaveBeenCalled();
      expect(s.idempotency.releaseZipConfirmation).not.toHaveBeenCalled();
      expect(s.storage.openReadStream).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('init reserves durable upload without a processing job and returns temporary local mechanism', async () => {
    const s = setup();
    const result = await s
      .service()
      .init(entityId, 'init-key', dto, tenant, context);
    expect(result.uploadId).toBe(uploadId);
    expect(result.upload?.url).toBe(
      `/api/v1/ingestion-uploads/${uploadId}/zip/content`,
    );
    expect(s.idempotency.createJob).not.toHaveBeenCalled();
    expect(s.idempotency.createUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadType: 'manual_zip',
        expectedSha256: sha,
        expectedSizeBytes: String(bytes.length),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('opaque-root');
  });
  it.each([undefined, '', 'contains space', 'x'.repeat(129)])(
    'requires bounded Idempotency-Key %s',
    async (key) => {
      const s = setup();
      await expectCode(
        s.service().init(entityId, key, dto, tenant, context),
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
      );
      expect(s.query).not.toHaveBeenCalled();
    },
  );
  it('admission checks entity assignment inside scoped transaction', async () => {
    const s = setup();
    s.accounts.requireAccessibleAccountWithManager.mockRejectedValue(
      new Error('denied'),
    );
    await expectCode(
      s.service().init(entityId, 'key', dto, tenant, context),
      404,
      'RESOURCE_NOT_FOUND',
    );
    expect(s.idempotency.createUploadIntent).not.toHaveBeenCalled();
  });
  it('confirmation verifies actual streamed SHA and never trusts head checksum metadata', async () => {
    const s = setup();
    const result = await s
      .service()
      .confirm(uploadId, 'confirm-key', tenant, context);
    expect(result.jobId).toBe(jobId);
    expect(s.storage.openReadStream).toHaveBeenCalledWith(
      'opaque-root',
      expect.any(AbortSignal),
    );
    expect(s.idempotency.confirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({ receiverVersion: 2 }),
    );
    expect(s.idempotency.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'manual_zip',
        rootObjectId: objectId,
        idempotencyKey: `zip-confirm:${uploadId}`,
      }),
    );
  });
  it('rejects an absent object without creating a job', async () => {
    const s = setup();
    s.storage.head.mockResolvedValue(null);
    await expectCode(
      s.service().confirm(uploadId, 'key', tenant, context),
      409,
      'UPLOAD_NOT_CONFIRMABLE',
    );
    expect(s.idempotency.createJob).not.toHaveBeenCalled();
    expect(s.idempotency.releaseZipConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: tenant.organizationId }),
      uploadId,
      2,
    );
  });
  it('rejects different bytes even at the expected size', async () => {
    const s = setup();
    s.storage.openReadStream.mockResolvedValue(
      Readable.from([Buffer.alloc(bytes.length)]),
    );
    await expectCode(
      s.service().confirm(uploadId, 'key', tenant, context),
      422,
      'UPLOAD_PAYLOAD_MISMATCH',
    );
    expect(s.idempotency.confirmUpload).not.toHaveBeenCalled();
  });
  it('rejects real size above 50 MiB before reading', async () => {
    const s = setup();
    s.storage.head.mockResolvedValue({
      sizeBytes: 50 * 1024 * 1024 + 1,
    } as never);
    await expectCode(
      s.service().confirm(uploadId, 'key', tenant, context),
      422,
      'UPLOAD_PAYLOAD_MISMATCH',
    );
    expect(s.storage.openReadStream).not.toHaveBeenCalled();
  });
  it('replayed confirmed intent uses durable idempotency without new byte access', async () => {
    const s = setup();
    s.row.state = 'confirmed';
    await s.service().confirm(uploadId, 'key', tenant, context);
    expect(s.storage.head).not.toHaveBeenCalled();
    expect(s.idempotency.confirmUpload).toHaveBeenCalledTimes(1);
  });
  it('local upload streams request to its authorized opaque object', async () => {
    const s = setup();
    const incoming = s.request();
    expect(await s.service().upload(uploadId, incoming, tenant)).toEqual({
      uploadId,
      state: 'uploaded',
    });
    expect(s.storage.putStream).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: 'opaque-root',
        expectedSizeBytes: bytes.length,
      }),
    );
  });
  it('expired local transfer cannot access storage', async () => {
    const s = setup();
    s.row.write_valid = false;
    await expectCode(
      s.service().upload(uploadId, s.request(), tenant),
      409,
      'UPLOAD_NOT_CONFIRMABLE',
    );
    expect(s.storage.putStream).not.toHaveBeenCalled();
  });
  it('local transfer rejects MIME mismatch before reading', async () => {
    const s = setup();
    const incoming = s.request();
    incoming.headers['content-type'] = 'text/plain';
    await expectCode(
      s.service().upload(uploadId, incoming, tenant),
      422,
      'UPLOAD_PAYLOAD_MISMATCH',
    );
    expect(s.storage.putStream).not.toHaveBeenCalled();
  });
  it('scope loss hides upload on confirm', async () => {
    const s = setup();
    s.query.mockResolvedValue([]);
    await expectCode(
      s.service().confirm(uploadId, 'key', tenant, context),
      404,
      'RESOURCE_NOT_FOUND',
    );
    expect(s.storage.head).not.toHaveBeenCalled();
  });
});
