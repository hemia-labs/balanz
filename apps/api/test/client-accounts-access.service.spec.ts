import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';
import { ClientAccountsService } from '../src/modules/client-accounts/client-accounts.service';
import { FiscalYearsService } from '../src/modules/client-accounts/fiscal-years.service';
import {
  ClientAccountDetailDto,
  ListClientAccountsDto,
} from '../src/modules/client-accounts/dtos/client-account.dtos';
import { FiscalYearStatus } from '../src/modules/client-accounts/entities/fiscal-year.entity';
import { LegalEntityStatus } from '../src/modules/client-accounts/entities/legal-entity.entity';

function tenant(permissions: string[]): SessionAuthorizationContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    organizationId: 'org-1',
    membershipId: 'membership-1',
    role: 'collaborator',
    permissions,
    assignedAccountIds: ['account-1'],
    accountAccessMode: 'assigned',
    mfaVerifiedAt: new Date(),
    requiresMfa: true,
    mfaStatus: 'active',
    expiresAt: new Date(Date.now() + 60_000),
    tenantActive: true,
  };
}

function legalEntityBuilder(items: Record<string, unknown>[]) {
  const builder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue([items, items.length]),
  };
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.addOrderBy.mockReturnValue(builder);
  builder.skip.mockReturnValue(builder);
  builder.take.mockReturnValue(builder);
  return builder;
}

function entityQueryBuilder(
  items: Record<string, unknown>[] = [],
  item: Record<string, unknown> | null = null,
) {
  const builder = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(items),
    getOne: jest.fn().mockResolvedValue(item),
  };
  builder.innerJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.addOrderBy.mockReturnValue(builder);
  return builder;
}

function assignmentBuilder(items: Record<string, unknown>[]) {
  const builder = {
    innerJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(items),
  };
  builder.innerJoin.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);
  builder.addSelect.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  return builder;
}

function accountListBuilder(items: Record<string, unknown>[]) {
  const builder = {
    where: jest.fn(),
    innerJoin: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue([items, items.length]),
  };
  builder.where.mockReturnValue(builder);
  builder.innerJoin.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.addOrderBy.mockReturnValue(builder);
  builder.skip.mockReturnValue(builder);
  builder.take.mockReturnValue(builder);
  return builder;
}

