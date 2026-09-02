import { DataSource } from 'typeorm';
import { resolveScriptDatabaseOptions } from './script-database-options';

const REQUIRED_BASE_RELATIONS = [
  'organizations',
  'memberships',
  'client_accounts',
  'legal_entities',
  'audit_events',
] as const;
const FOUNDATION_RELATIONS = [
  'stored_objects',
  'ingestion_uploads',
  'ingestion_jobs',
  'ingestion_items',
] as const;
const FISCAL_MIGRATION_IDENTITIES = new Map([
  ['1787690600000', 'FiscalIngestionFoundation1787690600000'],
  ['1787690610000', 'FiscalRlsWorkerClaims1787690610000'],
]);

interface DatabaseIdentityRow {
  database: string;
  migrator: string;
  readOnly: boolean;
  serverVersionNumber: number;
  superuser: boolean;
  createRole: boolean;
  ownsCurrentDatabase: boolean;
  ownsPublicSchema: boolean;
  ownsRequiredRelations: boolean;
  existingFiscalOwnerRoles: number;
}

async function preflightFiscalFoundation(): Promise<void> {
  assertSafeEnvironment();
  const options = await resolveScriptDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('CFDI Phase 0 preflight requires PostgreSQL');
  }

  const dataSource = new DataSource({ ...options, logging: false });
  try {
    await dataSource.initialize();
    const [identity] = await dataSource.query<DatabaseIdentityRow[]>(`
      SELECT
        current_database() AS database,
        current_user AS migrator,
        current_setting('transaction_read_only') = 'on' AS "readOnly",
        current_setting('server_version_num')::integer AS "serverVersionNumber",
        runtime_role.rolsuper AS superuser,
        runtime_role.rolcreaterole AS "createRole",
        pg_has_role(runtime_role.oid, database.datdba, 'USAGE')
          AS "ownsCurrentDatabase",
        pg_has_role(runtime_role.oid, public_schema.nspowner, 'USAGE')
          AS "ownsPublicSchema",
        NOT EXISTS (
          SELECT 1
          FROM pg_class AS relation
          INNER JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relname IN (
              'migrations', 'organizations', 'memberships',
              'client_accounts', 'legal_entities', 'audit_events',
              'stored_objects', 'ingestion_uploads',
              'ingestion_jobs', 'ingestion_items'
            )
            AND NOT pg_has_role(runtime_role.oid, relation.relowner, 'USAGE')
        ) AS "ownsRequiredRelations",
        (
          SELECT count(*)::integer
          FROM pg_roles AS fixed_owner
          WHERE fixed_owner.rolname IN (
            'balanz_fiscal_owner',
            'balanz_fiscal_cancel_owner',
            'balanz_fiscal_claim_owner',
            'balanz_fiscal_reconcile_owner'
          )
        ) AS "existingFiscalOwnerRoles"
      FROM pg_roles AS runtime_role
      INNER JOIN pg_database AS database
        ON database.datname = current_database()
      INNER JOIN pg_namespace AS public_schema
        ON public_schema.nspname = 'public'
      WHERE runtime_role.rolname = current_user
    `);
    const [catalog] = await dataSource.query<
      Array<{
        uuidExtension: boolean;
        uuidFunction: boolean;
        migrationLog: boolean;
        legalEntityKey: boolean;
        membershipKey: boolean;
      }>
    >(`
      SELECT
        EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'
        ) AS "uuidExtension",
        to_regprocedure('public.uuid_generate_v4()') IS NOT NULL
          AS "uuidFunction",
        to_regclass('public.migrations') IS NOT NULL AS "migrationLog",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = to_regclass('public.legal_entities')
            AND contype = 'u'
            AND conname = 'uq_legal_entities_account_id'
        ) AS "legalEntityKey",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = to_regclass('public.memberships')
            AND contype = 'u'
            AND conname = 'uq_memberships_organization_id'
        ) AS "membershipKey"
    `);
    const relations = await relationState(dataSource);
    const requiredBaseRelations = Object.fromEntries(
      REQUIRED_BASE_RELATIONS.map((name) => [name, relations[name]]),
    );
    const foundationRelations = Object.fromEntries(
      FOUNDATION_RELATIONS.map((name) => [name, relations[name]]),
    );
    const foundationCount =
      Object.values(foundationRelations).filter(Boolean).length;
    const baseRelationCount = Object.values(requiredBaseRelations).filter(
      Boolean,
    ).length;
    const freshBootstrap =
      baseRelationCount === 0 && foundationCount === 0 && !catalog.migrationLog;
    const legalEntityOrphans =
      relations.legal_entities && relations.client_accounts
        ? await scalarCount(
            dataSource,
            `SELECT count(*)::integer AS count
               FROM public.legal_entities AS legal_entity
               LEFT JOIN public.client_accounts AS client
                 ON client.organization_id = legal_entity.organization_id
                AND client.id = legal_entity.client_account_id
              WHERE client.id IS NULL`,
          )
        : null;
    const appliedMigrations = catalog.migrationLog
      ? await dataSource.query<Array<{ timestamp: string; name: string }>>(
          `SELECT timestamp::text, name FROM public.migrations ORDER BY id`,
        )
      : [];

    const failures: string[] = [];
    if (identity.readOnly) failures.push('database_is_read_only');
    if (identity.serverVersionNumber < 160000) {
      failures.push('postgres_16_required');
    }
    if (!catalog.uuidExtension || !catalog.uuidFunction) {
      failures.push('uuid_ossp_not_ready');
    }
    if (!freshBootstrap) {
      for (const [relation, present] of Object.entries(requiredBaseRelations)) {
        if (!present) failures.push(`missing_base_relation:${relation}`);
      }
      if (!catalog.legalEntityKey) {
        failures.push('missing_constraint:uq_legal_entities_account_id');
      }
      if (!catalog.membershipKey) {
        failures.push('missing_constraint:uq_memberships_organization_id');
      }
    }
    if (legalEntityOrphans !== null && legalEntityOrphans > 0) {
      failures.push('legal_entity_tenant_account_orphans');
    }
    if (foundationCount > 0 && foundationCount < FOUNDATION_RELATIONS.length) {
      failures.push('partial_fiscal_foundation_schema');
    }
    const phaseZeroLogged = new Set(
      appliedMigrations
        .map(({ name }) => name)
        .filter((name) =>
          [
            'FiscalIngestionFoundation1787690600000',
            'FiscalRlsWorkerClaims1787690610000',
          ].includes(name),
        ),
    );
    const nonSuperMigratorReady =
      identity.createRole &&
      identity.ownsCurrentDatabase &&
      identity.ownsPublicSchema &&
      identity.ownsRequiredRelations &&
      identity.existingFiscalOwnerRoles === 0;
    if (
      phaseZeroLogged.size < FISCAL_MIGRATION_IDENTITIES.size &&
      !identity.superuser &&
      !nonSuperMigratorReady
    ) {
      failures.push('insufficient_fiscal_migrator_authority');
    }
    const fiscalTimestampCollisions = appliedMigrations.filter(
      ({ timestamp, name }) =>
        FISCAL_MIGRATION_IDENTITIES.has(timestamp) &&
        FISCAL_MIGRATION_IDENTITIES.get(timestamp) !== name,
    );
    for (const collision of fiscalTimestampCollisions) {
      failures.push(
        `fiscal_migration_timestamp_collision:${collision.timestamp}:${collision.name}`,
      );
    }
    if (
      foundationCount === FOUNDATION_RELATIONS.length &&
      phaseZeroLogged.size === 0
    ) {
      failures.push('foundation_tables_not_tracked_by_migrations');
    }

    const report = {
      status: failures.length === 0 ? 'PASSED' : 'BLOCKED',
      mode: freshBootstrap ? 'FRESH_TEST_BOOTSTRAP' : 'EXISTING_DATABASE',
      readOnlyInspection: true,
      database: identity,
      catalog,
      requiredBaseRelations,
      foundationRelations,
      legalEntityTenantAccountOrphans: legalEntityOrphans,
      appliedMigrations,
      fiscalTimestampCollisions,
      migratorAuthority: {
        sufficient: identity.superuser || nonSuperMigratorReady,
        mode: identity.superuser
          ? 'SUPERUSER'
          : nonSuperMigratorReady
            ? 'CONSTRAINED_OWNER'
            : 'INSUFFICIENT',
      },
      failures,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) {
      throw new Error(
        `Fiscal migration preflight blocked: ${failures.join(', ')}`,
      );
    }
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

async function relationState(
  dataSource: DataSource,
): Promise<Record<string, boolean>> {
  const names = [...REQUIRED_BASE_RELATIONS, ...FOUNDATION_RELATIONS];
  const rows = await dataSource.query<
    Array<{ name: string; present: boolean }>
  >(
    `SELECT name, to_regclass(format('public.%I', name)) IS NOT NULL AS present
       FROM unnest($1::text[]) AS requested(name)`,
    [names],
  );
  return Object.fromEntries(rows.map(({ name, present }) => [name, present]));
}

async function scalarCount(
  dataSource: DataSource,
  sql: string,
): Promise<number> {
  const [row] = await dataSource.query<Array<{ count: number }>>(sql);
  return Number(row.count);
}

function assertSafeEnvironment(): void {
  const nodeEnvironment = process.env.NODE_ENV ?? 'development';
  if (!['development', 'test'].includes(nodeEnvironment)) {
    throw new Error(
      'Fiscal migration preflight is restricted to development/test',
    );
  }
  if (
    process.env.SECRETS_ENABLED === 'true' &&
    (process.env.SECRETS_ENVIRONMENT || 'dev') !== 'dev'
  ) {
    throw new Error(
      'Fiscal migration preflight requires the dev secrets scope',
    );
  }
}

void preflightFiscalFoundation().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Preflight failed');
  process.exitCode = 1;
});
