import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull, Repository } from 'typeorm';
import { PasswordService } from '../../common/auth/password.service';
import { PermissionStatus } from '../../common/auth/permission-catalog';
import { hasRecentReauthentication } from '../../common/auth/authorization-contract';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../audit/entities/audit-event.entity';
import { EmailService } from '../email/email.service';
import {
  Membership,
  MembershipStatus,
} from '../memberships/entities/membership.entity';
import { OrganizationStatus } from '../organizations/entities/organization.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { RolePermission } from '../permissions/entities/role-permission.entity';
import { Role, RoleScope } from '../permissions/entities/role.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { SessionsService } from '../sessions/sessions.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { EmailVerificationToken } from '../auth/entities/email-verification-token.entity';
import {
  AuthFactor,
  AuthFactorStatus,
} from '../auth/entities/auth-factor.entity';
import {
  AccountAssignment,
  AccountAssignmentStatus,
} from '../client-accounts/entities/account-assignment.entity';
import { MembershipPermission } from '../permissions/entities/membership-permission.entity';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  ListInvitationsDto,
} from './dtos/invitation.dtos';
import {
  Invitation,
  InvitationDeliveryStatus,
  InvitationStatus,
} from './entities/invitation.entity';
import { canAcceptInvitation } from './invitation-state';

