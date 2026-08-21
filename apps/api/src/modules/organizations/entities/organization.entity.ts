import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OrganizationStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
}

@Index('uq_organizations_slug', ['slug'], { unique: true })
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 160 })
  name: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 200, nullable: true })
  legalName?: string | null;

  @Column({ length: 100 })
  slug: string;

  @Column({
    name: 'billing_email',
    type: 'varchar',
    length: 320,
    nullable: true,
  })
  billingEmail?: string | null;

  @Column({ length: 64, default: 'America/Mexico_City' })
  timezone: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @Column({ type: 'enum', enum: OrganizationStatus })
  status: OrganizationStatus;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt?: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
