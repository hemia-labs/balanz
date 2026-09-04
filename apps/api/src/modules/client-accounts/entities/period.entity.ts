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

export enum PeriodStatus {
  NOT_STARTED = 'not_started',
  PREPARATION = 'preparation',
  REVIEW = 'review',
  READY_TO_CLOSE = 'ready_to_close',
  CLOSED = 'closed',
  CHANGES_DETECTED = 'changes_detected',
  REOPENED = 'reopened',
  BLOCKED = 'blocked',
}

@ForeignKey(
  'fiscal_years',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'fiscalYearId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_periods_fiscal_year', onDelete: 'RESTRICT' },
)
@Unique('uq_periods_org_id', ['organizationId', 'id'])
@Unique('uq_periods_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_periods_year_month', ['organizationId', 'fiscalYearId', 'month'])
@Check('ck_periods_month', 'month BETWEEN 1 AND 12')
@Index('ix_periods_year_month', ['organizationId', 'fiscalYearId', 'month'])
@Index('ix_periods_org_status', ['organizationId', 'status'])
@Index('ix_periods_legal_entity', [
  'organizationId',
  'legalEntityId',
  'fiscalYearId',
])
@Entity('periods')
export class Period {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'legal_entity_id', type: 'uuid' })
  legalEntityId: string;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId: string;

  @Column({ type: 'smallint' })
  month: number;

  @Column({
    type: 'enum',
    enum: PeriodStatus,
    default: PeriodStatus.NOT_STARTED,
  })
  status: PeriodStatus;

  @Column({ name: 'cutoff_at', type: 'timestamptz', nullable: true })
  cutoffAt?: Date | null;

  @Column({ name: 'lock_version', type: 'integer', default: 0 })
  lockVersion: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
