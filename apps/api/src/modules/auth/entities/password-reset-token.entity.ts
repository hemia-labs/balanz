import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('uq_password_reset_tokens_hash', ['tokenHash'], { unique: true })
@Index('idx_password_reset_tokens_user_expires', ['userId', 'expiresAt'])
@Index('idx_password_reset_tokens_expires_at', ['expiresAt'])
@Index('idx_password_reset_tokens_used_at', ['usedAt'])
@ForeignKey('users', ['userId'], ['id'], {
  name: 'fk_password_reset_tokens_user',
  onDelete: 'RESTRICT',
})
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'token_hash', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
