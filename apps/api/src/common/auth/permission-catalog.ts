import { RoleKey } from '../../modules/permissions/entities/role.entity';

export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export enum PermissionStatus {
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  DISABLED = 'disabled',
}

/**
 * Catálogo atómico acumulado del MVP. Los permisos de navegación/clientes ya
 * existían en develop; HU-P0-003 agrega el bloque sensible sin ligar claves a IDs.
 */
export const PERMISSION_CATALOG = [
  'organization.view',
  'organization.manage',
  'ownership.manage',
  'billing.manage',
  'team.view',
  'clients.view',
  'clients.manage',
  'clients.assign',
  'fiscal_entities.view',
  'fiscal_entities.manage',
  'fiscal_years.view',
  'fiscal_years.manage',
  'credentials.manage',
  'sat.download',
  'payroll.view',
  'cfdi.exclude',
  'exceptions.accept',
  'periods.close',
  'periods.reopen',
  'exports.generate',
  'support.authorize',
  'members.manage',
  'permissions.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number];

export interface PermissionDefinition {
  name: string;
  description: string;
  sensitive: boolean;
  requiresMfa: boolean;
  requiresReauthentication: boolean;
}

export const PERMISSION_METADATA = {
  'organization.view': {
    name: 'Ver organización',
    description: 'Consultar información visible de la organización.',
  },
  'organization.manage': {
    name: 'Administrar organización',
    description: 'Modificar la configuración general de la organización.',
  },
  'ownership.manage': {
    name: 'Administrar titularidad',
    description: 'Transferir o administrar la titularidad.',
  },
  'billing.manage': {
    name: 'Administrar facturación',
    description: 'Consultar y administrar plan y facturación.',
  },
  'team.view': {
    name: 'Ver equipo',
    description: 'Consultar miembros de la organización.',
  },
  'clients.view': {
    name: 'Ver clientes',
    description: 'Consultar cuentas cliente asignadas.',
  },
  'clients.manage': {
    name: 'Administrar clientes',
    description: 'Crear, modificar y archivar cuentas cliente.',
  },
  'clients.assign': {
    name: 'Asignar clientes',
    description: 'Asignar cuentas cliente a membresías.',
  },
  'fiscal_entities.view': {
    name: 'Ver entidades fiscales',
    description: 'Consultar entidades fiscales de cuentas asignadas.',
  },
  'fiscal_entities.manage': {
    name: 'Administrar entidades fiscales',
    description: 'Crear, modificar y archivar entidades fiscales.',
  },
  'fiscal_years.view': {
    name: 'Ver ejercicios fiscales',
    description: 'Consultar ejercicios y períodos autorizados.',
  },
  'fiscal_years.manage': {
    name: 'Administrar ejercicios fiscales',
    description: 'Crear ejercicios y períodos mensuales.',
  },
  'credentials.manage': {
    name: 'Administrar credenciales',
    description: 'Cargar, sustituir o revocar e.firma.',
  },
  'sat.download': {
    name: 'Solicitar descarga SAT',
    description: 'Solicitar una descarga de información fiscal del SAT.',
  },
  'payroll.view': {
    name: 'Consultar nómina',
    description: 'Consultar o exportar CFDI de nómina.',
  },
  'cfdi.exclude': {
    name: 'Excluir CFDI',
    description: 'Excluir o reincorporar un CFDI con motivo.',
  },
  'exceptions.accept': {
    name: 'Aceptar excepciones',
    description: 'Aceptar una excepción que permite continuar.',
  },
  'periods.close': {
    name: 'Cerrar períodos',
    description: 'Crear una versión cerrada de un período.',
  },
  'periods.reopen': {
    name: 'Reabrir períodos',
    description: 'Reabrir un período con motivo.',
  },
  'exports.generate': {
    name: 'Generar exportaciones',
    description: 'Generar archivos Excel, CSV o ZIP.',
  },
  'support.authorize': {
    name: 'Autorizar soporte',
    description: 'Conceder acceso temporal JIT a soporte.',
  },
  'members.manage': {
    name: 'Administrar miembros',
    description: 'Invitar, suspender, reactivar o revocar miembros.',
  },
  'permissions.manage': {
    name: 'Administrar permisos',
    description: 'Conceder o denegar permisos de otras membresías.',
  },
} satisfies Record<PermissionKey, { name: string; description: string }>;

const HU_P0_003_PERMISSION_KEYS = new Set<PermissionKey>([
  'credentials.manage',
  'sat.download',
  'payroll.view',
  'cfdi.exclude',
  'exceptions.accept',
  'periods.close',
  'periods.reopen',
  'exports.generate',
  'support.authorize',
  'members.manage',
  'permissions.manage',
]);

const LEGACY_MFA_PERMISSION_KEYS = new Set<PermissionKey>([
  'organization.manage',
  'ownership.manage',
  'billing.manage',
  'clients.assign',
  'fiscal_entities.manage',
]);

export const permissionDefinition = (
  key: PermissionKey,
): PermissionDefinition => {
  const huPermission = HU_P0_003_PERMISSION_KEYS.has(key);
  const requiresMfa = huPermission || LEGACY_MFA_PERMISSION_KEYS.has(key);
  return {
    ...PERMISSION_METADATA[key],
    sensitive: requiresMfa,
    requiresMfa,
    requiresReauthentication: huPermission,
  };
};

export const MFA_SENSITIVE_PERMISSION_KEYS = PERMISSION_CATALOG.filter(
  (key) => permissionDefinition(key).requiresMfa,
);

export const ROLE_PERMISSION_KEYS: Record<RoleKey, readonly PermissionKey[]> = {
  [RoleKey.ADMIN]: PERMISSION_CATALOG,
  [RoleKey.ACCOUNTANT]: [
    'organization.view',
    'team.view',
    'clients.view',
    'clients.manage',
    'clients.assign',
    'fiscal_entities.view',
    'fiscal_entities.manage',
    'fiscal_years.view',
    'fiscal_years.manage',
    'credentials.manage',
    'sat.download',
    'payroll.view',
    'cfdi.exclude',
    'exceptions.accept',
    'periods.close',
    'periods.reopen',
    'exports.generate',
  ],
  [RoleKey.COLLABORATOR]: [
    'organization.view',
    'clients.view',
    'fiscal_entities.view',
    'fiscal_years.view',
  ],
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (
    PERMISSION_KEY_PATTERN.test(value) &&
    (PERMISSION_CATALOG as readonly string[]).includes(value)
  );
}
