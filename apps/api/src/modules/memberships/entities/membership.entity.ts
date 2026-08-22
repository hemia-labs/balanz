import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum MembershipRole {
  OWNER = 'owner',
  ACCOUNTANT = 'accountant',
  COLLABORATOR = 'collaborator',
}

export enum MembershipStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REVOKED = 'revoked',
}

@Index('uq_memberships_organization_user', ['organizationId', 'userId'], {
  unique: true,
})
@Entity('memberships')
export class Membership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: MembershipRole })
  role: MembershipRole;

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
