import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { AccountAssignmentsService } from './account-assignments.service';
import { CreateAccountAssignmentDto } from './dtos/assignment.dtos';
import { ListDomainCollectionDto } from './dtos/client-account.dtos';

@Controller('client-accounts/:clientAccountId')
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class AccountAssignmentsController {
  constructor(private readonly service: AccountAssignmentsService) {}

  @Get('assignments')
  @Permissions('clients.assign')
  list(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @Query() query: ListDomainCollectionDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.list(clientAccountId, query, tenant);
  }

  @Get('available-members')
  @Permissions('clients.assign')
  availableMembers(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @Query() query: ListDomainCollectionDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.availableMembers(clientAccountId, query, tenant);
  }

  @Post('assignments')
  @Permissions('clients.assign')
  create(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @Body() dto: CreateAccountAssignmentDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.create(clientAccountId, dto, tenant, request);
  }

  @Delete('assignments/:assignmentId')
  @Permissions('clients.assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Param('clientAccountId', ParseUUIDPipe) clientAccountId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.revoke(clientAccountId, assignmentId, tenant, request);
  }
}
