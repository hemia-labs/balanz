import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../../common/decorators/current-session.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { FindUsersDto } from './dtos/find-users.dto';
import { UserResponseDto } from './dtos/user-response.dto';
import { UsersPageResponseDto } from './dtos/users-page-response.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(SessionGuard, TenantAccessGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @Permissions('team.view')
  findAll(
    @Query() query: FindUsersDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ): Promise<UsersPageResponseDto> {
    return this.service.findAll(query, this.organizationId(tenant));
  }

  @Get(':id')
  @Permissions('team.view')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ): Promise<UserResponseDto> {
    return this.service.findOne(id, this.organizationId(tenant));
  }

  private organizationId(tenant: SessionAuthorizationContext): string {
    if (!tenant.organizationId) {
      throw new ForbiddenException('Active tenant required');
    }
    return tenant.organizationId;
  }
}
