import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('uq_object_access_grants_token_hash', ['tokenHash'], { unique: true })
@Index('ix_object_access_grants_expiry', ['expiresAt', 'usedAt'])
@ForeignKey('private_objects', ['objectId'], ['id'], {
  name: 'fk_object_access_grants_object',
  onDelete: 'CASCADE',
})
@ForeignKey('auth_sessions', ['sessionId'], ['id'], {
  name: 'fk_object_access_grants_session',
  onDelete: 'CASCADE',
})
@ForeignKey(
  'memberships',
  ['organizationId', 'membershipId'],
  ['organizationId', 'id'],
  { name: 'fk_object_access_grants_membership', onDelete: 'CASCADE' },
)
@Entity('object_access_grants')
export class ObjectAccessGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'object_id', type: 'uuid' })
  objectId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
