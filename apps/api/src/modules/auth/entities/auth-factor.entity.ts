import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AuthFactorStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

@Index('uq_auth_factors_provider_ref', ['provider', 'providerFactorRef'], {
  unique: true,
})
@Index('idx_auth_factors_user_status', ['userId', 'status'])
@Entity('auth_factors')
export class AuthFactor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ length: 40 })
  provider: string;

  @Column({ name: 'provider_factor_ref', length: 255 })
  providerFactorRef: string;

  @Column({ name: 'factor_type', length: 24 })
  factorType: string;

  @Column({ type: 'enum', enum: AuthFactorStatus })
  status: AuthFactorStatus;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
