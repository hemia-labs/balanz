import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import {
  AuditActorType,
  AuditDecision,
} from '../audit/entities/audit-event.entity';
import { AuditService } from '../audit/audit.service';
import {
  Membership,
  MembershipStatus,
} from '../memberships/entities/membership.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { SessionsService } from '../sessions/sessions.service';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import {
  ClientAccountDetailDto,
  CreateClientAccountDto,
  ListClientAccountsDto,
  UpdateClientAccountDto,
} from './dtos/client-account.dtos';
import {
  AccountAssignment,
  AccountAssignmentStatus,
  AssignmentResponsibility,
} from './entities/account-assignment.entity';
import {
  ClientAccount,
  ClientAccountStatus,
} from './entities/client-account.entity';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { LegalEntity, LegalEntityStatus } from './entities/legal-entity.entity';
import { Period, PeriodStatus } from './entities/period.entity';
import { ClientAccountScopeService } from './client-account-scope.service';
import { constraintName, domainError } from './client-domain.errors';
import {
  clientSortColumn,
  isEligiblePrimaryRole,
  validateFiscalYear,
} from './client-domain.rules';

export interface PrimaryAssignmentSummary {
  clientAccountId: string;
  displayName: string;
}

@Injectable()
export class ClientAccountsService {
  constructor(
    @InjectRepository(ClientAccount)
    private readonly accounts: Repository<ClientAccount>,
    @InjectRepository(LegalEntity)
    private readonly legalEntities: Repository<LegalEntity>,
    @InjectRepository(AccountAssignment)
    private readonly assignments: Repository<AccountAssignment>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYears: Repository<FiscalYear>,
    @InjectRepository(Period)
    private readonly periods: Repository<Period>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly scope: ClientAccountScopeService,
    private readonly sessions: SessionsService,
  ) {}

