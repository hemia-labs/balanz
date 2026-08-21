import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Index('uq_auth_rate_limits_scope_key', ['scope', 'keyHash'], {
  unique: true,
})
@Index('idx_auth_rate_limits_expiry', ['expiresAt'])
@Entity('auth_rate_limits')
export class AuthRateLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 40 })
  scope: string;

  @Column({ name: 'key_hash', length: 64 })
  keyHash: string;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'window_started_at', type: 'timestamptz' })
  windowStartedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
