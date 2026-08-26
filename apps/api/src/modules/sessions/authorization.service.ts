import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  Membership,
  MembershipStatus,
} from '../memberships/entities/membership.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organizations/entities/organization.entity';
import { User, UserStatus } from '../users/entities/user.entity';
import { AuthSession, AuthSessionStatus } from './entities/auth-session.entity';
import type { SessionAuthorizationContext } from './session.types';
import {
  AuthFactor,
  AuthFactorStatus,
} from '../auth/entities/auth-factor.entity';
import { RolePermission } from '../permissions/entities/role-permission.entity';
import { RoleScope } from '../permissions/entities/role.entity';
import { MFA_SENSITIVE_PERMISSION_KEYS } from '../../common/auth/permission-catalog';
import {
  AccountAssignment,
  AccountAssignmentStatus,
} from '../client-accounts/entities/account-assignment.entity';
import {
  ClientAccount,
  ClientAccountStatus,
} from '../client-accounts/entities/client-account.entity';

export const MFA_SENSITIVE_PERMISSIONS = new Set<string>(
  MFA_SENSITIVE_PERMISSION_KEYS,
);

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
    @InjectRepository(RolePermission)
    private readonly rolePermissions: Repository<RolePermission>,
    @InjectRepository(AccountAssignment)
    private readonly assignments: Repository<AccountAssignment>,
    @Optional()
    @InjectRepository(AuthFactor)
    private readonly factors: Repository<AuthFactor>,
    private readonly dataSource: DataSource,
  ) {}

  async resolve(session: AuthSession): Promise<SessionAuthorizationContext> {
    const [user, factor] = await Promise.all([
      this.users.findOne({ where: { id: session.userId } }),
      this.factors && typeof this.factors.findOne === 'function'
        ? this.factors.findOne({
            where: [
              { userId: session.userId, status: AuthFactorStatus.ACTIVE },
              { userId: session.userId, status: AuthFactorStatus.PENDING },
            ],
            order: { createdAt: 'DESC' },
          })
        : Promise.resolve(null),
    ]);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Inactive user');
    }

    let role: string | null = null;
    let permissions: string[] = [];
    let tenantActive = false;
    let assignedAccountIds: string[] = [];
    let accountAccessMode: 'tenant' | 'assigned' = 'assigned';
    const mfaStatus =
      factor?.status === AuthFactorStatus.ACTIVE
        ? 'active'
        : factor?.status === AuthFactorStatus.PENDING
          ? 'pending'
          : 'disabled';
    if (session.organizationId && session.membershipId) {
      const [organization, membership] = await Promise.all([
        this.organizations.findOne({
          where: { id: session.organizationId },
        }),
        this.memberships.findOne({
          where: {
            id: session.membershipId,
            organizationId: session.organizationId,
            userId: session.userId,
          },
          relations: { role: true },
        }),
      ]);

      if (!organization || !membership) {
        throw new ForbiddenException('Invalid tenant context');
      }
      if (membership.role.scope !== RoleScope.ORGANIZATION) {
        throw new ForbiddenException('Invalid tenant role');
      }
      role = membership.role.key;
      permissions = await this.rolePermissions
        .find({ where: { roleId: membership.roleId } })
        .then((items) => items.map((item) => item.permission.key).sort());
      tenantActive =
        organization.status === OrganizationStatus.ACTIVE &&
        membership.status === MembershipStatus.ACTIVE &&
        session.status === AuthSessionStatus.ACTIVE &&
        session.expiresAt.getTime() > Date.now() &&
        (!session.requiresMfa || session.mfaVerifiedAt != null);
      if (organization.ownerUserId === user.id) {
        accountAccessMode = 'tenant';
      } else {
        assignedAccountIds = await this.assignments
          .createQueryBuilder('assignment')
          .innerJoin(
            ClientAccount,
            'account',
            'account.organization_id = assignment.organization_id AND account.id = assignment.client_account_id',
          )
          .select('assignment.client_account_id', 'clientAccountId')
          .where('assignment.organization_id = :organizationId', {
            organizationId: organization.id,
          })
          .andWhere('assignment.membership_id = :membershipId', {
            membershipId: membership.id,
          })
          .andWhere('assignment.status = :assignmentStatus', {
            assignmentStatus: AccountAssignmentStatus.ACTIVE,
          })
          .andWhere('account.status <> :archived', {
            archived: ClientAccountStatus.ARCHIVED,
          })
          .getRawMany<{ clientAccountId: string }>()
          .then((items) => items.map((item) => item.clientAccountId).sort());
      }
    }

    return {
      userId: user.id,
      sessionId: session.id,
      organizationId: session.organizationId ?? null,
      membershipId: session.membershipId ?? null,
      role,
      permissions,
      assignedAccountIds,
      accountAccessMode,
      mfaVerifiedAt: session.mfaVerifiedAt ?? null,
      requiresMfa: session.requiresMfa,
      mfaStatus,
      expiresAt: session.expiresAt,
      tenantActive,
    };
  }

  async requireTenant(
    session: AuthSession,
  ): Promise<SessionAuthorizationContext> {
    const context = await this.resolve(session);
    if (!context.tenantActive) {
      throw new ForbiddenException('Active tenant required');
    }
    return context;
  }

  requireMfa(session: AuthSession, permission: string): void {
    if (!MFA_SENSITIVE_PERMISSIONS.has(permission)) return;
    if (session.requiresMfa && !session.mfaVerifiedAt) {
      throw new UnauthorizedException('MFA_REQUIRED');
    }
    if (!session.requiresMfa) {
      throw new ForbiddenException('MFA_SETUP_REQUIRED');
    }
  }

  async listOrganizations(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      membershipId: string;
      role: string;
    }>
  > {
    const memberships = await this.memberships.find({
      where: { userId, status: MembershipStatus.ACTIVE },
      order: { createdAt: 'ASC' },
      relations: { role: true },
    });
    if (memberships.length === 0) return [];

    const organizations = await this.organizations.find({
      where: {
        id: In(memberships.map((membership) => membership.organizationId)),
        status: OrganizationStatus.ACTIVE,
      },
    });
    const byId = new Map(
      organizations.map((organization) => [organization.id, organization]),
    );

    return memberships.flatMap((membership) => {
      const organization = byId.get(membership.organizationId);
      if (!organization || membership.role?.scope !== RoleScope.ORGANIZATION) {
        return [];
      }
      return [
        {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          membershipId: membership.id,
          role: membership.role.key,
        },
      ];
    });
  }

  async changeOrganization(
    sessionId: string,
    userId: string,
    organizationId: string,
  ): Promise<{
    session: AuthSession;
    previousOrganizationId: string | null;
    previousMembershipId: string | null;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(AuthSession);
      const session = await sessions.findOne({
        where: { id: sessionId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session || session.status !== AuthSessionStatus.ACTIVE) {
        throw new UnauthorizedException('Invalid session');
      }
      if (
        session.expiresAt.getTime() <= Date.now() ||
        (session.requiresMfa && !session.mfaVerifiedAt)
      ) {
        throw new UnauthorizedException('Verified session required');
      }

      const organization = await manager.getRepository(Organization).findOne({
        where: { id: organizationId, status: OrganizationStatus.ACTIVE },
      });
      const membership = await manager.getRepository(Membership).findOne({
        where: {
          organizationId,
          userId,
          status: MembershipStatus.ACTIVE,
        },
        relations: { role: true },
      });
      if (
        !organization ||
        !membership ||
        membership.role?.scope !== RoleScope.ORGANIZATION
      ) {
        throw new NotFoundException('Organization not found');
      }

      const previousOrganizationId = session.organizationId ?? null;
      const previousMembershipId = session.membershipId ?? null;
      session.organizationId = organization.id;
      session.membershipId = membership.id;
      session.lastActivityAt = new Date();
      await sessions.save(session);
      return { session, previousOrganizationId, previousMembershipId };
    });
  }
}