  async list(
    query: ListClientAccountsDto,
    tenant: SessionAuthorizationContext,
  ) {
    const organizationId = this.organizationId(tenant);
    if (query.includeArchived && !this.scope.canIncludeArchived(tenant)) {
      throw domainError(
        HttpStatus.FORBIDDEN,
        'ARCHIVED_ACCESS_FORBIDDEN',
        'Archived accounts are not available',
      );
    }

    const builder = this.accounts
      .createQueryBuilder('account')
      .where('account.organization_id = :organizationId', { organizationId });
    if (tenant.accountAccessMode === 'assigned') {
      builder.innerJoin(
        AccountAssignment,
        'scope_assignment',
        'scope_assignment.organization_id = account.organization_id AND scope_assignment.client_account_id = account.id AND scope_assignment.membership_id = :membershipId AND scope_assignment.status = :assignmentStatus',
        {
          membershipId: tenant.membershipId,
          assignmentStatus: AccountAssignmentStatus.ACTIVE,
        },
      );
    }
    if (!query.includeArchived) {
      builder.andWhere('account.status <> :archived', {
        archived: ClientAccountStatus.ARCHIVED,
      });
    }
    if (query.status)
      builder.andWhere('account.status = :status', { status: query.status });
    if (query.search) {
      builder.andWhere(
        `(lower(account.name) LIKE :search ESCAPE '\\' OR lower(account.code) LIKE :search ESCAPE '\\')`,
        { search: `%${this.escapeLike(query.search.toLowerCase())}%` },
      );
    }
    const sortColumn = clientSortColumn(query.sort);
    const direction = query.direction.toUpperCase() as 'ASC' | 'DESC';
    builder
      .orderBy(sortColumn, direction)
      .addOrderBy('account.id', direction)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [accounts, total] = await builder.getManyAndCount();
    const projections = await this.loadAccountProjections(
      organizationId,
      accounts,
    );
    return {
      items: accounts.map((account) => ({
        account: this.accountResponse(account),
        ...projections.get(account.id),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  async create(
    dto: CreateClientAccountDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    const organizationId = this.organizationId(tenant);
    const actorMembershipId = this.membershipId(tenant);
    validateFiscalYear(dto.fiscalYear);
    const ids = {
      clientAccountId: randomUUID(),
      legalEntityId: randomUUID(),
      assignmentId: randomUUID(),
      fiscalYearId: randomUUID(),
    };
    try {
      await this.dataSource.transaction(async (manager) => {
        const membership = await manager.getRepository(Membership).findOne({
          where: {
            id: dto.primaryMembershipId,
            organizationId,
            status: MembershipStatus.ACTIVE,
          },
          relations: { role: true },
        });
        if (!membership || !isEligiblePrimaryRole(membership.role.key)) {
          throw domainError(
            HttpStatus.CONFLICT,
            'MEMBERSHIP_NOT_ELIGIBLE',
            'Membership is not eligible as primary',
          );
        }
        const now = new Date();
        await manager.getRepository(ClientAccount).save(
          manager.getRepository(ClientAccount).create({
            id: ids.clientAccountId,
            organizationId,
            name: dto.accountName,
            code: null,
            status: ClientAccountStatus.ACTIVE,
            version: 1,
            archivedAt: null,
          }),
        );
        await manager.getRepository(LegalEntity).save(
          manager.getRepository(LegalEntity).create({
            id: ids.legalEntityId,
            organizationId,
            clientAccountId: ids.clientAccountId,
            rfc: dto.legalEntity.rfc,
            legalName: dto.legalEntity.legalName,
            status: LegalEntityStatus.ACTIVE,
            version: 1,
            archivedAt: null,
          }),
        );
        await manager.getRepository(AccountAssignment).save(
          manager.getRepository(AccountAssignment).create({
            id: ids.assignmentId,
            organizationId,
            clientAccountId: ids.clientAccountId,
            membershipId: dto.primaryMembershipId,
            responsibility: AssignmentResponsibility.PRIMARY,
            status: AccountAssignmentStatus.ACTIVE,
            assignedByMembershipId: actorMembershipId,
            assignedAt: now,
            revokedByMembershipId: null,
            revokedAt: null,
          }),
        );
        await manager.getRepository(FiscalYear).save(
          manager.getRepository(FiscalYear).create({
            id: ids.fiscalYearId,
            organizationId,
            clientAccountId: ids.clientAccountId,
            legalEntityId: ids.legalEntityId,
            year: dto.fiscalYear,
            status: FiscalYearStatus.ACTIVE,
            version: 1,
            archivedAt: null,
          }),
        );
        await manager.getRepository(Period).insert(
          Array.from({ length: 12 }, (_, index) => ({
            id: randomUUID(),
            organizationId,
            clientAccountId: ids.clientAccountId,
            legalEntityId: ids.legalEntityId,
            fiscalYearId: ids.fiscalYearId,
            month: index + 1,
            status: PeriodStatus.NOT_STARTED,
            cutoffAt: null,
            lockVersion: 0,
          })),
        );
        await this.record(
          manager,
          tenant,
          request,
          'CLIENT_ACCOUNT_CREATED',
          'clients.manage',
          'client_account',
          ids.clientAccountId,
          ids.clientAccountId,
          null,
          { version: 1 },
        );
        await this.record(
          manager,
          tenant,
          request,
          'LEGAL_ENTITY_CREATED',
          'fiscal_entities.manage',
          'legal_entity',
          ids.legalEntityId,
          ids.clientAccountId,
          ids.legalEntityId,
          { version: 1 },
        );
        await this.record(
          manager,
          tenant,
          request,
          'ACCOUNT_ASSIGNMENT_CREATED',
          'clients.assign',
          'account_assignment',
          ids.assignmentId,
          ids.clientAccountId,
          ids.legalEntityId,
          { responsibility: AssignmentResponsibility.PRIMARY },
        );
        await this.record(
          manager,
          tenant,
          request,
          'FISCAL_YEAR_CREATED',
          'fiscal_years.manage',
          'fiscal_year',
          ids.fiscalYearId,
          ids.clientAccountId,
          ids.legalEntityId,
          { year: dto.fiscalYear },
        );
      });
    } catch (error) {
      this.translateConstraint(error);
    }
    await this.sessions.invalidateMembershipAuthorization(
      organizationId,
      dto.primaryMembershipId,
    );
    return ids;
  }

  async detail(
    clientAccountId: string,
    query: ClientAccountDetailDto,
    tenant: SessionAuthorizationContext,
  ) {
    if (query.includeArchived && !this.scope.canIncludeArchived(tenant)) {
      throw domainError(
        HttpStatus.FORBIDDEN,
        'ARCHIVED_ACCESS_FORBIDDEN',
        'Archived resources are not available',
      );
    }
    const account = await this.scope.requireAccessibleAccount(
      clientAccountId,
      tenant,
      query.includeArchived,
    );
    const organizationId = this.organizationId(tenant);
    const legalBuilder = this.legalEntities
      .createQueryBuilder('entity')
      .where(
        'entity.organization_id = :organizationId AND entity.client_account_id = :clientAccountId',
        { organizationId, clientAccountId },
      );
    if (!query.includeArchived)
      legalBuilder.andWhere('entity.status <> :archived', {
        archived: LegalEntityStatus.ARCHIVED,
      });
    if (query.legalEntityId) {
      legalBuilder.andWhere('entity.id = :legalEntityId', {
        legalEntityId: query.legalEntityId,
      });
    } else if (query.legalEntitySearch) {
      legalBuilder.andWhere(
        `(lower(entity.legal_name) LIKE :search ESCAPE '\\' OR lower(entity.rfc) LIKE :search ESCAPE '\\')`,
        {
          search: `%${this.escapeLike(query.legalEntitySearch.toLowerCase())}%`,
        },
      );
    }
    const legalEntityPage = query.legalEntityId ? 1 : query.legalEntityPage;
    const legalEntityLimit = query.legalEntityId ? 1 : query.legalEntityLimit;
    const primaryAssignmentsPromise = this.primaryAssignmentProjections(
      organizationId,
      [clientAccountId],
    );
    const [legalEntities, legalEntityTotal] = await legalBuilder
      .orderBy('entity.created_at', 'ASC')
      .addOrderBy('entity.id', 'ASC')
      .skip((legalEntityPage - 1) * legalEntityLimit)
      .take(legalEntityLimit)
      .getManyAndCount();
    if (query.legalEntityId && legalEntities.length === 0) {
      throw domainError(
        HttpStatus.NOT_FOUND,
        'LEGAL_ENTITY_NOT_FOUND',
        'Legal entity not found',
      );
    }
    let fiscalYearCountsPromise: Promise<
      Array<{ legalEntityId: string; count: string }>
    >;
    if (legalEntities.length === 0) {
      fiscalYearCountsPromise = Promise.resolve([]);
    } else {
      const builder = this.fiscalYears
        .createQueryBuilder('year')
        .select('year.legal_entity_id', 'legalEntityId')
        .addSelect('COUNT(year.id)', 'count')
        .where(
          'year.organization_id = :organizationId AND year.client_account_id = :clientAccountId',
          { organizationId, clientAccountId },
        )
        .andWhere('year.legal_entity_id IN (:...legalEntityIds)', {
          legalEntityIds: legalEntities.map((entity) => entity.id),
        })
        .groupBy('year.legal_entity_id');
      if (!query.includeArchived)
        builder.andWhere('year.status <> :archivedYearStatus', {
          archivedYearStatus: FiscalYearStatus.ARCHIVED,
        });
      fiscalYearCountsPromise = builder.getRawMany();
    }
    const [primaryAssignments, fiscalYearCounts] = await Promise.all([
      primaryAssignmentsPromise,
      fiscalYearCountsPromise,
    ]);
    const fiscalYearCountByEntity = new Map(
      fiscalYearCounts.map((item) => [item.legalEntityId, Number(item.count)]),
    );
    return {
      account: this.accountResponse(account),
      legalEntities: {
        items: legalEntities.map((entity) => ({
          ...this.legalEntityResponse(entity),
          fiscalYearCount: fiscalYearCountByEntity.get(entity.id) ?? 0,
        })),
        meta: {
          page: legalEntityPage,
          limit: legalEntityLimit,
          total: legalEntityTotal,
          totalPages:
            legalEntityTotal === 0
              ? 0
              : Math.ceil(legalEntityTotal / legalEntityLimit),
        },
      },
      primaryAssignment: this.primaryAssignmentResponse(
        primaryAssignments.find(
          (item) => item.clientAccountId === clientAccountId,
        ),
      ),
    };
  }

  async update(
    clientAccountId: string,
    dto: UpdateClientAccountDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    await this.scope.requireAccessibleAccount(clientAccountId, tenant);
    const organizationId = this.organizationId(tenant);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.scope.requireAccessibleAccountWithManager(
          manager,
          clientAccountId,
          tenant,
        );
        const values: Record<string, unknown> = {
          version: () => 'version + 1',
          updatedAt: () => 'now()',
        };
        if (dto.name !== undefined) values.name = dto.name;
        if (dto.code !== undefined)
          values.code = dto.code === '' ? null : dto.code;
        const result = await manager
          .createQueryBuilder()
          .update(ClientAccount)
          .set(values)
          .where(
            'id = :id AND organization_id = :organizationId AND version = :version AND status <> :archived',
            {
              id: clientAccountId,
              organizationId,
              version: dto.expectedVersion,
              archived: ClientAccountStatus.ARCHIVED,
            },
          )
          .execute();
        if ((result.affected ?? 0) !== 1) {
          throw domainError(
            HttpStatus.CONFLICT,
            'STALE_CLIENT_ACCOUNT',
            'Client account changed; reload and try again',
          );
        }
        await this.record(
          manager,
          tenant,
          request,
          'CLIENT_ACCOUNT_UPDATED',
          'clients.manage',
          'client_account',
          clientAccountId,
          clientAccountId,
          null,
          { expectedVersion: dto.expectedVersion },
        );
        const updated = await manager
          .getRepository(ClientAccount)
          .findOneByOrFail({ id: clientAccountId, organizationId });
        return this.accountResponse(updated);
      });
    } catch (error) {
      this.translateConstraint(error);
    }
  }

  async archive(
    clientAccountId: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ): Promise<void> {
    await this.scope.requireAccessibleAccount(clientAccountId, tenant);
    const organizationId = this.organizationId(tenant);
    const affectedMembershipIds = await this.dataSource.transaction(
      async (manager) => {
        const account = await this.scope.requireAccessibleAccountWithManager(
          manager,
          clientAccountId,
          tenant,
          false,
          true,
        );
        account.status = ClientAccountStatus.ARCHIVED;
        account.archivedAt = new Date();
        account.version += 1;
        await manager.getRepository(ClientAccount).save(account);
        await this.record(
          manager,
          tenant,
          request,
          'CLIENT_ACCOUNT_ARCHIVED',
          'clients.manage',
          'client_account',
          account.id,
          account.id,
          null,
          { version: account.version },
        );
        const assignments = await manager
          .getRepository(AccountAssignment)
          .find({
            select: { membershipId: true },
            where: {
              organizationId: account.organizationId,
              clientAccountId: account.id,
              status: AccountAssignmentStatus.ACTIVE,
            },
          });
        return [...new Set(assignments.map((item) => item.membershipId))];
      },
    );
    await Promise.all(
      affectedMembershipIds.map((membershipId) =>
        this.sessions.invalidateMembershipAuthorization(
          organizationId,
          membershipId,
        ),
      ),
    );
  }

  private async loadAccountProjections(
    organizationId: string,
    accounts: ClientAccount[],
  ) {
    const result = new Map<string, Record<string, unknown>>();
    if (accounts.length === 0) return result;
    const ids = accounts.map((account) => account.id);
    const entities = await this.legalEntities.find({
      where: {
        organizationId,
        clientAccountId: In(ids),
        status: LegalEntityStatus.ACTIVE,
      },
      order: { createdAt: 'ASC' },
    });
    const primaryEntities = new Map<string, LegalEntity>();
    for (const entity of entities) {
      if (!primaryEntities.has(entity.clientAccountId)) {
        primaryEntities.set(entity.clientAccountId, entity);
      }
    }
    const legalEntityIds = [...primaryEntities.values()].map(
      (entity) => entity.id,
    );
    const primaryAssignmentsPromise = this.primaryAssignmentProjections(
      organizationId,
      ids,
    );
    const yearsPromise =
      legalEntityIds.length === 0
        ? Promise.resolve([])
        : this.fiscalYears
            .createQueryBuilder('year')
            .innerJoin(
              LegalEntity,
              'year_entity',
              'year_entity.organization_id = year.organization_id AND year_entity.client_account_id = year.client_account_id AND year_entity.id = year.legal_entity_id',
            )
            .where('year.organization_id = :organizationId', {
              organizationId,
            })
            .andWhere('year.client_account_id IN (:...ids)', { ids })
            .andWhere('year.legal_entity_id IN (:...legalEntityIds)', {
              legalEntityIds,
            })
            .andWhere('year.status = :activeYearStatus', {
              activeYearStatus: FiscalYearStatus.ACTIVE,
            })
            .andWhere('year_entity.status = :activeEntityStatus', {
              activeEntityStatus: LegalEntityStatus.ACTIVE,
            })
            .orderBy('year.year', 'DESC')
            .getMany();
    const periodRowsPromise =
      legalEntityIds.length === 0
        ? Promise.resolve([])
        : this.periods
            .createQueryBuilder('period')
            .innerJoin(
              FiscalYear,
              'year',
              'year.id = period.fiscal_year_id AND year.organization_id = period.organization_id AND year.client_account_id = period.client_account_id AND year.legal_entity_id = period.legal_entity_id',
            )
            .innerJoin(
              LegalEntity,
              'period_entity',
              'period_entity.organization_id = period.organization_id AND period_entity.client_account_id = period.client_account_id AND period_entity.id = period.legal_entity_id',
            )
            .select('period.client_account_id', 'clientAccountId')
            .addSelect('period.status', 'status')
            .addSelect('year.year', 'year')
            .where('period.organization_id = :organizationId', {
              organizationId,
            })
            .andWhere('period.client_account_id IN (:...ids)', { ids })
            .andWhere('period.legal_entity_id IN (:...legalEntityIds)', {
              legalEntityIds,
            })
            .andWhere('year.status = :activeYearStatus', {
              activeYearStatus: FiscalYearStatus.ACTIVE,
            })
            .andWhere('period_entity.status = :activeEntityStatus', {
              activeEntityStatus: LegalEntityStatus.ACTIVE,
            })
            .andWhere('period.month = :month', {
              month: new Date().getMonth() + 1,
            })
            .orderBy('year.year', 'DESC')
            .getRawMany<{
              clientAccountId: string;
              status: PeriodStatus;
              year: number;
            }>();
    const [primaryAssignments, years, periodRows] = await Promise.all([
      primaryAssignmentsPromise,
      yearsPromise,
      periodRowsPromise,
    ]);
    for (const account of accounts) {
      const primaryEntity = primaryEntities.get(account.id) ?? null;
      const primaryAssignment =
        primaryAssignments.find(
          (assignment) => assignment.clientAccountId === account.id,
        ) ?? null;
      const latestYear =
        years.find((year) => year.clientAccountId === account.id) ?? null;
      const currentPeriod =
        periodRows.find((period) => period.clientAccountId === account.id) ??
        null;
      result.set(account.id, {
        primaryLegalEntity: primaryEntity
          ? this.legalEntityResponse(primaryEntity)
          : null,
        primaryAssignment: this.primaryAssignmentResponse(primaryAssignment),
        latestFiscalYear: latestYear
          ? this.fiscalYearResponse(latestYear)
          : null,
        currentPeriod: currentPeriod
          ? {
              year: Number(currentPeriod.year),
              month: new Date().getMonth() + 1,
              status: currentPeriod.status,
            }
          : null,
      });
    }
    return result;
  }

  private async primaryAssignmentProjections(
    organizationId: string,
    accountIds: string[],
  ) {
    if (accountIds.length === 0) return [];
    return this.assignments
      .createQueryBuilder('assignment')
      .innerJoin(
        'memberships',
        'membership',
        'membership.id = assignment.membership_id AND membership.organization_id = assignment.organization_id',
      )
      .innerJoin('users', 'user', 'user.id = membership.user_id')
      .select('assignment.client_account_id', 'clientAccountId')
      .addSelect(`concat(user.first_name, ' ', user.last_name)`, 'displayName')
      .where('assignment.organization_id = :organizationId', { organizationId })
      .andWhere('assignment.client_account_id IN (:...accountIds)', {
        accountIds,
      })
      .andWhere('assignment.status = :status', {
        status: AccountAssignmentStatus.ACTIVE,
      })
      .andWhere('assignment.responsibility = :responsibility', {
        responsibility: AssignmentResponsibility.PRIMARY,
      })
      .orderBy('assignment.assigned_at', 'ASC')
      .getRawMany<PrimaryAssignmentSummary>();
  }

  private primaryAssignmentResponse(
    assignment?: PrimaryAssignmentSummary | null,
  ) {
    return assignment ? { displayName: assignment.displayName } : null;
  }

  private accountResponse(account: ClientAccount) {
    return {
      id: account.id,
      name: account.name,
      code: account.code ?? null,
      status: account.status,
      version: account.version,
      archivedAt: account.archivedAt ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private legalEntityResponse(entity: LegalEntity) {
    return {
      id: entity.id,
      clientAccountId: entity.clientAccountId,
      rfc: entity.rfc,
      legalName: entity.legalName,
      status: entity.status,
      version: entity.version,
      archivedAt: entity.archivedAt ?? null,
    };
  }

  private fiscalYearResponse(year: FiscalYear) {
    return {
      id: year.id,
      clientAccountId: year.clientAccountId,
      legalEntityId: year.legalEntityId,
      year: year.year,
      status: year.status,
      version: year.version,
    };
  }

  private record(
    manager: Parameters<AuditService['record']>[0],
    tenant: SessionAuthorizationContext,
    request: RequestContext,
    action: string,
    permissionKey: string,
    objectType: string,
    objectId: string,
    clientAccountId: string,
    legalEntityId: string | null,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(manager, {
      organizationId: tenant.organizationId,
      actorType: AuditActorType.USER,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      servicePrincipal: null,
      supportGrantId: null,
      clientAccountId,
      legalEntityId,
      action,
      permissionKey,
      decision: AuditDecision.ALLOW,
      objectType,
      objectId,
      reason: null,
      correlationId: request.correlationId,
      ipAddress: request.ipAddress,
      metadata,
    });
  }

  private organizationId(tenant: SessionAuthorizationContext): string {
    if (!tenant.organizationId)
      throw domainError(
        HttpStatus.FORBIDDEN,
        'ACTIVE_TENANT_REQUIRED',
        'Active tenant required',
      );
    return tenant.organizationId;
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

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
  }

  private translateConstraint(error: unknown): never {
    const constraint = constraintName(error);
    if (constraint === 'uq_legal_entities_active_rfc') {
      throw domainError(
        HttpStatus.CONFLICT,
        'LEGAL_ENTITY_RFC_CONFLICT',
        'RFC already exists in this organization',
      );
    }
    if (constraint === 'uq_client_accounts_active_code') {
      throw domainError(
        HttpStatus.CONFLICT,
        'CLIENT_ACCOUNT_CODE_CONFLICT',
        'Client account code already exists',
      );
    }
    if (constraint === 'uq_account_assignments_active_primary') {
      throw domainError(
        HttpStatus.CONFLICT,
        'PRIMARY_ASSIGNMENT_CONFLICT',
        'A primary assignment already exists',
      );
    }
    if (constraint === 'uq_fiscal_years_entity_year') {
      throw domainError(
        HttpStatus.CONFLICT,
        'FISCAL_YEAR_CONFLICT',
        'Fiscal year already exists',
      );
    }
    throw error;
  }
}
