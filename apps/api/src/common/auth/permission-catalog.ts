import { RoleKey } from '../../modules/permissions/entities/role.entity';

export const PERMISSION_CATALOG = [
  'organization.view',
  'organization.manage',
  'ownership.manage',
  'billing.manage',
  'team.view',
  'team.manage',
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
  'cfdi.review',
  'cfdi.exclude',
  'period.close',
  'period.reopen',
  'exports.create',
  'obligations.view',
  'obligations.configure',
  'diot.generate',
  'ieps.generate',
  'audit.view',
  'support.authorize',
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number];

export const MFA_SENSITIVE_PERMISSION_KEYS = [
  'organization.manage',
  'ownership.manage',
  'billing.manage',
  'team.manage',
  'clients.assign',
  'fiscal_entities.manage',
  'credentials.manage',
  'sat.download',
  'period.close',
  'period.reopen',
  'exports.create',
  'support.authorize',
] as const satisfies readonly PermissionKey[];

export const PERMISSION_METADATA = {
  'organization.view': {
    name: 'Ver organización',
    description:
      'Consultar la información y configuración visible de la organización.',
  },
  'organization.manage': {
    name: 'Administrar organización',
    description: 'Modificar la configuración general de la organización.',
  },
  'ownership.manage': {
    name: 'Administrar titularidad',
    description: 'Transferir o administrar la titularidad de la organización.',
  },
  'billing.manage': {
    name: 'Administrar facturación',
    description: 'Consultar y administrar el plan y la facturación.',
  },
  'team.view': {
    name: 'Ver equipo',
    description:
      'Consultar los miembros y sus estados dentro de la organización.',
  },
  'team.manage': {
    name: 'Administrar equipo',
    description: 'Crear, actualizar, suspender o revocar miembros.',
  },
  'clients.view': {
    name: 'Ver clientes',
    description: 'Consultar las cuentas cliente asignadas a la organización.',
  },
  'clients.manage': {
    name: 'Administrar clientes',
    description: 'Crear, modificar y archivar cuentas cliente.',
  },
  'clients.assign': {
    name: 'Asignar clientes',
    description: 'Asignar cuentas cliente a miembros de la organización.',
  },
  'fiscal_entities.view': {
    name: 'Ver entidades fiscales',
    description: 'Consultar RFC y razones sociales de las cuentas asignadas.',
  },
  'fiscal_entities.manage': {
    name: 'Administrar entidades fiscales',
    description: 'Crear, modificar y archivar entidades fiscales.',
  },
  'fiscal_years.view': {
    name: 'Ver ejercicios fiscales',
    description: 'Consultar ejercicios y períodos de entidades autorizadas.',
  },
  'fiscal_years.manage': {
    name: 'Administrar ejercicios fiscales',
    description: 'Crear ejercicios fiscales y sus períodos mensuales.',
  },
  'credentials.manage': {
    name: 'Administrar credenciales',
    description: 'Configurar y administrar credenciales de servicios fiscales.',
  },
  'sat.download': {
    name: 'Descargar del SAT',
    description: 'Solicitar y descargar información fiscal del SAT.',
  },
  'payroll.view': {
    name: 'Ver nómina',
    description: 'Consultar información de comprobantes de nómina.',
  },
  'cfdi.review': {
    name: 'Revisar CFDI',
    description: 'Consultar y revisar comprobantes fiscales digitales.',
  },
  'cfdi.exclude': {
    name: 'Excluir CFDI',
    description: 'Excluir comprobantes del control mensual.',
  },
  'period.close': {
    name: 'Cerrar períodos',
    description: 'Cerrar un período contable o fiscal.',
  },
  'period.reopen': {
    name: 'Reabrir períodos',
    description: 'Reabrir un período previamente cerrado.',
  },
  'exports.create': {
    name: 'Crear exportaciones',
    description: 'Generar exportaciones de información autorizada.',
  },
  'obligations.view': {
    name: 'Ver obligaciones',
    description: 'Consultar obligaciones y su estado.',
  },
  'obligations.configure': {
    name: 'Configurar obligaciones',
    description: 'Configurar obligaciones y reglas operativas.',
  },
  'diot.generate': {
    name: 'Generar DIOT',
    description: 'Generar información para la declaración DIOT.',
  },
  'ieps.generate': {
    name: 'Generar IEPS',
    description: 'Generar información para procesos IEPS.',
  },
  'audit.view': {
    name: 'Ver auditoría',
    description: 'Consultar eventos de auditoría de la organización.',
  },
  'support.authorize': {
    name: 'Autorizar soporte',
    description: 'Autorizar acciones operativas de soporte.',
  },
} satisfies Record<PermissionKey, { name: string; description: string }>;

export const ROLE_PERMISSION_KEYS: Record<
  Exclude<RoleKey, 'admin'>,
  readonly (typeof PERMISSION_CATALOG)[number][]
> = {
  [RoleKey.OWNER]: PERMISSION_CATALOG,
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
    'cfdi.review',
    'cfdi.exclude',
    'period.close',
    'period.reopen',
    'exports.create',
    'obligations.view',
    'obligations.configure',
    'diot.generate',
    'ieps.generate',
    'audit.view',
  ],
  [RoleKey.COLLABORATOR]: [
    'organization.view',
    'clients.view',
    'fiscal_entities.view',
    'fiscal_years.view',
    'cfdi.review',
    'obligations.view',
  ],
};
