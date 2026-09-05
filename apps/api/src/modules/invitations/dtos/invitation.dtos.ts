import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RoleKey } from '../../permissions/entities/role.entity';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;
const normalize = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateInvitationDto {
  @Transform(normalize)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @Transform(normalize)
  @IsEnum(RoleKey)
  role: RoleKey;

  @IsISO8601({ strict: true })
  expiresAt: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  proposedPermissions?: string[];
}

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  @MaxLength(512)
  token: string;

  @Transform(normalize)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
