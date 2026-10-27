import { DataSource } from 'typeorm';
import { resolveScriptDatabaseOptions } from './script-database-options';

export async function assertReleaseSchema(
  source: Pick<DataSource, 'query' | 'migrations'>,
  expectedDatabase: string,
): Promise<void> {
  const [identity] = await source.query<
    Array<{ database: string; table: string | null }>
  >(
    "SELECT current_database() AS database, to_regclass('public.migrations')::text AS table",
  );
  if (identity?.database !== expectedDatabase)
    throw new Error('unexpected_database');
  if (!identity.table) throw new Error('pending_migrations');
  const applied = await source.query<Array<{ name: string }>>(
    'SELECT name FROM public.migrations',
  );
  const names = new Set(applied.map((migration) => migration.name));
  if (
    source.migrations.some(
      (migration) => !names.has(migration.name ?? migration.constructor.name),
    )
  )
    throw new Error('pending_migrations');
}

async function main() {
  const expected = process.argv[2];
  if (!expected || !/^[a-z][a-z0-9_]{0,62}$/.test(expected))
    throw new Error('expected_database_required');
  const options = await resolveScriptDatabaseOptions();
  const extra = options.extra as Record<string, unknown> | undefined;
  const connectionOptions =
    typeof extra?.options === 'string' ? extra.options : '';
  const source = new DataSource({
    ...options,
    logging: false,
    extra: {
      ...extra,
      options: `${connectionOptions} -c default_transaction_read_only=on`,
    },
  });
  try {
    await source.initialize();
    await assertReleaseSchema(source, expected);
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const known = [
      'pending_migrations',
      'unexpected_database',
      'expected_database_required',
    ];
    console.error(
      error instanceof Error && known.includes(error.message)
        ? error.message
        : 'schema_preflight_failed',
    );
    process.exitCode = 1;
  });
}
