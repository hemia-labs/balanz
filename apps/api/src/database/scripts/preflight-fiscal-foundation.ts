import { DataSource } from 'typeorm';
import {
  ALLOWED_SHARED_MIGRATION_TIMESTAMPS,
  EXPECTED_MIGRATION_IDENTITIES,
  EXPECTED_MIGRATION_NAMES,
} from './migration-manifest';
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
const PHASE_ZERO_MIGRATION_NAMES = new Set([
  'FiscalIngestionFoundation1787690600000',
  'FiscalRlsWorkerClaims1787690610000',
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
    const configuredMigrationNames = dataSource.migrations
      .map(({ name }) => name)
      .filter((name): name is string => typeof name === 'string');
    validateConfiguredMigrationManifest(configuredMigrationNames, failures);
    validateAppliedMigrationLedger(appliedMigrations, failures);
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
        .filter((name) => PHASE_ZERO_MIGRATION_NAMES.has(name)),
    );
    const nonSuperMigratorReady =
      identity.createRole &&
      identity.ownsCurrentDatabase &&
      identity.ownsPublicSchema &&
      identity.ownsRequiredRelations &&
      identity.existingFiscalOwnerRoles === 0;
    if (
      phaseZeroLogged.size < PHASE_ZERO_MIGRATION_NAMES.size &&
      !identity.superuser &&
      !nonSuperMigratorReady
    ) {
      failures.push('insufficient_fiscal_migrator_authority');
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
      migrationManifest: {
        configured: configuredMigrationNames,
        expected: EXPECTED_MIGRATION_IDENTITIES,
        allowedSharedTimestamps: Object.fromEntries(
          [...ALLOWED_SHARED_MIGRATION_TIMESTAMPS].map(([timestamp, names]) => [
            timestamp,
            [...names],
          ]),
        ),
        unknownExecuted: appliedMigrations
          .filter(({ name }) => !EXPECTED_MIGRATION_NAMES.includes(name))
          .map(({ timestamp, name }) => ({ timestamp, name })),
      },
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

function validateConfiguredMigrationManifest(
  configured: string[],
  failures: string[],
): void {
  const unique = new Set(configured);
  if (unique.size !== configured.length) {
    failures.push('duplicate_configured_migration_name');
  }
  const missing = EXPECTED_MIGRATION_NAMES.filter((name) => !unique.has(name));
  const unexpected = configured.filter(
    (name) => !EXPECTED_MIGRATION_NAMES.includes(name),
  );
  for (const name of missing) failures.push(`missing_migration_file:${name}`);
  for (const name of unexpected) {
    failures.push(`unexpected_migration_file:${name}`);
  }

  const namesByTimestamp = groupNamesByTimestamp(
    EXPECTED_MIGRATION_IDENTITIES.map(({ name, timestamp }) => ({
      name,
      timestamp: String(timestamp),
    })),
  );
  for (const [timestamp, names] of namesByTimestamp) {
    if (names.size === 1) continue;
    const allowed = ALLOWED_SHARED_MIGRATION_TIMESTAMPS.get(timestamp);
    if (!allowed || !sameStringSet(names, allowed)) {
      failures.push(`unapproved_manifest_timestamp_collision:${timestamp}`);
    }
  }
}

function validateAppliedMigrationLedger(
  applied: Array<{ timestamp: string; name: string }>,
  failures: string[],
): void {
  const expectedByName = new Map(
    EXPECTED_MIGRATION_IDENTITIES.map(({ name, timestamp }) => [
      name,
      String(timestamp),
    ]),
  );
  const seen = new Set<string>();
  for (const row of applied) {
    if (seen.has(row.name)) {
      failures.push(`duplicate_executed_migration_name:${row.name}`);
      continue;
    }
    seen.add(row.name);
    const expectedTimestamp = expectedByName.get(row.name);
    if (!expectedTimestamp) {
      failures.push(`unknown_executed_migration:${row.name}`);
    } else if (row.timestamp !== expectedTimestamp) {
      failures.push(`migration_identity_mismatch:${row.name}`);
    }
  }

  for (const [timestamp, names] of groupNamesByTimestamp(applied)) {
    if (names.size === 1) continue;
    const allowed = ALLOWED_SHARED_MIGRATION_TIMESTAMPS.get(timestamp);
    if (!allowed || !sameStringSet(names, allowed)) {
      failures.push(`unapproved_executed_timestamp_collision:${timestamp}`);
    }
  }
}

function groupNamesByTimestamp(
  rows: Array<{ timestamp: string; name: string }>,
): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>();
  for (const row of rows) {
    const timestamp = Number(row.timestamp);
    const names = result.get(timestamp) ?? new Set<string>();
    names.add(row.name);
    result.set(timestamp, names);
  }
  return result;
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
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
