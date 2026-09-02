import { DataSource } from 'typeorm';
import { resolveScriptDatabaseOptions } from './script-database-options';

async function runMigrations(): Promise<void> {
  const dataSource = new DataSource(await resolveScriptDatabaseOptions());
  try {
    await dataSource.initialize();
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

runMigrations().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Migration run failed',
  );
  process.exitCode = 1;
});
