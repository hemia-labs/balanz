import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsLocale,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeKey = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @Transform(normalizeKey)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneE164?: string;

  @IsOptional()
  @Transform(trim)
  @IsLocale()
  locale?: string;

  @IsOptional()
  @Transform(trim)
  @IsTimeZone()
  @MaxLength(64)
  timezone?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  organizationName: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @Transform(normalizeKey)
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/)
  @MaxLength(100)
  slug: string;

  @IsOptional()
  @Transform(normalizeKey)
  @IsEmail()
  @MaxLength(320)
  billingEmail?: string;

  @IsOptional()
  @Transform(trim)
  @IsTimeZone()
  @MaxLength(64)
  organizationTimezone?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  subscriptionType: string;
}
