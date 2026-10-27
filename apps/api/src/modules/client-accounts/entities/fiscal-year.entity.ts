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

export enum FiscalYearStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
  ARCHIVED = 'archived',
}

@ForeignKey(
  'legal_entities',
  ['organizationId', 'clientAccountId', 'legalEntityId'],
  ['organizationId', 'clientAccountId', 'id'],
  { name: 'fk_fiscal_years_legal_entity', onDelete: 'RESTRICT' },
)
@Unique('uq_fiscal_years_org_id', ['organizationId', 'id'])
@Unique('uq_fiscal_years_chain_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_fiscal_years_entity_year', [
  'organizationId',
  'legalEntityId',
  'year',
])
@Check('ck_fiscal_years_year', 'year BETWEEN 2000 AND 2200')
@Check(
  'ck_fiscal_years_archive_state',
  "(status = 'archived' AND archived_at IS NOT NULL) OR (status <> 'archived' AND archived_at IS NULL)",
)
@Index('ix_fiscal_years_entity_year_status', [
  'organizationId',
  'legalEntityId',
  'year',
  'status',
])
@Index('ix_fiscal_years_account_year', [
  'organizationId',
  'clientAccountId',
  'year',
])
@Entity('fiscal_years')
export class FiscalYear {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'legal_entity_id', type: 'uuid' })
  legalEntityId: string;

  @Column({ type: 'smallint' })
  year: number;

  @Column({
    type: 'enum',
    enum: FiscalYearStatus,
    default: FiscalYearStatus.ACTIVE,
  })
  status: FiscalYearStatus;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
