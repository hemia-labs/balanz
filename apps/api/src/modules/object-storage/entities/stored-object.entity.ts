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

export const StoredObjectKind = {
  MANUAL_XML: 'manual_xml',
  MANUAL_ZIP: 'manual_zip',
  SAT_PACKAGE: 'sat_package',
  EXTRACTED_XML: 'extracted_xml',
  CREDENTIAL_CERTIFICATE: 'credential_certificate',
  CREDENTIAL_PRIVATE_KEY: 'credential_private_key',
  EXPORT: 'export',
} as const;

export type StoredObjectKind =
  (typeof StoredObjectKind)[keyof typeof StoredObjectKind];

export const StorageProvider = {
  LOCAL: 'local',
  S3: 's3',
} as const;

export type StorageProvider =
  (typeof StorageProvider)[keyof typeof StorageProvider];

export const StoredObjectLifecycleState = {
  PENDING_UPLOAD: 'pending_upload',
  UPLOADED: 'uploaded',
  QUARANTINED: 'quarantined',
  AVAILABLE: 'available',
  REJECTED: 'rejected',
  DELETED: 'deleted',
} as const;

export type StoredObjectLifecycleState =
  (typeof StoredObjectLifecycleState)[keyof typeof StoredObjectLifecycleState];

export const MalwareScanStatus = {
  PENDING: 'pending',
  CLEAN: 'clean',
  INFECTED: 'infected',
  FAILED: 'failed',
  BYPASSED: 'bypassed',
} as const;

export type MalwareScanStatus =
  (typeof MalwareScanStatus)[keyof typeof MalwareScanStatus];

export const ObjectEncryptionClass = {
  STANDARD: 'standard',
  FISCAL: 'fiscal',
  CREDENTIAL: 'credential',
  EXPORT: 'export',
} as const;

export type ObjectEncryptionClass =
  (typeof ObjectEncryptionClass)[keyof typeof ObjectEncryptionClass];

