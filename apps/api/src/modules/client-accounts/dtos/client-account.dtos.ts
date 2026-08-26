import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ClientAccountStatus } from '../entities/client-account.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normalizeRfc = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateInitialLegalEntityDto {
  @Transform(trim)
  @IsString({ message: 'Escribe una razón social válida.' })
  @IsNotEmpty({ message: 'La razón social es obligatoria.' })
  @MaxLength(200, {
    message: 'La razón social no puede exceder 200 caracteres.',
  })
  legalName: string;

  @Transform(normalizeRfc)
  @IsString({ message: 'Escribe un RFC válido.' })
  @IsNotEmpty({ message: 'El RFC es obligatorio.' })
  @Matches(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/, {
    message:
      'Ingresa un RFC válido de 12 o 13 caracteres, sin espacios ni guiones.',
  })
  rfc: string;
}

export class CreateClientAccountDto {
  @Transform(trim)
  @IsString({ message: 'Escribe un nombre de cliente válido.' })
  @IsNotEmpty({ message: 'El nombre del cliente es obligatorio.' })
  @MaxLength(160, {
    message: 'El nombre del cliente no puede exceder 160 caracteres.',
  })
  accountName: string;

  @IsDefined({ message: 'Completa los datos fiscales del cliente.' })
  @ValidateNested({ message: 'Completa correctamente los datos fiscales.' })
  @Type(() => CreateInitialLegalEntityDto)
  legalEntity: CreateInitialLegalEntityDto;

  @IsUUID(undefined, {
    message: 'Selecciona un responsable principal válido.',
  })
  primaryMembershipId: string;

  @Type(() => Number)
  @IsInt({ message: 'Escribe un ejercicio fiscal válido.' })
  @Min(2000, { message: 'El ejercicio fiscal debe ser 2000 o posterior.' })
  fiscalYear: number;
}

export class UpdateClientAccountDto {
  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'Escribe un nombre de cliente válido.' })
  @IsNotEmpty({ message: 'El nombre del cliente no puede quedar vacío.' })
  @MaxLength(160, {
    message: 'El nombre del cliente no puede exceder 160 caracteres.',
  })
  name?: string;

  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'Escribe un código válido.' })
  @MaxLength(50, { message: 'El código no puede exceder 50 caracteres.' })
  code?: string | null;

  @Type(() => Number)
  @IsInt({ message: 'La versión de la cuenta no es válida.' })
  @Min(1, { message: 'La versión de la cuenta no es válida.' })
  expectedVersion: number;
}

export enum ClientAccountSort {
  NAME = 'name',
  STATUS = 'status',
  UPDATED_AT = 'updatedAt',
}

export class ListClientAccountsDto {
  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'La búsqueda debe ser texto.' })
  @MaxLength(160, {
    message: 'La búsqueda no puede exceder 160 caracteres.',
  })
  search?: string;

  @IsOptional()
  @IsEnum(ClientAccountStatus, { message: 'Selecciona un estado válido.' })
  status?: ClientAccountStatus;

  @Type(() => Number)
  @IsInt({ message: 'La página debe ser un número entero.' })
  @Min(1, { message: 'La página debe ser 1 o mayor.' })
  page = 1;

  @Type(() => Number)
  @IsInt({ message: 'El tamaño de página debe ser un número entero.' })
  @Min(1, { message: 'El tamaño de página debe ser 1 o mayor.' })
  @Max(100, { message: 'Sólo pueden mostrarse hasta 100 clientes.' })
  limit = 25;

  @IsOptional()
  @IsString({ message: 'Selecciona un orden válido.' })
  @MaxLength(20, { message: 'Selecciona un orden válido.' })
  sort: ClientAccountSort = ClientAccountSort.NAME;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'Selecciona una dirección válida.' })
  direction: 'asc' | 'desc' = 'asc';

  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean({ message: 'El filtro de archivados no es válido.' })
  includeArchived = false;
}

export class IncludeArchivedDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean({ message: 'El filtro de archivados no es válido.' })
  includeArchived = false;
}
