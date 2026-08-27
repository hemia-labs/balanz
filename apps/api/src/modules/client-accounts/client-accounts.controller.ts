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
import { ClientAccountsService } from './client-accounts.service';
import { AccountAssignmentsService } from './account-assignments.service';
import {
  CreateClientAccountDto,
  ClientAccountDetailDto,
  ListClientAccountsDto,
  ListDomainCollectionDto,
  UpdateClientAccountDto,
} from './dtos/client-account.dtos';

@Controller('client-accounts')
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class ClientAccountsController {
  constructor(
    private readonly service: ClientAccountsService,
    private readonly assignments: AccountAssignmentsService,
  ) {}

  @Get()
  @Permissions('clients.view')
  list(
    @Query() query: ListClientAccountsDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.list(query, tenant);
  }

  @Get('available-primary-members')
  @Permissions('clients.assign')
  availablePrimaryMembers(
    @Query() query: ListDomainCollectionDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.assignments.availablePrimaryMembers(query, tenant);
  }

  @Post()
  @Permissions(
    'clients.manage',
    'clients.assign',
    'fiscal_entities.manage',
    'fiscal_years.manage',
  )
  create(
    @Body() dto: CreateClientAccountDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.create(dto, tenant, request);
  }

  @Get(':clientAccountId')
  @Permissions('clients.view')
  detail(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @Query() query: ClientAccountDetailDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.detail(clientAccountId, query, tenant);
  }

  @Patch(':clientAccountId')
  @Permissions('clients.manage')
  update(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @Body() dto: UpdateClientAccountDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.update(clientAccountId, dto, tenant, request);
  }

  @Delete(':clientAccountId')
  @Permissions('clients.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.archive(clientAccountId, tenant, request);
  }
}
