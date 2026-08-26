import appDataSource from '../data-source';
import { seedDatabase } from './seed-database';

async function seed(): Promise<void> {
  const dataSource = await appDataSource;
  await dataSource.initialize();

  await seedDatabase(dataSource);

  await dataSource.destroy();
}

seed().catch(async (error: unknown) => {
  const dataSource = await appDataSource.catch(() => undefined);
  if (dataSource?.isInitialized) await dataSource.destroy();
  console.error(error);
  process.exitCode = 1;
});
