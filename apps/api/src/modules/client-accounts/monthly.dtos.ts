import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
export class MonthlyQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional()
  @IsIn(['all', 'pending', 'incidents', 'excluded', 'news'])
  view?: string;
  @IsOptional() @IsIn(['issued', 'received']) direction?: string;
  @IsOptional() @IsIn(['I', 'E', 'T', 'P', 'N']) documentType?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateFrom?: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateTo?: string;
  @IsOptional() @Matches(/^\d{1,18}(\.\d{1,6})?$/) amountFrom?: string;
  @IsOptional() @Matches(/^\d{1,18}(\.\d{1,6})?$/) amountTo?: string;
}
export class LeaseDto {
  @IsString()
  @Length(32, 128)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  instanceToken!: string;
  @IsOptional() @IsString() @Length(3, 1000) reason?: string;
}
export class MonthlyWriteDto extends LeaseDto {
  @IsInt() @Min(0) expectedVersion!: number;
}
export class DecisionDto extends MonthlyWriteDto {
  @IsInt() @Min(0) decisionVersion!: number;
  @IsIn(['pending', 'reviewed']) reviewStatus!: 'pending' | 'reviewed';
  @IsIn(['included', 'excluded']) inclusion!: 'included' | 'excluded';
  @IsOptional() @IsString() @MaxLength(1000) exclusionReason?: string | null;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsIn(['pendiente', 'no_aplica', 'documentado']) taxStatus!:
    | 'pendiente'
    | 'no_aplica'
    | 'documentado';
  @IsOptional() @IsString() @MaxLength(1000) taxNote?: string | null;
  @IsIn(['pendiente', 'no_aplica', 'documentado']) vatStatus!:
    | 'pendiente'
    | 'no_aplica'
    | 'documentado';
  @IsOptional() @IsString() @MaxLength(1000) vatNote?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string | null;
}
export class SelectionDto {
  @IsUUID() id!: string;
  @IsInt() @Min(0) version!: number;
}
export class BulkDto extends MonthlyWriteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((x: SelectionDto) => x.id)
  @ValidateNested({ each: true })
  @Type(() => SelectionDto)
  selection!: SelectionDto[];
  @IsIn(['review', 'unreview', 'include', 'exclude', 'category']) action!:
    | 'review'
    | 'unreview'
    | 'include'
    | 'exclude'
    | 'category';
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsUUID() previewId?: string;
}
export class ChecklistDto extends MonthlyWriteDto {
  @IsIn([
    'relationships_reviewed',
    'scope_confirmed',
    'client_clarifications',
    'professional_review',
  ])
  key!: string;
  @IsBoolean() confirmed!: boolean;
  @IsInt() @Min(0) itemVersion!: number;
}
export class IncidentDto extends MonthlyWriteDto {
  @IsIn(['open', 'client_clarification', 'resolved', 'reviewed_rejection'])
  state!: string;
  @IsOptional() @IsUUID() responsibleMembershipId?: string | null;
  @IsString() @MaxLength(2000) comment!: string;
  @IsInt() @Min(0) incidentVersion!: number;
}
export class SourceLinkDto extends MonthlyWriteDto {
  @IsIn(['ingestion', 'sat']) kind!: 'ingestion' | 'sat';
  @IsUUID() sourceId!: string;
}
export class CloseDto extends MonthlyWriteDto {
  @IsOptional() @IsString() @Length(3, 1000) sourceExceptionReason?: string;
}
export class CategoryDto {
  @IsString() @Length(1, 80) label!: string;
  @IsBoolean() archived!: boolean;
  @IsInt() @Min(0) expectedVersion!: number;
}
export class TemplateDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(7)
  @ArrayMaxSize(9)
  @IsIn(
    [
      'documents_reviewed',
      'exclusions_reasoned',
      'sources_settled',
      'integrity_resolved',
      'relationships_reviewed',
      'scope_confirmed',
      'snapshot_ready',
      'client_clarifications',
      'professional_review',
    ],
    { each: true },
  )
  keys!: string[];
  @IsInt() @Min(0) expectedVersion!: number;
}
