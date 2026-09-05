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
  { name: 'fk_cfdi_relations_cfdi', onDelete: 'RESTRICT' },
)
@Unique('uq_cfdi_relations_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_relations_parent_ordinal', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'cfdiId',
  'relationGroupOrdinal',
  'ordinal',
])
@Check(
  'ck_cfdi_relations_ordinals',
  'relation_group_ordinal > 0 AND ordinal > 0',
)
@Check('ck_cfdi_relations_type', "relation_type ~ '^[0-9]{2}$'")
@Index('ix_cfdi_relations_related_uuid', [
  'organizationId',
  'legalEntityId',
  'relatedUuid',
])
@Entity('cfdi_relations')
export class CfdiRelation {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid' }) cfdiId: string;
  @Column({ name: 'relation_group_ordinal', type: 'integer' })
  relationGroupOrdinal: number;
  @Column({ type: 'integer' }) ordinal: number;
  @Column({ name: 'relation_type', type: 'varchar', length: 2 })
  relationType: string;
  @Column({ name: 'related_uuid', type: 'uuid' }) relatedUuid: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
