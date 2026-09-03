import {
  createSecretsClient,
  type SecretsClient,
  type SecretsScope,
} from '@hemia/secrets';
import { isJwtSecrets } from '../src/common/auth/types/jwt.types';
import { isDatabaseSecret } from '../src/database/types/database.types';
import { isAwsEmailSecret } from '../src/modules/email/types/aws-email-secret.types';
import { isRedisSecret } from '../src/modules/redis/redis.types';

const scope: SecretsScope = {
  environment: 'dev',
  category: 'internal',
  owner: 'balanz',
  system: 'api',
};

async function validateEphemeralVault(): Promise<void> {
  assertOptIn();
  const api = client(
    requiredEnvironment('EPHEMERAL_VAULT_API_ROLE_ID'),
    requiredEnvironment('EPHEMERAL_VAULT_API_SECRET_ID'),
  );
  const worker = client(
    requiredEnvironment('EPHEMERAL_VAULT_WORKER_ROLE_ID'),
    requiredEnvironment('EPHEMERAL_VAULT_WORKER_SECRET_ID'),
  );

  const [apiDatabase, workerDatabase, apiRedis, workerRedis, jwt, email] =
    await Promise.all([
      api.getRequired('database/postgres-api'),
      worker.getRequired('database/postgres-worker'),
      api.getRequired('cache/redis'),
      worker.getRequired('cache/redis'),
      api.getRequired('auth/jwt'),
      api.getRequired('email/ses'),
    ]);

  assert(isDatabaseSecret(apiDatabase), 'API database secret shape');
  assert(isDatabaseSecret(workerDatabase), 'worker database secret shape');
  assert(
    apiDatabase.db_username !== workerDatabase.db_username,
    'runtime database principals must be distinct',
  );
  assert(isRedisSecret(apiRedis), 'API Redis secret shape');
  assert(isRedisSecret(workerRedis), 'worker Redis secret shape');
  assert(isJwtSecrets(jwt), 'JWT secret shape');
  assert(isAwsEmailSecret(email), 'email secret shape');

  await assertDenied(api, 'database/postgres-worker');
  await assertDenied(worker, 'database/postgres-api');
  await assertDenied(worker, 'auth/jwt');
  await assertDenied(worker, 'email/ses');

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        provider: 'EPHEMERAL_VAULT_APPROLE_KV_V2',
        api: {
          database: 'ALLOWED',
          redis: 'ALLOWED',
          workerDatabase: 'DENIED',
          auth: 'ALLOWED',
          email: 'ALLOWED',
        },
        worker: {
          database: 'ALLOWED',
          redis: 'ALLOWED',
          apiDatabase: 'DENIED',
          auth: 'DENIED',
          email: 'DENIED',
        },
        secretValuesPrinted: false,
      },
      null,
      2,
    ),
  );
}

function client(roleId: string, secretId: string): SecretsClient {
  return createSecretsClient({
    scope,
    provider: {
      type: 'hashicorp-vault',
      options: {
        baseUrl: requiredEnvironment('EPHEMERAL_VAULT_BASE_URL'),
        roleId,
        secretId,
        authPath: 'approle',
        mountPrefix: 'kv-',
        timeoutMs: 5_000,
      },
    },
    cache: { enabled: false, ttlMs: 1 },
  });
}

async function assertDenied(
  secrets: SecretsClient,
  path: string,
): Promise<void> {
  try {
    await secrets.getRequired(path);
  } catch {
    return;
  }
  throw new Error(`AppRole unexpectedly read disallowed logical path ${path}`);
}

function assertOptIn(): void {
  if (
    process.env.RUN_EPHEMERAL_VAULT_INTEGRATION !== 'true' ||
    process.env.NODE_ENV !== 'test'
  ) {
    throw new Error(
      'Ephemeral Vault validation requires NODE_ENV=test and explicit opt-in',
    );
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

void validateEphemeralVault().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Ephemeral Vault validation failed',
  );
  process.exitCode = 1;
});
