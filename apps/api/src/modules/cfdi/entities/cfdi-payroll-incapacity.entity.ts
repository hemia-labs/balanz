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

@ForeignKey(
  'cfdi_payrolls',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'payrollId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_cfdi_payroll_incapacities_payroll', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_payroll_incapacities_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_payroll_incapacities_parent_ordinal', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'payrollId',
  'ordinal',
])
@Check('ck_cfdi_payroll_incapacities_ordinal', 'ordinal > 0')
@Check(
  'ck_cfdi_payroll_incapacities_values',
  'incapacity_days > 0 AND (amount IS NULL OR amount >= 0)',
)
@Index('ix_cfdi_payroll_incapacities_parent', [
  'organizationId',
  'payrollId',
  'ordinal',
])
@Entity('cfdi_payroll_incapacities')
export class CfdiPayrollIncapacity {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'payroll_id', type: 'uuid' }) payrollId: string;
  @Column({ type: 'integer' }) ordinal: number;
  @Column({ name: 'incapacity_days', type: 'numeric', precision: 12, scale: 3 })
  incapacityDays: string;
  @Column({ name: 'incapacity_type', type: 'varchar', length: 3 })
  incapacityType: string;
  @Column({ type: 'numeric', precision: 24, scale: 6, nullable: true })
  amount?: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
