import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class DisableMfaDto {
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
