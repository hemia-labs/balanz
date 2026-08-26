import { ClientAccountScopeService } from '../src/modules/client-accounts/client-account-scope.service';
import { ClientAccountStatus } from '../src/modules/client-accounts/entities/client-account.entity';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

function context(mode: 'tenant' | 'assigned'): SessionAuthorizationContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    organizationId: 'org-1',
    membershipId: 'membership-1',
    role: mode === 'tenant' ? 'owner' : 'accountant',
    permissions: ['clients.view'],
    assignedAccountIds: [],
    accountAccessMode: mode,
    mfaVerifiedAt: new Date(),
    requiresMfa: true,
    mfaStatus: 'active',
    expiresAt: new Date(Date.now() + 60_000),
    tenantActive: true,
  };
}

describe('ClientAccountScopeService', () => {
  const account = {
    id: 'account-1',
    organizationId: 'org-1',
    status: ClientAccountStatus.ACTIVE,
  };

  it('lets the real tenant owner access every tenant account without an assignment', async () => {
    const accounts = { findOne: jest.fn().mockResolvedValue(account) };
    const assignments = { existsBy: jest.fn() };
    const service = new ClientAccountScopeService(
      accounts as never,
      assignments as never,
    );

    await expect(
      service.requireAccessibleAccount('account-1', context('tenant')),
    ).resolves.toBe(account);
    expect(assignments.existsBy).not.toHaveBeenCalled();
  });

  it('requires an active assignment for accountant and collaborator scope', async () => {
    const accounts = { findOne: jest.fn().mockResolvedValue(account) };
    const assignments = { existsBy: jest.fn().mockResolvedValue(true) };
    const service = new ClientAccountScopeService(
      accounts as never,
      assignments as never,
    );

    await expect(
      service.requireAccessibleAccount('account-1', context('assigned')),
    ).resolves.toBe(account);
    expect(assignments.existsBy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        membershipId: 'membership-1',
        clientAccountId: 'account-1',
        status: 'active',
      }),
    );

    assignments.existsBy.mockResolvedValue(false);
    await expect(
      service.requireAccessibleAccount('account-1', context('assigned')),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('masks cross-tenant and archived resources as not found', async () => {
    const accounts = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new ClientAccountScopeService(
      accounts as never,
      {} as never,
    );
    await expect(
      service.requireAccessibleAccount('foreign-account', context('tenant')),
    ).rejects.toMatchObject({ status: 404 });

    accounts.findOne.mockResolvedValue({
      ...account,
      status: ClientAccountStatus.ARCHIVED,
    });
    await expect(
      service.requireAccessibleAccount('account-1', context('tenant')),
    ).rejects.toMatchObject({ status: 404 });
  });
});
