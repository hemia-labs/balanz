import { IsString, Length } from 'class-validator';

export class ReopenPeriodDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}
