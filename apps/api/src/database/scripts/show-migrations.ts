import { DataSource } from 'typeorm';
import {
  EXPECTED_MIGRATION_IDENTITIES,
  EXPECTED_MIGRATION_NAMES,
} from './migration-manifest';
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
    const expectedNames = new Set<string>(EXPECTED_MIGRATION_NAMES);
    const expectedTimestamps = new Map(
      EXPECTED_MIGRATION_IDENTITIES.map(({ name, timestamp }) => [
        name,
        String(timestamp),
      ]),
    );
    const unknownExecuted = executed
      .filter(({ name }) => !expectedNames.has(name))
      .map(({ name, timestamp }) => ({ name, timestamp }));
    const identityMismatches = executed
      .filter(
        ({ name, timestamp }) =>
          expectedTimestamps.has(name) &&
          expectedTimestamps.get(name) !== timestamp,
      )
      .map(({ name, timestamp }) => ({ name, timestamp }));
    const missingFiles = EXPECTED_MIGRATION_NAMES.filter(
      (name) => !availableNames.includes(name),
    );
    const unexpectedFiles = availableNames.filter(
      (name) => !expectedNames.has(name),
    );
    console.log(
      JSON.stringify(
        {
          available,
          manifest: {
            missingFiles,
            unexpectedFiles,
            unknownExecuted,
            identityMismatches,
          },
        },
        null,
        2,
      ),
    );
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
