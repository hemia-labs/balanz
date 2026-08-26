import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { IncludeArchivedDto } from './dtos/client-account.dtos';
import {
  CreateLegalEntityDto,
  UpdateLegalEntityDto,
} from './dtos/legal-entity.dtos';
import { LegalEntitiesService } from './legal-entities.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class LegalEntitiesController {
  constructor(private readonly service: LegalEntitiesService) {}

  @Get('client-accounts/:clientAccountId/legal-entities')
  @Permissions('fiscal_entities.view')
  list(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @Query() query: IncludeArchivedDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.list(clientAccountId, query.includeArchived, tenant);
  }

  @Post('client-accounts/:clientAccountId/legal-entities')
  @Permissions('fiscal_entities.manage')
  create(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @Body() dto: CreateLegalEntityDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.create(clientAccountId, dto, tenant, request);
  }

  @Patch('legal-entities/:legalEntityId')
  @Permissions('fiscal_entities.manage')
  update(
    @Param('legalEntityId', ParseUUIDPipe) legalEntityId: string,
    @Body() dto: UpdateLegalEntityDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.update(legalEntityId, dto, tenant, request);
  }

  @Delete('legal-entities/:legalEntityId')
  @Permissions('fiscal_entities.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @Param('legalEntityId', ParseUUIDPipe) legalEntityId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.archive(legalEntityId, tenant, request);
  }
}
