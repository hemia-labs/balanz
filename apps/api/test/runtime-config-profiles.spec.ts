import {
  apiEnvVarsSchema,
  workerEnvVarsSchema,
} from '../src/config/env.validation';
import {
  getDatabaseConfig,
  type DatabaseConfig,
} from '../src/config/database.config';
import {
  runtimeConfigFactories,
  runtimeEnvFilePaths,
} from '../src/config/platform-config.module';
import { getSecretsConfig } from '../src/config/secrets.config';
import { resolveRuntimeDatabaseOptions } from '../src/database/database.module';

const commonDatabase = {
  NODE_ENV: 'development',
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_DATABASE: 'balanz_test',
};

const apiEnvironment = {
  ...commonDatabase,
  DB_API_USERNAME: 'balanz_api_login',
  DB_API_PASSWORD: 'api-runtime-password-for-tests',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BCRYPT_SALT_ROUNDS: 12,
};

const workerEnvironment = {
  ...commonDatabase,
  DB_WORKER_USERNAME: 'balanz_worker_login',
  DB_WORKER_PASSWORD: 'worker-runtime-password-for-tests',
};

describe('runtime configuration profiles', () => {
  it('accepts API configuration without a worker credential', () => {
    const result = apiEnvVarsSchema.validate(apiEnvironment);
    const value: unknown = result.value;

    expect(result.error).toBeUndefined();
    expect(value).not.toHaveProperty('DB_WORKER_USERNAME');
    expect(value).not.toHaveProperty('DB_WORKER_PASSWORD');
  });

  it('accepts worker configuration without API, JWT, MFA or email settings', () => {
    const result = workerEnvVarsSchema.validate(workerEnvironment);
    const value: unknown = result.value;

    expect(result.error).toBeUndefined();
    expect(value).not.toHaveProperty('DB_API_USERNAME');
    expect(value).not.toHaveProperty('JWT_SECRET');
    expect(value).not.toHaveProperty('MFA_ENCRYPTION_KEY');
    expect(value).not.toHaveProperty('EMAIL_FROM_AUTH');
  });

  it.each([
    ['DB_WORKER_USERNAME', 'must-not-reach-api'],
    ['DB_USERNAME', 'must-not-reach-api'],
  ])(
    'rejects foreign database setting %s in the API profile',
    (name, value) => {
      const result = apiEnvVarsSchema.validate({
        ...apiEnvironment,
        [name]: value,
      });

      expect(result.error?.message).toContain(name);
    },
  );

  it.each([
    ['DB_API_USERNAME', 'must-not-reach-worker'],
    ['DB_USERNAME', 'must-not-reach-worker'],
    ['JWT_SECRET', 'c'.repeat(32)],
    ['MFA_ENCRYPTION_KEY', Buffer.alloc(32).toString('base64')],
    ['EMAIL_FROM_AUTH', 'auth@example.test'],
  ])('rejects API-only setting %s in the worker profile', (name, value) => {
    const result = workerEnvVarsSchema.validate({
      ...workerEnvironment,
      [name]: value,
    });

    expect(result.error?.message).toContain(name);
  });

  it('requires an explicit Vault system in production without changing the existing namespace', () => {
    const productionWorker = {
      ...workerEnvironment,
      NODE_ENV: 'production',
      SECRETS_ENABLED: true,
      SECRETS_ENVIRONMENT: 'prod',
      VAULT_BASE_URL: 'https://vault.example.test',
      VAULT_ROLE_ID: 'worker-role-id',
      VAULT_SECRET_ID: 'worker-secret-id',
      OBJECT_STORAGE_DRIVER: 's3',
      S3_BUCKET: 'private-fiscal-bucket',
      S3_SSE_MODE: 'aws:kms',
      S3_KMS_KEY_ID: 'alias/balanz-fiscal',
      MALWARE_SCANNER_MODE: 'clamav',
    };

    expect(
      workerEnvVarsSchema.validate(productionWorker).error?.message,
    ).toContain('SECRETS_SYSTEM');
    expect(
      workerEnvVarsSchema.validate({
        ...productionWorker,
        SECRETS_SYSTEM: 'api',
      }).error,
    ).toBeUndefined();
  });

  it('loads only factories belonging to each entrypoint', () => {
    const namespaces = (profile: 'api' | 'worker') =>
      runtimeConfigFactories(profile).map((factory) => factory.KEY);

    expect(namespaces('api')).toEqual([
      'CONFIGURATION(app)',
      'CONFIGURATION(database)',
      'CONFIGURATION(redis)',
      'CONFIGURATION(secrets)',
      'CONFIGURATION(horus)',
      'CONFIGURATION(fiscalPlatform)',
      'CONFIGURATION(auth)',
      'CONFIGURATION(cookies)',
      'CONFIGURATION(email)',
    ]);
    expect(namespaces('worker')).toEqual([
      'CONFIGURATION(database)',
      'CONFIGURATION(redis)',
      'CONFIGURATION(secrets)',
      'CONFIGURATION(horus)',
      'CONFIGURATION(fiscalPlatform)',
    ]);
  });

  it('prioritizes a dedicated environment file for each entrypoint', () => {
    expect(runtimeEnvFilePaths('api')[0]).toBe('.env.api.local');
    expect(runtimeEnvFilePaths('worker')[0]).toBe('.env.worker.local');
  });

  it('materializes only the selected runtime database credential', () => {
    const env = {
      ...process.env,
      DB_API_USERNAME: 'api-login',
      DB_API_PASSWORD: 'api-password',
      DB_WORKER_USERNAME: 'worker-login',
      DB_WORKER_PASSWORD: 'worker-password',
      DB_USERNAME: 'migrator-login',
      DB_PASSWORD: 'migrator-password',
    };

    const api = getDatabaseConfig(env, 'api');
    const worker = getDatabaseConfig(env, 'worker');
    expect(api).toMatchObject({
      apiUsername: 'api-login',
      apiPassword: 'api-password',
    });
    expect(api).not.toHaveProperty('workerUsername');
    expect(api).not.toHaveProperty('workerPassword');
    expect(api).not.toHaveProperty('username');
    expect(api).not.toHaveProperty('password');
    expect(worker).toMatchObject({
      workerUsername: 'worker-login',
      workerPassword: 'worker-password',
    });
    expect(worker).not.toHaveProperty('apiUsername');
    expect(worker).not.toHaveProperty('apiPassword');
    expect(worker).not.toHaveProperty('username');
    expect(worker).not.toHaveProperty('password');
    expect(getDatabaseConfig(env)).toMatchObject({
      username: 'migrator-login',
      apiUsername: 'api-login',
      workerUsername: 'worker-login',
    });
  });

  it('preserves the existing Vault taxonomy while recording the internal profile', () => {
    expect(getSecretsConfig({}, 'api')).toMatchObject({
      runtimeProfile: 'api',
      scope: { owner: 'balanz', system: 'api' },
    });
    expect(getSecretsConfig({}, 'worker')).toMatchObject({
      runtimeProfile: 'worker',
      scope: { owner: 'balanz', system: 'api' },
    });
  });

  it('requests only the worker PostgreSQL secret path for a worker profile', async () => {
    const getRequired = jest.fn().mockResolvedValue({
      db_host: 'database.internal',
      db_port: 5432,
      db_username: 'balanz_worker_login',
      db_password: 'worker-runtime-password',
      db_database: 'balanz',
      db_logging: false,
    });
    const database: DatabaseConfig = {
      host: undefined,
      port: 5432,
      username: undefined,
      password: undefined,
      name: undefined,
      logging: false,
      connectionTimeoutMs: 2_000,
    };

    const options = await resolveRuntimeDatabaseOptions(
      database,
      true,
      { getRequired },
      'worker',
      'worker',
    );

    expect(getRequired).toHaveBeenCalledTimes(1);
    expect(getRequired).toHaveBeenCalledWith('database/postgres-worker');
    expect(options).toMatchObject({ username: 'balanz_worker_login' });
  });

  it('rejects a mismatched module/profile before reading Vault', async () => {
    const getRequired = jest.fn();
    const database: DatabaseConfig = {
      port: 5432,
      logging: false,
      connectionTimeoutMs: 2_000,
    };

    await expect(
      resolveRuntimeDatabaseOptions(
        database,
        true,
        { getRequired },
        'worker',
        'api',
      ),
    ).rejects.toThrow('cannot initialize worker');
    expect(getRequired).not.toHaveBeenCalled();
  });
});
