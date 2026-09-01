import { MigrationInterface, QueryRunner } from 'typeorm';

const ACTIVE_PERMISSION_KEYS = [
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

const ACCOUNTANT_PERMISSION_KEYS = [
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
] as const;

const COLLABORATOR_PERMISSION_KEYS = [
  'organization.view',
  'clients.view',
  'fiscal_entities.view',
  'fiscal_years.view',
] as const;

const LEGACY_PERMISSION_KEYS = [
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

const LEGACY_ACCOUNTANT_PERMISSION_KEYS = [
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
] as const;

const LEGACY_COLLABORATOR_PERMISSION_KEYS = [
  'organization.view',
  'clients.view',
  'fiscal_entities.view',
  'fiscal_years.view',
  'cfdi.review',
  'obligations.view',
] as const;

const sqlList = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ');

export class AuthorizationModel1787690050000 implements MigrationInterface {
  name = 'AuthorizationModel1787690050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // El rol histórico owner conserva su UUID y pasa a ser el admin del tenant.
    await queryRunner.query(`
      UPDATE memberships m SET role_id = owner_role.id
      FROM roles legacy_admin, roles owner_role
      WHERE m.role_id = legacy_admin.id AND legacy_admin.key = 'admin'
        AND owner_role.key = 'owner';
      DELETE FROM role_permissions rp USING roles r
      WHERE rp.role_id = r.id AND r.key IN ('owner', 'admin');
      DELETE FROM roles WHERE key = 'admin'
        AND EXISTS (SELECT 1 FROM roles WHERE key = 'owner');
      UPDATE roles SET key = 'admin' WHERE key = 'owner';
      INSERT INTO roles (id, key, name, description, scope) VALUES
        (uuid_generate_v4(), 'admin', 'Administrador', 'Administración de la organización.', 'organization'),
        (uuid_generate_v4(), 'accountant', 'Contador', 'Operación contable dentro de la organización.', 'organization'),
        (uuid_generate_v4(), 'collaborator', 'Colaborador', 'Consulta y colaboración dentro de la organización.', 'organization')
      ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name,
        description = EXCLUDED.description, scope = EXCLUDED.scope;
      ALTER TABLE roles ADD CONSTRAINT roles_key_chk
        CHECK (key IN ('admin', 'accountant', 'collaborator'));
    `);

    await queryRunner.query(`
      ALTER TABLE permissions ADD COLUMN sensitive boolean NOT NULL DEFAULT false;
      ALTER TABLE permissions ADD COLUMN requires_mfa boolean NOT NULL DEFAULT false;
      ALTER TABLE permissions ADD COLUMN requires_reauthentication boolean NOT NULL DEFAULT false;
      ALTER TABLE permissions ADD COLUMN status varchar(20) NOT NULL DEFAULT 'active';
      ALTER TABLE permissions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE permissions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE permissions ADD CONSTRAINT permissions_key_format_chk
        CHECK (key ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$');
      ALTER TABLE permissions ADD CONSTRAINT permissions_status_chk
        CHECK (status IN ('active', 'deprecated', 'disabled'));
      UPDATE permissions SET key = 'periods.close' WHERE key = 'period.close'
        AND NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'periods.close');
      UPDATE permissions SET key = 'periods.reopen' WHERE key = 'period.reopen'
        AND NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'periods.reopen');
      UPDATE permissions SET key = 'exports.generate' WHERE key = 'exports.create'
        AND NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'exports.generate');
      UPDATE permissions SET key = 'members.manage' WHERE key = 'team.manage'
        AND NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'members.manage');
      INSERT INTO permissions (id, key, name, description, sensitive,
        requires_mfa, requires_reauthentication, status) VALUES
        (uuid_generate_v4(), 'credentials.manage', 'Administrar credenciales', 'Cargar, sustituir o revocar e.firma.', true, true, true, 'active'),
        (uuid_generate_v4(), 'sat.download', 'Solicitar descarga SAT', 'Solicitar una descarga de información fiscal del SAT.', true, true, true, 'active'),
        (uuid_generate_v4(), 'payroll.view', 'Consultar nómina', 'Consultar o exportar CFDI de nómina.', true, true, true, 'active'),
        (uuid_generate_v4(), 'cfdi.exclude', 'Excluir CFDI', 'Excluir o reincorporar un CFDI con motivo.', true, true, true, 'active'),
        (uuid_generate_v4(), 'exceptions.accept', 'Aceptar excepciones', 'Aceptar una excepción que permite continuar.', true, true, true, 'active'),
        (uuid_generate_v4(), 'periods.close', 'Cerrar períodos', 'Crear una versión cerrada de un período.', true, true, true, 'active'),
        (uuid_generate_v4(), 'periods.reopen', 'Reabrir períodos', 'Reabrir un período con motivo.', true, true, true, 'active'),
        (uuid_generate_v4(), 'exports.generate', 'Generar exportaciones', 'Generar archivos Excel, CSV o ZIP.', true, true, true, 'active'),
        (uuid_generate_v4(), 'support.authorize', 'Autorizar soporte', 'Conceder acceso temporal JIT a soporte.', true, true, true, 'active'),
        (uuid_generate_v4(), 'members.manage', 'Administrar miembros', 'Invitar, suspender, reactivar o revocar miembros.', true, true, true, 'active'),
        (uuid_generate_v4(), 'permissions.manage', 'Administrar permisos', 'Conceder o denegar permisos de otras membresías.', true, true, true, 'active')
      ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name,
        description = EXCLUDED.description, sensitive = EXCLUDED.sensitive,
        requires_mfa = EXCLUDED.requires_mfa,
        requires_reauthentication = EXCLUDED.requires_reauthentication,
        status = 'active', updated_at = now();
      UPDATE permissions SET status = 'deprecated', updated_at = now()
      WHERE key NOT IN (${sqlList(ACTIVE_PERMISSION_KEYS)});
    `);

    await queryRunner.query(`
      ALTER TABLE role_permissions ADD COLUMN enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE role_permissions ADD COLUMN valid_from timestamptz;
      ALTER TABLE role_permissions ADD COLUMN valid_until timestamptz;
      ALTER TABLE role_permissions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE role_permissions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_validity_chk
        CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from);
      DELETE FROM role_permissions;
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.key = 'admin' AND p.status = 'active';
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.key = 'accountant' AND p.key IN (${sqlList(ACCOUNTANT_PERMISSION_KEYS)});
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.key = 'collaborator' AND p.key IN (${sqlList(COLLABORATOR_PERMISSION_KEYS)});
    `);

    await queryRunner.query(`
      CREATE TABLE membership_permissions (
        id uuid NOT NULL DEFAULT uuid_generate_v4(), organization_id uuid NOT NULL,
        membership_id uuid NOT NULL, permission_id uuid NOT NULL,
        effect varchar(10) NOT NULL, granted_by_membership_id uuid NOT NULL,
        granted_at timestamptz NOT NULL, revoked_by_membership_id uuid,
        revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT membership_permissions_pkey PRIMARY KEY (id),
        CONSTRAINT membership_permissions_effect_chk CHECK (effect IN ('grant', 'deny')),
        CONSTRAINT membership_permissions_permission_fk FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE RESTRICT,
        CONSTRAINT membership_permissions_target_fk FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT membership_permissions_actor_fk FOREIGN KEY (organization_id, granted_by_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT membership_permissions_revoker_fk FOREIGN KEY (organization_id, revoked_by_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX uq_membership_permissions_active ON membership_permissions
        (organization_id, membership_id, permission_id) WHERE revoked_at IS NULL;
      CREATE INDEX membership_permissions_membership_idx ON membership_permissions
        (organization_id, membership_id, revoked_at);
      CREATE INDEX membership_permissions_permission_idx ON membership_permissions
        (organization_id, permission_id, revoked_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE membership_permissions`);
    await queryRunner.query(`
      DELETE FROM role_permissions;
      ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_validity_chk;
      ALTER TABLE role_permissions DROP COLUMN updated_at;
      ALTER TABLE role_permissions DROP COLUMN created_at;
      ALTER TABLE role_permissions DROP COLUMN valid_until;
      ALTER TABLE role_permissions DROP COLUMN valid_from;
      ALTER TABLE role_permissions DROP COLUMN enabled;
      ALTER TABLE roles DROP CONSTRAINT roles_key_chk;
      UPDATE roles SET key = 'owner', name = 'Titular',
        description = 'Control total de una organización.', scope = 'organization'
      WHERE key = 'admin';
      UPDATE roles SET name = 'Contador responsable',
        description = 'Acceso operativo contable dentro de una organización.',
        scope = 'organization' WHERE key = 'accountant';
      UPDATE roles SET name = 'Colaborador',
        description = 'Acceso básico de consulta y revisión.',
        scope = 'organization' WHERE key = 'collaborator';
      INSERT INTO roles (id, key, name, description, scope) VALUES
        (uuid_generate_v4(), 'admin', 'Administrador de plataforma',
         'Administración interna de la plataforma fuera de tenants.', 'platform')
      ON CONFLICT (key) DO NOTHING;

      DELETE FROM permissions WHERE key = 'periods.close'
        AND EXISTS (SELECT 1 FROM permissions WHERE key = 'period.close');
      UPDATE permissions SET key = 'period.close', name = 'Cerrar períodos',
        description = 'Cerrar un período contable o fiscal.'
      WHERE key = 'periods.close';
      DELETE FROM permissions WHERE key = 'periods.reopen'
        AND EXISTS (SELECT 1 FROM permissions WHERE key = 'period.reopen');
      UPDATE permissions SET key = 'period.reopen', name = 'Reabrir períodos',
        description = 'Reabrir un período previamente cerrado.'
      WHERE key = 'periods.reopen';
      DELETE FROM permissions WHERE key = 'exports.generate'
        AND EXISTS (SELECT 1 FROM permissions WHERE key = 'exports.create');
      UPDATE permissions SET key = 'exports.create', name = 'Crear exportaciones',
        description = 'Generar exportaciones de información autorizada.'
      WHERE key = 'exports.generate';
      DELETE FROM permissions WHERE key = 'members.manage'
        AND EXISTS (SELECT 1 FROM permissions WHERE key = 'team.manage');
      UPDATE permissions SET key = 'team.manage', name = 'Administrar equipo',
        description = 'Crear, actualizar, suspender o revocar miembros.'
      WHERE key = 'members.manage';
      DELETE FROM permissions
      WHERE key NOT IN (${sqlList(LEGACY_PERMISSION_KEYS)});
      INSERT INTO permissions (id, key, name, description) VALUES
        (uuid_generate_v4(), 'cfdi.review', 'Revisar CFDI', 'Consultar y revisar comprobantes fiscales digitales.'),
        (uuid_generate_v4(), 'obligations.view', 'Ver obligaciones', 'Consultar obligaciones y su estado.'),
        (uuid_generate_v4(), 'obligations.configure', 'Configurar obligaciones', 'Configurar obligaciones y reglas operativas.'),
        (uuid_generate_v4(), 'diot.generate', 'Generar DIOT', 'Generar información para la declaración DIOT.'),
        (uuid_generate_v4(), 'ieps.generate', 'Generar IEPS', 'Generar información para procesos IEPS.'),
        (uuid_generate_v4(), 'audit.view', 'Ver auditoría', 'Consultar eventos de auditoría de la organización.')
      ON CONFLICT (key) DO NOTHING;

      ALTER TABLE permissions DROP CONSTRAINT permissions_status_chk;
      ALTER TABLE permissions DROP CONSTRAINT permissions_key_format_chk;
      ALTER TABLE permissions DROP COLUMN updated_at;
      ALTER TABLE permissions DROP COLUMN created_at;
      ALTER TABLE permissions DROP COLUMN status;
      ALTER TABLE permissions DROP COLUMN requires_reauthentication;
      ALTER TABLE permissions DROP COLUMN requires_mfa;
      ALTER TABLE permissions DROP COLUMN sensitive;

      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.key = 'owner' AND p.key IN (${sqlList(LEGACY_PERMISSION_KEYS)});
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.key = 'accountant'
        AND p.key IN (${sqlList(LEGACY_ACCOUNTANT_PERMISSION_KEYS)});
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.key = 'collaborator'
        AND p.key IN (${sqlList(LEGACY_COLLABORATOR_PERMISSION_KEYS)});
    `);
  }
}
