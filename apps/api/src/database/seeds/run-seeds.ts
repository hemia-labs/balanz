import { DataSource } from 'typeorm';
import { resolveScriptDatabaseOptions } from '../scripts/script-database-options';
import { seedDatabase } from './seed-database';

async function seed(): Promise<void> {
  const dataSource = new DataSource(await resolveScriptDatabaseOptions());
  try {
    await dataSource.initialize();
    await seedDatabase(dataSource);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
