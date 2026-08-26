import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../../common/decorators/current-session.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { CreateUserDto } from './dtos/create-user.dto';
import { FindUsersDto } from './dtos/find-users.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
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

  @Post()
  @Permissions('team.manage')
  create(
    @Body() dto: CreateUserDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ): Promise<UserResponseDto> {
    return this.service.create(dto, this.organizationId(tenant));
  }

  @Put(':id')
  @Permissions('team.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ): Promise<UserResponseDto> {
    return this.service.update(id, this.organizationId(tenant), dto);
  }

  @Delete(':id')
  @Permissions('team.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: SessionAuthorizationContext,
  ): Promise<void> {
    return this.service.remove(id, this.organizationId(tenant));
  }

  private organizationId(tenant: SessionAuthorizationContext): string {
    if (!tenant.organizationId) {
      throw new ForbiddenException('Active tenant required');
    }
    return tenant.organizationId;
  }
}
