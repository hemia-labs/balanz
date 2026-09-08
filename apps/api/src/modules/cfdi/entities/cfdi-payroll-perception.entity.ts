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
  { name: 'fk_cfdi_payroll_perceptions_payroll', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_payroll_perceptions_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_payroll_perceptions_parent_ordinal', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'payrollId',
  'ordinal',
])
@Check('ck_cfdi_payroll_perceptions_ordinal', 'ordinal > 0')
@Check(
  'ck_cfdi_payroll_perceptions_amounts',
  'taxable_amount >= 0 AND exempt_amount >= 0',
)
@Index('ix_cfdi_payroll_perceptions_parent', [
  'organizationId',
  'payrollId',
  'ordinal',
])
@Entity('cfdi_payroll_perceptions')
export class CfdiPayrollPerception {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'payroll_id', type: 'uuid' }) payrollId: string;
  @Column({ type: 'integer' }) ordinal: number;
  @Column({ name: 'perception_type', type: 'varchar', length: 3 })
  perceptionType: string;
  @Column({ type: 'varchar', length: 15 }) key: string;
  @Column({ type: 'varchar', length: 100 }) concept: string;
  @Column({ name: 'taxable_amount', type: 'numeric', precision: 24, scale: 6 })
  taxableAmount: string;
  @Column({ name: 'exempt_amount', type: 'numeric', precision: 24, scale: 6 })
  exemptAmount: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
