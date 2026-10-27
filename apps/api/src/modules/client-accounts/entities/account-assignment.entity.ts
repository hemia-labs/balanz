import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
} from 'typeorm';

export enum AssignmentResponsibility {
  PRIMARY = 'primary',
  COLLABORATOR = 'collaborator',
  REVIEWER = 'reviewer',
}

export enum AccountAssignmentStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

@ForeignKey(
  'client_accounts',
  ['organizationId', 'clientAccountId'],
  ['organizationId', 'id'],
  { name: 'fk_account_assignments_account', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'membershipId'],
  ['organizationId', 'id'],
  { name: 'fk_account_assignments_membership', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'assignedByMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_account_assignments_assigned_by', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'revokedByMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_account_assignments_revoked_by', onDelete: 'RESTRICT' },
)
@Check(
  'ck_account_assignments_revoke_state',
  "(status = 'active' AND revoked_at IS NULL AND revoked_by_membership_id IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_membership_id IS NOT NULL)",
)
@Index(
  'uq_account_assignments_active_member',
  ['organizationId', 'clientAccountId', 'membershipId'],
  { unique: true, where: "status = 'active'" },
)
@Index(
  'uq_account_assignments_active_primary',
  ['organizationId', 'clientAccountId'],
  {
    unique: true,
    where: "status = 'active' AND responsibility = 'primary'",
  },
)
@Index('ix_account_assignments_membership_status', [
  'organizationId',
  'membershipId',
  'status',
])
@Index('ix_account_assignments_account_status', [
  'organizationId',
  'clientAccountId',
  'status',
])
@Entity('account_assignments')
export class AccountAssignment {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @Column({ type: 'enum', enum: AssignmentResponsibility })
  responsibility: AssignmentResponsibility;

  @Column({
    type: 'enum',
    enum: AccountAssignmentStatus,
    default: AccountAssignmentStatus.ACTIVE,
  })
  status: AccountAssignmentStatus;

  @Column({ name: 'assigned_by_membership_id', type: 'uuid' })
  assignedByMembershipId: string;

  @Column({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @Column({ name: 'revoked_by_membership_id', type: 'uuid', nullable: true })
  revokedByMembershipId?: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
