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
import type { SessionAuthorizationContext } from '../sessions/session.types';
import type { AuthSession } from '../sessions/entities/auth-session.entity';
import { ClientAccountScopeService } from './client-account-scope.service';
import { constraintName, domainError } from './client-domain.errors';
import {
  CreateFiscalYearDto,
  ListFiscalYearsDto,
} from './dtos/fiscal-year.dtos';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { LegalEntity, LegalEntityStatus } from './entities/legal-entity.entity';
import { Period, PeriodStatus } from './entities/period.entity';
import { LegalEntitiesService } from './legal-entities.service';
import { validateFiscalYear } from './client-domain.rules';
import { FiscalAuthorizationService } from './fiscal-authorization.service';

@Injectable()
export class FiscalYearsService {
  constructor(
    @InjectRepository(FiscalYear)
    private readonly fiscalYears: Repository<FiscalYear>,
    @InjectRepository(Period)
    private readonly periods: Repository<Period>,
    private readonly dataSource: DataSource,
    private readonly scope: ClientAccountScopeService,
    private readonly legalEntities: LegalEntitiesService,
    private readonly audit: AuditService,
    private readonly authorization: FiscalAuthorizationService,
  ) {}

  async list(
    legalEntityId: string,
    query: ListFiscalYearsDto,
    tenant: SessionAuthorizationContext,
  ) {
    const entity = await this.legalEntities.requireEntity(
      legalEntityId,
      tenant,
    );
    const builder = this.fiscalYears
      .createQueryBuilder('year')
      .where(
        'year.organization_id = :organizationId AND year.client_account_id = :clientAccountId AND year.legal_entity_id = :legalEntityId',
        {
          organizationId: entity.organizationId,
          clientAccountId: entity.clientAccountId,
          legalEntityId: entity.id,
        },
      )
      .andWhere('year.status <> :archivedStatus', {
        archivedStatus: FiscalYearStatus.ARCHIVED,
      });
    if (query.year !== undefined)
      builder.andWhere('year.year = :year', { year: query.year });
    if (!query.paginated) {
      const years = await builder
        .orderBy('year.year', 'DESC')
        .addOrderBy('year.id', 'ASC')
        .getMany();
      return years.map((year) => this.response(year));
    }
    const [years, total] = await builder
      .orderBy('year.year', 'DESC')
      .addOrderBy('year.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: years.map((year) => this.response(year)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  async create(
    legalEntityId: string,
    dto: CreateFiscalYearDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    validateFiscalYear(dto.year);
    const entity = await this.legalEntities.requireEntity(
      legalEntityId,
      tenant,
    );
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.scope.requireAccessibleAccountWithManager(
          manager,
          entity.clientAccountId,
          tenant,
          false,
          true,
        );
        const lockedEntity = await manager.getRepository(LegalEntity).findOne({
          where: { id: entity.id, organizationId: entity.organizationId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedEntity || lockedEntity.status !== LegalEntityStatus.ACTIVE) {
          throw domainError(
            HttpStatus.NOT_FOUND,
            'LEGAL_ENTITY_NOT_FOUND',
            'Legal entity not found',
          );
        }
        const year = await manager.getRepository(FiscalYear).save(
          manager.getRepository(FiscalYear).create({
            id: randomUUID(),
            organizationId: entity.organizationId,
            clientAccountId: entity.clientAccountId,
            legalEntityId: entity.id,
            year: dto.year,
            status: FiscalYearStatus.ACTIVE,
            version: 1,
            archivedAt: null,
          }),
        );
        const periodRows = Array.from({ length: 12 }, (_, index) => ({
          id: randomUUID(),
          organizationId: entity.organizationId,
          clientAccountId: entity.clientAccountId,
          legalEntityId: entity.id,
          fiscalYearId: year.id,
          month: index + 1,
          status: PeriodStatus.NOT_STARTED,
          cutoffAt: null,
          lockVersion: 0,
        }));
        await manager.getRepository(Period).insert(periodRows);
        await this.audit.record(manager, {
          organizationId: entity.organizationId,
          actorType: AuditActorType.USER,
          actorUserId: tenant.userId,
          actorMembershipId: tenant.membershipId,
          servicePrincipal: null,
          supportGrantId: null,
          clientAccountId: entity.clientAccountId,
          legalEntityId: entity.id,
          action: 'FISCAL_YEAR_CREATED',
          permissionKey: 'fiscal_years.manage',
          decision: AuditDecision.ALLOW,
          objectType: 'fiscal_year',
          objectId: year.id,
          reason: null,
          correlationId: request.correlationId,
          ipAddress: request.ipAddress,
          metadata: { year: year.year, periodCount: 12 },
        });
        return {
          ...this.response(year),
          periodIds: periodRows.map((period) => period.id),
        };
      });
    } catch (error) {
      if (constraintName(error) === 'uq_fiscal_years_entity_year') {
        throw domainError(
          HttpStatus.CONFLICT,
          'FISCAL_YEAR_CONFLICT',
          'Fiscal year already exists',
        );
      }
      throw error;
    }
  }

