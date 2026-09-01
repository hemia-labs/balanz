import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FiscalAuthorizationService } from '../src/modules/client-accounts/fiscal-authorization.service';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';
import type { AuthSession } from '../src/modules/sessions/entities/auth-session.entity';
import { AuditDecision } from '../src/modules/audit/entities/audit-event.entity';

describe('FiscalAuthorizationService', () => {
  const accountId = randomUUID();
  const context = (): SessionAuthorizationContext => ({
    userId: randomUUID(),
    sessionId: randomUUID(),
    organizationId: randomUUID(),
    membershipId: randomUUID(),
    role: 'accountant',
    permissions: ['periods.close'],
    assignedAccountIds: [],
    accountAccessMode: 'assigned',
    mfaVerifiedAt: new Date(),
    requiresMfa: true,
    mfaStatus: 'active',
    expiresAt: new Date(Date.now() + 60_000),
    tenantActive: true,
    reauthenticationRequiredActions: ['periods.close'],
  });
  const request = { correlationId: randomUUID(), ipAddress: '127.0.0.1' };

  it('allows only after permission, MFA, reauthentication and scope pass', async () => {
    const scope = { requireAccessibleAccount: jest.fn().mockResolvedValue({}) };
    const audit = { recordDirect: jest.fn() };
    const service = new FiscalAuthorizationService(
      scope as never,
      audit as never,
      {} as never,
    );
    await expect(
      service.authorize(
        { mfaVerifiedAt: new Date() } as AuthSession,
        context(),
        request,
        {
          permission: 'periods.close',
          clientAccountId: accountId,
          objectType: 'period',
          requireReauthentication: true,
        },
      ),
    ).resolves.toBeUndefined();
    expect(scope.requireAccessibleAccount).toHaveBeenCalledWith(
      accountId,
      expect.any(Object),
    );
    expect(audit.recordDirect).not.toHaveBeenCalled();
  });

  it('denies and audits a missing effective permission', async () => {
    const scope = { requireAccessibleAccount: jest.fn() };
    const audit = { recordDirect: jest.fn().mockResolvedValue({}) };
    const service = new FiscalAuthorizationService(
      scope as never,
      audit as never,
      {} as never,
    );
    const denied = context();
    denied.permissions = [];
    await expect(
      service.authorize(
        { mfaVerifiedAt: new Date() } as AuthSession,
        denied,
        request,
        {
          permission: 'periods.close',
          clientAccountId: accountId,
          objectType: 'period',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.recordDirect).toHaveBeenCalledWith(
      expect.objectContaining({ decision: AuditDecision.DENY }),
    );
  });

  it('requires recent reauthentication for sensitive mutations', async () => {
    const scope = { requireAccessibleAccount: jest.fn().mockResolvedValue({}) };
    const audit = { recordDirect: jest.fn().mockResolvedValue({}) };
    const service = new FiscalAuthorizationService(
      scope as never,
      audit as never,
      {} as never,
    );
    const oldMfa = new Date(Date.now() - 16 * 60 * 1000);
    await expect(
      service.authorize(
        { mfaVerifiedAt: oldMfa } as AuthSession,
        context(),
        request,
        {
          permission: 'periods.close',
          clientAccountId: accountId,
          objectType: 'period',
          requireReauthentication: true,
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(audit.recordDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: AuditDecision.REAUTHENTICATION_REQUIRED,
      }),
    );
  });
});
