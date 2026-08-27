import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CreateFiscalYearDto {
  @Type(() => Number)
  @IsInt({ message: 'Escribe un ejercicio fiscal válido.' })
  @Min(2000, { message: 'El ejercicio fiscal debe ser 2000 o posterior.' })
  year: number;
}
