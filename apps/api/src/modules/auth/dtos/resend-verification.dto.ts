import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ResendVerificationDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsUUID()
  membershipId: string;
}
