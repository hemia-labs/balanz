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
  'cfdis',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_cfdi_payments_cfdi', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_payments_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_payments_parent_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
  'id',
])
@Unique('uq_cfdi_payments_parent_ordinal', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
  'ordinal',
])
@Check('ck_cfdi_payments_ordinal', 'ordinal > 0')
@Check(
  'ck_cfdi_payments_currency',
  "currency = upper(btrim(currency)) AND currency ~ '^[A-Z]{3}$'",
)
@Check(
  'ck_cfdi_payments_amount',
  'amount > 0 AND (exchange_rate IS NULL OR exchange_rate > 0)',
)
@Check(
  'ck_cfdi_payments_bank_rfcs',
  '(payer_bank_rfc IS NULL OR payer_bank_rfc = upper(btrim(payer_bank_rfc))) AND (beneficiary_bank_rfc IS NULL OR beneficiary_bank_rfc = upper(btrim(beneficiary_bank_rfc)))',
)
@Check(
  'ck_cfdi_payments_foreign_bank_name',
  'payer_foreign_bank_name IS NULL OR (payer_foreign_bank_name = btrim(payer_foreign_bank_name) AND char_length(payer_foreign_bank_name) BETWEEN 1 AND 300)',
)
@Index('ix_cfdi_payments_parent_date', [
  'organizationId',
  'cfdiId',
  'paymentDate',
  'ordinal',
])
@Entity('cfdi_payments')
export class CfdiPayment {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid' }) cfdiId: string;
  @Column({ type: 'integer' }) ordinal: number;
  @Column({ name: 'payment_date', type: 'timestamptz' }) paymentDate: Date;
  @Column({ name: 'payment_form', type: 'varchar', length: 3 })
  paymentForm: string;
  @Column({ type: 'varchar', length: 3 }) currency: string;
  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 24,
    scale: 10,
    nullable: true,
  })
  exchangeRate?: string | null;
  @Column({ type: 'numeric', precision: 24, scale: 6 }) amount: string;
  @Column({
    name: 'operation_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  operationNumber?: string | null;
  @Column({
    name: 'payer_bank_rfc',
    type: 'varchar',
    length: 13,
    nullable: true,
  })
  payerBankRfc?: string | null;
  @Column({
    name: 'payer_foreign_bank_name',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  payerForeignBankName?: string | null;
  @Column({
    name: 'payer_account',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  payerAccount?: string | null;
  @Column({
    name: 'beneficiary_bank_rfc',
    type: 'varchar',
    length: 13,
    nullable: true,
  })
  beneficiaryBankRfc?: string | null;
  @Column({
    name: 'beneficiary_account',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  beneficiaryAccount?: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
