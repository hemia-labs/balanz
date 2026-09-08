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
  'cfdi_payments',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId', 'paymentId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId', 'id'],
  { name: 'fk_cfdi_payment_documents_payment', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'cfdis',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_cfdi_payment_documents_cfdi', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_payment_documents_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_payment_documents_parent_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
  'paymentId',
  'id',
])
@Unique('uq_cfdi_payment_documents_parent_ordinal', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
  'paymentId',
  'ordinal',
])
@Check('ck_cfdi_payment_documents_ordinal', 'ordinal > 0')
@Check(
  'ck_cfdi_payment_documents_currency',
  "currency = upper(btrim(currency)) AND currency ~ '^[A-Z]{3}$'",
)
@Check(
  'ck_cfdi_payment_documents_values',
  'installment_number > 0 AND previous_balance >= 0 AND paid_amount >= 0 AND remaining_balance >= 0 AND (equivalence IS NULL OR equivalence > 0)',
)
@Index('ix_cfdi_payment_documents_uuid', [
  'organizationId',
  'legalEntityId',
  'relatedUuid',
])
@Entity('cfdi_payment_documents')
export class CfdiPaymentDocument {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid' }) cfdiId: string;
  @Column({ name: 'payment_id', type: 'uuid' }) paymentId: string;
  @Column({ type: 'integer' }) ordinal: number;
  @Column({ name: 'related_uuid', type: 'uuid' }) relatedUuid: string;
  @Column({ type: 'varchar', length: 25, nullable: true }) series?:
    string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) folio?:
    string | null;
  @Column({ type: 'varchar', length: 3 }) currency: string;
  @Column({ type: 'numeric', precision: 24, scale: 10, nullable: true })
  equivalence?: string | null;
  @Column({ name: 'installment_number', type: 'integer' })
  installmentNumber: number;
  @Column({
    name: 'previous_balance',
    type: 'numeric',
    precision: 24,
    scale: 6,
  })
  previousBalance: string;
  @Column({ name: 'paid_amount', type: 'numeric', precision: 24, scale: 6 })
  paidAmount: string;
  @Column({
    name: 'remaining_balance',
    type: 'numeric',
    precision: 24,
    scale: 6,
  })
  remainingBalance: string;
  @Column({ name: 'tax_object_code', type: 'varchar', length: 3 })
  taxObjectCode: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
