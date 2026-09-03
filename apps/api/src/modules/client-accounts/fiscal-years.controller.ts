import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentRequestContext } from '../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-session.decorator';
import { CurrentSession } from '../../common/decorators/current-session.decorator';
import type { AuthSession } from '../sessions/entities/auth-session.entity';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import {
  CreateFiscalYearDto,
  ListFiscalYearsDto,
} from './dtos/fiscal-year.dtos';
import { ReopenPeriodDto } from './dtos/period-action.dtos';
import { FiscalYearsService } from './fiscal-years.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class FiscalYearsController {
  constructor(private readonly service: FiscalYearsService) {}

  @Get('legal-entities/:legalEntityId/fiscal-years')
  @Permissions('fiscal_years.view')
  list(
    @Param('legalEntityId', ParseUUIDPipe) legalEntityId: string,
    @Query() query: ListFiscalYearsDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.list(legalEntityId, query, tenant);
  }

  @Post('legal-entities/:legalEntityId/fiscal-years')
  @Permissions('fiscal_years.manage')
  create(
    @Param('legalEntityId', ParseUUIDPipe) legalEntityId: string,
    @Body() dto: CreateFiscalYearDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.create(legalEntityId, dto, tenant, request);
  }

  @Get('fiscal-years/:fiscalYearId/periods')
  @Permissions('fiscal_years.view')
  periods(
    @Param('fiscalYearId', ParseUUIDPipe) fiscalYearId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.listPeriods(fiscalYearId, tenant);
  }

  @Post('periods/:periodId/close')
  closePeriod(
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.closePeriod(periodId, session, tenant, request);
  }

  @Post('periods/:periodId/reopen')
  reopenPeriod(
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @Body() dto: ReopenPeriodDto,
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.reopenPeriod(
      periodId,
      dto.reason,
      session,
      tenant,
      request,
    );
  }
}
