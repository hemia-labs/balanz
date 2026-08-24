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
        status: OrganizationStatus.ACTIVE,
      }),
    };
    const memberships = {
      findOne: jest.fn().mockResolvedValue({
        id: 'membership-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
      }),
    };
    const service = new AuthorizationService(
      users as never,
      organizations as never,
      memberships as never,
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
    expect(memberships.findOne).toHaveBeenCalledWith({
      where: {
        id: 'membership-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    });
  });
});
