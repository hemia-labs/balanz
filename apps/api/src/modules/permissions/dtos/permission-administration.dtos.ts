import { IsEnum, Matches } from 'class-validator';
import { PermissionEffect } from '../entities/membership-permission.entity';
import { RoleKey } from '../entities/role.entity';

export class SetMembershipPermissionDto {
  @Matches(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)
  permission: string;

  @IsEnum(PermissionEffect)
  effect: PermissionEffect;
}

export class ChangeMembershipRoleDto {
  @IsEnum(RoleKey)
  role: RoleKey;
}
