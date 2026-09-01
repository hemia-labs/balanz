/* eslint-disable @typescript-eslint/no-unsafe-return */
import { randomUUID } from 'node:crypto';
import { PermissionStatus } from '../src/common/auth/permission-catalog';
import { Membership } from '../src/modules/memberships/entities/membership.entity';
import { PermissionAdministrationService } from '../src/modules/permissions/permission-administration.service';
import {
  MembershipPermission,
  PermissionEffect,
} from '../src/modules/permissions/entities/membership-permission.entity';
import { Permission } from '../src/modules/permissions/entities/permission.entity';
import { RoleKey } from '../src/modules/permissions/entities/role.entity';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

describe('TA-P0-003-04 permission administration audit', () => {
  const organizationId = randomUUID();
  const actorMembershipId = randomUUID();
  const targetMembershipId = randomUUID();
  const actorUserId = randomUUID();
  const targetUserId = randomUUID();
  const permissionId = randomUUID();
  const correlationId = randomUUID();
  const permission = {
    id: permissionId,
    key: 'clients.view',
    name: 'Ver clientes',
    status: PermissionStatus.ACTIVE,
    sensitive: false,
  };
  const target = {
    id: targetMembershipId,
    organizationId,
    userId: targetUserId,
    roleId: 'role-accountant',
    role: { key: RoleKey.ACCOUNTANT },
    status: 'active',
  };
  const tenant = {
    userId: actorUserId,
    sessionId: randomUUID(),
    organizationId,
    membershipId: actorMembershipId,
    role: RoleKey.ADMIN,
    permissions: ['permissions.manage'],
    assignedAccountIds: [],
    accountAccessMode: 'assigned',
    mfaVerifiedAt: new Date(),
    requiresMfa: true,
    mfaStatus: 'active',
    expiresAt: new Date(Date.now() + 60_000),
    tenantActive: true,
    reauthenticationRequiredActions: ['permissions.manage'],
  } as SessionAuthorizationContext;
  const requestContext = { correlationId, ipAddress: '127.0.0.1' };

  function harness(activeOverride: Partial<MembershipPermission> | null) {
    const membershipQuery = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(target),
    };
    const overrideQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(activeOverride),
    };
    const membershipRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(membershipQuery),
      findOne: jest.fn().mockResolvedValue(target),
    };
    const permissionRepository = {
      findOne: jest.fn().mockResolvedValue(permission),
    };
    const overrideRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(overrideQuery),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Membership) return membershipRepository;
        if (entity === Permission) return permissionRepository;
        if (entity === MembershipPermission) return overrideRepository;
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      manager,
      transaction: jest.fn((work: (value: unknown) => unknown) =>
        work(manager),
      ),
    };
    const memberships = {
      findOne: jest.fn().mockResolvedValue(target),
    };
    const organizations = {
      findOne: jest.fn().mockResolvedValue({
        id: organizationId,
        ownerUserId: randomUUID(),
      }),
    };
    const permissions = {
      find: jest.fn().mockResolvedValue([permission]),
    };
    const rolePermissions = {
      find: jest
        .fn()
        .mockResolvedValue([{ permission: { key: permission.key } }]),
    };
    const membershipPermissions = {
      find: jest.fn().mockResolvedValue([]),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({}),
      recordDirect: jest.fn().mockResolvedValue({}),
    };
    const service = new PermissionAdministrationService(
      {} as never,
      permissions as never,
      memberships as never,
      organizations as never,
      rolePermissions as never,
      membershipPermissions as never,
      dataSource as never,
      audit as never,
    );
    return { service, audit, overrideRepository, dataSource };
  }

  it.each([PermissionEffect.GRANT, PermissionEffect.DENY])(
    'audits a %s override with actor, tenant, permission and correlation',
    async (effect) => {
      const { service, audit, overrideRepository } = harness(null);
      await service.setMembershipPermission(
        organizationId,
        targetMembershipId,
        { permission: permission.key, effect },
        tenant,
        requestContext,
      );
      expect(overrideRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId,
          membershipId: targetMembershipId,
          permissionId,
          effect,
          grantedByMembershipId: actorMembershipId,
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'membership_permission.set',
          permissionKey: permission.key,
          decision: 'ALLOW',
          reason: effect,
          organizationId,
          actorUserId,
          actorMembershipId,
          objectId: targetMembershipId,
          correlationId,
        }),
      );
    },
  );

  it('revokes with revoked_at and audits return to the role default', async () => {
    const current = {
      id: randomUUID(),
      effect: PermissionEffect.DENY,
      revokedAt: null,
      revokedByMembershipId: null,
    };
    const { service, audit, overrideRepository } = harness(current);
    await service.revokeMembershipPermission(
      organizationId,
      targetMembershipId,
      permission.key,
      tenant,
      requestContext,
    );
    expect(current.revokedAt).toBeInstanceOf(Date);
    expect(current.revokedByMembershipId).toBe(actorMembershipId);
    expect(overrideRepository.save).toHaveBeenCalledWith(current);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'membership_permission.revoke',
        permissionKey: permission.key,
        decision: 'ALLOW',
        reason: 'return_to_role_default',
        organizationId,
        actorUserId,
        actorMembershipId,
        objectId: targetMembershipId,
        correlationId,
      }),
    );
  });

  it('requires recent reauthentication before an administrative mutation', async () => {
    const { service, audit, dataSource } = harness(null);
    const staleTenant = {
      ...tenant,
      mfaVerifiedAt: new Date(Date.now() - 16 * 60 * 1000),
    };

    await expect(
      service.setMembershipPermission(
        organizationId,
        targetMembershipId,
        { permission: permission.key, effect: PermissionEffect.DENY },
        staleTenant,
        requestContext,
      ),
    ).rejects.toMatchObject({ message: 'REAUTHENTICATION_REQUIRED' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(audit.recordDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionKey: 'permissions.manage',
        decision: 'REAUTHENTICATION_REQUIRED',
        reason: 'REAUTHENTICATION_REQUIRED',
        objectId: targetMembershipId,
        correlationId,
      }),
    );
  });

  it('audits and rejects self mutation without changing data', async () => {
    const { service, audit, dataSource } = harness(null);

    await expect(
      service.setMembershipPermission(
        organizationId,
        actorMembershipId,
        { permission: permission.key, effect: PermissionEffect.GRANT },
        tenant,
        requestContext,
      ),
    ).rejects.toMatchObject({ message: 'Self elevation is not allowed' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(audit.recordDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'DENY',
        reason: 'SELF_MUTATION_FORBIDDEN',
        objectId: actorMembershipId,
        correlationId,
      }),
    );
  });
});
