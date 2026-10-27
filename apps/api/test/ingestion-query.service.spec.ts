import { HttpException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RequestContext } from '../src/common/decorators/request-context.decorator';
import type { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import type { ClientAccountScopeService } from '../src/modules/client-accounts/client-account-scope.service';
import { IngestionQueryService } from '../src/modules/cfdi/services/ingestion-query.service';
import {
  IngestionAdmissionLimitError,
  type CreateJobReservationInput,
  type IngestionIdempotencyRepository,
} from '../src/modules/ingestion/services/ingestion-idempotency.repository';
import type { IngestionJobRepository } from '../src/modules/ingestion/services/ingestion-job.repository';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

const ids = {
  organization: '11111111-1111-4111-8111-111111111111',
  account: '22222222-2222-4222-8222-222222222222',
  entity: '33333333-3333-4333-8333-333333333333',
  membership: '44444444-4444-4444-8444-444444444444',
  session: '55555555-5555-4555-8555-555555555555',
  user: '66666666-6666-4666-8666-666666666666',
  job: '77777777-7777-4777-8777-777777777777',
  upload: '88888888-8888-4888-8888-888888888888',
  object: '99999999-9999-4999-8999-999999999999',
  retryJob: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

const tenant: SessionAuthorizationContext = {
  userId: ids.user,
  sessionId: ids.session,
  organizationId: ids.organization,
  membershipId: ids.membership,
  role: 'accountant',
  permissions: ['ingestion.retry'],
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

const request: RequestContext = {
  correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ipAddress: '127.0.0.1',
};

function manualXmlJob(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: ids.job,
    client_account_id: ids.account,
    legal_entity_id: ids.entity,
    source_type: 'manual_xml',
    upload_id: ids.upload,
    root_object_id: ids.object,
    requested_by_membership_id: ids.membership,
    retry_of_job_id: null,
    status: 'failed_final',
    current_stage: null,
    total_items: 1,
    pending_items: 0,
    processing_items: 0,
    incorporated_items: 0,
    duplicate_items: 0,
    foreign_items: 0,
    invalid_items: 0,
    unsupported_items: 0,
    internal_error_items: 1,
    attempt_count: 4,
    automatic_retry_count: 3,
    next_attempt_at: null,
    last_error_code: 'PARSER_INTERNAL_ERROR',
    created_at: new Date('2026-09-03T10:00:00.000Z'),
    updated_at: new Date('2026-09-03T10:01:00.000Z'),
    completed_at: new Date('2026-09-03T10:01:00.000Z'),
    version: 9,
    ...overrides,
  };
}

function managerFor(job: Record<string, unknown>): jest.Mocked<EntityManager> {
  return {
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM ingestion_jobs')) return Promise.resolve([job]);
      if (sql.includes('FROM ingestion_items')) {
        return Promise.resolve([
          { safe_filename: 'invoice.xml', sha256: 'b'.repeat(64) },
        ]);
      }
      throw new Error('Unexpected query in ingestion action test');
    }),
  } as unknown as jest.Mocked<EntityManager>;
}

function transactionsFor(
  manager: EntityManager,
): FiscalTenantTransactionService {
  return {
    run: jest.fn(
      async (
        _scope: unknown,
        work: (transactionManager: EntityManager) => Promise<unknown>,
      ) => work(manager),
    ),
  } as unknown as FiscalTenantTransactionService;
}

