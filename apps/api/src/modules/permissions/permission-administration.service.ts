import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { PermissionStatus } from '../../common/auth/permission-catalog';
import { hasRecentReauthentication } from '../../common/auth/authorization-contract';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../audit/entities/audit-event.entity';
import {
  Membership,
  MembershipStatus,
} from '../memberships/entities/membership.entity';
import { Organization } from '../organizations/entities/organization.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import {
  ChangeMembershipRoleDto,
  SetMembershipPermissionDto,
} from './dtos/permission-administration.dtos';
import {
  MembershipPermission,
  PermissionEffect,
} from './entities/membership-permission.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { ROLE_KEYS, Role } from './entities/role.entity';

@Injectable()
export class PermissionAdministrationService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(RolePermission)
    private readonly rolePermissions: Repository<RolePermission>,
    @InjectRepository(MembershipPermission)
    private readonly membershipPermissions: Repository<MembershipPermission>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async listRoles() {
    const roles = await this.roles.find({
      where: ROLE_KEYS.map((key) => ({ key })),
      order: { key: 'ASC' },
    });
    const defaults = await this.rolePermissions.find({
      where: roles.map((role) => ({ roleId: role.id, enabled: true })),
    });
    return roles.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      scope: role.scope,
      defaultPermissions: defaults
        .filter((item) => item.roleId === role.id)
        .map((item) => item.permission.key)
        .sort(),
    }));
  }

  async listPermissions() {
    const items = await this.permissions.find({ order: { key: 'ASC' } });
    return items.map((permission) => ({
      key: permission.key,
      name: permission.name,
      description: permission.description,
      sensitive: permission.sensitive,
      requiresMfa: permission.requiresMfa,
      requiresReauthentication: permission.requiresReauthentication,
      status: permission.status,
    }));
  }

  async listMemberships(
    organizationId: string,
    tenant: SessionAuthorizationContext,
  ) {
    this.requireOrganization(organizationId, tenant);
    return this.memberships
      .createQueryBuilder('membership')
      .innerJoin('membership.role', 'role')
      .innerJoin('users', 'user', 'user.id = membership.user_id')
      .select('membership.id', 'membershipId')
      .addSelect('membership.user_id', 'userId')
      .addSelect(`concat(user.first_name, ' ', user.last_name)`, 'displayName')
      .addSelect('user.email', 'email')
      .addSelect('role.key', 'role')
      .addSelect('membership.status', 'status')
      .where('membership.organization_id = :organizationId', {
        organizationId,
      })
      .orderBy('user.first_name', 'ASC')
      .addOrderBy('user.last_name', 'ASC')
      .getRawMany();
  }

  async getMembershipPermissions(
    organizationId: string,
    membershipId: string,
    tenant: SessionAuthorizationContext,
  ) {
    this.requireOrganization(organizationId, tenant);
    const membership = await this.requireTarget(organizationId, membershipId);
    const [catalog, defaults, overrides] = await Promise.all([
      this.permissions.find({ order: { key: 'ASC' } }),
      this.rolePermissions.find({
        where: { roleId: membership.roleId, enabled: true },
      }),
      this.membershipPermissions.find({
        where: { organizationId, membershipId, revokedAt: IsNull() },
      }),
    ]);
    const defaultKeys = new Set(defaults.map((item) => item.permission.key));
    const overrideByKey = new Map(
      overrides.map((item) => [item.permission.key, item.effect]),
    );
    const permissions = catalog.map((permission) => {
      const roleDefault = defaultKeys.has(permission.key);
      const override = overrideByKey.get(permission.key) ?? null;
      return {
        key: permission.key,
        name: permission.name,
        status: permission.status,
        sensitive: permission.sensitive,
        roleDefault,
        override,
        effective:
          permission.status === PermissionStatus.ACTIVE &&
          (override === PermissionEffect.DENY
            ? false
            : override === PermissionEffect.GRANT || roleDefault),
      };
    });
    return {
      organizationId,
      membershipId,
      role: membership.role.key,
      permissions,
    };
  }

  async setMembershipPermission(
    organizationId: string,
    membershipId: string,
    dto: SetMembershipPermissionDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    this.requireOrganization(organizationId, tenant);
    await this.requireAdministrativeMutation(
      organizationId,
      membershipId,
      'permissions.manage',
      tenant,
      request,
    );
    const actorMembershipId = this.actorMembershipId(tenant);
    await this.dataSource.transaction(async (manager) => {
      await this.requireTarget(organizationId, membershipId, manager);
      const permission = await manager.getRepository(Permission).findOne({
        where: { key: dto.permission, status: PermissionStatus.ACTIVE },
      });
      if (!permission) throw new NotFoundException('Permission not found');
      const repository = manager.getRepository(MembershipPermission);
      const current = await this.findActiveOverrideForUpdate(
        repository,
        organizationId,
        membershipId,
        permission.id,
      );
      if (current?.effect === dto.effect) return;
      const now = new Date();
      if (current) {
        current.revokedAt = now;
        current.revokedByMembershipId = actorMembershipId;
        await repository.save(current);
      }
      await repository.save(
        repository.create({
          organizationId,
          membershipId,
          permissionId: permission.id,
          effect: dto.effect,
          grantedAt: now,
          grantedByMembershipId: actorMembershipId,
        }),
      );
      await this.audit.record(manager, {
        organizationId,
        actorType: AuditActorType.USER,
        actorUserId: tenant.userId,
        actorMembershipId,
        action: 'membership_permission.set',
        permissionKey: dto.permission,
        decision: AuditDecision.ALLOW,
        objectType: 'membership',
        objectId: membershipId,
        reason: dto.effect,
        correlationId: request.correlationId,
        ipAddress: request.ipAddress,
        metadata: {
          effect: dto.effect,
          previousEffect: current?.effect ?? null,
        },
      });
    });
    return this.getMembershipPermissions(organizationId, membershipId, tenant);
  }

  async revokeMembershipPermission(
    organizationId: string,
    membershipId: string,
    permissionKey: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ): Promise<void> {
    this.requireOrganization(organizationId, tenant);
    await this.requireAdministrativeMutation(
      organizationId,
      membershipId,
      'permissions.manage',
      tenant,
      request,
    );
    const actorMembershipId = this.actorMembershipId(tenant);
    await this.dataSource.transaction(async (manager) => {
      await this.requireTarget(organizationId, membershipId, manager);
      const permission = await manager
        .getRepository(Permission)
        .findOne({ where: { key: permissionKey } });
      if (!permission) throw new NotFoundException('Permission not found');
      const repository = manager.getRepository(MembershipPermission);
      const current = await this.findActiveOverrideForUpdate(
        repository,
        organizationId,
        membershipId,
        permission.id,
      );
      if (!current) throw new NotFoundException('Active override not found');
      current.revokedAt = new Date();
      current.revokedByMembershipId = actorMembershipId;
      await repository.save(current);
      await this.audit.record(manager, {
        organizationId,
        actorType: AuditActorType.USER,
        actorUserId: tenant.userId,
        actorMembershipId,
        action: 'membership_permission.revoke',
        permissionKey,
        decision: AuditDecision.ALLOW,
        objectType: 'membership',
        objectId: membershipId,
        reason: 'return_to_role_default',
        correlationId: request.correlationId,
        ipAddress: request.ipAddress,
        metadata: { previousEffect: current.effect },
      });
    });
  }

  async changeMembershipRole(
    organizationId: string,
    membershipId: string,
    dto: ChangeMembershipRoleDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    this.requireOrganization(organizationId, tenant);
    await this.requireAdministrativeMutation(
      organizationId,
      membershipId,
      'members.manage',
      tenant,
      request,
    );
    const actorMembershipId = this.actorMembershipId(tenant);
    await this.dataSource.transaction(async (manager) => {
      const membership = await this.requireTarget(
        organizationId,
        membershipId,
        manager,
        true,
      );
      const role = await manager
        .getRepository(Role)
        .findOne({ where: { key: dto.role } });
      if (!role) throw new ConflictException('Role is unavailable');
      const previousRole = membership.role.key;
      if (previousRole === role.key) return;
      membership.roleId = role.id;
      await manager.getRepository(Membership).save(membership);
      await this.audit.record(manager, {
        organizationId,
        actorType: AuditActorType.USER,
        actorUserId: tenant.userId,
        actorMembershipId,
        action: 'membership.role.change',
        permissionKey: 'members.manage',
        decision: AuditDecision.ALLOW,
        objectType: 'membership',
        objectId: membershipId,
        reason: 'administrative_change',
        correlationId: request.correlationId,
        ipAddress: request.ipAddress,
        metadata: { previousRole, role: role.key },
      });
    });
    return this.getMembershipPermissions(organizationId, membershipId, tenant);
  }

  private findActiveOverrideForUpdate(
    repository: Repository<MembershipPermission>,
    organizationId: string,
    membershipId: string,
    permissionId: string,
  ) {
    // The permission relation is eager. A repository find would add a LEFT
    // JOIN, which PostgreSQL cannot lock with FOR UPDATE. This query locks only
    // the active membership_permissions row.
    return repository
      .createQueryBuilder('membershipPermission')
      .where('membershipPermission.organizationId = :organizationId', {
        organizationId,
      })
      .andWhere('membershipPermission.membershipId = :membershipId', {
        membershipId,
      })
      .andWhere('membershipPermission.permissionId = :permissionId', {
        permissionId,
      })
      .andWhere('membershipPermission.revokedAt IS NULL')
      .setLock('pessimistic_write')
      .getOne();
  }

  private requireOrganization(
    organizationId: string,
    tenant: SessionAuthorizationContext,
  ) {
    if (!tenant.organizationId || tenant.organizationId !== organizationId) {
      throw new NotFoundException('Organization not found');
    }
  }

  private async requireAdministrativeMutation(
    organizationId: string,
    membershipId: string,
    permissionKey: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ): Promise<void> {
    if (!hasRecentReauthentication(tenant.mfaVerifiedAt)) {
      await this.auditDenial(
        organizationId,
        membershipId,
        permissionKey,
        tenant,
        request,
        AuditDecision.REAUTHENTICATION_REQUIRED,
        'REAUTHENTICATION_REQUIRED',
      );
      throw new UnauthorizedException('REAUTHENTICATION_REQUIRED');
    }
    if (tenant.membershipId === membershipId) {
      await this.auditDenial(
        organizationId,
        membershipId,
        permissionKey,
        tenant,
        request,
        AuditDecision.DENY,
        'SELF_MUTATION_FORBIDDEN',
      );
      throw new ForbiddenException('Self elevation is not allowed');
    }
    await this.preventOwnerMutation(
      organizationId,
      membershipId,
      permissionKey,
      tenant,
      request,
    );
  }

  private actorMembershipId(tenant: SessionAuthorizationContext): string {
    if (!tenant.membershipId)
      throw new ForbiddenException('Active membership required');
    return tenant.membershipId;
  }

  private async preventOwnerMutation(
    organizationId: string,
    membershipId: string,
    permissionKey: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    const [organization, membership] = await Promise.all([
      this.organizations.findOne({ where: { id: organizationId } }),
      this.memberships.findOne({ where: { id: membershipId, organizationId } }),
    ]);
    if (!organization || !membership)
      throw new NotFoundException('Membership not found');
    if (organization.ownerUserId === membership.userId) {
      await this.auditDenial(
        organizationId,
        membershipId,
        permissionKey,
        tenant,
        request,
        AuditDecision.DENY,
        'OWNER_MEMBERSHIP_PROTECTED',
      );
      throw new ForbiddenException(
        'Organization owner permissions are protected',
      );
    }
  }

  private auditDenial(
    organizationId: string,
    membershipId: string,
    permissionKey: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
    decision: AuditDecision,
    reason: string,
  ) {
    return this.audit.recordDirect({
      organizationId,
      actorType: AuditActorType.USER,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      action: 'permission_administration.denied',
      permissionKey,
      decision,
      objectType: 'membership',
      objectId: membershipId,
      reason,
      correlationId: request.correlationId,
      ipAddress: request.ipAddress,
      metadata: {},
    });
  }

  private async requireTarget(
    organizationId: string,
    membershipId: string,
    manager = this.dataSource.manager,
    lock = false,
  ) {
    const query = manager
      .getRepository(Membership)
      .createQueryBuilder('membership')
      .innerJoinAndSelect('membership.role', 'role')
      .where('membership.id = :membershipId', { membershipId })
      .andWhere('membership.organizationId = :organizationId', {
        organizationId,
      })
      .andWhere('membership.status = :status', {
        status: MembershipStatus.ACTIVE,
      });
    if (lock) query.setLock('pessimistic_write');
    const membership = await query.getOne();
    if (!membership) throw new NotFoundException('Membership not found');
    return membership;
  }
}
