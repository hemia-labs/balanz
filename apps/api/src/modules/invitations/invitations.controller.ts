import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CurrentTenant } from '../../common/decorators/current-session.decorator';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
} from './dtos/invitation.dtos';
import { InvitationsService } from './invitations.service';

@Controller()
@UseGuards(ThrottlerGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('organizations/:organizationId/invitations')
  @UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
  @Permissions('members.manage')
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.invitations.create(organizationId, dto, tenant, request);
  }

  @Get('organizations/:organizationId/invitations')
  @UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
  @Permissions('members.manage')
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.invitations.list(organizationId, tenant, request);
  }

  @Post('invitations/:invitationId/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() dto: AcceptInvitationDto,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.invitations.accept(invitationId, dto, request);
  }

  @Post('invitations/:invitationId/revoke')
  @UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
  @Permissions('members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.invitations.revokeInvitation(invitationId, tenant, request);
  }

  @Patch('memberships/:membershipId/suspend')
  @UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
  @Permissions('members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  suspend(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.invitations.changeMembershipStatus(
      membershipId,
      'suspend',
      tenant,
      request,
    );
  }

  @Patch('memberships/:membershipId/reactivate')
  @UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
  @Permissions('members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  reactivate(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.invitations.changeMembershipStatus(
      membershipId,
      'reactivate',
      tenant,
      request,
    );
  }

  @Post('memberships/:membershipId/revoke')
  @UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
  @Permissions('members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeMembership(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.invitations.changeMembershipStatus(
      membershipId,
      'revoke',
      tenant,
      request,
    );
  }
}
