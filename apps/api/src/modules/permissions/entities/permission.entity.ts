import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PermissionStatus } from '../../../common/auth/permission-catalog';

@Check(
  'permissions_key_format_chk',
  `"key" ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$'`,
)
@Check(
  'permissions_status_chk',
  `"status" IN ('active', 'deprecated', 'disabled')`,
)
@Index('uq_permissions_key', ['key'], { unique: true })
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 80 })
  key: string;

  @Column({ length: 160 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ default: false })
  sensitive: boolean;

  @Column({ name: 'requires_mfa', default: false })
  requiresMfa: boolean;

  @Column({ name: 'requires_reauthentication', default: false })
  requiresReauthentication: boolean;

  @Column({ type: 'varchar', length: 20, default: PermissionStatus.ACTIVE })
  status: PermissionStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
