import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const RoleKey = {
  OWNER: 'owner',
  ACCOUNTANT: 'accountant',
  COLLABORATOR: 'collaborator',
  ADMIN: 'admin',
} as const;

export type RoleKey = (typeof RoleKey)[keyof typeof RoleKey];

export const RoleScope = {
  ORGANIZATION: 'organization',
  PLATFORM: 'platform',
} as const;

export type RoleScope = (typeof RoleScope)[keyof typeof RoleScope];

export const ROLE_DEFINITIONS: ReadonlyArray<{
  key: RoleKey;
  name: string;
  description: string;
  scope: RoleScope;
}> = [
  {
    key: RoleKey.OWNER,
    name: 'Titular',
    description: 'Control total de una organización.',
    scope: RoleScope.ORGANIZATION,
  },
  {
    key: RoleKey.ACCOUNTANT,
    name: 'Contador responsable',
    description: 'Acceso operativo contable dentro de una organización.',
    scope: RoleScope.ORGANIZATION,
  },
  {
    key: RoleKey.COLLABORATOR,
    name: 'Colaborador',
    description: 'Acceso básico de consulta y revisión.',
    scope: RoleScope.ORGANIZATION,
  },
  {
    key: RoleKey.ADMIN,
    name: 'Administrador de plataforma',
    description: 'Administración interna de la plataforma fuera de tenants.',
    scope: RoleScope.PLATFORM,
  },
];

@Index('uq_roles_key', ['key'], { unique: true })
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  key: RoleKey;

  @Column({ length: 160 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ length: 20 })
  scope: RoleScope;
}
