import { AppDataSource } from '../data-source';

async function seed(): Promise<void> {
  // Agregar aquí seeds idempotentes cuando sean necesarios.
}

AppDataSource.initialize()
  .then(seed)
  .then(() => AppDataSource.destroy())
  .catch(async (error: unknown) => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    console.error(error);
    process.exitCode = 1;
  });
