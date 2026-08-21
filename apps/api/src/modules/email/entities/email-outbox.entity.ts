import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum EmailOutboxStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SENT = 'sent',
  FAILED = 'failed',
}

@Index('idx_email_outbox_status_available_at', ['status', 'availableAt'])
@Entity('email_outbox')
export class EmailOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'token_id', type: 'uuid' })
  tokenId: string;

  @Column({ length: 80 })
  kind: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'enum', enum: EmailOutboxStatus })
  status: EmailOutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'available_at', type: 'timestamptz' })
  availableAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
