import { DataSource, EntityManager } from 'typeorm';
import { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import { ClientAccountScopeService } from '../src/modules/client-accounts/client-account-scope.service';
import { MonthlyService } from '../src/modules/client-accounts/monthly.service';
import { AuthorizationService } from '../src/modules/sessions/authorization.service';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

describe('monthly access to suspended entities', () => {
  const tenant: SessionAuthorizationContext = {
    userId: 'user',
    sessionId: 'session',
    organizationId: 'org',
    membershipId: 'member',
    role: 'titular',
    permissions: [
      'cfdi.view',
      'periods.view',
      'periods.review',
      'incidents.view',
      'processes.view',
    ],
    assignedAccountIds: [],
    accountAccessMode: 'tenant',
    mfaVerifiedAt: new Date(),
    reauthenticatedAt: new Date(),
    requiresMfa: false,
    mfaStatus: 'active',
    expiresAt: new Date(Date.now() + 600000),
    tenantActive: true,
    reauthenticationRequiredActions: [],
  };

  function setup(status: string, payroll = false) {
    const query = jest.fn((sql: string) => {
      if (sql.startsWith('SELECT p.*,fy.year'))
        return [
          {
            id: 'period',
            organization_id: 'org',
            client_account_id: 'account',
            legal_entity_id: 'entity',
            entity_status: status,
          },
        ];
      if (sql.includes('FROM unnest'))
        return tenant.permissions.map((key) => ({ key }));
      if (sql.includes(' AS restricted')) return [{ restricted: payroll }];
      if (sql.startsWith('SELECT id,version,closed_at'))
        return [{ id: 'close', version: 1 }];
      if (sql.startsWith('SELECT * FROM monthly_workspaces')) return [];
      throw new Error('Unexpected query in access regression');
    });
    const manager = { query } as unknown as EntityManager;
    const transaction = jest.fn(
      async (
        _isolation: string,
        work: (m: EntityManager) => Promise<unknown>,
      ) => work(manager),
    );
    const apply = jest.fn().mockResolvedValue(undefined);
    const revalidateSession = jest.fn().mockResolvedValue({ context: tenant });
    const requireAccessibleAccountWithManager = jest
      .fn()
      .mockResolvedValue({ id: 'account' });
    const service = new MonthlyService(
      { transaction } as unknown as DataSource,
      { apply } as unknown as FiscalTenantTransactionService,
      { revalidateSession } as unknown as AuthorizationService,
      {
        requireAccessibleAccountWithManager,
      } as unknown as ClientAccountScopeService,
    );
    return {
      service,
      query,
      apply,
      requireAccessibleAccountWithManager,
      revalidateSession,
    };
  }

  it.each(['active', 'suspended'])(
    'allows authorized history reads for %s entities',
    async (status) => {
      const test = setup(status);
      await expect(test.service.closes(tenant, 'period')).resolves.toEqual({
        items: [{ id: 'close', version: 1 }],
      });
      expect(test.apply).toHaveBeenCalledWith(expect.anything(), {
        organizationId: 'org',
        membershipId: 'member',
      });
      expect(test.requireAccessibleAccountWithManager).toHaveBeenCalledWith(
        expect.anything(),
        'account',
        tenant,
      );
      expect(
        test.query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql)),
      ).toBe(false);
    },
  );

  it('rejects acquiring and renewing editing authority while suspended', async () => {
    const test = setup('suspended');
    const input = { instanceToken: 'a'.repeat(64), expectedVersion: 0 };
    await expect(
      test.service.acquire(tenant, 'period', input),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      test.service.renew(tenant, 'period', input),
    ).rejects.toMatchObject({ status: 404 });
    expect(test.query.mock.calls).toHaveLength(2);
  });

  it('does not open archived or unknown entity states to reads', async () => {
    for (const status of ['archived', 'unknown']) {
      await expect(
        setup(status).service.closes(tenant, 'period'),
      ).rejects.toMatchObject({ status: 404 });
    }
  });

  it('still requires current account access for suspended entities', async () => {
    const test = setup('suspended');
    test.requireAccessibleAccountWithManager.mockRejectedValueOnce(
      new Error('access revoked'),
    );
    await expect(test.service.closes(tenant, 'period')).rejects.toThrow(
      'access revoked',
    );
    expect(test.query.mock.calls).toHaveLength(1);
  });

  it('still denies a changed tenant before reading a suspended entity', async () => {
    const test = setup('suspended');
    test.revalidateSession.mockResolvedValueOnce({
      context: { ...tenant, organizationId: 'other' },
    });
    await expect(test.service.closes(tenant, 'period')).rejects.toMatchObject({
      status: 403,
    });
    expect(test.query).not.toHaveBeenCalled();
  });

  it('keeps payroll protection on historical closes of suspended entities', async () => {
    await expect(
      setup('suspended', true).service.closes(tenant, 'period'),
    ).rejects.toMatchObject({ status: 403 });
  });
});
