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
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Role, RoleKey } from '../../permissions/entities/role.entity';

export const MembershipRole = RoleKey;
export type MembershipRole = RoleKey;

export enum MembershipStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REVOKED = 'revoked',
}

@Index('uq_memberships_organization_user', ['organizationId', 'userId'], {
  unique: true,
})
@Unique('uq_memberships_organization_id', ['organizationId', 'id'])
@Unique('uq_memberships_organization_id_user', [
  'organizationId',
  'id',
  'userId',
])
@ForeignKey('organizations', ['organizationId'], ['id'], {
  name: 'fk_memberships_organization',
  onDelete: 'RESTRICT',
})
@ForeignKey('users', ['userId'], ['id'], {
  name: 'fk_memberships_user',
  onDelete: 'RESTRICT',
})
@Check(
  'ck_memberships_transition_dates',
  `
    ("status" = 'pending' AND "joined_at" IS NULL AND "suspended_at" IS NULL AND "revoked_at" IS NULL)
    OR ("status" = 'active' AND "joined_at" IS NOT NULL AND "suspended_at" IS NULL AND "revoked_at" IS NULL)
    OR ("status" = 'suspended' AND "joined_at" IS NOT NULL AND "suspended_at" IS NOT NULL AND "revoked_at" IS NULL)
    OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
  `,
)
@Entity('memberships')
export class Membership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ type: 'enum', enum: MembershipStatus })
  status: MembershipStatus;

  @Column({ name: 'invited_at', type: 'timestamptz', nullable: true })
  invitedAt?: Date | null;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt?: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt?: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
