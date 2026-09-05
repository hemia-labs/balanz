import type { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import type { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import type { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import {
  IngestionAdmissionLimitError,
  IngestionIdempotencyRepository,
  type CreateJobReservationInput,
} from '../src/modules/ingestion/services/ingestion-idempotency.repository';
import type { OpaqueObjectKeyFactory } from '../src/modules/object-storage/services/opaque-object-key.factory';
import type { RedisWakeupService } from '../src/modules/redis/redis-wakeup.service';

const input: CreateJobReservationInput = {
  scope: {
    organizationId: '11111111-1111-4111-8111-111111111111',
    clientAccountId: '22222222-2222-4222-8222-222222222222',
    legalEntityId: '33333333-3333-4333-8333-333333333333',
    membershipId: '44444444-4444-4444-8444-444444444444',
  },
  sourceType: 'manual_xml',
  idempotencyKey: 'admission-key',
  requestFingerprint: 'a'.repeat(64),
  idempotencyExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
  correlationId: '55555555-5555-4555-8555-555555555555',
  status: 'queued',
  uploadId: '66666666-6666-4666-8666-666666666666',
  rootObjectId: '77777777-7777-4777-8777-777777777777',
  requestedByMembershipId: '44444444-4444-4444-8444-444444444444',
  initialItem: {
    objectId: '77777777-7777-4777-8777-777777777777',
    safeFilename: 'invoice.xml',
    sha256: 'b'.repeat(64),
  },
};

function setup(
  counts: { tenant: number; user: number },
  options?: { replay?: boolean },
) {
  const queries: string[] = [];
  const manager = {
    query: jest.fn((sql: string) => {
      queries.push(sql);
      if (
        sql.includes('AS idempotency_valid') &&
        sql.includes('$1::timestamptz')
      ) {
        return Promise.resolve([{ idempotency_valid: true }]);
      }
      if (sql.includes('tenant_active_jobs')) {
        return Promise.resolve([
          {
            tenant_active_jobs: counts.tenant,
            user_active_jobs: counts.user,
          },
        ]);
      }
      if (
        sql.includes('FROM ingestion_jobs') &&
        sql.includes('idempotency_key = $3')
      ) {
        return Promise.resolve(
          options?.replay
            ? [
                {
                  id: '88888888-8888-4888-8888-888888888888',
                  status: 'queued',
                  request_fingerprint: input.requestFingerprint,
                  response_status: 202,
                  response_reference: '88888888-8888-4888-8888-888888888888',
                  idempotency_expires_at: input.idempotencyExpiresAt,
                  idempotency_valid: true,
                },
              ]
            : [],
        );
      }
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
      throw new Error('Admission test reached work after its expected limit');
    }),
  } as unknown as jest.Mocked<EntityManager>;
  const transactions = {
    run: jest.fn(
      async (
        _scope: unknown,
        work: (transactionManager: EntityManager) => Promise<unknown>,
      ) => work(manager),
    ),
  } as unknown as jest.Mocked<FiscalTenantTransactionService>;
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      retention: { incompleteUploadHours: 24 },
      limits: { activeJobsPerUser: 2, activeJobsPerTenant: 4 },
      worker: { leaseSeconds: 90 },
    }),
  } as unknown as ConfigService;
  const repository = new IngestionIdempotencyRepository(
    transactions,
    { publishJobsAvailable: jest.fn() } as unknown as RedisWakeupService,
    { increment: jest.fn() } as unknown as FiscalMetricsService,
    { assertValid: jest.fn() } as unknown as OpaqueObjectKeyFactory,
    config,
  );
  return { repository, manager, queries };
}

describe('manual ingestion admission', () => {
  it('serializes the tenant count and rejects a third active job for one user', async () => {
    const dependencies = setup({ tenant: 3, user: 2 });

    await expect(
      dependencies.repository.createJob(input),
    ).rejects.toMatchObject({
      code: 'INGESTION_ACTIVE_JOB_LIMIT',
      dimension: 'user',
    } satisfies Partial<IngestionAdmissionLimitError>);

    const admissionLock = dependencies.queries.findIndex((sql) =>
      sql.includes('84732'),
    );
    const capacityRead = dependencies.queries.findIndex((sql) =>
      sql.includes('tenant_active_jobs'),
    );
    expect(admissionLock).toBeGreaterThanOrEqual(0);
    expect(capacityRead).toBeGreaterThan(admissionLock);
    expect(
      dependencies.queries.some((sql) =>
        sql.includes('INSERT INTO ingestion_jobs'),
      ),
    ).toBe(false);
  });

  it('rejects a fifth active job for a tenant even when the user has room', async () => {
    const dependencies = setup({ tenant: 4, user: 1 });

    await expect(
      dependencies.repository.createJob(input),
    ).rejects.toMatchObject({
      code: 'INGESTION_ACTIVE_JOB_LIMIT',
      dimension: 'tenant',
    } satisfies Partial<IngestionAdmissionLimitError>);
  });

  it('replays an existing idempotent job even while capacity is full', async () => {
    const dependencies = setup({ tenant: 4, user: 2 }, { replay: true });

    await expect(dependencies.repository.createJob(input)).resolves.toEqual({
      outcome: 'replayed',
      value: {
        jobId: '88888888-8888-4888-8888-888888888888',
        status: 'queued',
        responseStatus: 202,
        responseReference: '88888888-8888-4888-8888-888888888888',
      },
    });
    expect(
      dependencies.queries.some(
        (sql) => sql.includes('84732') || sql.includes('tenant_active_jobs'),
      ),
    ).toBe(false);
  });

  it('validates the fixed 2/4 policy at startup', () => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        retention: { incompleteUploadHours: 24 },
        limits: { activeJobsPerUser: 3, activeJobsPerTenant: 4 },
        worker: { leaseSeconds: 90 },
      }),
    } as unknown as ConfigService;

    expect(
      () =>
        new IngestionIdempotencyRepository(
          {} as FiscalTenantTransactionService,
          {} as RedisWakeupService,
          {} as FiscalMetricsService,
          {} as OpaqueObjectKeyFactory,
          config,
        ),
    ).toThrow('INGESTION_ACTIVE_JOBS_PER_USER/TENANT must remain fixed at 2/4');
  });
});
