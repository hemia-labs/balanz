import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum FiscalOperationType {
  SAT_DOWNLOAD = 'sat_download',
  EXPORT = 'export',
}

export enum FiscalOperationStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

@Check('fiscal_operations_type_chk', `"type" IN ('sat_download', 'export')`)
@Check(
  'fiscal_operations_status_chk',
  `"status" IN ('queued', 'processing', 'completed', 'failed', 'expired')`,
)
@Index('ix_fiscal_operations_status_expiry', ['status', 'expiresAt'])
@Index('ix_fiscal_operations_org_account', [
  'organizationId',
  'clientAccountId',
  'createdAt',
])
@ForeignKey(
  'client_accounts',
  ['organizationId', 'clientAccountId'],
  ['organizationId', 'id'],
  { name: 'fk_fiscal_operations_account', onDelete: 'RESTRICT' },
)
@ForeignKey(
  'memberships',
  ['organizationId', 'requestedByMembershipId'],
  ['organizationId', 'id'],
  { name: 'fk_fiscal_operations_membership', onDelete: 'RESTRICT' },
)
@ForeignKey('auth_sessions', ['sourceSessionId'], ['id'], {
  name: 'fk_fiscal_operations_session',
  onDelete: 'RESTRICT',
})
@Entity('fiscal_operations')
export class FiscalOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'requested_by_membership_id', type: 'uuid' })
  requestedByMembershipId: string;

  @Column({ name: 'source_session_id', type: 'uuid' })
  sourceSessionId: string;

  @Column({ type: 'varchar', length: 24 })
  type: FiscalOperationType;

  @Column({ type: 'varchar', length: 20 })
  status: FiscalOperationStatus;

  @Column({ type: 'jsonb', default: {} })
  request: Record<string, unknown>;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
