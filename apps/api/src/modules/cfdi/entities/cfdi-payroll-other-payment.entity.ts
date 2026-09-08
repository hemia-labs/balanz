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
  { name: 'fk_cfdi_payroll_other_payments_payroll', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_payroll_other_payments_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_payroll_other_payments_parent_ordinal', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'payrollId',
  'ordinal',
])
@Check('ck_cfdi_payroll_other_payments_ordinal', 'ordinal > 0')
@Check('ck_cfdi_payroll_other_payments_amounts', 'amount >= 0')
@Index('ix_cfdi_payroll_other_payments_parent', [
  'organizationId',
  'payrollId',
  'ordinal',
])
@Entity('cfdi_payroll_other_payments')
export class CfdiPayrollOtherPayment {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'payroll_id', type: 'uuid' }) payrollId: string;
  @Column({ type: 'integer' }) ordinal: number;
  @Column({ name: 'other_payment_type', type: 'varchar', length: 3 })
  otherPaymentType: string;
  @Column({ type: 'varchar', length: 15 }) key: string;
  @Column({ type: 'varchar', length: 100 }) concept: string;
  @Column({ type: 'numeric', precision: 24, scale: 6 }) amount: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
