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

export const IngestionJobSourceType = {
  MANUAL_XML: 'manual_xml',
  MANUAL_ZIP: 'manual_zip',
  SAT_PACKAGE: 'sat_package',
} as const;

export type IngestionJobSourceType =
  (typeof IngestionJobSourceType)[keyof typeof IngestionJobSourceType];

export const IngestionJobStatus = {
  AWAITING_UPLOAD: 'awaiting_upload',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  COMPLETED_WITH_ISSUES: 'completed_with_issues',
  FAILED_RETRYABLE: 'failed_retryable',
  FAILED_FINAL: 'failed_final',
  CANCEL_REQUESTED: 'cancel_requested',
  CANCELLED: 'cancelled',
} as const;

export type IngestionJobStatus =
  (typeof IngestionJobStatus)[keyof typeof IngestionJobStatus];

export const IngestionStage = {
  SCANNING: 'scanning',
  EXTRACTING: 'extracting',
  PARSING: 'parsing',
  PERSISTING: 'persisting',
} as const;

export type IngestionStage =
  (typeof IngestionStage)[keyof typeof IngestionStage];

@ForeignKey(
  'legal_entities',
  ['organizationId', 'clientAccountId', 'legalEntityId'],
  ['organizationId', 'clientAccountId', 'id'],
  { name: 'fk_ingestion_jobs_legal_entity', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'stored_objects',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'rootObjectId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_ingestion_jobs_root_object', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'ingestion_uploads',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'uploadId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_ingestion_jobs_upload', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'requestedByMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_ingestion_jobs_requested_by', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'ingestion_jobs',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'retryOfJobId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_ingestion_jobs_retry_of', onDelete: 'RESTRICT' },
)
@Unique('uq_ingestion_jobs_org_id', ['organizationId', 'id'])
@Unique('uq_ingestion_jobs_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_ingestion_jobs_idempotency', [
  'organizationId',
  'legalEntityId',
  'idempotencyKey',
])
@Check(
  'ck_ingestion_jobs_source_type',
  "source_type IN ('manual_xml','manual_zip','sat_package')",
)
@Check(
  'ck_ingestion_jobs_source_shape',
  "(source_type IN ('manual_xml','manual_zip') AND upload_id IS NOT NULL AND root_object_id IS NOT NULL AND requested_by_membership_id IS NOT NULL) OR (source_type = 'sat_package' AND upload_id IS NULL AND root_object_id IS NOT NULL)",
)
@Check(
  'ck_ingestion_jobs_status',
  "status IN ('awaiting_upload','queued','processing','completed','completed_with_issues','failed_retryable','failed_final','cancel_requested','cancelled')",
)
@Check(
  'ck_ingestion_jobs_stage',
  "current_stage IS NULL OR current_stage IN ('scanning','extracting','parsing','persisting')",
)
@Check(
  'ck_ingestion_jobs_idempotency_key',
  'idempotency_key = btrim(idempotency_key) AND char_length(idempotency_key) BETWEEN 1 AND 128',
)
@Check(
  'ck_ingestion_jobs_request_fingerprint',
  "request_fingerprint ~ '^[0-9a-f]{64}$'",
)
@Check(
  'ck_ingestion_jobs_response_status',
  'response_status IS NULL OR response_status BETWEEN 100 AND 599',
)
@Check(
  'ck_ingestion_jobs_attempt_count',
  // attempt_count includes the initial execution; at most three total
  // executions are allowed by the locked Phase 0 policy.
  'attempt_count BETWEEN 0 AND 3',
)
@Check(
  'ck_ingestion_jobs_worker_ids',
  "(worker_id IS NULL OR worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') AND (locked_by IS NULL OR locked_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')",
)
@Check(
  'ck_ingestion_jobs_counters',
  'total_items >= 0 AND pending_items >= 0 AND processing_items >= 0 AND incorporated_items >= 0 AND duplicate_items >= 0 AND foreign_items >= 0 AND invalid_items >= 0 AND unsupported_items >= 0 AND internal_error_items >= 0 AND pending_items + processing_items + incorporated_items + duplicate_items + foreign_items + invalid_items + unsupported_items + internal_error_items = total_items',
)
@Check(
  'ck_ingestion_jobs_lease_state',
  "(status = 'processing' AND locked_by IS NOT NULL AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL AND started_at IS NOT NULL) OR status <> 'processing'",
)
@Check(
  'ck_ingestion_jobs_unlocked_state',
  "status IN ('processing','cancel_requested') OR (locked_by IS NULL AND lease_expires_at IS NULL)",
)
@Check(
  'ck_ingestion_jobs_cancel_state',
  "(status IN ('cancel_requested','cancelled')) = (cancel_requested_at IS NOT NULL)",
)
@Check(
  'ck_ingestion_jobs_completion_state',
  "(status IN ('completed','completed_with_issues','failed_final','cancelled')) = (completed_at IS NOT NULL)",
)
@Check(
  'ck_ingestion_jobs_retry_schedule',
  "status NOT IN ('queued','failed_retryable') OR next_attempt_at IS NOT NULL",
)
@Check(
  'ck_ingestion_jobs_retry_of',
  'retry_of_job_id IS NULL OR retry_of_job_id <> id',
)
@Check(
  'ck_ingestion_jobs_idempotency_expiration',
  'idempotency_expires_at > created_at',
)
@Check('ck_ingestion_jobs_version', 'version > 0')
@Index('ix_ingestion_jobs_claim', { synchronize: false })
@Index('ix_ingestion_jobs_active_tenant', { synchronize: false })
@Index('ix_ingestion_jobs_counter_reconcile', { synchronize: false })
@Index('ix_ingestion_jobs_tenant_fairness', { synchronize: false })
// Both relationship indexes are partial. Keep their metadata visible without
// allowing schema synchronization to replace them with non-partial indexes.
@Index('ix_ingestion_jobs_root_object', { synchronize: false })
@Index('ix_ingestion_jobs_retry_of', { synchronize: false })
@Index('ix_ingestion_jobs_scope_status', [
  'organizationId',
  'legalEntityId',
  'status',
  'updatedAt',
  'id',
])
@Index('ix_ingestion_jobs_requested_by_status', [
  'organizationId',
  'requestedByMembershipId',
  'status',
  'createdAt',
])
@Entity('ingestion_jobs')
export class IngestionJob {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'legal_entity_id', type: 'uuid' })
  legalEntityId: string;

  @Column({ name: 'source_type', type: 'varchar', length: 20 })
  sourceType: IngestionJobSourceType;

  @Column({ name: 'upload_id', type: 'uuid', nullable: true })
  uploadId?: string | null;

  @Column({ name: 'root_object_id', type: 'uuid', nullable: true })
  rootObjectId?: string | null;

  @Column({
    name: 'requested_by_membership_id',
    type: 'uuid',
    nullable: true,
  })
  requestedByMembershipId?: string | null;

  @Column({ name: 'retry_of_job_id', type: 'uuid', nullable: true })
  retryOfJobId?: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint: string;

  @Column({ name: 'response_status', type: 'smallint', nullable: true })
  responseStatus?: number | null;

  @Column({
    name: 'response_reference',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  responseReference?: string | null;

  @Column({ name: 'idempotency_expires_at', type: 'timestamptz' })
  idempotencyExpiresAt: Date;

  @Column({
    type: 'varchar',
    length: 32,
    default: IngestionJobStatus.AWAITING_UPLOAD,
  })
  status: IngestionJobStatus;

  @Column({
    name: 'current_stage',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  currentStage?: IngestionStage | null;

  @Column({ name: 'total_items', type: 'integer', default: 0 })
  totalItems: number;

  @Column({ name: 'pending_items', type: 'integer', default: 0 })
  pendingItems: number;

  @Column({ name: 'processing_items', type: 'integer', default: 0 })
  processingItems: number;

  @Column({ name: 'incorporated_items', type: 'integer', default: 0 })
  incorporatedItems: number;

  @Column({ name: 'duplicate_items', type: 'integer', default: 0 })
  duplicateItems: number;

  @Column({ name: 'foreign_items', type: 'integer', default: 0 })
  foreignItems: number;

  @Column({ name: 'invalid_items', type: 'integer', default: 0 })
  invalidItems: number;

  @Column({ name: 'unsupported_items', type: 'integer', default: 0 })
  unsupportedItems: number;

  @Column({ name: 'internal_error_items', type: 'integer', default: 0 })
  internalErrorItems: number;

  @Column({
    name: 'counters_reconciled_at',
    type: 'timestamptz',
    nullable: true,
  })
  countersReconciledAt?: Date | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt?: Date | null;

  @Column({ name: 'worker_id', type: 'varchar', length: 128, nullable: true })
  workerId?: string | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 128, nullable: true })
  lockedBy?: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt?: Date | null;

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt?: Date | null;

  @Column({ name: 'last_claimed_at', type: 'timestamptz', nullable: true })
  lastClaimedAt?: Date | null;

  @Column({ name: 'cancel_requested_at', type: 'timestamptz', nullable: true })
  cancelRequestedAt?: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  lastErrorCode?: string | null;

  @Column({
    name: 'last_error_detail',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  lastErrorDetail?: string | null;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId: string;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
