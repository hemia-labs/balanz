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

export interface RuntimeDatabaseCredential {
  database: string | undefined;
  host: string | undefined;
  password: string;
  port: number;
  username: string;
}

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
      owner: env.SECRETS_OWNER || 'balanz',
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

/**
 * Resolves a dedicated runtime credential without opening a connection or
 * exposing it in logs. Provisioning and QA scripts use the same Vault paths as
 * DatabaseModule (`database/postgres-api|postgres-worker`).
 */
export async function resolveRuntimeDatabaseCredential(
  principal: 'api' | 'worker',
  env: NodeJS.ProcessEnv = process.env,
  secretReader?: DatabaseSecretReader,
): Promise<RuntimeDatabaseCredential> {
  const database = getDatabaseConfig(env);
  if (env.SECRETS_ENABLED !== 'true') {
    const username =
      principal === 'api' ? database.apiUsername : database.workerUsername;
    const password =
      principal === 'api' ? database.apiPassword : database.workerPassword;
    if (!username || !password) {
      throw new Error(
        `Dedicated DB_${principal.toUpperCase()}_USERNAME/PASSWORD credentials are required`,
      );
    }
    return {
      database: database.name,
      host: database.host,
      password,
      port: database.port,
      username,
    };
  }

  const secret = await (
    secretReader ?? createDatabaseSecretReader(env)
  ).getRequired<DatabaseSecret>(`database/postgres-${principal}`);
  if (!isDatabaseSecret(secret)) {
    throw new Error(
      `Secret database/postgres-${principal} must contain a dedicated PostgreSQL runtime login`,
    );
  }
  return {
    database: secret.db_database,
    host: secret.db_host,
    password: secret.db_password,
    port: secret.db_port,
    username: secret.db_username,
  };
}
