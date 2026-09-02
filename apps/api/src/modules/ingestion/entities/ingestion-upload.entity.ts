import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export const IngestionUploadWorkflow = {
  DIRECT: 'direct',
  PRESIGNED: 'presigned',
} as const;

export type IngestionUploadWorkflow =
  (typeof IngestionUploadWorkflow)[keyof typeof IngestionUploadWorkflow];

export const IngestionUploadType = {
  MANUAL_XML: 'manual_xml',
  MANUAL_ZIP: 'manual_zip',
} as const;

export type IngestionUploadType =
  (typeof IngestionUploadType)[keyof typeof IngestionUploadType];

export const IngestionUploadState = {
  PENDING: 'pending',
  RECEIVING: 'receiving',
  UPLOADED: 'uploaded',
  CONFIRMED: 'confirmed',
  EXPIRED: 'expired',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type IngestionUploadState =
  (typeof IngestionUploadState)[keyof typeof IngestionUploadState];

@ForeignKey(
  'legal_entities',
  ['organizationId', 'clientAccountId', 'legalEntityId'],
  ['organizationId', 'clientAccountId', 'id'],
  { name: 'fk_ingestion_uploads_legal_entity', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'stored_objects',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'objectId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_ingestion_uploads_object', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'createdByMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_ingestion_uploads_created_by', onDelete: 'RESTRICT' },
)
@Unique('uq_ingestion_uploads_org_id', ['organizationId', 'id'])
@Unique('uq_ingestion_uploads_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_ingestion_uploads_object', ['organizationId', 'objectId'])
@Unique('uq_ingestion_uploads_init_idempotency', [
  'organizationId',
  'legalEntityId',
  'initIdempotencyKey',
])
@Check('ck_ingestion_uploads_workflow', "workflow IN ('direct','presigned')")
@Check(
  'ck_ingestion_uploads_type',
  "upload_type IN ('manual_xml','manual_zip')",
)
@Check(
  'ck_ingestion_uploads_state',
  "state IN ('pending','receiving','uploaded','confirmed','expired','failed','cancelled')",
)
@Check(
  'ck_ingestion_uploads_init_idempotency_key',
  'init_idempotency_key = btrim(init_idempotency_key) AND char_length(init_idempotency_key) BETWEEN 1 AND 128',
)
@Check(
  'ck_ingestion_uploads_init_request_fingerprint',
  "init_request_fingerprint ~ '^[0-9a-f]{64}$'",
)
@Check(
  'ck_ingestion_uploads_confirm_idempotency',
  "(confirm_idempotency_key IS NULL AND confirm_request_fingerprint IS NULL AND confirm_idempotency_created_at IS NULL AND confirm_idempotency_expires_at IS NULL AND confirm_response_status IS NULL AND confirm_response_reference IS NULL) OR (confirm_idempotency_key = btrim(confirm_idempotency_key) AND char_length(confirm_idempotency_key) BETWEEN 1 AND 128 AND confirm_request_fingerprint ~ '^[0-9a-f]{64}$' AND confirm_idempotency_created_at IS NOT NULL AND confirm_idempotency_expires_at > confirm_idempotency_created_at)",
)
@Check(
  'ck_ingestion_uploads_checksums',
  "(expected_sha256 IS NULL OR expected_sha256 ~ '^[0-9a-f]{64}$') AND (actual_sha256 IS NULL OR actual_sha256 ~ '^[0-9a-f]{64}$')",
)
@Check(
  'ck_ingestion_uploads_sizes',
  '(expected_size_bytes IS NULL OR expected_size_bytes >= 0) AND (actual_size_bytes IS NULL OR actual_size_bytes >= 0)',
)
@Check(
  'ck_ingestion_uploads_expiration',
  'upload_expires_at > created_at AND init_idempotency_expires_at > created_at',
)
@Check(
  'ck_ingestion_uploads_confirmation',
  "(state = 'confirmed') = (confirmed_at IS NOT NULL) AND (state <> 'confirmed' OR confirm_idempotency_key IS NOT NULL)",
)
@Check(
  'ck_ingestion_uploads_confirmed_payload',
  "state <> 'confirmed' OR (actual_size_bytes IS NOT NULL AND actual_sha256 IS NOT NULL AND (expected_size_bytes IS NULL OR expected_size_bytes = actual_size_bytes) AND (expected_sha256 IS NULL OR expected_sha256 = actual_sha256))",
)
@Check(
  'ck_ingestion_uploads_response_statuses',
  '(init_response_status IS NULL OR init_response_status BETWEEN 100 AND 599) AND (confirm_response_status IS NULL OR confirm_response_status BETWEEN 100 AND 599)',
)
@Check('ck_ingestion_uploads_version', 'version > 0')
@Index('ix_ingestion_uploads_expiration', { synchronize: false })
@Index('uq_ingestion_uploads_confirm_idempotency', { synchronize: false })
@Index('ix_ingestion_uploads_scope_state', [
  'organizationId',
  'legalEntityId',
  'state',
  'updatedAt',
  'id',
])
@Entity('ingestion_uploads')
export class IngestionUpload {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'legal_entity_id', type: 'uuid' })
  legalEntityId: string;

  @Column({ type: 'varchar', length: 16 })
  workflow: IngestionUploadWorkflow;

  @Column({ name: 'upload_type', type: 'varchar', length: 20 })
  uploadType: IngestionUploadType;

  @Column({ name: 'init_idempotency_key', type: 'varchar', length: 128 })
  initIdempotencyKey: string;

  @Column({ name: 'init_request_fingerprint', type: 'char', length: 64 })
  initRequestFingerprint: string;

  @Column({ name: 'init_response_status', type: 'smallint', nullable: true })
  initResponseStatus?: number | null;

  @Column({
    name: 'init_response_reference',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  initResponseReference?: string | null;

  @Column({ name: 'init_idempotency_expires_at', type: 'timestamptz' })
  initIdempotencyExpiresAt: Date;

  @Column({
    name: 'confirm_idempotency_key',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  confirmIdempotencyKey?: string | null;

  @Column({
    name: 'confirm_request_fingerprint',
    type: 'char',
    length: 64,
    nullable: true,
  })
  confirmRequestFingerprint?: string | null;

  @Column({ name: 'confirm_response_status', type: 'smallint', nullable: true })
  confirmResponseStatus?: number | null;

  @Column({
    name: 'confirm_response_reference',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  confirmResponseReference?: string | null;

  @Column({
    name: 'confirm_idempotency_created_at',
    type: 'timestamptz',
    nullable: true,
  })
  confirmIdempotencyCreatedAt?: Date | null;

  @Column({
    name: 'confirm_idempotency_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  confirmIdempotencyExpiresAt?: Date | null;

  @Column({ name: 'object_id', type: 'uuid' })
  objectId: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: IngestionUploadState.PENDING,
  })
  state: IngestionUploadState;

  @Column({ name: 'expected_size_bytes', type: 'bigint', nullable: true })
  expectedSizeBytes?: string | null;

  @Column({ name: 'expected_sha256', type: 'char', length: 64, nullable: true })
  expectedSha256?: string | null;

  @Column({ name: 'actual_size_bytes', type: 'bigint', nullable: true })
  actualSizeBytes?: string | null;

  @Column({ name: 'actual_sha256', type: 'char', length: 64, nullable: true })
  actualSha256?: string | null;

  @Column({ name: 'upload_expires_at', type: 'timestamptz' })
  uploadExpiresAt: Date;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt?: Date | null;

  @Column({
    name: 'confirmed_without_job_reported_at',
    type: 'timestamptz',
    nullable: true,
  })
  confirmedWithoutJobReportedAt?: Date | null;

  @Column({ name: 'created_by_membership_id', type: 'uuid' })
  createdByMembershipId: string;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId: string;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  lastErrorCode?: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
