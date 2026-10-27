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
} from 'typeorm';

export enum LegalEntityStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

@ForeignKey(
  'client_accounts',
  ['organizationId', 'clientAccountId'],
  ['organizationId', 'id'],
  { name: 'fk_legal_entities_account', onDelete: 'RESTRICT' },
)
@Unique('uq_legal_entities_org_id', ['organizationId', 'id'])
@Unique('uq_legal_entities_account_id', [
  'organizationId',
  'clientAccountId',
  'id',
])
@Check(
  'ck_legal_entities_rfc',
  "rfc = upper(btrim(rfc)) AND char_length(rfc) IN (12, 13) AND rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'",
)
@Check(
  'ck_legal_entities_name',
  'legal_name = btrim(legal_name) AND char_length(legal_name) BETWEEN 1 AND 200',
)
@Check(
  'ck_legal_entities_archive_state',
  "(status = 'archived' AND archived_at IS NOT NULL) OR (status <> 'archived' AND archived_at IS NULL)",
)
@Index('uq_legal_entities_active_rfc', ['organizationId', 'rfc'], {
  unique: true,
  where: 'archived_at IS NULL',
})
@Index('ix_legal_entities_org_rfc', ['organizationId', 'rfc'])
@Index('ix_legal_entities_account_status', [
  'organizationId',
  'clientAccountId',
  'status',
])
@Entity('legal_entities')
export class LegalEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ type: 'varchar', length: 13 })
  rfc: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 200 })
  legalName: string;

  @Column({
    type: 'enum',
    enum: LegalEntityStatus,
    default: LegalEntityStatus.ACTIVE,
  })
  status: LegalEntityStatus;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
