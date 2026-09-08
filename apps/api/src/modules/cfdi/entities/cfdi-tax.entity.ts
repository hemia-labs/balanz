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

export const CfdiTaxScope = {
  DOCUMENT: 'document',
  CONCEPT: 'concept',
  PAYMENT: 'payment',
  PAYMENT_DOCUMENT: 'payment_document',
} as const;
export type CfdiTaxScope = (typeof CfdiTaxScope)[keyof typeof CfdiTaxScope];
export const CfdiTaxDirection = {
  TRANSFERRED: 'transferred',
  WITHHELD: 'withheld',
} as const;
export type CfdiTaxDirection =
  (typeof CfdiTaxDirection)[keyof typeof CfdiTaxDirection];
export const CfdiTaxFactorType = {
  RATE: 'rate',
  QUOTA: 'quota',
  EXEMPT: 'exempt',
} as const;
export type CfdiTaxFactorType =
  (typeof CfdiTaxFactorType)[keyof typeof CfdiTaxFactorType];

@ForeignKey(
  'cfdis',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_cfdi_taxes_cfdi', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'cfdi_concepts',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId', 'conceptId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId', 'id'],
  { name: 'fk_cfdi_taxes_concept', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'cfdi_payments',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId', 'paymentId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId', 'id'],
  { name: 'fk_cfdi_taxes_payment', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'cfdi_payment_documents',
  [
    'organizationId',
    'clientAccountId',
    'legalEntityId',
    'cfdiId',
    'paymentId',
    'paymentDocumentId',
  ],
  [
    'organizationId',
    'clientAccountId',
    'legalEntityId',
    'cfdiId',
    'paymentId',
    'id',
  ],
  { name: 'fk_cfdi_taxes_payment_document', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_taxes_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Index(
  'uq_cfdi_taxes_document_ordinal',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId', 'ordinal'],
  { unique: true, where: `"scope_type" = 'document'` },
)
@Index(
  'uq_cfdi_taxes_concept_ordinal',
  [
    'organizationId',
    'clientAccountId',
    'legalEntityId',
    'cfdiId',
    'conceptId',
    'ordinal',
  ],
  { unique: true, where: `"scope_type" = 'concept'` },
)
@Index(
  'uq_cfdi_taxes_payment_ordinal',
  [
    'organizationId',
    'clientAccountId',
    'legalEntityId',
    'cfdiId',
    'paymentId',
    'ordinal',
  ],
  { unique: true, where: `"scope_type" = 'payment'` },
)
@Index(
  'uq_cfdi_taxes_payment_document_ordinal',
  [
    'organizationId',
    'clientAccountId',
    'legalEntityId',
    'cfdiId',
    'paymentId',
    'paymentDocumentId',
    'ordinal',
  ],
  { unique: true, where: `"scope_type" = 'payment_document'` },
)
@Check(
  'ck_cfdi_taxes_scope_type',
  "scope_type IN ('document','concept','payment','payment_document')",
)
@Check('ck_cfdi_taxes_direction', "direction IN ('transferred','withheld')")
@Check(
  'ck_cfdi_taxes_factor',
  "factor_type IS NULL OR factor_type IN ('rate','quota','exempt')",
)
@Check('ck_cfdi_taxes_ordinal', 'ordinal > 0')
@Check(
  'ck_cfdi_taxes_parent',
  "(scope_type = 'document' AND concept_id IS NULL AND payment_id IS NULL AND payment_document_id IS NULL) OR (scope_type = 'concept' AND concept_id IS NOT NULL AND payment_id IS NULL AND payment_document_id IS NULL) OR (scope_type = 'payment' AND concept_id IS NULL AND payment_id IS NOT NULL AND payment_document_id IS NULL) OR (scope_type = 'payment_document' AND concept_id IS NULL AND payment_id IS NOT NULL AND payment_document_id IS NOT NULL)",
)
@Check(
  'ck_cfdi_taxes_values',
  "(base_amount IS NULL OR base_amount >= 0) AND (rate_or_quota IS NULL OR rate_or_quota >= 0) AND (amount IS NULL OR amount >= 0) AND ((direction = 'withheld' AND scope_type IN ('document','payment') AND factor_type IS NULL AND base_amount IS NULL AND rate_or_quota IS NULL AND amount IS NOT NULL) OR (factor_type = 'exempt' AND base_amount IS NOT NULL AND rate_or_quota IS NULL AND amount IS NULL) OR (factor_type IN ('rate','quota') AND base_amount IS NOT NULL AND rate_or_quota IS NOT NULL AND amount IS NOT NULL))",
)
@Index('ix_cfdi_taxes_parent', [
  'organizationId',
  'cfdiId',
  'scopeType',
  'ordinal',
])
@Entity('cfdi_taxes')
export class CfdiTax {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid' }) cfdiId: string;
  @Column({ name: 'concept_id', type: 'uuid', nullable: true }) conceptId?:
    string | null;
  @Column({ name: 'payment_id', type: 'uuid', nullable: true }) paymentId?:
    string | null;
  @Column({ name: 'payment_document_id', type: 'uuid', nullable: true })
  paymentDocumentId?: string | null;
  @Column({ name: 'scope_type', type: 'varchar', length: 24 })
  scopeType: CfdiTaxScope;
  @Column({ type: 'varchar', length: 12 }) direction: CfdiTaxDirection;
  @Column({ type: 'integer' }) ordinal: number;
  @Column({ name: 'tax_code', type: 'varchar', length: 3 }) taxCode: string;
  @Column({ name: 'factor_type', type: 'varchar', length: 8, nullable: true })
  factorType?: CfdiTaxFactorType | null;
  @Column({
    name: 'base_amount',
    type: 'numeric',
    precision: 24,
    scale: 6,
    nullable: true,
  })
  baseAmount?: string | null;
  @Column({
    name: 'rate_or_quota',
    type: 'numeric',
    precision: 24,
    scale: 10,
    nullable: true,
  })
  rateOrQuota?: string | null;
  @Column({ type: 'numeric', precision: 24, scale: 6, nullable: true })
  amount?: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