describe('Client account detail authorization', () => {
  it('returns only a safe primary summary and filters archived fiscal chains', async () => {
    const legalEntity = {
      id: 'entity-active',
      organizationId: 'org-1',
      clientAccountId: 'account-1',
      rfc: 'ABC010101AA1',
      legalName: 'Empresa Activa',
      status: LegalEntityStatus.ACTIVE,
      version: 1,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const account = {
      id: 'account-1',
      organizationId: 'org-1',
      name: 'Empresa',
      code: null,
      status: 'active',
      version: 1,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const builder = legalEntityBuilder([legalEntity]);
    const legalEntities = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    };
    const primaryBuilder = assignmentBuilder([
      { clientAccountId: 'account-1', displayName: 'Persona Responsable' },
    ]);
    const assignments = {
      createQueryBuilder: jest.fn().mockReturnValue(primaryBuilder),
    };
    const fiscalYearBuilder = entityQueryBuilder();
    const fiscalYears = {
      createQueryBuilder: jest.fn().mockReturnValue(fiscalYearBuilder),
    };
    const scope = {
      canIncludeArchived: jest.fn().mockReturnValue(false),
      requireAccessibleAccount: jest.fn().mockResolvedValue(account),
    };
    const service = new ClientAccountsService(
      {} as never,
      legalEntities as never,
      assignments as never,
      fiscalYears as never,
      {} as never,
      {} as never,
      {} as never,
      scope as never,
      {} as never,
    );

    const result = await service.detail(
      'account-1',
      new ClientAccountDetailDto(),
      tenant(['clients.view']),
    );

    expect(result).not.toHaveProperty('assignments');
    expect(result.primaryAssignment).toEqual({
      displayName: 'Persona Responsable',
    });
    expect(result.legalEntities).toEqual({
      items: [expect.objectContaining({ id: 'entity-active' })],
      meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });
    expect(assignments.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(primaryBuilder.addSelect).not.toHaveBeenCalledWith(
      'user.email',
      'email',
    );
    expect(fiscalYearBuilder.innerJoin).toHaveBeenCalled();
    expect(fiscalYearBuilder.andWhere).toHaveBeenCalledWith(
      'year.status <> :archivedYearStatus',
      { archivedYearStatus: FiscalYearStatus.ARCHIVED },
    );
    expect(fiscalYearBuilder.andWhere).toHaveBeenCalledWith(
      'year_entity.status <> :archivedEntityStatus',
      { archivedEntityStatus: LegalEntityStatus.ARCHIVED },
    );
  });
});

describe('Client account list projections', () => {
  it('keeps the displayed RFC, fiscal year and current period on one chain', async () => {
    const account = {
      id: 'account-1',
      organizationId: 'org-1',
      name: 'Empresa',
      code: null,
      status: 'active',
      version: 1,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const primaryEntity = {
      id: 'entity-primary',
      organizationId: 'org-1',
      clientAccountId: 'account-1',
      rfc: 'ABC010101AA1',
      legalName: 'Empresa Primaria',
      status: LegalEntityStatus.ACTIVE,
      version: 1,
      archivedAt: null,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date(),
    };
    const secondaryEntity = {
      ...primaryEntity,
      id: 'entity-secondary',
      rfc: 'DEF010101AA1',
      legalName: 'Empresa Secundaria',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const primaryYear = {
      id: 'year-primary',
      organizationId: 'org-1',
      clientAccountId: 'account-1',
      legalEntityId: 'entity-primary',
      year: 2025,
      status: FiscalYearStatus.ACTIVE,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const accountBuilder = accountListBuilder([account]);
    const yearBuilder = entityQueryBuilder([primaryYear]);
    const periodBuilder = assignmentBuilder([
      { clientAccountId: 'account-1', status: 'preparation', year: 2025 },
    ]);
    const primaryAssignmentBuilder = assignmentBuilder([
      { clientAccountId: 'account-1', displayName: 'Persona Responsable' },
    ]);
    const legalEntities = {
      find: jest.fn().mockResolvedValue([primaryEntity, secondaryEntity]),
    };
    const service = new ClientAccountsService(
      {
        createQueryBuilder: jest.fn().mockReturnValue(accountBuilder),
      } as never,
      legalEntities as never,
      {
        createQueryBuilder: jest.fn().mockReturnValue(primaryAssignmentBuilder),
      } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(yearBuilder) } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(periodBuilder) } as never,
      {} as never,
      {} as never,
      { canIncludeArchived: jest.fn().mockReturnValue(false) } as never,
      {} as never,
    );
    const query = new ListClientAccountsDto();
    const ownerTenant = {
      ...tenant(['clients.view']),
      role: 'owner',
      accountAccessMode: 'tenant' as const,
    };

    const result = await service.list(query, ownerTenant);

    expect(result.items[0]).toMatchObject({
      primaryLegalEntity: { id: 'entity-primary' },
      latestFiscalYear: {
        id: 'year-primary',
        legalEntityId: 'entity-primary',
      },
      currentPeriod: { year: 2025, status: 'preparation' },
    });
    expect(yearBuilder.andWhere).toHaveBeenCalledWith(
      'year.legal_entity_id IN (:...legalEntityIds)',
      { legalEntityIds: ['entity-primary'] },
    );
    expect(periodBuilder.andWhere).toHaveBeenCalledWith(
      'period.legal_entity_id IN (:...legalEntityIds)',
      { legalEntityIds: ['entity-primary'] },
    );
  });
});

describe('Fiscal year lifecycle authorization', () => {
  it('does not expose periods when the parent legal entity is archived', async () => {
    const yearBuilder = entityQueryBuilder();
    const fiscalYears = {
      createQueryBuilder: jest.fn().mockReturnValue(yearBuilder),
    };
    const periods = { createQueryBuilder: jest.fn() };
    const scope = {
      requireAccessibleAccount: jest.fn(),
    };
    const service = new FiscalYearsService(
      fiscalYears as never,
      periods as never,
      {} as never,
      scope as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.listPeriods('year-1', tenant(['fiscal_years.view'])),
    ).rejects.toMatchObject({ status: 404 });
    expect(yearBuilder.andWhere).toHaveBeenCalledWith(
      'entity.status <> :archivedEntityStatus',
      { archivedEntityStatus: LegalEntityStatus.ARCHIVED },
    );
    expect(scope.requireAccessibleAccount).not.toHaveBeenCalled();
    expect(periods.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rechecks the fiscal chain while loading periods', async () => {
    const year = {
      id: 'year-1',
      organizationId: 'org-1',
      clientAccountId: 'account-1',
      legalEntityId: 'entity-active',
      year: 2026,
      status: FiscalYearStatus.ACTIVE,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const period = {
      id: 'period-1',
      organizationId: 'org-1',
      clientAccountId: 'account-1',
      legalEntityId: 'entity-active',
      fiscalYearId: 'year-1',
      month: 1,
      status: 'not_started',
      cutoffAt: null,
      lockVersion: 0,
    };
    const yearBuilder = entityQueryBuilder([], year);
    const periodBuilder = entityQueryBuilder([period]);
    const scope = {
      requireAccessibleAccount: jest.fn().mockResolvedValue({
        id: 'account-1',
      }),
    };
    const service = new FiscalYearsService(
      { createQueryBuilder: jest.fn().mockReturnValue(yearBuilder) } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(periodBuilder) } as never,
      {} as never,
      scope as never,
      {} as never,
      {} as never,
    );

    const result = await service.listPeriods(
      'year-1',
      tenant(['fiscal_years.view']),
    );

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]).toMatchObject({ id: 'period-1', month: 1 });
    expect(scope.requireAccessibleAccount).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({ organizationId: 'org-1' }),
    );
    expect(periodBuilder.andWhere).toHaveBeenCalledWith(
      'period_entity.status <> :archivedEntityStatus',
      { archivedEntityStatus: LegalEntityStatus.ARCHIVED },
    );
  });
});
