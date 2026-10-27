import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AuthFactorStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

@Index('idx_auth_factors_user_status', ['userId', 'status'])
@Index('uq_auth_factors_user_current', ['userId'], {
  unique: true,
  where: "status IN ('pending', 'active')",
})
@ForeignKey('users', ['userId'], ['id'], {
  name: 'fk_auth_factors_user',
  onDelete: 'RESTRICT',
})
@Entity('auth_factors')
export class AuthFactor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'secret_encrypted', type: 'text' })
  secretEncrypted: string;

  @Column({ type: 'enum', enum: AuthFactorStatus })
  status: AuthFactorStatus;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ name: 'last_used_counter', type: 'bigint', nullable: true })
  lastUsedCounter?: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
