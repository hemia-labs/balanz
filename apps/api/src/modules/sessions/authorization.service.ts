import {
  ForbiddenException,
  Injectable,
  NotFoundException,
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

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
    private readonly dataSource: DataSource,
  ) {}

  async resolve(session: AuthSession): Promise<SessionAuthorizationContext> {
    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Inactive user');
    }

    let role: string | null = null;
    let tenantActive = false;
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
        session.mfaVerifiedAt != null;
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
      if (session.expiresAt.getTime() <= Date.now() || !session.mfaVerifiedAt) {
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
