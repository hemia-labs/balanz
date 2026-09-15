import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
export class CreateSatJobDto {
  @IsUUID() legalEntityId!: string;
  @IsIn(['issued', 'received', 'folio']) direction!:
    | 'issued'
    | 'received'
    | 'folio';
  @IsIn(['xml', 'metadata']) contentType!: 'xml' | 'metadata';
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  dateFrom?: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  dateTo?: string;
  @IsOptional() @IsUUID() folio?: string;
  @IsIn(['I', 'E', 'T', 'P']) documentType!: 'I' | 'E' | 'T' | 'P';
  @IsIn(['active', 'cancelled', 'all']) documentStatus!:
    | 'active'
    | 'cancelled'
    | 'all';
}
export class SatReauthDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
export type SatJobStatus =
  | 'authorization_pending'
  | 'submitting'
  | 'waiting_sat'
  | 'requires_user_authorization'
  | 'recovering'
  | 'processing_local'
  | 'completed'
  | 'completed_with_issues'
  | 'cancelled'
  | 'failed'
  | 'external_submission_unknown';
export interface SatJobRow {
  id: string;
  organization_id: string;
  client_account_id: string;
  legal_entity_id: string;
  user_id: string;
  membership_id: string;
  status: SatJobStatus;
  custody_id: string | null;
  filter_version: 1;
  direction: CreateSatJobDto['direction'];
  content_type: CreateSatJobDto['contentType'];
  date_from: Date | null;
  date_from_local?: string | null;
  date_to_local?: string | null;
  date_to: Date | null;
  folio: string | null;
  document_type: string;
  document_status: string;
  cancel_requested_at: Date | null;
  terminal_at: Date | null;
  error_code: string | null;
  created_at: Date;
  updated_at: Date;
  lease_token: string | null;
  fence: string;
  technical_retries: number;
  next_attempt_at: Date;
}