  async listPeriods(fiscalYearId: string, tenant: SessionAuthorizationContext) {
    if (!tenant.organizationId) {
      throw domainError(
        HttpStatus.NOT_FOUND,
        'FISCAL_YEAR_NOT_FOUND',
        'Fiscal year not found',
      );
    }
    const year = await this.fiscalYears
      .createQueryBuilder('year')
      .innerJoin(
        LegalEntity,
        'entity',
        'entity.organization_id = year.organization_id AND entity.client_account_id = year.client_account_id AND entity.id = year.legal_entity_id',
      )
      .where('year.id = :fiscalYearId', { fiscalYearId })
      .andWhere('year.organization_id = :organizationId', {
        organizationId: tenant.organizationId,
      })
      .andWhere('year.status <> :archivedYearStatus', {
        archivedYearStatus: FiscalYearStatus.ARCHIVED,
      })
      .andWhere('entity.status <> :archivedEntityStatus', {
        archivedEntityStatus: LegalEntityStatus.ARCHIVED,
      })
      .getOne();
    if (!year) {
      throw domainError(
        HttpStatus.NOT_FOUND,
        'FISCAL_YEAR_NOT_FOUND',
        'Fiscal year not found',
      );
    }
    await this.scope.requireAccessibleAccount(year.clientAccountId, tenant);
    const periods = await this.periods
      .createQueryBuilder('period')
      .innerJoin(
        FiscalYear,
        'period_year',
        'period_year.organization_id = period.organization_id AND period_year.client_account_id = period.client_account_id AND period_year.legal_entity_id = period.legal_entity_id AND period_year.id = period.fiscal_year_id',
      )
      .innerJoin(
        LegalEntity,
        'period_entity',
        'period_entity.organization_id = period.organization_id AND period_entity.client_account_id = period.client_account_id AND period_entity.id = period.legal_entity_id',
      )
      .where('period.organization_id = :organizationId', {
        organizationId: year.organizationId,
      })
      .andWhere('period.client_account_id = :clientAccountId', {
        clientAccountId: year.clientAccountId,
      })
      .andWhere('period.legal_entity_id = :legalEntityId', {
        legalEntityId: year.legalEntityId,
      })
      .andWhere('period.fiscal_year_id = :fiscalYearId', {
        fiscalYearId: year.id,
      })
      .andWhere('period_year.status <> :archivedYearStatus', {
        archivedYearStatus: FiscalYearStatus.ARCHIVED,
      })
      .andWhere('period_entity.status <> :archivedEntityStatus', {
        archivedEntityStatus: LegalEntityStatus.ARCHIVED,
      })
      .orderBy('period.month', 'ASC')
      .getMany();
    if (periods.length === 0) {
      throw domainError(
        HttpStatus.NOT_FOUND,
        'FISCAL_YEAR_NOT_FOUND',
        'Fiscal year not found',
      );
    }
    return {
      fiscalYear: this.response(year),
      periods: periods.map((period) => ({
        id: period.id,
        fiscalYearId: period.fiscalYearId,
        month: period.month,
        status: period.status,
        cutoffAt: period.cutoffAt ?? null,
        lockVersion: period.lockVersion,
      })),
    };
  }

  async closePeriod(
    periodId: string,
    session: AuthSession,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    return this.changePeriodStatus(
      periodId,
      PeriodStatus.READY_TO_CLOSE,
      PeriodStatus.CLOSED,
      'periods.close',
      null,
      session,
      tenant,
      request,
    );
  }

  async reopenPeriod(
    periodId: string,
    reason: string,
    session: AuthSession,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    return this.changePeriodStatus(
      periodId,
      PeriodStatus.CLOSED,
      PeriodStatus.REOPENED,
      'periods.reopen',
      reason.trim(),
      session,
      tenant,
      request,
    );
  }

  private async changePeriodStatus(
    periodId: string,
    requiredStatus: PeriodStatus,
    nextStatus: PeriodStatus,
    permission: 'periods.close' | 'periods.reopen',
    reason: string | null,
    session: AuthSession,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    if (!tenant.organizationId) throw this.periodNotFound();
    const visible = await this.periods.findOne({
      where: { id: periodId, organizationId: tenant.organizationId },
    });
    if (!visible) throw this.periodNotFound();
    await this.authorization.authorize(session, tenant, request, {
      permission,
      clientAccountId: visible.clientAccountId,
      objectType: 'period',
      objectId: visible.id,
      requireReauthentication: true,
    });
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Period);
      const period = await repository.findOne({
        where: { id: periodId, organizationId: tenant.organizationId! },
        lock: { mode: 'pessimistic_write' },
      });
      if (!period) throw this.periodNotFound();
      if (period.status !== requiredStatus) {
        throw domainError(
          HttpStatus.CONFLICT,
          'PERIOD_STATE_CONFLICT',
          'Period state does not allow this action',
        );
      }
      period.status = nextStatus;
      period.cutoffAt = nextStatus === PeriodStatus.CLOSED ? new Date() : null;
      period.lockVersion += 1;
      await repository.save(period);
      await this.audit.record(manager, {
        organizationId: period.organizationId,
        actorType: AuditActorType.USER,
        actorUserId: tenant.userId,
        actorMembershipId: tenant.membershipId,
        servicePrincipal: null,
        supportGrantId: null,
        clientAccountId: period.clientAccountId,
        legalEntityId: period.legalEntityId,
        action:
          nextStatus === PeriodStatus.CLOSED
            ? 'PERIOD_CLOSED'
            : 'PERIOD_REOPENED',
        permissionKey: permission,
        decision: AuditDecision.ALLOW,
        objectType: 'period',
        objectId: period.id,
        reason,
        correlationId: request.correlationId,
        ipAddress: request.ipAddress,
        metadata: { previousStatus: requiredStatus, nextStatus },
      });
      return {
        id: period.id,
        status: period.status,
        cutoffAt: period.cutoffAt ?? null,
        lockVersion: period.lockVersion,
      };
    });
  }

  private periodNotFound() {
    return domainError(
      HttpStatus.NOT_FOUND,
      'PERIOD_NOT_FOUND',
      'Period not found',
    );
  }

  private response(year: FiscalYear) {
    return {
      id: year.id,
      clientAccountId: year.clientAccountId,
      legalEntityId: year.legalEntityId,
      year: year.year,
      status: year.status,
      version: year.version,
      createdAt: year.createdAt,
      updatedAt: year.updatedAt,
    };
  }
}
