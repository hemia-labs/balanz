import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryColumn,
  Unique,
} from 'typeorm';

export const CfdiPayrollType = { ORDINARY: 'O', EXTRAORDINARY: 'E' } as const;
export type CfdiPayrollType =
  (typeof CfdiPayrollType)[keyof typeof CfdiPayrollType];

@ForeignKey(
  'cfdis',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_cfdi_payrolls_cfdi', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_payrolls_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_payrolls_cfdi', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
])
@Check('ck_cfdi_payrolls_version', "payroll_version = '1.2'")
@Check('ck_cfdi_payrolls_type', "payroll_type IN ('O','E')")
@Check('ck_cfdi_payrolls_dates', 'initial_payment_date <= final_payment_date')
@Check(
  'ck_cfdi_payrolls_values',
  'paid_days >= 0 AND (total_perceptions IS NULL OR total_perceptions >= 0) AND (total_deductions IS NULL OR total_deductions >= 0) AND (total_other_payments IS NULL OR total_other_payments >= 0) AND (base_salary IS NULL OR base_salary >= 0) AND (integrated_daily_salary IS NULL OR integrated_daily_salary >= 0)',
)
@Entity('cfdi_payrolls')
export class CfdiPayroll {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid' }) cfdiId: string;
  @Column({ name: 'payroll_version', type: 'varchar', length: 10 })
  payrollVersion: string;
  @Column({ name: 'payroll_type', type: 'char', length: 1 })
  payrollType: CfdiPayrollType;
  @Column({ name: 'payment_date', type: 'timestamptz' }) paymentDate: Date;
  @Column({ name: 'initial_payment_date', type: 'timestamptz' })
  initialPaymentDate: Date;
  @Column({ name: 'final_payment_date', type: 'timestamptz' })
  finalPaymentDate: Date;
  @Column({ name: 'paid_days', type: 'numeric', precision: 12, scale: 3 })
  paidDays: string;
  @Column({
    name: 'total_perceptions',
    type: 'numeric',
    precision: 24,
    scale: 6,
    nullable: true,
  })
  totalPerceptions?: string | null;
  @Column({
    name: 'total_deductions',
    type: 'numeric',
    precision: 24,
    scale: 6,
    nullable: true,
  })
  totalDeductions?: string | null;
  @Column({
    name: 'total_other_payments',
    type: 'numeric',
    precision: 24,
    scale: 6,
    nullable: true,
  })
  totalOtherPayments?: string | null;
  @Column({
    name: 'employer_registration',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  employerRegistration?: string | null;
  @Column({ name: 'employee_curp', type: 'char', length: 18 })
  employeeCurp: string;
  @Column({
    name: 'employee_social_security_number',
    type: 'varchar',
    length: 15,
    nullable: true,
  })
  employeeSocialSecurityNumber?: string | null;
  @Column({
    name: 'employment_start_date',
    type: 'timestamptz',
    nullable: true,
  })
  employmentStartDate?: Date | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) seniority?:
    string | null;
  @Column({ name: 'contract_type', type: 'varchar', length: 3, nullable: true })
  contractType?: string | null;
  @Column({ name: 'regime_type', type: 'varchar', length: 3 })
  regimeType: string;
  @Column({ name: 'employee_number', type: 'varchar', length: 30 })
  employeeNumber: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) position?:
    string | null;
  @Column({ name: 'risk_position', type: 'varchar', length: 3, nullable: true })
  riskPosition?: string | null;
  @Column({ name: 'payment_periodicity', type: 'varchar', length: 3 })
  paymentPeriodicity: string;
  @Column({ name: 'bank_code', type: 'varchar', length: 3, nullable: true })
  bankCode?: string | null;
  @Column({ name: 'bank_account', type: 'varchar', length: 18, nullable: true })
  bankAccount?: string | null;
  @Column({
    name: 'base_salary',
    type: 'numeric',
    precision: 24,
    scale: 6,
    nullable: true,
  })
  baseSalary?: string | null;
  @Column({
    name: 'integrated_daily_salary',
    type: 'numeric',
    precision: 24,
    scale: 6,
    nullable: true,
  })
  integratedDailySalary?: string | null;
  @Column({ name: 'state_code', type: 'varchar', length: 3, nullable: true })
  stateCode?: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
