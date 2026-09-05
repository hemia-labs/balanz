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

export const IngestionItemTechnicalStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  TERMINAL: 'terminal',
} as const;

export type IngestionItemTechnicalStatus =
  (typeof IngestionItemTechnicalStatus)[keyof typeof IngestionItemTechnicalStatus];

export const IngestionItemResult = {
  INCORPORATED: 'incorporated',
  DUPLICATE: 'duplicate',
  FOREIGN: 'foreign',
  INVALID: 'invalid',
  UNSUPPORTED: 'unsupported',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type IngestionItemResult =
  (typeof IngestionItemResult)[keyof typeof IngestionItemResult];

@ForeignKey(
  'ingestion_jobs',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'ingestionJobId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_ingestion_items_job', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'stored_objects',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'objectId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_ingestion_items_object', onDelete: 'RESTRICT' },
)
@Unique('uq_ingestion_items_org_id', ['organizationId', 'id'])
@Unique('uq_ingestion_items_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_ingestion_items_job_ordinal', ['ingestionJobId', 'ordinal'])
@Check('ck_ingestion_items_ordinal', 'ordinal > 0')
@Check(
  'ck_ingestion_items_technical_status',
  "technical_status IN ('pending','processing','terminal')",
)
@Check(
  'ck_ingestion_items_product_result',
  "product_result IS NULL OR product_result IN ('incorporated','duplicate','foreign','invalid','unsupported','internal_error')",
)
@Check('ck_ingestion_items_hash', "sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'")
@Check('ck_ingestion_items_attempt_count', 'attempt_count BETWEEN 0 AND 4')
@Check(
  'ck_ingestion_items_terminal_state',
  "(technical_status = 'terminal' AND product_result IS NOT NULL AND processed_at IS NOT NULL) OR (technical_status <> 'terminal' AND product_result IS NULL AND processed_at IS NULL)",
)
@Check(
  'ck_ingestion_items_error_state',
  "(product_result IN ('foreign','invalid','unsupported','internal_error') AND error_code IS NOT NULL) OR (product_result IS NULL OR product_result IN ('incorporated','duplicate'))",
)
@Check(
  'ck_ingestion_items_success_error',
  "product_result NOT IN ('incorporated','duplicate') OR (error_code IS NULL AND safe_error_detail IS NULL)",
)
@Check(
  'ck_ingestion_items_safe_filename',
  "safe_filename IS NULL OR (safe_filename = btrim(safe_filename) AND char_length(safe_filename) BETWEEN 1 AND 255 AND position('/' in safe_filename) = 0 AND position(chr(92) in safe_filename) = 0 AND safe_filename !~ '[[:cntrl:]]')",
)
@Check('ck_ingestion_items_version', 'version > 0')
@Index('ix_ingestion_items_job_status', [
  'organizationId',
  'ingestionJobId',
  'technicalStatus',
  'ordinal',
])
@Index('ix_ingestion_items_job_updated', [
  'organizationId',
  'ingestionJobId',
  'updatedAt',
])
// The physical index is partial (object_id IS NOT NULL). TypeORM cannot
// represent the predicate portably, so migrations remain its sole owner.
@Index('ix_ingestion_items_object', { synchronize: false })
@Entity('ingestion_items')
export class IngestionItem {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'legal_entity_id', type: 'uuid' })
  legalEntityId: string;

  @Column({ name: 'ingestion_job_id', type: 'uuid' })
  ingestionJobId: string;

  @Column({ name: 'object_id', type: 'uuid', nullable: true })
  objectId?: string | null;

  @Column({ type: 'integer' })
  ordinal: number;

  @Column({
    name: 'safe_filename',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  safeFilename?: string | null;

  @Column({
    name: 'technical_status',
    type: 'varchar',
    length: 16,
    default: IngestionItemTechnicalStatus.PENDING,
  })
  technicalStatus: IngestionItemTechnicalStatus;

  @Column({
    name: 'product_result',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  productResult?: IngestionItemResult | null;

  @Column({ type: 'char', length: 64, nullable: true })
  sha256?: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode?: string | null;

  @Column({
    name: 'safe_error_detail',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  safeErrorDetail?: string | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'observed_at', type: 'timestamptz', default: () => 'now()' })
  observedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
