/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IsNull } from 'typeorm';
import {
  ROLE_PERMISSION_KEYS,
  type PermissionKey,
} from '../src/common/auth/permission-catalog';
import { resolveEffectivePermission } from '../src/common/auth/authorization-contract';
import { FiscalAuthorizationService } from '../src/modules/client-accounts/fiscal-authorization.service';
import { AuditDecision } from '../src/modules/audit/entities/audit-event.entity';
import { PermissionEffect } from '../src/modules/permissions/entities/membership-permission.entity';
import { RoleKey } from '../src/modules/permissions/entities/role.entity';
import {
  AuthSession,
  AuthSessionStatus,
} from '../src/modules/sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';
import { AuthorizationService } from '../src/modules/sessions/authorization.service';

type MatrixOverride = PermissionEffect | null;

describe('TA-P0-003-04 authorization matrix', () => {
  const organizationId = randomUUID();
  const membershipId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const accountId = randomUUID();
  const correlationId = randomUUID();
  const permission: PermissionKey = 'periods.close';

  function context(
    input: {
      role?: RoleKey;
      override?: MatrixOverride;
      mfa?: boolean;
      tenantActive?: boolean;
    } = {},
  ): SessionAuthorizationContext {
    const role = input.role ?? RoleKey.ACCOUNTANT;
    const roleDefault = ROLE_PERMISSION_KEYS[role].includes(permission);
    const effective = resolveEffectivePermission({
      roleDefault,
      activeOverride: input.override,
    });
    const mfa = input.mfa ?? true;
    return {
      userId,
      sessionId,
      organizationId,
      membershipId,
      role,
      permissions: effective ? [permission] : [],
      assignedAccountIds: [accountId],
      accountAccessMode: 'assigned',
      mfaVerifiedAt: mfa ? new Date() : null,
      reauthenticatedAt: mfa ? new Date() : null,
      requiresMfa: true,
      mfaStatus: mfa ? 'active' : 'disabled',
      expiresAt: new Date(Date.now() + 60_000),
      tenantActive: input.tenantActive ?? true,
      reauthenticationRequiredActions: effective ? [permission] : [],
    };
  }

  const activeSession = (reauthenticatedAt = new Date()) =>
    ({
      id: sessionId,
      mfaVerifiedAt: new Date(),
      reauthenticatedAt,
      status: AuthSessionStatus.ACTIVE,
      expiresAt: new Date(Date.now() + 60_000),
    }) as AuthSession;

  const request = { correlationId, ipAddress: '127.0.0.1' };

  const cases: Array<{
    name: string;
    role: RoleKey;
    override: MatrixOverride;
    mfa?: boolean;
    tenantActive?: boolean;
    scope?: 'assigned' | 'outside';
    staleReauthentication?: boolean;
    expected:
      | 'ALLOW'
      | 'DENY'
      | 'OUT_OF_SCOPE'
      | 'MFA_REQUIRED'
      | 'REAUTHENTICATION_REQUIRED';
  }> = [
    {
      name: 'accountant default + assigned',
      role: RoleKey.ACCOUNTANT,
      override: null,
      expected: 'ALLOW',
    },
    {
      name: 'accountant deny + assigned',
      role: RoleKey.ACCOUNTANT,
      override: PermissionEffect.DENY,
      expected: 'DENY',
    },
    {
      name: 'collaborator grant + assigned',
      role: RoleKey.COLLABORATOR,
      override: PermissionEffect.GRANT,
      expected: 'ALLOW',
    },
    {
      name: 'collaborator default + assigned',
      role: RoleKey.COLLABORATOR,
      override: null,
      expected: 'DENY',
    },
    {
      name: 'any role + outside assignment',
      role: RoleKey.ADMIN,
      override: null,
      scope: 'outside',
      expected: 'OUT_OF_SCOPE',
    },
    {
      name: 'permission + stale sensitive session',
      role: RoleKey.ACCOUNTANT,
      override: null,
      staleReauthentication: true,
      expected: 'REAUTHENTICATION_REQUIRED',
    },
    {
      name: 'permission + no MFA',
      role: RoleKey.ACCOUNTANT,
      override: null,
      mfa: false,
      expected: 'MFA_REQUIRED',
    },
    {
      name: 'inactive tenant + existing permission',
      role: RoleKey.ACCOUNTANT,
      override: null,
      tenantActive: false,
      expected: 'DENY',
    },
  ];

  it.each(cases)('$name => $expected', async (testCase) => {
    const scope = {
      requireAccessibleAccount:
        testCase.scope === 'outside'
          ? jest.fn().mockRejectedValue(new NotFoundException('Not found'))
          : jest.fn().mockResolvedValue({ id: accountId }),
    };
    const audit = { recordDirect: jest.fn().mockResolvedValue({}) };
    const service = new FiscalAuthorizationService(
      scope as never,
      audit as never,
      {} as never,
    );
    const authorization = context({
      role: testCase.role,
      override: testCase.override,
      mfa: testCase.mfa,
      tenantActive: testCase.tenantActive,
    });
    const session = activeSession(
      testCase.staleReauthentication
        ? new Date(Date.now() - 16 * 60 * 1000)
        : new Date(),
    );
    const operation = service.authorize(session, authorization, request, {
      permission,
      clientAccountId: accountId,
      objectType: 'period',
      objectId: randomUUID(),
      requireReauthentication: true,
    });

    if (testCase.expected === 'ALLOW') {
      await expect(operation).resolves.toBeUndefined();
      expect(audit.recordDirect).not.toHaveBeenCalled();
      return;
    }
    if (testCase.expected === 'OUT_OF_SCOPE') {
      await expect(operation).rejects.toBeInstanceOf(NotFoundException);
    } else if (
      testCase.expected === 'MFA_REQUIRED' ||
      testCase.expected === 'REAUTHENTICATION_REQUIRED'
    ) {
      await expect(operation).rejects.toBeInstanceOf(UnauthorizedException);
    } else {
      await expect(operation).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(audit.recordDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        actorUserId: userId,
        actorMembershipId: membershipId,
        permissionKey: permission,
        correlationId,
        decision:
          testCase.expected === 'DENY'
            ? AuditDecision.DENY
            : AuditDecision[testCase.expected],
        reason:
          testCase.expected === 'DENY'
            ? testCase.tenantActive === false
              ? 'INACTIVE_TENANT'
              : 'INSUFFICIENT_PERMISSION'
            : testCase.expected,
      }),
    );
    const recorded = audit.recordDirect.mock.calls[0][0];
    if (testCase.expected === 'OUT_OF_SCOPE') {
      expect(recorded.clientAccountId).toBeNull();
      expect(recorded.objectId).toBeNull();
    }
    expect(JSON.stringify(recorded)).not.toMatch(
      /token|secret|password|xml|accessUrl/i,
    );
  });

  it('returns to the role default when a deny override has revoked_at', () => {
    const revokedOverride = {
      effect: PermissionEffect.DENY,
      revokedAt: new Date(),
    };
    expect(
      resolveEffectivePermission({
        roleDefault: true,
        activeOverride: revokedOverride.revokedAt
          ? null
          : revokedOverride.effect,
      }),
    ).toBe(true);
  });

  it.each([
    ['revoked', null],
    [
      'expired',
      {
        id: sessionId,
        status: AuthSessionStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 1),
      },
    ],
  ])(
    'rejects a %s worker session with 401 semantics',
    async (_name, stored) => {
      const repository = { findOne: jest.fn().mockResolvedValue(stored) };
      const dataSource = {
        getRepository: jest.fn().mockReturnValue(repository),
      };
      const service = new AuthorizationService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        dataSource as never,
      );
      await expect(service.revalidateSession(sessionId)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );

  it('queries only active overrides so revoked_at restores the default', async () => {
    const membershipPermissions = { find: jest.fn().mockResolvedValue([]) };
    const service = new AuthorizationService(
      {
        findOne: jest.fn().mockResolvedValue({ id: userId, status: 'active' }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: organizationId,
          status: 'active',
        }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: membershipId,
          organizationId,
          userId,
          roleId: 'role-accountant',
          role: { key: RoleKey.ACCOUNTANT },
          status: 'active',
        }),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          {
            enabled: true,
            permission: { key: permission, status: 'active' },
          },
        ]),
      } as never,
      { findOne: jest.fn().mockResolvedValue({ status: 'active' }) } as never,
      {} as never,
      membershipPermissions as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
    );
    const resolved = await service.resolve({
      id: sessionId,
      userId,
      organizationId,
      membershipId,
      status: AuthSessionStatus.ACTIVE,
      requiresMfa: true,
      mfaVerifiedAt: new Date(),
      reauthenticatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as AuthSession);
    expect(resolved.permissions).toContain(permission);
    expect(membershipPermissions.find).toHaveBeenCalledWith({
      where: {
        organizationId,
        membershipId,
        revokedAt: IsNull(),
      },
    });
  });
});
