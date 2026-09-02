import { DataSource } from 'typeorm';
import { resolveScriptDatabaseOptions } from './script-database-options';

async function showMigrations(): Promise<void> {
  const dataSource = new DataSource(await resolveScriptDatabaseOptions());
  try {
    await dataSource.initialize();
    const [{ present }] = await dataSource.query<Array<{ present: boolean }>>(
      `SELECT to_regclass('public.migrations') IS NOT NULL AS present`,
    );
    const executed = present
      ? await dataSource.query<
          Array<{ id: number; timestamp: string; name: string }>
        >(
          `SELECT id, timestamp::text, name
             FROM migrations
            ORDER BY id`,
        )
      : [];
    const executedNames = new Set(executed.map(({ name }) => name));
    const availableNames = dataSource.migrations
      .map(({ name }) => name)
      .filter((name): name is string => typeof name === 'string');
    const available = availableNames.map((name) => ({
      name,
      status: executedNames.has(name) ? 'executed' : 'pending',
    }));
    const unknownExecuted = executed
      .filter(({ name }) => !availableNames.includes(name))
      .map(({ name, timestamp }) => ({ name, timestamp }));
    console.log(JSON.stringify({ available, unknownExecuted }, null, 2));
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

showMigrations().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Migration status failed',
  );
  process.exitCode = 1;
});
