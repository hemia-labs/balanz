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
  { name: 'fk_cfdi_concepts_cfdi', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_concepts_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_concepts_parent_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
  'id',
])
@Unique('uq_cfdi_concepts_parent_ordinal', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
  'ordinal',
])
@Check('ck_cfdi_concepts_ordinal', 'ordinal > 0')
@Check('ck_cfdi_concepts_product_code', "product_service_code ~ '^[0-9]{8}$'")
@Check(
  'ck_cfdi_concepts_values',
  'quantity > 0 AND unit_value >= 0 AND amount >= 0 AND (discount IS NULL OR discount >= 0)',
)
@Check(
  'ck_cfdi_concepts_description',
  'description = btrim(description) AND char_length(description) BETWEEN 1 AND 1000',
)
@Index('ix_cfdi_concepts_parent', ['organizationId', 'cfdiId', 'ordinal'])
@Entity('cfdi_concepts')
export class CfdiConcept {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid' }) cfdiId: string;
  @Column({ type: 'integer' }) ordinal: number;
  @Column({ name: 'product_service_code', type: 'varchar', length: 8 })
  productServiceCode: string;
  @Column({
    name: 'identification_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  identificationNumber?: string | null;
  @Column({ type: 'numeric', precision: 24, scale: 6 }) quantity: string;
  @Column({ name: 'unit_code', type: 'varchar', length: 3, nullable: true })
  unitCode?: string | null;
  @Column({ name: 'unit_name', type: 'varchar', length: 100, nullable: true })
  unitName?: string | null;
  @Column({ type: 'varchar', length: 1000 }) description: string;
  @Column({ name: 'unit_value', type: 'numeric', precision: 24, scale: 6 })
  unitValue: string;
  @Column({ type: 'numeric', precision: 24, scale: 6 }) amount: string;
  @Column({ type: 'numeric', precision: 24, scale: 6, nullable: true })
  discount?: string | null;
  @Column({ name: 'tax_object_code', type: 'varchar', length: 3 })
  taxObjectCode: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
