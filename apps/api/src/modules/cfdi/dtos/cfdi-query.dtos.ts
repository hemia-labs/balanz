import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'desc';
}

export class IngestionItemsQueryDto extends PageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsIn([
    'incorporated',
    'duplicate',
    'foreign',
    'invalid',
    'unsupported',
    'internal_error',
  ])
  result?: string;

  @IsOptional()
  @IsIn(['ordinal', 'updatedAt'])
  sort: 'ordinal' | 'updatedAt' = 'ordinal';
}

export class ProcessesQueryDto extends PageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsIn([
    'awaiting_upload',
    'queued',
    'processing',
    'completed',
    'completed_with_issues',
    'failed_retryable',
    'failed_final',
    'cancel_requested',
    'cancelled',
  ])
  status?: string;

  @Transform(trim)
  @IsOptional()
  @IsIn(['manual_xml'])
  source?: 'manual_xml';

  @Transform(trim)
  @IsOptional()
  @IsUUID('4')
  legalEntityId?: string;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'status'])
  sort: 'createdAt' | 'updatedAt' | 'status' = 'createdAt';
}

export class CfdiListQueryDto extends PageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsIn(['I', 'E', 'T', 'N', 'P'])
  documentType?: string;

  @Transform(trim)
  @IsOptional()
  @IsUUID()
  uuid?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  issuedFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  issuedTo?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(13)
  counterpartyRfc?: string;

  @IsOptional()
  @IsIn(['issuedAt', 'total', 'createdAt'])
  sort: 'issuedAt' | 'total' | 'createdAt' = 'issuedAt';
}
