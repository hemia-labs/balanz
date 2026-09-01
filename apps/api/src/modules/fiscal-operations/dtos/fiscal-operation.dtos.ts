import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateSatDownloadJobDto {
  @IsUUID()
  clientAccountId: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/)
  rfc: string;
}

export class CreateExportDto {
  @IsUUID()
  clientAccountId: string;

  @IsOptional()
  @IsBoolean()
  massive = false;
}
