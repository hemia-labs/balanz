import { IsEnum, IsOptional } from 'class-validator';
import { MembershipStatus } from '../../memberships/entities/membership.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
