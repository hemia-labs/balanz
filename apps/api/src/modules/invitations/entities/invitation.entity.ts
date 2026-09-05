import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../permissions/entities/role.entity';

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Index('uq_invitations_token_hash', ['tokenHash'], { unique: true })
@Index('ix_invitations_organization_status_expires', [
  'organizationId',
  'status',
  'expiresAt',
])
@Index(
  'uq_invitations_pending_recipient',
  ['organizationId', 'emailNormalized'],
  {
    unique: true,
    where: `"status" = 'pending'`,
  },
)
@ForeignKey('organizations', ['organizationId'], ['id'], {
  name: 'fk_invitations_organization',
  onDelete: 'RESTRICT',
})
@ForeignKey('users', ['userId'], ['id'], {
  name: 'fk_invitations_user',
  onDelete: 'RESTRICT',
})
@ForeignKey(
  'memberships',
  ['organizationId', 'invitedByMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_invitations_inviter_tenant', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'acceptedMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_invitations_accepted_membership_tenant', onDelete: 'RESTRICT' },
)
@Check(
  'ck_invitations_email_normalized',
  `"email_normalized" = lower(btrim("email"))`,
)
@Check('ck_invitations_send_count', `"send_count" >= 1`)
@Check(
  'ck_invitations_proposed_permissions_array',
  `jsonb_typeof("proposed_permissions") = 'array'`,
)
@Check('ck_invitations_expiration', `"expires_at" > "created_at"`)
@Check(
  'ck_invitations_transition_dates',
  `
    ("status" = 'pending' AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "accepted_membership_id" IS NULL)
    OR ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "revoked_at" IS NULL AND "accepted_membership_id" IS NOT NULL)
    OR ("status" = 'expired' AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "accepted_membership_id" IS NULL)
    OR ("status" = 'revoked' AND "accepted_at" IS NULL AND "revoked_at" IS NOT NULL AND "accepted_membership_id" IS NULL)
  `,
)
@Entity('invitations')
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ name: 'email_normalized', type: 'varchar', length: 320 })
  emailNormalized: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'role_id',
    foreignKeyConstraintName: 'fk_invitations_role',
  })
  role: Role;

  @Column({ name: 'proposed_permissions', type: 'jsonb', default: [] })
  proposedPermissions: string[];

  @Column({ name: 'token_hash', type: 'varchar', length: 64, select: false })
  tokenHash: string;

  @Column({
    type: 'enum',
    enum: InvitationStatus,
    default: InvitationStatus.PENDING,
  })
  status: InvitationStatus;

  @Column({ name: 'invited_by_membership_id', type: 'uuid' })
  invitedByMembershipId: string;

  @Column({ name: 'accepted_membership_id', type: 'uuid', nullable: true })
  acceptedMembershipId?: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'last_sent_at', type: 'timestamptz' })
  lastSentAt: Date;

  @Column({ name: 'send_count', type: 'integer', default: 1 })
  sendCount: number;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt?: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
