import { registerAs } from '@nestjs/config';
import * as path from 'path';
import { DataSourceOptions } from 'typeorm';

export interface DatabaseConfig {
  host?: string;
  port: number;
  username?: string;
  password?: string;
  name?: string;
  logging: boolean;
  connectionTimeoutMs: number;
  apiUsername?: string;
  apiPassword?: string;
  workerUsername?: string;
  workerPassword?: string;
}

export type DatabaseRuntimeProfile = 'api' | 'worker';

export function getDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
  runtimeProfile?: DatabaseRuntimeProfile,
): DatabaseConfig {
  const config: DatabaseConfig = {
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 5432,
    name: env.DB_DATABASE,
    logging: env.DB_LOGGING === 'true',
    connectionTimeoutMs: Number(env.DB_CONNECTION_TIMEOUT_MS) || 2_000,
  };

  if (!runtimeProfile) {
    config.username = env.DB_USERNAME;
    config.password = env.DB_PASSWORD;
  }

  // Runtime processes only materialize their own login in ConfigService. The
  // unscoped form is intentionally reserved for CLI provisioning/QA, which
  // must resolve both dedicated identities explicitly.
  if (!runtimeProfile || runtimeProfile === 'api') {
    config.apiUsername = env.DB_API_USERNAME?.trim() || undefined;
    config.apiPassword = env.DB_API_PASSWORD || undefined;
  }
  if (!runtimeProfile || runtimeProfile === 'worker') {
    config.workerUsername = env.DB_WORKER_USERNAME?.trim() || undefined;
    config.workerPassword = env.DB_WORKER_PASSWORD || undefined;
  }

  return config;
}

export function databaseConfigForRuntime(profile: DatabaseRuntimeProfile) {
  return registerAs('database', () => getDatabaseConfig(process.env, profile));
}

export function getDatabaseOptions(config: DatabaseConfig): DataSourceOptions {
  return {
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: config.name,
    logging: config.logging,
    synchronize: false,
    // Extensions are provisioned explicitly by infrastructure/migrations. Keeping
    // this disabled also makes read-only commands such as migration:show truly
    // read-only and avoids requiring CREATE EXTENSION at runtime.
    installExtensions: false,
    extra: {
      options: '-c timezone=America/Mexico_City -c search_path=public',
      connectionTimeoutMillis: config.connectionTimeoutMs,
    },
    entities: [
      path.join(__dirname, '..', '**', '*.entity.js'),
      path.join(__dirname, '..', '**', '*.entity.ts'),
    ],
    migrations: [
      path.join(__dirname, '..', 'database', 'migrations', '*.js'),
      path.join(__dirname, '..', 'database', 'migrations', '*.ts'),
    ],
  };
}