function accessibleAccountScope(): jest.Mocked<ClientAccountScopeService> {
  return {
    requireAccessibleAccountWithManager: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<ClientAccountScopeService>;
}

describe('IngestionQueryService', () => {
  it('requests durable cancellation for an accessible manual_xml job', async () => {
    const manager = managerFor(manualXmlJob({ status: 'queued' }));
    const accountScope = accessibleAccountScope();
    const jobs = {
      requestCancellation: jest.fn().mockResolvedValue('cancel_requested'),
    };
    const service = new IngestionQueryService(
      transactionsFor(manager),
      accountScope,
      jobs as unknown as IngestionJobRepository,
      {} as IngestionIdempotencyRepository,
    );

    await expect(service.cancel(ids.job, tenant)).resolves.toEqual({
      jobId: ids.job,
      status: 'cancel_requested',
    });
    expect(
      accountScope.requireAccessibleAccountWithManager,
    ).toHaveBeenCalledWith(manager, ids.account, tenant);
    expect(jobs.requestCancellation).toHaveBeenCalledWith(
      {
        organizationId: ids.organization,
        membershipId: ids.membership,
      },
      ids.job,
    );
  });

  it('creates one logical manual_xml retry and replays it for the same key', async () => {
    const manager = managerFor(manualXmlJob());
    const accountScope = accessibleAccountScope();
    const inputs: CreateJobReservationInput[] = [];
    const createJob = jest.fn((input: CreateJobReservationInput) => {
      inputs.push(input);
      return Promise.resolve({
        outcome:
          inputs.length === 1 ? ('created' as const) : ('replayed' as const),
        value: {
          jobId: ids.retryJob,
          status: 'queued' as const,
          responseStatus: 202,
          responseReference: `/api/v1/ingestions/${ids.retryJob}`,
        },
      });
    });
    const service = new IngestionQueryService(
      transactionsFor(manager),
      accountScope,
      {} as IngestionJobRepository,
      { createJob } as unknown as IngestionIdempotencyRepository,
    );

    const first = await service.retry(ids.job, 'retry-key', tenant, request);
    const replay = await service.retry(ids.job, 'retry-key', tenant, request);

    expect(first).toEqual({ jobId: ids.retryJob, status: 'queued' });
    expect(replay).toEqual(first);
    expect(createJob).toHaveBeenCalledTimes(2);
    const [firstInput, replayInput] = inputs;
    if (!firstInput || !replayInput) {
      throw new Error('Expected both retry reservation inputs');
    }
    expect(firstInput).toMatchObject({
      scope: {
        organizationId: ids.organization,
        clientAccountId: ids.account,
        legalEntityId: ids.entity,
        membershipId: ids.membership,
      },
      sourceType: 'manual_xml',
      idempotencyKey: 'retry-key',
      correlationId: request.correlationId,
      status: 'queued',
      uploadId: ids.upload,
      rootObjectId: ids.object,
      requestedByMembershipId: ids.membership,
      retryOfJobId: ids.job,
      initialItem: {
        objectId: ids.object,
        safeFilename: 'invoice.xml',
        sha256: 'b'.repeat(64),
      },
    });
    expect(firstInput.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(replayInput.requestFingerprint).toBe(firstInput.requestFingerprint);
  });

  it('maps admission rejection during a manual retry to stable 429', async () => {
    const manager = {
      query: jest.fn((sql: string) => {
        if (sql.includes('FROM ingestion_jobs')) {
          return Promise.resolve([
            {
              id: ids.job,
              client_account_id: ids.account,
              legal_entity_id: ids.entity,
              source_type: 'manual_xml',
              upload_id: ids.upload,
              root_object_id: ids.object,
              requested_by_membership_id: ids.membership,
              retry_of_job_id: null,
              status: 'failed_final',
              current_stage: null,
              total_items: 1,
              pending_items: 0,
              processing_items: 0,
              incorporated_items: 0,
              duplicate_items: 0,
              foreign_items: 0,
              invalid_items: 0,
              unsupported_items: 0,
              internal_error_items: 1,
              attempt_count: 4,
              automatic_retry_count: 3,
              next_attempt_at: null,
              last_error_code: 'PARSER_INTERNAL_ERROR',
              created_at: new Date(),
              updated_at: new Date(),
              completed_at: new Date(),
              version: 9,
            },
          ]);
        }
        if (sql.includes('FROM ingestion_items')) {
          return Promise.resolve([
            { safe_filename: 'invoice.xml', sha256: 'b'.repeat(64) },
          ]);
        }
        throw new Error('Unexpected query in retry test');
      }),
    } as unknown as jest.Mocked<EntityManager>;
    const transactions = {
      run: jest.fn(
        async (
          _scope: unknown,
          work: (transactionManager: EntityManager) => Promise<unknown>,
        ) => work(manager),
      ),
    } as unknown as FiscalTenantTransactionService;
    const accountScope = {
      requireAccessibleAccountWithManager: jest.fn().mockResolvedValue({}),
    } as unknown as ClientAccountScopeService;
    const idempotency = {
      createJob: jest
        .fn()
        .mockRejectedValue(new IngestionAdmissionLimitError('tenant')),
    } as unknown as jest.Mocked<IngestionIdempotencyRepository>;
    const service = new IngestionQueryService(
      transactions,
      accountScope,
      {} as IngestionJobRepository,
      idempotency,
    );

    try {
      await service.retry(ids.job, 'retry-key', tenant, request);
      throw new Error('Expected retry admission to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'INGESTION_ACTIVE_JOB_LIMIT',
      });
    }
  });
});
