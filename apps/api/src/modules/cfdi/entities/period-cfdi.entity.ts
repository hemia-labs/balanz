import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';

export const CfdiPeriodParticipationType = {
  DOCUMENT_ISSUE: 'document_issue',
  PAYMENT: 'payment',
  PAYROLL: 'payroll',
} as const;
export type CfdiPeriodParticipationType =
  (typeof CfdiPeriodParticipationType)[keyof typeof CfdiPeriodParticipationType];
export const CfdiPeriodOrigin = {
  AUTOMATIC: 'automatic',
  MANUAL: 'manual',
} as const;
export type CfdiPeriodOrigin =
  (typeof CfdiPeriodOrigin)[keyof typeof CfdiPeriodOrigin];

@ForeignKey(
  'cfdis',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_period_cfdis_cfdi', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'periods',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'periodId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_period_cfdis_period', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'createdByMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_period_cfdis_created_by', onDelete: 'RESTRICT' },
)
@Unique('uq_period_cfdis_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_period_cfdis_source', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
  'participationType',
  'sourceOrdinal',
])
@Check(
  'ck_period_cfdis_type',
  "participation_type IN ('document_issue','payment','payroll')",
)
@Check(
  'ck_period_cfdis_policy',
  'policy_version = btrim(policy_version) AND char_length(policy_version) BETWEEN 1 AND 64',
)
@Check(
  'ck_period_cfdis_timezone',
  'timezone = btrim(timezone) AND char_length(timezone) BETWEEN 1 AND 64',
)
@Check('ck_period_cfdis_source_ordinal', 'source_ordinal > 0')
@Check(
  'ck_period_cfdis_origin',
  "(origin = 'automatic' AND created_by_membership_id IS NULL) OR (origin = 'manual' AND created_by_membership_id IS NOT NULL)",
)
@Index('ix_period_cfdis_period', [
  'organizationId',
  'legalEntityId',
  'periodId',
  'sourceDate',
  'id',
])
@Index('ix_period_cfdis_cfdi', [
  'organizationId',
  'cfdiId',
  'participationType',
  'sourceOrdinal',
])
@Entity('period_cfdis')
export class PeriodCfdi {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid' }) cfdiId: string;
  @Column({ name: 'period_id', type: 'uuid' }) periodId: string;
  @Column({ name: 'participation_type', type: 'varchar', length: 24 })
  participationType: CfdiPeriodParticipationType;
  @Column({ name: 'policy_version', type: 'varchar', length: 64 })
  policyVersion: string;
  @Column({ type: 'varchar', length: 64 }) timezone: string;
  @Column({ name: 'source_date', type: 'timestamptz' }) sourceDate: Date;
  @Column({ name: 'source_ordinal', type: 'integer' }) sourceOrdinal: number;
  @Column({ type: 'varchar', length: 12 }) origin: CfdiPeriodOrigin;
  @Column({ name: 'created_by_membership_id', type: 'uuid', nullable: true })
  createdByMembershipId?: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
