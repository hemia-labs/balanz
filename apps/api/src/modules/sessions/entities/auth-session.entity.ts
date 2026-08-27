import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AuthSessionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Index('uq_auth_sessions_token_hash', ['sessionTokenHash'], { unique: true })
@Index('idx_auth_sessions_user_status', ['userId', 'status', 'expiresAt'])
@Index('idx_auth_sessions_membership_status', [
  'organizationId',
  'membershipId',
  'status',
  'expiresAt',
])
@Check(
  'ck_auth_sessions_tenant_context',
  '(organization_id IS NULL AND membership_id IS NULL) OR (organization_id IS NOT NULL AND membership_id IS NOT NULL)',
)
@ForeignKey('users', ['userId'], ['id'], {
  name: 'fk_auth_sessions_user',
  onDelete: 'RESTRICT',
})
@ForeignKey(
  'memberships',
  ['organizationId', 'membershipId'],
  ['organizationId', 'id'],
  { name: 'fk_auth_sessions_membership_tenant', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'membershipId', 'userId'],
  ['organizationId', 'id', 'userId'],
  { name: 'fk_auth_sessions_membership_identity', onDelete: 'RESTRICT' },
)
@Entity('auth_sessions')
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_token_hash', length: 64 })
  sessionTokenHash: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'membership_id', type: 'uuid', nullable: true })
  membershipId?: string | null;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Column({ type: 'enum', enum: AuthSessionStatus })
  status: AuthSessionStatus;

  @Column({ name: 'mfa_verified_at', type: 'timestamptz', nullable: true })
  mfaVerifiedAt?: Date | null;

  @Column({ name: 'requires_mfa', default: false })
  requiresMfa: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'last_activity_at', type: 'timestamptz' })
  lastActivityAt: Date;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent?: string | null;

  @Column({
    name: 'revoked_reason',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  revokedReason?: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
