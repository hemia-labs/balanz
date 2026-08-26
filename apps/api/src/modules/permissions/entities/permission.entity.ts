import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

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
}
