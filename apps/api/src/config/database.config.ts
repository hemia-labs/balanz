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
}

export function getDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 5432,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    name: env.DB_DATABASE,
    logging: env.DB_LOGGING === 'true',
  };
}

export function getDatabaseOptions(
  config: DatabaseConfig,
): DataSourceOptions {
  return {
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: config.name,
    logging: config.logging,
    synchronize: false,
    extra: { options: '-c timezone=America/Mexico_City' },
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

export default registerAs('database', () => getDatabaseConfig());