@ForeignKey(
  'legal_entities',
  ['organizationId', 'clientAccountId', 'legalEntityId'],
  ['organizationId', 'clientAccountId', 'id'],
  { name: 'fk_stored_objects_legal_entity', onDelete: 'RESTRICT' },
)
@Unique('uq_stored_objects_org_id', ['organizationId', 'id'])
@Unique('uq_stored_objects_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_stored_objects_storage_location', [
  'storageProvider',
  'storageContainer',
  'objectKey',
])
@Check(
  'ck_stored_objects_kind',
  "kind IN ('manual_xml','manual_zip','sat_package','extracted_xml','credential_certificate','credential_private_key','export')",
)
@Check('ck_stored_objects_provider', "storage_provider IN ('local','s3')")
@Check(
  'ck_stored_objects_container',
  "storage_container = btrim(storage_container) AND char_length(storage_container) BETWEEN 1 AND 255 AND position('/' in storage_container) = 0 AND position(chr(92) in storage_container) = 0",
)
@Check(
  'ck_stored_objects_encryption_class',
  "encryption_class IN ('standard','fiscal','credential','export')",
)
@Check(
  'ck_stored_objects_lifecycle_state',
  "lifecycle_state IN ('pending_upload','uploaded','quarantined','available','rejected','deleted')",
)
@Check(
  'ck_stored_objects_scan_status',
  "malware_scan_status IN ('pending','clean','infected','failed','bypassed')",
)
@Check('ck_stored_objects_size', 'size_bytes IS NULL OR size_bytes >= 0')
@Check(
  'ck_stored_objects_sha256',
  "sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'",
)
@Check(
  'ck_stored_objects_object_key',
  "object_key = btrim(object_key) AND char_length(object_key) BETWEEN 1 AND 512 AND object_key !~ '(^|/)\\.\\.(/|$)' AND object_key !~ '^/' AND position(chr(92) in object_key) = 0",
)
@Check(
  'ck_stored_objects_filename',
  "original_filename IS NULL OR (original_filename = btrim(original_filename) AND char_length(original_filename) BETWEEN 1 AND 255 AND position('/' in original_filename) = 0 AND position(chr(92) in original_filename) = 0 AND original_filename !~ '[[:cntrl:]]')",
)
@Check(
  'ck_stored_objects_payload_state',
  "(lifecycle_state = 'pending_upload' AND size_bytes IS NULL AND sha256 IS NULL AND uploaded_at IS NULL) OR (lifecycle_state IN ('uploaded','quarantined','available') AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND uploaded_at IS NOT NULL) OR lifecycle_state IN ('rejected','deleted')",
)
@Check(
  'ck_stored_objects_deleted_state',
  "(lifecycle_state = 'deleted') = (deleted_at IS NOT NULL)",
)
@Check(
  'ck_stored_objects_available_scan',
  "lifecycle_state <> 'available' OR (malware_scan_status IN ('clean','bypassed') AND malware_scanned_at IS NOT NULL AND available_at IS NOT NULL)",
)
@Check(
  'ck_stored_objects_scan_timestamp',
  "(malware_scan_status = 'pending' AND malware_scanned_at IS NULL) OR (malware_scan_status <> 'pending' AND malware_scanned_at IS NOT NULL)",
)
@Check(
  'ck_stored_objects_quarantine_reason',
  "quarantine_reason_code IS NULL OR lifecycle_state IN ('quarantined','rejected','deleted')",
)
@Check('ck_stored_objects_version', 'version > 0')
@Index('ix_stored_objects_scope_hash', [
  'organizationId',
  'legalEntityId',
  'kind',
  'sha256',
])
@Index('ix_stored_objects_lifecycle_updated', [
  'lifecycleState',
  'updatedAt',
  'id',
])
@Index('ix_stored_objects_retention', { synchronize: false })
@Entity('stored_objects')
export class StoredObject {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'legal_entity_id', type: 'uuid' })
  legalEntityId: string;

  @Column({ type: 'varchar', length: 40 })
  kind: StoredObjectKind;

  @Column({ name: 'storage_provider', type: 'varchar', length: 16 })
  storageProvider: StorageProvider;

  @Column({ name: 'storage_container', type: 'varchar', length: 255 })
  storageContainer: string;

  @Column({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey: string;

  @Column({
    name: 'original_filename',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalFilename?: string | null;

  @Column({
    name: 'declared_mime_type',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  declaredMimeType?: string | null;

  @Column({
    name: 'detected_mime_type',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  detectedMimeType?: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes?: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  sha256?: string | null;

  @Column({
    name: 'storage_etag',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  storageEtag?: string | null;

  @Column({
    name: 'storage_version_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  storageVersionId?: string | null;

  @Column({ name: 'encryption_class', type: 'varchar', length: 24 })
  encryptionClass: ObjectEncryptionClass;

  @Column({
    name: 'lifecycle_state',
    type: 'varchar',
    length: 24,
    default: StoredObjectLifecycleState.PENDING_UPLOAD,
  })
  lifecycleState: StoredObjectLifecycleState;

  @Column({
    name: 'malware_scan_status',
    type: 'varchar',
    length: 16,
    default: MalwareScanStatus.PENDING,
  })
  malwareScanStatus: MalwareScanStatus;

  @Column({
    name: 'malware_scanner_version',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  malwareScannerVersion?: string | null;

  @Column({ name: 'malware_scanned_at', type: 'timestamptz', nullable: true })
  malwareScannedAt?: Date | null;

  @Column({
    name: 'quarantine_reason_code',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  quarantineReasonCode?: string | null;

  @Column({ name: 'retention_until', type: 'timestamptz', nullable: true })
  retentionUntil?: Date | null;

  @Column({ name: 'hold_until', type: 'timestamptz', nullable: true })
  holdUntil?: Date | null;

  @Column({
    name: 'redundant_reported_at',
    type: 'timestamptz',
    nullable: true,
  })
  redundantReportedAt?: Date | null;

  @Column({
    name: 'retention_eligible_reported_at',
    type: 'timestamptz',
    nullable: true,
  })
  retentionEligibleReportedAt?: Date | null;

  @Column({ name: 'uploaded_at', type: 'timestamptz', nullable: true })
  uploadedAt?: Date | null;

  @Column({ name: 'available_at', type: 'timestamptz', nullable: true })
  availableAt?: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
