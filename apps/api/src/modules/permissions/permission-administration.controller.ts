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
import {
  ChangeMembershipRoleDto,
  SetMembershipPermissionDto,
} from './dtos/permission-administration.dtos';
import { PermissionAdministrationService } from './permission-administration.service';

@Controller()
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class PermissionAdministrationController {
  constructor(private readonly service: PermissionAdministrationService) {}

  @Get('roles')
  @Permissions('organization.view')
  listRoles() {
    return this.service.listRoles();
  }

  @Get('permissions')
  @Permissions('permissions.manage')
  listPermissions() {
    return this.service.listPermissions();
  }

  @Get('organizations/:organizationId/memberships')
  @Permissions('members.manage')
  listMemberships(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.listMemberships(organizationId, tenant);
  }

  @Get('organizations/:organizationId/memberships/:membershipId/permissions')
  @Permissions('permissions.manage')
  getMembershipPermissions(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ) {
    return this.service.getMembershipPermissions(
      organizationId,
      membershipId,
      tenant,
    );
  }

  @Post('organizations/:organizationId/memberships/:membershipId/permissions')
  @Permissions('permissions.manage')
  setMembershipPermission(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: SetMembershipPermissionDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.setMembershipPermission(
      organizationId,
      membershipId,
      dto,
      tenant,
      request,
    );
  }

  @Delete(
    'organizations/:organizationId/memberships/:membershipId/permissions/:permission',
  )
  @Permissions('permissions.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeMembershipPermission(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('permission') permission: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.revokeMembershipPermission(
      organizationId,
      membershipId,
      permission,
      tenant,
      request,
    );
  }

  @Patch('organizations/:organizationId/memberships/:membershipId/role')
  @Permissions('members.manage', 'permissions.manage')
  changeMembershipRole(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: ChangeMembershipRoleDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
    @CurrentRequestContext() request: RequestContext,
  ) {
    return this.service.changeMembershipRole(
      organizationId,
      membershipId,
      dto,
      tenant,
      request,
    );
  }
}
