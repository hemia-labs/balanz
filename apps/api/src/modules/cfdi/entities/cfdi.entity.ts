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
  VersionColumn,
} from 'typeorm';

export const CfdiDocumentType = {
  INCOME: 'I',
  EXPENSE: 'E',
  TRANSFER: 'T',
  PAYROLL: 'N',
  PAYMENT: 'P',
} as const;

export type CfdiDocumentType =
  (typeof CfdiDocumentType)[keyof typeof CfdiDocumentType];

@ForeignKey(
  'legal_entities',
  ['organizationId', 'clientAccountId', 'legalEntityId'],
  ['organizationId', 'clientAccountId', 'id'],
  { name: 'fk_cfdis_legal_entity', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'stored_objects',
  ['organizationId', 'clientAccountId', 'legalEntityId', 'sourceObjectId'],
  ['organizationId', 'clientAccountId', 'legalEntityId', 'id'],
  { name: 'fk_cfdis_source_object', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdis_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdis_scope_source', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'sourceObjectId',
])
@Unique('uq_cfdis_scope_id_source', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
  'sourceObjectId',
])
@Unique('uq_cfdis_legal_entity_uuid', ['legalEntityId', 'normalizedUuid'])
@Check('ck_cfdis_supported_version', "cfdi_version = '4.0'")
@Check('ck_cfdis_document_type', "document_type IN ('I','E','T','N','P')")
@Check(
  'ck_cfdis_parser_versions',
  'schema_version = btrim(schema_version) AND char_length(schema_version) BETWEEN 1 AND 64 AND parser_version = btrim(parser_version) AND char_length(parser_version) BETWEEN 1 AND 64',
)
@Check(
  'ck_cfdis_rfc',
  "issuer_rfc = upper(btrim(issuer_rfc)) AND issuer_rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$' AND receiver_rfc = upper(btrim(receiver_rfc)) AND receiver_rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'",
)
@Check(
  'ck_cfdis_currency',
  "currency = upper(btrim(currency)) AND currency ~ '^[A-Z]{3}$'",
)
@Check(
  'ck_cfdis_amounts',
  'subtotal >= 0 AND total >= 0 AND (discount IS NULL OR discount >= 0) AND (exchange_rate IS NULL OR exchange_rate > 0)',
)
@Check('ck_cfdis_version', 'version > 0')
@Index('ix_cfdis_scope_issued', [
  'organizationId',
  'legalEntityId',
  'issuedAt',
  'id',
])
@Index('ix_cfdis_scope_type_issued', [
  'organizationId',
  'legalEntityId',
  'documentType',
  'issuedAt',
  'id',
])
@Index('ix_cfdis_scope_receiver', [
  'organizationId',
  'legalEntityId',
  'receiverRfc',
  'issuedAt',
  'id',
])
@Entity('cfdis')
export class Cfdi {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'legal_entity_id', type: 'uuid' })
  legalEntityId: string;

  @Column({ name: 'source_object_id', type: 'uuid' })
  sourceObjectId: string;

  @Column({ name: 'normalized_uuid', type: 'uuid' })
  normalizedUuid: string;

  @Column({ name: 'cfdi_version', type: 'varchar', length: 10 })
  cfdiVersion: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 64 })
  schemaVersion: string;

  @Column({ name: 'parser_version', type: 'varchar', length: 64 })
  parserVersion: string;

  @Column({ name: 'document_type', type: 'char', length: 1 })
  documentType: CfdiDocumentType;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'certified_at', type: 'timestamptz' })
  certifiedAt: Date;

  @Column({ name: 'issuer_rfc', type: 'varchar', length: 13 })
  issuerRfc: string;

  @Column({ name: 'issuer_name', type: 'varchar', length: 300, nullable: true })
  issuerName?: string | null;

  @Column({ name: 'receiver_rfc', type: 'varchar', length: 13 })
  receiverRfc: string;

  @Column({
    name: 'receiver_name',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  receiverName?: string | null;

  @Column({
    name: 'receiver_fiscal_zip',
    type: 'varchar',
    length: 5,
    nullable: true,
  })
  receiverFiscalZip?: string | null;

  @Column({
    name: 'receiver_fiscal_regime_code',
    type: 'varchar',
    length: 3,
    nullable: true,
  })
  receiverFiscalRegimeCode?: string | null;

  @Column({ name: 'usage_code', type: 'varchar', length: 3, nullable: true })
  usageCode?: string | null;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 24,
    scale: 10,
    nullable: true,
  })
  exchangeRate?: string | null;

  @Column({ type: 'numeric', precision: 24, scale: 6 })
  subtotal: string;

  @Column({ type: 'numeric', precision: 24, scale: 6, nullable: true })
  discount?: string | null;

  @Column({ type: 'numeric', precision: 24, scale: 6 })
  total: string;

  @Column({ name: 'payment_form', type: 'varchar', length: 3, nullable: true })
  paymentForm?: string | null;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 3,
    nullable: true,
  })
  paymentMethod?: string | null;

  @Column({
    name: 'place_of_issue',
    type: 'varchar',
    length: 5,
    nullable: true,
  })
  placeOfIssue?: string | null;

  @Column({ name: 'export_code', type: 'varchar', length: 3, nullable: true })
  exportCode?: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
