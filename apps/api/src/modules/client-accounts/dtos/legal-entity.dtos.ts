import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const rfc = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateLegalEntityDto {
  @Transform(rfc)
  @IsString({ message: 'Escribe un RFC válido.' })
  @IsNotEmpty({ message: 'El RFC es obligatorio.' })
  @Matches(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/, {
    message:
      'Ingresa un RFC válido de 12 o 13 caracteres, sin espacios ni guiones.',
  })
  rfc: string;

  @Transform(trim)
  @IsString({ message: 'Escribe una razón social válida.' })
  @IsNotEmpty({ message: 'La razón social es obligatoria.' })
  @MaxLength(200, {
    message: 'La razón social no puede exceder 200 caracteres.',
  })
  legalName: string;
}

export class UpdateLegalEntityDto {
  @Transform(rfc)
  @IsOptional()
  @IsString({ message: 'Escribe un RFC válido.' })
  @Matches(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/, {
    message:
      'Ingresa un RFC válido de 12 o 13 caracteres, sin espacios ni guiones.',
  })
  rfc?: string;

  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'Escribe una razón social válida.' })
  @IsNotEmpty({ message: 'La razón social no puede quedar vacía.' })
  @MaxLength(200, {
    message: 'La razón social no puede exceder 200 caracteres.',
  })
  legalName?: string;

  @Type(() => Number)
  @IsInt({ message: 'La versión de la entidad fiscal no es válida.' })
  @Min(1, { message: 'La versión de la entidad fiscal no es válida.' })
  expectedVersion: number;
}
