import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('uq_email_verification_tokens_hash', ['tokenHash'], { unique: true })
@Index('idx_email_verification_tokens_user_expires', ['userId', 'expiresAt'])
@ForeignKey('users', ['userId'], ['id'], {
  name: 'fk_email_verification_tokens_user',
  onDelete: 'RESTRICT',
})
@Entity('email_verification_tokens')
export class EmailVerificationToken {
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