type MembershipAction = 'suspend' | 'reactivate' | 'revoke';

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissions: Repository<RolePermission>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async create(
    organizationId: string,
    dto: CreateInvitationDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    this.requireTenant(organizationId, tenant);
    this.requireReauthentication(tenant);
    const emailNormalized = this.normalizeEmail(dto.email);
    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Expiration must be in the future');
    }
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();

    const invitation = await this.dataSource
      .transaction(async (manager) => {
        const organization = await manager.getRepository(Organization).findOne({
          where: { id: organizationId, status: OrganizationStatus.ACTIVE },
          lock: { mode: 'pessimistic_read' },
        });
        if (!organization)
          throw new NotFoundException('Organization not found');

        const role = await manager.getRepository(Role).findOne({
          where: { key: dto.role, scope: RoleScope.ORGANIZATION },
        });
        if (!role) throw new BadRequestException('Invalid organization role');
        await this.validateGrantablePermissions(
          role,
          dto.proposedPermissions ?? [],
          tenant,
          manager.getRepository(RolePermission),
          manager.getRepository(Permission),
        );

        const existingMember = await manager
          .getRepository(Membership)
          .createQueryBuilder('membership')
          .innerJoin('users', 'user', 'user.id = membership.user_id')
          .where('membership.organization_id = :organizationId', {
            organizationId,
          })
          .andWhere('user.email = :email', { email: emailNormalized })
          .getOne();
        if (
          existingMember &&
          existingMember.status !== MembershipStatus.REVOKED
        ) {
          throw new ConflictException(
            'Recipient already belongs to organization',
          );
        }

        const repository = manager.getRepository(Invitation);
        const saved = await repository.save(
          repository.create({
            organizationId,
            email: emailNormalized,
            emailNormalized,
            roleId: role.id,
            proposedPermissions: dto.proposedPermissions ?? [],
            tokenHash,
            status: InvitationStatus.PENDING,
            invitedByMembershipId: this.actorMembershipId(tenant),
            expiresAt,
            lastSentAt: now,
            sendCount: 1,
            deliveryStatus: InvitationDeliveryStatus.PENDING,
          }),
        );
        await this.record(manager, {
          organizationId,
          tenant,
          request,
          action: 'invitation.create',
          objectType: 'invitation',
          objectId: saved.id,
          metadata: {
            previousStatus: null,
            status: saved.status,
            role: dto.role,
            email: emailNormalized,
          },
        });
        return saved;
      })
      .catch((error: unknown) => {
        if (this.isUniqueViolation(error)) {
          throw new ConflictException('A pending invitation already exists');
        }
        throw error;
      });

    await this.deliverInvitation(invitation, rawToken);
    invitation.deliveryStatus = InvitationDeliveryStatus.SENT;
    return this.toResponse(invitation, dto.role);
  }

  async resendInvitation(
    invitationId: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    const organizationId = this.activeOrganizationId(tenant);
    this.requireReauthentication(tenant);
    const rawToken = randomBytes(32).toString('hex');
    const now = new Date();
    const invitation = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Invitation);
      const current = await repository
        .createQueryBuilder('invitation')
        .addSelect('invitation.tokenHash')
        .innerJoinAndSelect('invitation.role', 'role')
        .where('invitation.id = :invitationId', { invitationId })
        .andWhere('invitation.organization_id = :organizationId', {
          organizationId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!current) throw new NotFoundException('Invitation not found');
      if (current.status !== InvitationStatus.PENDING) {
        throw new ConflictException('Only pending invitations can be resent');
      }
      if (current.expiresAt.getTime() <= now.getTime()) {
        current.status = InvitationStatus.EXPIRED;
        await repository.save(current);
        throw new ConflictException('Invitation has expired');
      }
      current.tokenHash = this.hashToken(rawToken);
      current.lastSentAt = now;
      current.sendCount += 1;
      current.deliveryStatus = InvitationDeliveryStatus.PENDING;
      await repository.save(current);
      await this.record(manager, {
        organizationId,
        tenant,
        request,
        action: 'invitation.resend',
        objectType: 'invitation',
        objectId: current.id,
        metadata: { sendCount: current.sendCount },
      });
      return current;
    });

    await this.deliverInvitation(invitation, rawToken);
    invitation.deliveryStatus = InvitationDeliveryStatus.SENT;
    return this.toResponse(invitation, invitation.role.key);
  }

  async list(
    organizationId: string,
    tenant: SessionAuthorizationContext,
    query: ListInvitationsDto,
  ) {
    this.requireTenant(organizationId, tenant);
    const builder = this.invitations
      .createQueryBuilder('invitation')
      .innerJoin('invitation.role', 'role')
      .select('invitation.id', 'id')
      .addSelect('invitation.email', 'email')
      .addSelect('role.key', 'role')
      .addSelect('invitation.proposed_permissions', 'proposedPermissions')
      .addSelect(
        `CASE WHEN invitation.status = 'pending' AND invitation.expires_at <= CURRENT_TIMESTAMP THEN 'expired' ELSE invitation.status::text END`,
        'status',
      )
      .addSelect('invitation.expires_at', 'expiresAt')
      .addSelect('invitation.last_sent_at', 'lastSentAt')
      .addSelect('invitation.send_count', 'sendCount')
      .addSelect('invitation.delivery_status', 'deliveryStatus')
      .addSelect('invitation.accepted_at', 'acceptedAt')
      .addSelect('invitation.revoked_at', 'revokedAt')
      .addSelect('invitation.created_at', 'createdAt')
      .where('invitation.organization_id = :organizationId', {
        organizationId,
      });
    const total = await builder.clone().getCount();
    const items = await builder
      .orderBy('invitation.created_at', 'DESC')
      .addOrderBy('invitation.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getRawMany();
    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async accept(
    invitationId: string,
    dto: AcceptInvitationDto,
    request: RequestContext,
  ) {
    const tokenHash = this.hashToken(dto.token.trim());
    const emailNormalized = this.normalizeEmail(dto.email);
    const now = new Date();
    let verificationDelivery: {
      email: string;
      firstName: string;
      token: string;
      membershipId: string;
    } | null = null;

    const result = await this.dataSource
      .transaction(async (manager) => {
        const invitation = await manager
          .getRepository(Invitation)
          .createQueryBuilder('invitation')
          .addSelect('invitation.tokenHash')
          .innerJoinAndSelect('invitation.role', 'role')
          .where('invitation.id = :invitationId', { invitationId })
          .setLock('pessimistic_write')
          .getOne();
        if (
          !invitation ||
          invitation.tokenHash !== tokenHash ||
          invitation.emailNormalized !== emailNormalized
        ) {
          return null;
        }
        if (invitation.status !== InvitationStatus.PENDING) {
          throw new ConflictException('Invitation is no longer available');
        }
        if (
          !canAcceptInvitation(invitation.status, invitation.expiresAt, now)
        ) {
          invitation.status = InvitationStatus.EXPIRED;
          await manager.getRepository(Invitation).save(invitation);
          await this.recordPublicAcceptance(
            manager,
            invitation,
            request,
            'invitation.expire',
            InvitationStatus.PENDING,
            InvitationStatus.EXPIRED,
          );
          return null;
        }
        const organization = await manager.getRepository(Organization).findOne({
          where: {
            id: invitation.organizationId,
            status: OrganizationStatus.ACTIVE,
          },
        });
        if (!organization)
          throw new UnauthorizedException('Invalid invitation');

        const users = manager.getRepository(User);
        let user = await users.findOne({ where: { email: emailNormalized } });
        if (!user) {
          if (!dto.firstName || !dto.lastName || !dto.password) {
            throw new UnprocessableEntityException(
              'Profile and password are required for a new user',
            );
          }
          user = await users.save(
            users.create({
              firstName: dto.firstName,
              lastName: dto.lastName,
              email: emailNormalized,
              passwordHash: await this.passwords.hash(dto.password),
              locale: 'es-MX',
              timezone: organization.timezone,
              status: UserStatus.ACTIVE,
            }),
          );
        } else if (user.status !== UserStatus.ACTIVE) {
          throw new UnauthorizedException('Invalid invitation');
        }

        const memberships = manager.getRepository(Membership);
        const existing = await memberships.findOne({
          where: { organizationId: invitation.organizationId, userId: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (existing && existing.status !== MembershipStatus.REVOKED) {
          throw new ConflictException('Membership already exists');
        }
        const activeMfaFactor = user.emailVerifiedAt
          ? await manager.getRepository(AuthFactor).exists({
              where: { userId: user.id, status: AuthFactorStatus.ACTIVE },
            })
          : false;
        const membershipStatus =
          !existing && user.emailVerifiedAt && activeMfaFactor
            ? MembershipStatus.ACTIVE
            : MembershipStatus.PENDING;
        const membership =
          existing ??
          memberships.create({
            organizationId: invitation.organizationId,
            userId: user.id,
          });
        membership.roleId = invitation.roleId;
        membership.status = membershipStatus;
        membership.invitedAt = invitation.createdAt;
        membership.joinedAt =
          membershipStatus === MembershipStatus.ACTIVE ? now : null;
        membership.suspendedAt = null;
        membership.revokedAt = null;
        await memberships.save(membership);
        if (existing) {
          await manager.getRepository(MembershipPermission).update(
            {
              organizationId: invitation.organizationId,
              membershipId: membership.id,
              revokedAt: IsNull(),
            },
            {
              revokedAt: now,
              revokedByMembershipId: invitation.invitedByMembershipId,
            },
          );
          await manager.getRepository(AccountAssignment).update(
            {
              organizationId: invitation.organizationId,
              membershipId: membership.id,
              status: AccountAssignmentStatus.ACTIVE,
            },
            {
              status: AccountAssignmentStatus.REVOKED,
              revokedAt: now,
              revokedByMembershipId: invitation.invitedByMembershipId,
            },
          );
        }
        if (!user.emailVerifiedAt) {
          const rawVerificationToken = randomBytes(32).toString('hex');
          const verificationTokens = manager.getRepository(
            EmailVerificationToken,
          );
          await verificationTokens.update(
            {
              userId: user.id,
              membershipId: membership.id,
              usedAt: IsNull(),
            },
            { usedAt: now },
          );
          await verificationTokens.save(
            verificationTokens.create({
              userId: user.id,
              membershipId: membership.id,
              tokenHash: this.hashToken(rawVerificationToken),
              expiresAt: new Date(
                now.getTime() +
                  this.config.get<number>(
                    'auth.emailVerificationTtlMinutes',
                    30,
                  ) *
                    60_000,
              ),
              usedAt: null,
            }),
          );
          verificationDelivery = {
            email: user.email,
            firstName: user.firstName,
            token: rawVerificationToken,
            membershipId: membership.id,
          };
        }
        invitation.userId = user.id;
        invitation.acceptedMembershipId = membership.id;
        invitation.acceptedAt = now;
        invitation.status = InvitationStatus.ACCEPTED;
        await manager.getRepository(Invitation).save(invitation);
        await this.recordPublicAcceptance(
          manager,
          invitation,
          request,
          'invitation.accept',
          InvitationStatus.PENDING,
          InvitationStatus.ACCEPTED,
          user.id,
        );
        return {
          invitationId: invitation.id,
          invitationStatus: invitation.status,
          userId: user.id,
          membershipId: membership.id,
          membershipStatus: membership.status,
          role: invitation.role.key,
          nextStep: user.emailVerifiedAt ? 'ready' : 'verify_email',
        };
      })
      .catch((error: unknown) => {
        if (this.isUniqueViolation(error)) {
          throw new ConflictException('Membership already exists');
        }
        throw error;
      });
    if (!result) throw new UnauthorizedException('Invalid invitation');
    if (verificationDelivery) {
      await this.email.sendVerification(verificationDelivery);
    }
    return result;
  }

  async revokeInvitation(
    invitationId: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ): Promise<void> {
    const organizationId = this.activeOrganizationId(tenant);
    this.requireReauthentication(tenant);
    await this.dataSource.transaction(async (manager) => {
      const invitation = await manager.getRepository(Invitation).findOne({
        where: { id: invitationId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invitation) throw new NotFoundException('Invitation not found');
      if (invitation.status === InvitationStatus.REVOKED) return;
      if (invitation.status !== InvitationStatus.PENDING) {
        throw new ConflictException('Invitation cannot be revoked');
      }
      invitation.status = InvitationStatus.REVOKED;
      invitation.revokedAt = new Date();
      await manager.getRepository(Invitation).save(invitation);
      await this.record(manager, {
        organizationId,
        tenant,
        request,
        action: 'invitation.revoke',
        objectType: 'invitation',
        objectId: invitation.id,
        metadata: {
          previousStatus: InvitationStatus.PENDING,
          status: InvitationStatus.REVOKED,
        },
      });
    });
  }

  async changeMembershipStatus(
    membershipId: string,
    action: MembershipAction,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ): Promise<void> {
    const organizationId = this.activeOrganizationId(tenant);
    this.requireReauthentication(tenant);
    if (tenant.membershipId === membershipId) {
      throw new ForbiddenException('Self mutation is not allowed');
    }
    const target = await this.dataSource.transaction(async (manager) => {
      const membership = await manager.getRepository(Membership).findOne({
        where: { id: membershipId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership) throw new NotFoundException('Membership not found');
      const organization = await manager.getRepository(Organization).findOne({
        where: { id: organizationId },
      });
      if (!organization) throw new NotFoundException('Membership not found');
      if (organization.ownerUserId === membership.userId) {
        throw new ForbiddenException('Organization owner is protected');
      }

      const previousStatus = membership.status;
      const nextStatus = this.nextMembershipStatus(action);
      if (previousStatus === nextStatus && action === 'revoke') return null;
      if (!this.validMembershipAction(previousStatus, action)) {
        throw new UnprocessableEntityException(
          'Membership status is incompatible with the operation',
        );
      }
      const now = new Date();
      membership.status = nextStatus;
      membership.suspendedAt =
        nextStatus === MembershipStatus.SUSPENDED ? now : null;
      membership.revokedAt =
        nextStatus === MembershipStatus.REVOKED ? now : null;
      await manager.getRepository(Membership).save(membership);
      await this.record(manager, {
        organizationId,
        tenant,
        request,
        action: `membership.${action}`,
        objectType: 'membership',
        objectId: membership.id,
        metadata: { previousStatus, status: nextStatus },
      });
      return membership;
    });
    if (target && target.status !== MembershipStatus.ACTIVE) {
      await this.sessions.revokeMembershipSessions(
        organizationId,
        membershipId,
        `membership_${target.status}`,
      );
    }
  }

  private async validateGrantablePermissions(
    role: Role,
    proposed: string[],
    tenant: SessionAuthorizationContext,
    rolePermissions: Repository<RolePermission>,
    permissions: Repository<Permission>,
  ): Promise<void> {
    const defaults = await rolePermissions.find({
      where: { roleId: role.id, enabled: true },
    });
    const actorPermissions = new Set(tenant.permissions);
    if (defaults.some((item) => !actorPermissions.has(item.permission.key))) {
      throw new ForbiddenException('Cannot assign a role above actor access');
    }
    if (proposed.some((key) => !actorPermissions.has(key))) {
      throw new ForbiddenException(
        'Cannot propose permissions above actor access',
      );
    }
    if (proposed.length > 0) {
      const active = await permissions
        .createQueryBuilder('permission')
        .where('permission.key IN (:...proposed)', { proposed })
        .andWhere('permission.status = :status', {
          status: PermissionStatus.ACTIVE,
        })
        .getCount();
      if (active !== proposed.length) {
        throw new BadRequestException('Unknown or unavailable permission');
      }
    }
  }

  private validMembershipAction(
    status: MembershipStatus,
    action: MembershipAction,
  ): boolean {
    if (action === 'suspend') return status === MembershipStatus.ACTIVE;
    if (action === 'reactivate') return status === MembershipStatus.SUSPENDED;
    return status !== MembershipStatus.REVOKED;
  }

  private nextMembershipStatus(action: MembershipAction): MembershipStatus {
    if (action === 'suspend') return MembershipStatus.SUSPENDED;
    if (action === 'reactivate') return MembershipStatus.ACTIVE;
    return MembershipStatus.REVOKED;
  }

  private requireTenant(
    organizationId: string,
    tenant: SessionAuthorizationContext,
  ): void {
    if (tenant.organizationId !== organizationId) {
      throw new NotFoundException('Organization not found');
    }
  }

  private activeOrganizationId(tenant: SessionAuthorizationContext): string {
    if (!tenant.organizationId) {
      throw new NotFoundException('Resource not found');
    }
    return tenant.organizationId;
  }

  private requireReauthentication(tenant: SessionAuthorizationContext): void {
    if (!hasRecentReauthentication(tenant.reauthenticatedAt)) {
      throw new UnauthorizedException('REAUTHENTICATION_REQUIRED');
    }
  }

  private actorMembershipId(tenant: SessionAuthorizationContext): string {
    if (!tenant.membershipId) {
      throw new ForbiddenException('Active membership required');
    }
    return tenant.membershipId;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private toResponse(invitation: Invitation, role: string) {
    return {
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role,
      proposedPermissions: invitation.proposedPermissions,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      lastSentAt: invitation.lastSentAt,
      sendCount: invitation.sendCount,
      deliveryStatus: invitation.deliveryStatus,
      createdAt: invitation.createdAt,
    };
  }

  private async deliverInvitation(
    invitation: Invitation,
    rawToken: string,
  ): Promise<void> {
    try {
      await this.email.sendInvitation({
        email: invitation.email,
        token: rawToken,
        invitationId: invitation.id,
        expiresAt: invitation.expiresAt,
      });
      await this.invitations.update(invitation.id, {
        deliveryStatus: InvitationDeliveryStatus.SENT,
        lastSentAt: new Date(),
      });
    } catch (error) {
      await this.invitations.update(invitation.id, {
        deliveryStatus: InvitationDeliveryStatus.FAILED,
      });
      throw error;
    }
  }

  private record(
    manager: Parameters<AuditService['record']>[0],
    input: {
      organizationId: string;
      tenant: SessionAuthorizationContext;
      request: RequestContext;
      action: string;
      objectType: string;
      objectId: string;
      metadata: Record<string, unknown>;
    },
  ) {
    return this.audit.record(manager, {
      organizationId: input.organizationId,
      actorType: AuditActorType.USER,
      actorUserId: input.tenant.userId,
      actorMembershipId: input.tenant.membershipId,
      action: input.action,
      permissionKey: 'members.manage',
      decision: AuditDecision.ALLOW,
      objectType: input.objectType,
      objectId: input.objectId,
      reason: null,
      correlationId: input.request.correlationId,
      ipAddress: input.request.ipAddress,
      metadata: input.metadata,
    });
  }

  private recordPublicAcceptance(
    manager: Parameters<AuditService['record']>[0],
    invitation: Invitation,
    request: RequestContext,
    action: string,
    previousStatus: InvitationStatus,
    status: InvitationStatus,
    actorUserId: string | null = null,
  ) {
    return this.audit.record(manager, {
      organizationId: invitation.organizationId,
      actorType: actorUserId ? AuditActorType.USER : AuditActorType.SYSTEM,
      actorUserId,
      actorMembershipId: null,
      action,
      permissionKey: null,
      decision: AuditDecision.ALLOW,
      objectType: 'invitation',
      objectId: invitation.id,
      reason: null,
      correlationId: request.correlationId,
      ipAddress: request.ipAddress,
      metadata: { previousStatus, status },
    });
  }
}
