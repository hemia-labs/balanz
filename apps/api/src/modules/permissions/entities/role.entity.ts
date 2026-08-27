import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum RoleKey {
  ADMIN = 'admin',
  ACCOUNTANT = 'accountant',
  COLLABORATOR = 'collaborator',
}

export const ROLE_KEYS = Object.values(RoleKey) as readonly RoleKey[];

export enum RoleScope {
  ORGANIZATION = 'organization',
}

export const ROLE_DEFINITIONS: ReadonlyArray<{
  key: RoleKey;
  name: string;
  description: string;
  scope: RoleScope;
}> = [
  {
    key: RoleKey.ADMIN,
    name: 'Administrador',
    description: 'Administración del tenant, equipo, seguridad y políticas.',
    scope: RoleScope.ORGANIZATION,
  },
  {
    key: RoleKey.ACCOUNTANT,
    name: 'Contador',
    description: 'Operación fiscal de las cuentas cliente asignadas.',
    scope: RoleScope.ORGANIZATION,
  },
  {
    key: RoleKey.COLLABORATOR,
    name: 'Colaborador',
    description: 'Preparación y revisión de cuentas cliente asignadas.',
    scope: RoleScope.ORGANIZATION,
  },
];

@Check(
  'roles_key_chk',
  `"key" IN ('admin', 'accountant', 'collaborator')`,
)
@Index('uq_roles_key', ['key'], { unique: true })
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  key: RoleKey;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 20 })
  scope: RoleScope;
}
