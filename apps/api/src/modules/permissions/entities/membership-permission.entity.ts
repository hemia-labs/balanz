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
import { Membership } from '../../memberships/entities/membership.entity';
import { Permission } from './permission.entity';

export enum PermissionEffect {
  GRANT = 'grant',
  DENY = 'deny',
}

@Check('membership_permissions_effect_chk', `"effect" IN ('grant', 'deny')`)
@ForeignKey('permissions', ['permissionId'], ['id'], {
  name: 'membership_permissions_permission_fk',
  onDelete: 'RESTRICT',
})
@ForeignKey(
  'memberships',
  ['organizationId', 'membershipId'],
  ['organizationId', 'id'],
  { name: 'membership_permissions_target_fk', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'grantedByMembershipId'],
  ['organizationId', 'id'],
  { name: 'membership_permissions_actor_fk', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'revokedByMembershipId'],
  ['organizationId', 'id'],
  { name: 'membership_permissions_revoker_fk', onDelete: 'RESTRICT' },
)
@Index(
  'uq_membership_permissions_active',
  ['organizationId', 'membershipId', 'permissionId'],
  { unique: true, where: 'revoked_at IS NULL' },
)
@Index('membership_permissions_membership_idx', [
  'organizationId',
  'membershipId',
  'revokedAt',
])
@Index('membership_permissions_permission_idx', [
  'organizationId',
  'permissionId',
  'revokedAt',
])
@Entity('membership_permissions')
export class MembershipPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @Column({ name: 'permission_id', type: 'uuid' })
  permissionId: string;

  @Column({ type: 'varchar', length: 10 })
  effect: PermissionEffect;

  @Column({ name: 'granted_by_membership_id', type: 'uuid' })
  grantedByMembershipId: string;

  @Column({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;

  @Column({ name: 'revoked_by_membership_id', type: 'uuid', nullable: true })
  revokedByMembershipId?: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Membership, { createForeignKeyConstraints: false })
  @JoinColumn([
    { name: 'organization_id', referencedColumnName: 'organizationId' },
    { name: 'membership_id', referencedColumnName: 'id' },
  ])
  membership: Membership;

  @ManyToOne(() => Permission, {
    eager: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;
}
