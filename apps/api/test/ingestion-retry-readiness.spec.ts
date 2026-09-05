import type { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import type { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import type { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import {
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
  idempotencyKey: 'first-manual-retry',
  requestFingerprint: 'a'.repeat(64),
  idempotencyExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
  correlationId: '55555555-5555-4555-8555-555555555555',
  status: 'queued',
  uploadId: '66666666-6666-4666-8666-666666666666',
  rootObjectId: '77777777-7777-4777-8777-777777777777',
  retryOfJobId: '88888888-8888-4888-8888-888888888888',
};

it('allows retry after failure, replays its success, and rejects a new retry of the published XML', async () => {
  let objectState = 'quarantined';
  const jobs = new Map<string, Record<string, unknown>>();
  const query = jest.fn((sql: string, parameters: unknown[] = []) => {
    if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    if (sql.includes('$1::timestamptz'))
      return Promise.resolve([{ idempotency_valid: true }]);
    if (sql.includes('idempotency_key = $3')) {
      const existing = jobs.get(parameters[2] as string);
      return Promise.resolve(existing ? [existing] : []);
    }
    if (sql.includes('tenant_active_jobs')) {
      return Promise.resolve([{ tenant_active_jobs: 0, user_active_jobs: 0 }]);
    }
    if (sql.includes('FROM ingestion_uploads AS upload')) {
      return Promise.resolve([
        { id: input.uploadId, lifecycle_state: objectState },
      ]);
    }
    if (sql.includes('INSERT INTO ingestion_jobs')) {
      const row = {
        id: parameters[0],
        status: 'queued',
        request_fingerprint: input.requestFingerprint,
        response_status: 202,
        response_reference: parameters[0],
        idempotency_valid: true,
      };
      jobs.set(parameters[9] as string, row);
      return Promise.resolve([row]);
    }
    if (sql.includes('INSERT INTO audit_events')) return Promise.resolve([]);
    throw new Error(`Unexpected retry query: ${sql}`);
  });
  const manager = { query } as unknown as EntityManager;
  const transactions = {
    run: (
      _scope: unknown,
      work: (manager: EntityManager) => Promise<unknown>,
    ) => work(manager),
  } as unknown as FiscalTenantTransactionService;
  const wakeup = { publishJobsAvailable: jest.fn() };
  const repository = new IngestionIdempotencyRepository(
    transactions,
    wakeup as unknown as RedisWakeupService,
    { increment: jest.fn() } as unknown as FiscalMetricsService,
    {} as OpaqueObjectKeyFactory,
    {
      getOrThrow: () => ({
        retention: { incompleteUploadHours: 24 },
        limits: { activeJobsPerUser: 2, activeJobsPerTenant: 4 },
        worker: { leaseSeconds: 90 },
      }),
    } as unknown as ConfigService,
  );

  const first = await repository.createJob(input);
  expect(first.outcome).toBe('created');
  // The successful retry publishes the object, while the original job remains failed_final.
  objectState = 'available';
  jobs.get(input.idempotencyKey)!.status = 'completed';
  const replay = await repository.createJob(input);
  expect(replay).toMatchObject({
    outcome: 'replayed',
    value: { jobId: first.value.jobId, status: 'completed' },
  });
  await expect(
    repository.createJob({ ...input, idempotencyKey: 'second-manual-retry' }),
  ).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' });
  expect(jobs.size).toBe(1);
  expect(wakeup.publishJobsAvailable).toHaveBeenCalledTimes(1);
  expect(objectState).toBe('available');
});
