import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum ClientAccountStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

@ForeignKey('organizations', ['organizationId'], ['id'], {
  name: 'fk_client_accounts_organization',
  onDelete: 'RESTRICT',
})
@Unique('uq_client_accounts_org_id', ['organizationId', 'id'])
@Check(
  'ck_client_accounts_name',
  'name = btrim(name) AND char_length(name) BETWEEN 1 AND 160',
)
@Check(
  'ck_client_accounts_archive_state',
  "(status = 'archived' AND archived_at IS NOT NULL) OR (status <> 'archived' AND archived_at IS NULL)",
)
@Index('uq_client_accounts_active_code', { synchronize: false })
@Index('ix_client_accounts_name_search', { synchronize: false })
@Index('ix_client_accounts_name_trgm', { synchronize: false })
@Index('ix_client_accounts_code_trgm', { synchronize: false })
@Index('ix_client_accounts_org_status_updated', [
  'organizationId',
  'status',
  'updatedAt',
  'id',
])
@Entity('client_accounts')
export class ClientAccount {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  code?: string | null;

  @Column({
    type: 'enum',
    enum: ClientAccountStatus,
    default: ClientAccountStatus.ACTIVE,
  })
  status: ClientAccountStatus;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
