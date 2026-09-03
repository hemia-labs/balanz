import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateFiscalYearDto {
  @Type(() => Number)
  @IsInt({ message: 'Escribe un ejercicio fiscal válido.' })
  @Min(2000, { message: 'El ejercicio fiscal debe ser 2000 o posterior.' })
  year: number;
}

export class ListFiscalYearsDto {
  @Type(() => Number)
  @IsInt({ message: 'La página debe ser un número entero.' })
  @Min(1, { message: 'La página debe ser 1 o mayor.' })
  @Max(10_000, { message: 'La página solicitada excede el máximo permitido.' })
  page = 1;

  @Type(() => Number)
  @IsInt({ message: 'El tamaño de página debe ser un número entero.' })
  @Min(1, { message: 'El tamaño de página debe ser 1 o mayor.' })
  @Max(100, { message: 'Sólo pueden mostrarse hasta 100 ejercicios.' })
  limit = 25;

  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'El ejercicio fiscal no es válido.' })
  @Min(2000, { message: 'El ejercicio fiscal debe ser 2000 o posterior.' })
  @Max(2200, { message: 'El ejercicio fiscal no es válido.' })
  year?: number;
}
