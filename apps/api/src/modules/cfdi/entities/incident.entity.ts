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

export const IncidentSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type IncidentSeverity =
  (typeof IncidentSeverity)[keyof typeof IncidentSeverity];
export const IncidentStatus = {
  OPEN: 'open',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
} as const;
export type IncidentStatus =
  (typeof IncidentStatus)[keyof typeof IncidentStatus];

@ForeignKey(
  'legal_entities',
  ['organizationId', 'clientAccountId', 'legalEntityId'],
  ['organizationId', 'clientAccountId', 'id'],
  { name: 'fk_incidents_legal_entity', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'cfdis',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_incidents_cfdi', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'ingestion_items',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'ingestionItemId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_incidents_ingestion_item', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'stored_objects',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'storedObjectId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_incidents_stored_object', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'resolvedByMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_incidents_resolved_by', onDelete: 'RESTRICT' },
)
@Unique('uq_incidents_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Check('ck_incidents_code', "code ~ '^[A-Z][A-Z0-9_]{2,79}$'")
@Check(
  'ck_incidents_severity',
  "severity IN ('low','medium','high','critical')",
)
@Check('ck_incidents_status', "status IN ('open','resolved','dismissed')")
@Check(
  'ck_incidents_resolution',
  "(status = 'open' AND resolved_at IS NULL AND resolved_by_membership_id IS NULL) OR (status IN ('resolved','dismissed') AND resolved_at IS NOT NULL AND resolved_by_membership_id IS NOT NULL)",
)
@Check(
  'ck_incidents_reference',
  'cfdi_id IS NOT NULL OR ingestion_item_id IS NOT NULL OR stored_object_id IS NOT NULL',
)
@Check(
  'ck_incidents_safe_detail',
  'safe_detail IS NULL OR char_length(safe_detail) BETWEEN 1 AND 500',
)
@Check('ck_incidents_version', 'version > 0')
@Index('ix_incidents_open_scope', { synchronize: false })
@Index('ix_incidents_cfdi', { synchronize: false })
@Index('ix_incidents_item', { synchronize: false })
@Entity('incidents')
export class Incident {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid', nullable: true }) cfdiId?:
    string | null;
  @Column({ name: 'ingestion_item_id', type: 'uuid', nullable: true })
  ingestionItemId?: string | null;
  @Column({ name: 'stored_object_id', type: 'uuid', nullable: true })
  storedObjectId?: string | null;
  @Column({ type: 'varchar', length: 80 }) code: string;
  @Column({ type: 'varchar', length: 12 }) severity: IncidentSeverity;
  @Column({ type: 'varchar', length: 12, default: IncidentStatus.OPEN })
  status: IncidentStatus;
  @Column({ name: 'safe_detail', type: 'varchar', length: 500, nullable: true })
  safeDetail?: string | null;
  @Column({ name: 'detected_at', type: 'timestamptz', default: () => 'now()' })
  detectedAt: Date;
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;
  @Column({ name: 'resolved_by_membership_id', type: 'uuid', nullable: true })
  resolvedByMembershipId?: string | null;
  @VersionColumn({ type: 'integer', default: 1 }) version: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
