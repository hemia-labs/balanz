import { AuthorizationService } from '../src/modules/sessions/authorization.service';
import {
  MembershipRole,
  MembershipStatus,
} from '../src/modules/memberships/entities/membership.entity';
import { OrganizationStatus } from '../src/modules/organizations/entities/organization.entity';
import { UserStatus } from '../src/modules/users/entities/user.entity';
import {
  AuthSession,
  AuthSessionStatus,
} from '../src/modules/sessions/entities/auth-session.entity';
import { RoleScope } from '../src/modules/permissions/entities/role.entity';

describe('AuthorizationService', () => {
  it('requires the session tenant to match the membership tenant', async () => {
    const users = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
      }),
    };
    const organizations = {
      findOne: jest.fn().mockResolvedValue({
        id: 'org-1',
        ownerUserId: 'user-1',
        status: OrganizationStatus.ACTIVE,
      }),
    };
    const memberships = {
      findOne: jest.fn().mockResolvedValue({
        id: 'membership-1',
        organizationId: 'org-1',
        userId: 'user-1',
        roleId: 'role-1',
        role: { key: MembershipRole.OWNER, scope: RoleScope.ORGANIZATION },
        status: MembershipStatus.ACTIVE,
      }),
    };
    const rolePermissions = {
      find: jest
        .fn()
        .mockResolvedValue([{ permission: { key: 'organization.view' } }]),
    };
    const service = new AuthorizationService(
      users as never,
      organizations as never,
      memberships as never,
      rolePermissions as never,
      { find: jest.fn() } as never,
      {} as never,
      {} as never,
    );
    const session = {
      id: 'session-1',
      userId: 'user-1',
      organizationId: 'org-1',
      membershipId: 'membership-1',
      status: AuthSessionStatus.ACTIVE,
      mfaVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as AuthSession;

    const context = await service.resolve(session);

    expect(context.tenantActive).toBe(true);
    expect(context.role).toBe(MembershipRole.OWNER);
    expect(context.permissions).toContain('organization.view');
    expect(context.assignedAccountIds).toEqual([]);
    expect(context.accountAccessMode).toBe('tenant');
    expect(memberships.findOne).toHaveBeenCalledWith({
      where: {
        id: 'membership-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
      relations: { role: true },
    });
    expect(rolePermissions.find).toHaveBeenCalledWith({
      where: { roleId: 'role-1' },
    });
  });

  it('resolves non-owner access from active account assignments', async () => {
    const users = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'user-2', status: UserStatus.ACTIVE }),
    };
    const organizations = {
      findOne: jest.fn().mockResolvedValue({
        id: 'org-1',
        ownerUserId: 'user-1',
        status: OrganizationStatus.ACTIVE,
      }),
    };
    const memberships = {
      findOne: jest.fn().mockResolvedValue({
        id: 'membership-2',
        organizationId: 'org-1',
        userId: 'user-2',
        roleId: 'role-accountant',
        role: { key: MembershipRole.ACCOUNTANT, scope: RoleScope.ORGANIZATION },
        status: MembershipStatus.ACTIVE,
      }),
    };
    const rolePermissions = {
      find: jest
        .fn()
        .mockResolvedValue([{ permission: { key: 'clients.view' } }]),
    };
    const query = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([
          { clientAccountId: 'account-b' },
          { clientAccountId: 'account-a' },
        ]),
    };
    const assignments = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    };
    const service = new AuthorizationService(
      users as never,
      organizations as never,
      memberships as never,
      rolePermissions as never,
      assignments as never,
      {} as never,
      {} as never,
    );
    const session = {
      id: 'session-2',
      userId: 'user-2',
      organizationId: 'org-1',
      membershipId: 'membership-2',
      status: AuthSessionStatus.ACTIVE,
      mfaVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as AuthSession;

    const context = await service.resolve(session);

    expect(context.accountAccessMode).toBe('assigned');
    expect(context.assignedAccountIds).toEqual(['account-a', 'account-b']);
    expect(assignments.createQueryBuilder).toHaveBeenCalledWith('assignment');
  });
});
