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
  ['organizationId', 'clientAccountId', 'legalEntityId', 'cfdiId', 'objectId'],
  [
    'organizationId',
    'clientAccountId',
    'legalEntityId',
    'id',
    'sourceObjectId',
  ],
  { name: 'fk_cfdi_access_grants_source', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'membershipId'],
  ['organizationId', 'id'],
  { name: 'fk_cfdi_access_grants_membership', onDelete: 'RESTRICT' },
)
@ForeignKey('auth_sessions', ['sessionId'], ['id'], {
  name: 'fk_cfdi_access_grants_session',
  onDelete: 'RESTRICT',
})
@Unique('uq_cfdi_access_grants_scope_id', [
  'organizationId',
  'clientAccountId',
  'legalEntityId',
  'id',
])
@Unique('uq_cfdi_access_grants_token_hash', ['tokenHash'])
@Check('ck_cfdi_access_grants_hash', "token_hash ~ '^[0-9a-f]{64}$'")
@Check('ck_cfdi_access_grants_expiry', 'expires_at > created_at')
@Check(
  'ck_cfdi_access_grants_usage',
  'used_at IS NULL OR (used_at >= created_at AND used_at <= expires_at)',
)
@Index('ix_cfdi_access_grants_expiry', ['expiresAt', 'usedAt', 'id'])
@Index('ix_cfdi_access_grants_subject', [
  'organizationId',
  'membershipId',
  'sessionId',
  'cfdiId',
  'createdAt',
])
@Entity('cfdi_access_grants')
export class CfdiAccessGrant {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'client_account_id', type: 'uuid' }) clientAccountId: string;
  @Column({ name: 'legal_entity_id', type: 'uuid' }) legalEntityId: string;
  @Column({ name: 'cfdi_id', type: 'uuid' }) cfdiId: string;
  @Column({ name: 'object_id', type: 'uuid' }) objectId: string;
  @Column({ name: 'membership_id', type: 'uuid' }) membershipId: string;
  @Column({ name: 'session_id', type: 'uuid' }) sessionId: string;
  @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt?: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
