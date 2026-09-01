import { randomBytes } from 'node:crypto';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import {
  PERMISSION_CATALOG,
  ROLE_PERMISSION_KEYS,
} from '../src/common/auth/permission-catalog';
import { resolveDatabaseOptions } from '../src/database/database-options.factory';
import { seedDatabase } from '../src/database/seeds/seed-database';

const TEMP_DATABASE_PATTERN = /^balanz_migration_qa_[a-f0-9]{12}$/;

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

async function validateMigrationLifecycle(): Promise<void> {
  if (
    !['development', 'test'].includes(process.env.NODE_ENV ?? 'development')
  ) {
    throw new Error('Migration lifecycle QA is restricted to development/test');
  }
  if (
    process.env.SECRETS_ENABLED === 'true' &&
    (process.env.SECRETS_ENVIRONMENT || 'dev') !== 'dev'
  ) {
    throw new Error('Migration lifecycle QA requires the dev secrets scope');
  }

  const options = await resolveDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('Migration lifecycle QA requires PostgreSQL');
  }

  const temporaryDatabase = `balanz_migration_qa_${randomBytes(6).toString('hex')}`;
  if (!TEMP_DATABASE_PATTERN.test(temporaryDatabase)) {
    throw new Error('Refusing to use an invalid temporary database name');
  }

  const admin = new DataSource({ ...options, logging: false });
  let temporary: DataSource | undefined;
  let databaseCreated = false;
  const report: Record<string, unknown> = {};

  try {
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${temporaryDatabase}"`);
    databaseCreated = true;

    temporary = new DataSource({
      ...options,
      database: temporaryDatabase,
      logging: false,
    });
    await temporary.initialize();

    const initial = await temporary.runMigrations({ transaction: 'all' });
    report.initialMigrations = initial.map((migration) => migration.name);
    assertEqual(initial.length, 6, 'initial migration count');

    await seedDatabase(temporary);
    await seedDatabase(temporary);
    const [seedCounts] = await temporary.query<
      Array<{
        roles: number;
        distinct_roles: number;
        permissions: number;
        distinct_permissions: number;
        role_permissions: number;
        role_permission_roles: number;
      }>
    >(
      `SELECT
        (SELECT count(*)::int FROM roles) AS roles,
        (SELECT count(DISTINCT key)::int FROM roles) AS distinct_roles,
        (SELECT count(*)::int FROM permissions) AS permissions,
        (SELECT count(DISTINCT key)::int FROM permissions) AS distinct_permissions,
        (SELECT count(*)::int FROM role_permissions) AS role_permissions,
        (SELECT count(DISTINCT role_id)::int FROM role_permissions) AS role_permission_roles`,
    );
    report.seedCounts = seedCounts;
    assertEqual(seedCounts.roles, 3, 'seed role count');
    assertEqual(seedCounts.distinct_roles, 3, 'distinct seed role count');
    assertEqual(
      seedCounts.permissions,
      PERMISSION_CATALOG.length,
      'seed permission count',
    );
    assertEqual(
      seedCounts.distinct_permissions,
      PERMISSION_CATALOG.length,
      'distinct seed permission count',
    );
    assertEqual(
      seedCounts.role_permissions,
      Object.values(ROLE_PERMISSION_KEYS).reduce(
        (total, permissions) => total + permissions.length,
        0,
      ),
      'role permission count',
    );
    assertEqual(seedCounts.role_permission_roles, 3, 'role default count');

    await temporary.undoLastMigration({ transaction: 'all' });
    const [operationsRollback] = await temporary.query<
      Array<Record<string, boolean>>
    >(
      `SELECT
        to_regclass('public.fiscal_operations') IS NULL AS operations_removed,
        to_regclass('public.private_objects') IS NULL AS private_objects_removed,
        to_regclass('public.object_access_grants') IS NULL AS access_grants_removed,
        to_regclass('public.client_accounts') IS NOT NULL AS clients_preserved`,
    );
    report.operationsRollback = operationsRollback;
    assertAllTrue(operationsRollback, 'fiscal operations rollback');

    await temporary.undoLastMigration({ transaction: 'all' });
    const [searchRollback] = await temporary.query<
      Array<Record<string, boolean>>
    >(
      `SELECT
        to_regclass('public.ix_client_accounts_name_trgm') IS NULL AS name_trgm_removed,
        to_regclass('public.ix_client_accounts_code_trgm') IS NULL AS code_trgm_removed,
        to_regclass('public.client_accounts') IS NOT NULL AS client_accounts_preserved`,
    );
    report.searchRollback = searchRollback;
    assertAllTrue(searchRollback, 'client search rollback');

    await temporary.undoLastMigration({ transaction: 'all' });
    const [clientRollback] = await temporary.query<
      Array<Record<string, boolean>>
    >(
      `SELECT
        to_regclass('public.client_accounts') IS NULL AS client_accounts_removed,
        to_regclass('public.legal_entities') IS NULL AS legal_entities_removed,
        to_regclass('public.account_assignments') IS NULL AS assignments_removed,
        to_regclass('public.fiscal_years') IS NULL AS fiscal_years_removed,
        to_regclass('public.periods') IS NULL AS periods_removed,
        to_regclass('public.users') IS NOT NULL AS identity_preserved`,
    );
    report.clientRollback = clientRollback;
    assertAllTrue(clientRollback, 'client domain rollback');

    const reappliedClient = await temporary.runMigrations({
      transaction: 'all',
    });
    assertEqual(reappliedClient.length, 3, 'client migration reapply count');

    for (let index = 0; index < 6; index += 1) {
      await temporary.undoLastMigration({ transaction: 'all' });
    }
    const [fullRollback] = await temporary.query<
      Array<Record<string, boolean>>
    >(
      `SELECT
        to_regclass('public.client_accounts') IS NULL AS clients_removed,
        to_regclass('public.memberships') IS NULL AS memberships_removed,
        to_regclass('public.users') IS NULL AS users_removed`,
    );
    report.fullRollback = fullRollback;
    assertAllTrue(fullRollback, 'full rollback');

    const reapplied = await temporary.runMigrations({ transaction: 'all' });
    assertEqual(reapplied.length, 6, 'full migration reapply count');
    await seedDatabase(temporary);
    const schemaLog = await temporary.driver.createSchemaBuilder().log();
    report.reappliedMigrations = reapplied.map((migration) => migration.name);
    report.schemaDrift = {
      upQueries: schemaLog.upQueries.length,
      downQueries: schemaLog.downQueries.length,
      queries: schemaLog.upQueries.map((query) => query.query),
    };
    if (schemaLog.upQueries.length > 0) {
      console.error(JSON.stringify(report.schemaDrift, null, 2));
    }
    assertEqual(schemaLog.upQueries.length, 0, 'schema drift up query count');
    assertEqual(
      schemaLog.downQueries.length,
      0,
      'schema drift down query count',
    );
  } finally {
    if (temporary?.isInitialized) await temporary.destroy();
    if (databaseCreated && admin.isInitialized) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [temporaryDatabase],
      );
      await admin.query(`DROP DATABASE "${temporaryDatabase}"`);
      report.temporaryDatabaseRemoved = true;
    }
    if (admin.isInitialized) await admin.destroy();
  }

  console.log(JSON.stringify(report, null, 2));
}

function assertEqual(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function assertAllTrue(values: Record<string, boolean>, label: string): void {
  const failures = Object.entries(values)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (failures.length > 0) {
    throw new Error(`${label} failed: ${failures.join(', ')}`);
  }
}

void validateMigrationLifecycle().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
