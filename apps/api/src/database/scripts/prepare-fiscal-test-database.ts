import * as dotenv from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { resolveDatabaseOptions } from '../database-options.factory';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const TEST_DATABASE_PATTERN = /^(?:test_[a-z0-9_]+|[a-z0-9_]+_test)$/;

async function prepareFiscalTestDatabase(): Promise<void> {
  assertSafeEnvironment();
  const target =
    process.env.CFDI_PHASE0_TEST_DATABASE?.trim() || 'balanz_cfdi_phase0_test';
  if (!TEST_DATABASE_PATTERN.test(target) || target.length > 63) {
    throw new Error(
      'CFDI_PHASE0_TEST_DATABASE must be a lowercase test_* or *_test name',
    );
  }

  const options = await resolveDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('CFDI Phase 0 test database requires PostgreSQL');
  }
  const administration = new DataSource({ ...options, logging: false });
  let created = false;
  try {
    await administration.initialize();
    const [{ database: sourceDatabase }] = await administration.query<
      Array<{ database: string }>
    >(`SELECT current_database() AS database`);
    if (sourceDatabase === target) {
      throw new Error('Refusing to create the test database from itself');
    }
    const existing = await administration.query<
      Array<{
        name: string;
        owner: string;
        isTemplate: boolean;
        allowsConnections: boolean;
      }>
    >(
      `SELECT
         database.datname AS name,
         owner.rolname AS owner,
         database.datistemplate AS "isTemplate",
         database.datallowconn AS "allowsConnections"
       FROM pg_database AS database
       INNER JOIN pg_roles AS owner ON owner.oid = database.datdba
       WHERE database.datname = $1`,
      [target],
    );
    if (existing[0]?.isTemplate || existing[0]?.allowsConnections === false) {
      throw new Error(
        'Existing test database is not a connectable non-template',
      );
    }
    if (existing.length === 0) {
      // Target is constrained to lowercase ASCII plus underscore and quoted.
      // CREATE DATABASE cannot run in a transaction or parameterize identifiers.
      await administration.query(
        `CREATE DATABASE "${target}" WITH TEMPLATE template0 ENCODING 'UTF8'`,
      );
      created = true;
    }

    const targetOptions = {
      ...options,
      database: target,
      logging: false,
    } as DataSourceOptions;
    const testDatabase = new DataSource(targetOptions);
    try {
      await testDatabase.initialize();
      await testDatabase.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
      const [state] = await testDatabase.query<
        Array<{
          database: string;
          owner: string;
          uuidExtension: boolean;
          publicRelations: number;
        }>
      >(`
        SELECT
          current_database() AS database,
          pg_get_userbyid(database.datdba) AS owner,
          EXISTS (
            SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'
          ) AS "uuidExtension",
          (
            SELECT count(*)::integer
            FROM pg_class AS relation
            INNER JOIN pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relkind IN ('r','p')
          ) AS "publicRelations"
        FROM pg_database AS database
        WHERE database.datname = current_database()
      `);
      console.log(
        JSON.stringify(
          {
            status: 'READY',
            created,
            destructiveOperations: false,
            database: state,
          },
          null,
          2,
        ),
      );
    } finally {
      if (testDatabase.isInitialized) await testDatabase.destroy();
    }
  } finally {
    if (administration.isInitialized) await administration.destroy();
  }
}

function assertSafeEnvironment(): void {
  if (
    !['development', 'test'].includes(process.env.NODE_ENV ?? 'development')
  ) {
    throw new Error(
      'Test database preparation is restricted to development/test',
    );
  }
  if (
    process.env.SECRETS_ENABLED === 'true' &&
    (process.env.SECRETS_ENVIRONMENT || 'dev') !== 'dev'
  ) {
    throw new Error('Test database preparation requires the dev secrets scope');
  }
}

void prepareFiscalTestDatabase().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Test database preparation failed',
  );
  process.exitCode = 1;
});
