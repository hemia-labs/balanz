import {
  createSecretsClient,
  isCategory,
  isEnvironment,
  type SecretsClient,
} from '@hemia/secrets';
import type { DataSourceOptions } from 'typeorm';
import {
  getDatabaseConfig,
  getDatabaseOptions,
} from '../config/database.config';
import { isDatabaseSecret, type DatabaseSecret } from './types/database.types';

type DatabaseSecretReader = Pick<SecretsClient, 'getRequired'>;

function requiredEnvironmentValue(
  env: NodeJS.ProcessEnv,
  key: keyof NodeJS.ProcessEnv,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${String(key)} is required when SECRETS_ENABLED=true`);
  }

  return value;
}

function createDatabaseSecretReader(
  env: NodeJS.ProcessEnv,
): DatabaseSecretReader {
  const environment = env.SECRETS_ENVIRONMENT || 'dev';
  const category = env.SECRETS_CATEGORY || 'internal';

  if (!isEnvironment(environment)) {
    throw new Error(`Invalid SECRETS_ENVIRONMENT: ${environment}`);
  }
  if (!isCategory(category)) {
    throw new Error(`Invalid SECRETS_CATEGORY: ${category}`);
  }

  return createSecretsClient({
    scope: {
      environment,
      category,
      owner: env.SECRETS_OWNER || 'hemia',
      system: env.SECRETS_SYSTEM || 'api',
    },
    provider: {
      type: 'hashicorp-vault',
      options: {
        baseUrl: requiredEnvironmentValue(env, 'VAULT_BASE_URL'),
        roleId: requiredEnvironmentValue(env, 'VAULT_ROLE_ID'),
        secretId: requiredEnvironmentValue(env, 'VAULT_SECRET_ID'),
        authPath: env.VAULT_AUTH_PATH || 'approle',
        mountPrefix: env.VAULT_MOUNT_PREFIX || 'kv-',
        timeoutMs: Number(env.VAULT_TIMEOUT_MS) || 5_000,
      },
    },
    cache: {
      enabled: env.SECRETS_CACHE_ENABLED !== 'false',
      ttlMs: Number(env.SECRETS_CACHE_TTL_MS) || 60_000,
    },
  });
}

export async function resolveDatabaseOptions(
  env: NodeJS.ProcessEnv = process.env,
  secretReader?: DatabaseSecretReader,
): Promise<DataSourceOptions> {
  const database = getDatabaseConfig(env);

  if (env.SECRETS_ENABLED !== 'true') {
    return getDatabaseOptions(database);
  }

  const secret = await (
    secretReader ?? createDatabaseSecretReader(env)
  ).getRequired<DatabaseSecret>('database/postgres');

  if (!isDatabaseSecret(secret)) {
    throw new Error(
      'Secret database/postgres must contain db_host, db_port, db_username, db_password, db_database and db_logging',
    );
  }

  return getDatabaseOptions({
    ...database,
    host: secret.db_host,
    port: secret.db_port,
    username: secret.db_username,
    password: secret.db_password,
    name: secret.db_database,
    logging: secret.db_logging,
  });
}
