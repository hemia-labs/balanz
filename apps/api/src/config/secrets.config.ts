import { registerAs } from '@nestjs/config';

export type SecretsRuntimeProfile = 'api' | 'worker';

export function getSecretsConfig(
  env: NodeJS.ProcessEnv = process.env,
  runtimeProfile: SecretsRuntimeProfile,
) {
  return {
    enabled: env.SECRETS_ENABLED === 'true',
    runtimeProfile,
    scope: {
      environment: env.SECRETS_ENVIRONMENT || 'dev',
      category: env.SECRETS_CATEGORY || 'internal',
      owner: env.SECRETS_OWNER || 'balanz',
      // `api` is the existing development Vault taxonomy. Runtime separation
      // is enforced by the profile and AppRole policy, not by inventing a new
      // external namespace. Production validation requires this to be explicit.
      system: env.SECRETS_SYSTEM || 'api',
    },
    vault: {
      baseUrl: env.VAULT_BASE_URL,
      roleId: env.VAULT_ROLE_ID,
      secretId: env.VAULT_SECRET_ID,
      authPath: env.VAULT_AUTH_PATH || 'approle',
      mountPrefix: env.VAULT_MOUNT_PREFIX || 'kv-',
      timeoutMs: Number(env.VAULT_TIMEOUT_MS) || 5_000,
    },
    cache: {
      enabled: env.SECRETS_CACHE_ENABLED !== 'false',
      ttlMs: Number(env.SECRETS_CACHE_TTL_MS) || 60_000,
    },
  };
}

export function secretsConfigForRuntime(profile: SecretsRuntimeProfile) {
  return registerAs('secrets', () => getSecretsConfig(process.env, profile));
}
