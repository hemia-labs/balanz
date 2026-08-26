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
import { ClientAccountScopeService } from './client-account-scope.service';
import { constraintName, domainError } from './client-domain.errors';
import { CreateFiscalYearDto } from './dtos/fiscal-year.dtos';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { LegalEntity, LegalEntityStatus } from './entities/legal-entity.entity';
import { Period, PeriodStatus } from './entities/period.entity';
import { LegalEntitiesService } from './legal-entities.service';
import { validateFiscalYear } from './client-domain.rules';

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
  ) {}

  async list(legalEntityId: string, tenant: SessionAuthorizationContext) {
    const entity = await this.legalEntities.requireEntity(
      legalEntityId,
      tenant,
    );
    const years = await this.fiscalYears.find({
      where: {
        organizationId: entity.organizationId,
        clientAccountId: entity.clientAccountId,
        legalEntityId: entity.id,
      },
      order: { year: 'DESC' },
    });
    return years
      .filter((year) => year.status !== FiscalYearStatus.ARCHIVED)
      .map((year) => this.response(year));
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
