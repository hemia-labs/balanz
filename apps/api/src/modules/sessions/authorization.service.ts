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

const OWNER_PERMISSIONS = [
  'organization.view',
  'organization.manage',
  'ownership.manage',
  'billing.manage',
  'team.view',
  'team.manage',
  'clients.view',
  'clients.manage',
  'clients.assign',
  'credentials.manage',
  'sat.download',
  'payroll.view',
  'cfdi.review',
  'cfdi.exclude',
  'period.close',
  'period.reopen',
  'exports.create',
  'obligations.view',
  'obligations.configure',
  'diot.generate',
  'ieps.generate',
  'audit.view',
  'support.authorize',
];

export const MFA_SENSITIVE_PERMISSIONS = new Set([
  'organization.manage',
  'organization.transfer',
  'organization.cancel',
  'members.manage',
  'permissions.manage',
  'billing.manage',
  'clients.assign',
  'fiscal_entities.manage',
  'credentials.manage',
  'sat.download',
  'cfdi.download',
  'payroll.export',
  'exceptions.accept',
  'checklist.configure',
  'periods.takeover',
  'periods.close',
  'periods.reopen',
  'exports.generate',
  'exports.download',
  'exports.bulk',
  'support.authorize',
  'retention.manage',
]);

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
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
    let tenantActive = false;
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
        }),
      ]);

      if (!organization || !membership) {
        throw new ForbiddenException('Invalid tenant context');
      }
      role = membership.role;
      tenantActive =
        organization.status === OrganizationStatus.ACTIVE &&
        membership.status === MembershipStatus.ACTIVE &&
        session.status === AuthSessionStatus.ACTIVE &&
        session.expiresAt.getTime() > Date.now() &&
        (!session.requiresMfa || session.mfaVerifiedAt != null);
    }

    return {
      userId: user.id,
      sessionId: session.id,
      organizationId: session.organizationId ?? null,
      membershipId: session.membershipId ?? null,
      role,
      permissions: role === 'owner' ? [...OWNER_PERMISSIONS] : [],
      assignedAccountIds: [],
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
      return organization
        ? [
            {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              membershipId: membership.id,
              role: membership.role,
            },
          ]
        : [];
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
      });
      if (!organization || !membership) {
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
