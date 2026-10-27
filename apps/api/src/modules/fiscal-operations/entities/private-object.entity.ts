import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PrivateObjectStatus {
  AVAILABLE = 'available',
  REVOKED = 'revoked',
}

@Check('private_objects_status_chk', `"status" IN ('available', 'revoked')`)
@Index('ix_private_objects_org_account', ['organizationId', 'clientAccountId'])
@ForeignKey(
  'client_accounts',
  ['organizationId', 'clientAccountId'],
  ['organizationId', 'id'],
  { name: 'fk_private_objects_account', onDelete: 'RESTRICT' },
)
@ForeignKey('permissions', ['permissionKey'], ['key'], {
  name: 'fk_private_objects_permission',
  onDelete: 'RESTRICT',
})
@Entity('private_objects')
export class PrivateObject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_account_id', type: 'uuid' })
  clientAccountId: string;

  @Column({ name: 'permission_key', type: 'varchar', length: 80 })
  permissionKey: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 1000 })
  storageKey: string;

  @Column({ type: 'varchar', length: 20 })
  status: PrivateObjectStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
