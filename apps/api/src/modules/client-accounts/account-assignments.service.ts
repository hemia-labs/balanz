import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
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
import { RoleKey, RoleScope } from '../permissions/entities/role.entity';
import { SessionsService } from '../sessions/sessions.service';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { ClientAccountScopeService } from './client-account-scope.service';
import { constraintName, domainError } from './client-domain.errors';
import { CreateAccountAssignmentDto } from './dtos/assignment.dtos';
import { ListDomainCollectionDto } from './dtos/client-account.dtos';
import { isEligiblePrimaryRole } from './client-domain.rules';
import {
  AccountAssignment,
  AccountAssignmentStatus,
  AssignmentResponsibility,
} from './entities/account-assignment.entity';

@Injectable()
export class AccountAssignmentsService {
  constructor(
    @InjectRepository(AccountAssignment)
    private readonly assignments: Repository<AccountAssignment>,
    @InjectRepository(Membership)
    private readonly memberships: Repository<Membership>,
    private readonly dataSource: DataSource,
    private readonly scope: ClientAccountScopeService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  async list(
    clientAccountId: string,
    query: ListDomainCollectionDto,
    tenant: SessionAuthorizationContext,
  ) {
    const account = await this.scope.requireAccessibleAccount(
      clientAccountId,
      tenant,
    );
    const builder = this.assignmentQuery(account.organizationId, account.id);
    if (query.search) {
      builder.andWhere(
        `(lower(concat(user.first_name, ' ', user.last_name)) LIKE :search ESCAPE '\\' OR lower(user.email) LIKE :search ESCAPE '\\')`,
        { search: `%${this.escapeLike(query.search.toLowerCase())}%` },
      );
    }
    builder
      .orderBy('assignment.assigned_at', 'ASC')
      .addOrderBy('assignment.id', 'ASC');
    const total = await builder.getCount();
    const items = await builder
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getRawMany();
    return this.page(items, query, total);
  }

  async availableMembers(
    clientAccountId: string,
    query: ListDomainCollectionDto,
    tenant: SessionAuthorizationContext,
  ) {
    const account = await this.scope.requireAccessibleAccount(
      clientAccountId,
      tenant,
    );
    const builder = this.memberships
      .createQueryBuilder('membership')
      .innerJoin('users', 'user', 'user.id = membership.user_id')
      .innerJoin(
        'roles',
        'role',
        'role.id = membership.role_id AND role.scope = :scope',
        { scope: RoleScope.ORGANIZATION },
      )
      .leftJoin(
        AccountAssignment,
        'assignment',
        'assignment.organization_id = membership.organization_id AND assignment.membership_id = membership.id AND assignment.client_account_id = :clientAccountId AND assignment.status = :assignmentStatus',
        { clientAccountId, assignmentStatus: AccountAssignmentStatus.ACTIVE },
      )
      .select('membership.id', 'membershipId')
      .addSelect(`concat(user.first_name, ' ', user.last_name)`, 'displayName')
      .addSelect('user.email', 'email')
      .addSelect('role.key', 'role')
      .addSelect('membership.status', 'membershipStatus')
      .addSelect('assignment.id', 'assignmentId')
      .addSelect('assignment.responsibility', 'responsibility')
      .where('membership.organization_id = :organizationId', {
        organizationId: account.organizationId,
      })
      .andWhere('membership.status = :membershipStatus', {
        membershipStatus: MembershipStatus.ACTIVE,
      });
    if (query.search) {
      builder.andWhere(
        `(lower(concat(user.first_name, ' ', user.last_name)) LIKE :search ESCAPE '\\' OR lower(user.email) LIKE :search ESCAPE '\\')`,
        { search: `%${this.escapeLike(query.search.toLowerCase())}%` },
      );
    }
    builder
      .orderBy('user.first_name', 'ASC')
      .addOrderBy('user.last_name', 'ASC')
      .addOrderBy('membership.id', 'ASC');
    const total = await builder.getCount();
    const items = await builder
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getRawMany();
    return this.page(items, query, total);
  }

  async availablePrimaryMembers(
    query: ListDomainCollectionDto,
    tenant: SessionAuthorizationContext,
  ) {
    if (!tenant.organizationId) {
      throw domainError(
        HttpStatus.FORBIDDEN,
        'ACTIVE_TENANT_REQUIRED',
        'Active tenant required',
      );
    }
    const builder = this.memberships
      .createQueryBuilder('membership')
      .innerJoin('users', 'user', 'user.id = membership.user_id')
      .innerJoin('roles', 'role', 'role.id = membership.role_id')
      .select('membership.id', 'membershipId')
      .addSelect(`concat(user.first_name, ' ', user.last_name)`, 'displayName')
      .addSelect('user.email', 'email')
      .addSelect('role.key', 'role')
      .where('membership.organization_id = :organizationId', {
        organizationId: tenant.organizationId,
      })
      .andWhere('membership.status = :status', {
        status: MembershipStatus.ACTIVE,
      })
      .andWhere('role.scope = :scope', { scope: RoleScope.ORGANIZATION })
      .andWhere('role.key IN (:...roles)', {
        roles: [RoleKey.ADMIN, RoleKey.ACCOUNTANT],
      });
    if (query.search) {
      builder.andWhere(
        `(lower(concat(user.first_name, ' ', user.last_name)) LIKE :search ESCAPE '\\' OR lower(user.email) LIKE :search ESCAPE '\\')`,
        { search: `%${this.escapeLike(query.search.toLowerCase())}%` },
      );
    }
    builder
      .orderBy('user.first_name', 'ASC')
      .addOrderBy('user.last_name', 'ASC')
      .addOrderBy('membership.id', 'ASC');
    const total = await builder.getCount();
    const items = await builder
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getRawMany();
    return this.page(items, query, total);
  }

  async create(
    clientAccountId: string,
    dto: CreateAccountAssignmentDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    const account = await this.scope.requireAccessibleAccount(
      clientAccountId,
      tenant,
    );
    const actorMembershipId = this.membershipId(tenant);
    const invalidations = new Set<string>([dto.membershipId]);
    try {
      const created = await this.dataSource.transaction(async (manager) => {
        await this.scope.requireAccessibleAccountWithManager(
          manager,
          account.id,
          tenant,
          false,
          true,
        );
        const membership = await manager.getRepository(Membership).findOne({
          where: {
            id: dto.membershipId,
            organizationId: account.organizationId,
            status: MembershipStatus.ACTIVE,
          },
          relations: { role: true },
        });
        if (
          !membership ||
          (dto.responsibility === AssignmentResponsibility.PRIMARY &&
            !isEligiblePrimaryRole(membership.role.key))
        ) {
          throw domainError(
            HttpStatus.CONFLICT,
            'MEMBERSHIP_NOT_ELIGIBLE',
            'Membership is not eligible for this assignment',
          );
        }
        const repository = manager.getRepository(AccountAssignment);
        const currentForMember = await repository.findOne({
          where: {
            organizationId: account.organizationId,
            clientAccountId: account.id,
            membershipId: membership.id,
            status: AccountAssignmentStatus.ACTIVE,
          },
          lock: { mode: 'pessimistic_write' },
        });
        let previousPrimary: AccountAssignment | null = null;
        if (dto.responsibility === AssignmentResponsibility.PRIMARY) {
          previousPrimary = await repository.findOne({
            where: {
              organizationId: account.organizationId,
              clientAccountId: account.id,
              responsibility: AssignmentResponsibility.PRIMARY,
              status: AccountAssignmentStatus.ACTIVE,
            },
            lock: { mode: 'pessimistic_write' },
          });
          if (previousPrimary?.membershipId === membership.id) {
            throw domainError(
              HttpStatus.CONFLICT,
              'ACCOUNT_ASSIGNMENT_CONFLICT',
              'Membership already has this active assignment',
            );
          }
          if (currentForMember) {
            await this.revokeWithManager(
              repository,
              currentForMember,
              actorMembershipId,
            );
            await this.record(
              manager,
              tenant,
              request,
              'ACCOUNT_ASSIGNMENT_REVOKED',
              currentForMember,
              { responsibility: currentForMember.responsibility },
            );
          }
          if (previousPrimary) {
            invalidations.add(previousPrimary.membershipId);
            await this.revokeWithManager(
              repository,
              previousPrimary,
              actorMembershipId,
            );
            await this.record(
              manager,
              tenant,
              request,
              'ACCOUNT_ASSIGNMENT_REVOKED',
              previousPrimary,
              { responsibility: previousPrimary.responsibility },
            );
          }
        } else if (currentForMember) {
          throw domainError(
            HttpStatus.CONFLICT,
            'ACCOUNT_ASSIGNMENT_CONFLICT',
            'Membership already has an active assignment',
          );
        }

        const assignment = await repository.save(
          repository.create({
            id: randomUUID(),
            organizationId: account.organizationId,
            clientAccountId: account.id,
            membershipId: membership.id,
            responsibility: dto.responsibility,
            status: AccountAssignmentStatus.ACTIVE,
            assignedByMembershipId: actorMembershipId,
            assignedAt: new Date(),
            revokedByMembershipId: null,
            revokedAt: null,
          }),
        );
        await this.record(
          manager,
          tenant,
          request,
          'ACCOUNT_ASSIGNMENT_CREATED',
          assignment,
          {
            responsibility: assignment.responsibility,
          },
        );
        if (dto.responsibility === AssignmentResponsibility.PRIMARY) {
          await this.record(
            manager,
            tenant,
            request,
            'PRIMARY_ASSIGNMENT_CHANGED',
            assignment,
            {
              previousMembershipId: previousPrimary?.membershipId ?? null,
              membershipId: assignment.membershipId,
            },
          );
        }
        return assignment;
      });
      await Promise.all(
        [...invalidations].map((membershipId) =>
          this.sessions.invalidateMembershipAuthorization(
            account.organizationId,
            membershipId,
          ),
        ),
      );
      return {
        id: created.id,
        membershipId: created.membershipId,
        responsibility: created.responsibility,
        status: created.status,
        assignedAt: created.assignedAt,
      };
    } catch (error) {
      this.translateConstraint(error);
    }
  }

  async revoke(
    clientAccountId: string,
    assignmentId: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ): Promise<void> {
    const account = await this.scope.requireAccessibleAccount(
      clientAccountId,
      tenant,
    );
    const actorMembershipId = this.membershipId(tenant);
    const membershipId = await this.dataSource.transaction(async (manager) => {
      await this.scope.requireAccessibleAccountWithManager(
        manager,
        account.id,
        tenant,
        false,
        true,
      );
      const repository = manager.getRepository(AccountAssignment);
      const assignment = await repository.findOne({
        where: {
          id: assignmentId,
          organizationId: account.organizationId,
          clientAccountId: account.id,
          status: AccountAssignmentStatus.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!assignment) {
        throw domainError(
          HttpStatus.NOT_FOUND,
          'ACCOUNT_ASSIGNMENT_NOT_FOUND',
          'Account assignment not found',
        );
      }
      if (assignment.responsibility === AssignmentResponsibility.PRIMARY) {
        throw domainError(
          HttpStatus.CONFLICT,
          'LAST_PRIMARY_ASSIGNMENT',
          'Replace the primary assignment atomically before removing it',
        );
      }
      await this.revokeWithManager(repository, assignment, actorMembershipId);
      await this.record(
        manager,
        tenant,
        request,
        'ACCOUNT_ASSIGNMENT_REVOKED',
        assignment,
        {
          responsibility: assignment.responsibility,
        },
      );
      return assignment.membershipId;
    });
    await this.sessions.invalidateMembershipAuthorization(
      account.organizationId,
      membershipId,
    );
  }

  private assignmentQuery(organizationId: string, clientAccountId: string) {
    return this.assignments
      .createQueryBuilder('assignment')
      .innerJoin(
        'memberships',
        'membership',
        'membership.id = assignment.membership_id AND membership.organization_id = assignment.organization_id',
      )
      .innerJoin('users', 'user', 'user.id = membership.user_id')
      .innerJoin('roles', 'role', 'role.id = membership.role_id')
      .select('assignment.id', 'id')
      .addSelect('assignment.membership_id', 'membershipId')
      .addSelect('assignment.responsibility', 'responsibility')
      .addSelect('assignment.status', 'status')
      .addSelect('assignment.assigned_at', 'assignedAt')
      .addSelect(`concat(user.first_name, ' ', user.last_name)`, 'displayName')
      .addSelect('user.email', 'email')
      .addSelect('role.key', 'role')
      .where('assignment.organization_id = :organizationId', { organizationId })
      .andWhere('assignment.client_account_id = :clientAccountId', {
        clientAccountId,
      })
      .andWhere('assignment.status = :status', {
        status: AccountAssignmentStatus.ACTIVE,
      });
  }

  private page<T>(
    items: T[],
    query: Pick<ListDomainCollectionDto, 'page' | 'limit'>,
    total: number,
  ) {
    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }

  private async revokeWithManager(
    repository: Repository<AccountAssignment>,
    assignment: AccountAssignment,
    actorMembershipId: string,
  ): Promise<void> {
    assignment.status = AccountAssignmentStatus.REVOKED;
    assignment.revokedAt = new Date();
    assignment.revokedByMembershipId = actorMembershipId;
    await repository.save(assignment);
  }

  private record(
    manager: Parameters<AuditService['record']>[0],
    tenant: SessionAuthorizationContext,
    request: RequestContext,
    action: string,
    assignment: AccountAssignment,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(manager, {
      organizationId: assignment.organizationId,
      actorType: AuditActorType.USER,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      servicePrincipal: null,
      supportGrantId: null,
      clientAccountId: assignment.clientAccountId,
      legalEntityId: null,
      action,
      permissionKey: 'clients.assign',
      decision: AuditDecision.ALLOW,
      objectType: 'account_assignment',
      objectId: assignment.id,
      reason: null,
      correlationId: request.correlationId,
      ipAddress: request.ipAddress,
      metadata,
    });
  }

  private membershipId(tenant: SessionAuthorizationContext): string {
    if (!tenant.membershipId)
      throw domainError(
        HttpStatus.FORBIDDEN,
        'ACTIVE_TENANT_REQUIRED',
        'Active tenant required',
      );
    return tenant.membershipId;
  }

  private translateConstraint(error: unknown): never {
    const constraint = constraintName(error);
    if (constraint === 'uq_account_assignments_active_primary') {
      throw domainError(
        HttpStatus.CONFLICT,
        'PRIMARY_ASSIGNMENT_CONFLICT',
        'A primary assignment already exists',
      );
    }
    if (constraint === 'uq_account_assignments_active_member') {
      throw domainError(
        HttpStatus.CONFLICT,
        'ACCOUNT_ASSIGNMENT_CONFLICT',
        'Membership already has an active assignment',
      );
    }
    throw error;
  }
}
