import { DataSource } from 'typeorm';
import { PHASE_ZERO_MIGRATION_NAMES } from './migration-manifest';
import { resolveScriptDatabaseOptions } from './script-database-options';

async function runMigrations(): Promise<void> {
  const dataSource = new DataSource(await resolveScriptDatabaseOptions());
  try {
    await dataSource.initialize();
    await assertPendingPhaseZeroMigrationsUseSuperuser(dataSource);
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    console.log(
      JSON.stringify(
        {
          applied: applied.map(({ name }) => name),
          count: applied.length,
        },
        null,
        2,
      ),
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

export async function assertPendingPhaseZeroMigrationsUseSuperuser(
  dataSource: Pick<DataSource, 'migrations' | 'query'>,
): Promise<void> {
  const configuredNames = new Set(
    dataSource.migrations
      .map(({ name }) => name)
      .filter((name): name is string => typeof name === 'string'),
  );
  const configuredPhaseZero = PHASE_ZERO_MIGRATION_NAMES.filter((name) =>
    configuredNames.has(name),
  );
  if (configuredPhaseZero.length === 0) return;

  const [catalog] = await dataSource.query<Array<{ present: boolean }>>(`
    SELECT to_regclass('public.migrations') IS NOT NULL AS present
  `);
  const appliedNames = catalog?.present
    ? new Set(
        (
          await dataSource.query<Array<{ name: string }>>(`
            SELECT name FROM public.migrations
          `)
        ).map(({ name }) => name),
      )
    : new Set<string>();
  const phaseZeroPending = configuredPhaseZero.some(
    (name) => !appliedNames.has(name),
  );
  if (!phaseZeroPending) return;

  const [identity] = await dataSource.query<Array<{ superuser: boolean }>>(`
    SELECT role.rolsuper AS superuser
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  `);
  if (!identity?.superuser) {
    throw new Error(
      'Pending CFDI Phase 0 migrations require the dedicated ephemeral PostgreSQL superuser/migrator',
    );
  }
}

if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Migration run failed',
    );
    process.exitCode = 1;
  });
}
