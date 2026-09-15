import { SatService } from '../src/modules/sat-download/sat.service';
import type { SatJobRow } from '../src/modules/sat-download/sat.dtos';
import type { EfirmaRepository } from '../src/modules/efirma/efirma.repository';
import type { EfirmaPreparationService } from '../src/modules/efirma/efirma-preparation.service';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';
import type { EntityManager } from 'typeorm';
describe('PR25 actor and retry contract regression', () => {
  const actor = {
    userId: 'assigned-user',
    membershipId: 'assigned-membership',
    organizationId: 'org',
    tenantActive: true,
    permissions: ['sat.download', 'credentials.manage'],
  } as SessionAuthorizationContext;
  const row = {
    id: 'job',
    user_id: 'creator',
    membership_id: 'creator-membership',
    organization_id: 'org',
    legal_entity_id: 'entity',
    client_account_id: 'account',
    status: 'requires_user_authorization',
    error_code: 'SAT_TECHNICAL_FAILURE',
    technical_retries: 1,
    next_attempt_at: new Date(0),
    cancel_requested_at: null,
    terminal_at: null,
  } as unknown as SatJobRow;
  const make = () => {
    const query = jest.fn((sql: string) =>
      Promise.resolve(sql.startsWith('SELECT ') ? [row] : []),
    );
    const manager = { query } as unknown as EntityManager;
    const custody = {
      config: { enabled: true },
      run: <T>(_tenant: unknown, work: (m: EntityManager) => Promise<T>) =>
        work(manager),
      entity: jest.fn().mockResolvedValue({}),
    };
    return {
      query,
      service: new SatService(
        custody as unknown as EfirmaRepository,
        {} as EfirmaPreparationService,
      ),
    };
  };
  beforeEach(() =>
    jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'test',
      SAT_ENABLED: 'true',
      SAT_QA_ISOLATED: 'true',
      EFIRMA_ENABLED: 'true',
    }),
  );
  afterEach(() => jest.restoreAllMocks());
  it.each(['cancel', 'retry'] as const)(
    'attributes %s to the acting authorized user',
    async (action) => {
      const { query, service } = make();
      if (action === 'cancel')
        await service.cancel(actor, row.id, 'correlation');
      else await service.retry(actor, row.id, undefined, 'correlation');
      const call = (query.mock.calls as unknown as [string, unknown[]][]).find(
        ([sql]) => sql.startsWith('INSERT INTO audit_events'),
      );
      expect(call?.[1]).toEqual([
        'org',
        actor.userId,
        actor.membershipId,
        'account',
        'entity',
        'sat.' + (action === 'cancel' ? 'cancel_requested' : 'retry_requested'),
        'job',
        'correlation',
      ]);
    },
  );
  it.each([
    {
      status: 'requires_user_authorization',
      technical_retries: 1,
      next_attempt_at: new Date(0),
      eligible: true,
      allowed: true,
    },
    {
      status: 'requires_user_authorization',
      technical_retries: 1,
      next_attempt_at: new Date(Date.now() + 60000),
      eligible: true,
      allowed: false,
    },
    {
      status: 'failed',
      technical_retries: 3,
      next_attempt_at: new Date(0),
      eligible: false,
      allowed: false,
    },
  ])(
    'exposes backend retry eligibility for $status / $technical_retries attempts',
    (example) => {
      const dto = make().service.dto({ ...row, ...example } as SatJobRow);
      expect(dto.technicalRetry).toMatchObject({
        eligible: example.eligible,
        allowed: example.allowed,
        remainingAttempts: 3 - example.technical_retries,
      });
    },
  );
});
