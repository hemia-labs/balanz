import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentRequestContext } from '../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-session.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { CreateFiscalYearDto } from './dtos/fiscal-year.dtos';
import { FiscalYearsService } from './fiscal-years.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class FiscalYearsController {
  constructor(private readonly service: FiscalYearsService) {}

  @Get('legal-entities/:legalEntityId/fiscal-years')
  @Permissions('fiscal_years.view')
  list(
    @Param('legalEntityId', ParseUUIDPipe) legalEntityId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.list(legalEntityId, tenant);
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
}
