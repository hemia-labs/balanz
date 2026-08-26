import { registerAs } from '@nestjs/config';

export default registerAs('secrets', () => ({
  enabled: process.env.SECRETS_ENABLED === 'true',
  scope: {
    environment: process.env.SECRETS_ENVIRONMENT || 'dev',
    category: process.env.SECRETS_CATEGORY || 'internal',
    owner: process.env.SECRETS_OWNER || 'hemia',
    system: process.env.SECRETS_SYSTEM || 'api',
  },
  vault: {
    baseUrl: process.env.VAULT_BASE_URL,
    roleId: process.env.VAULT_ROLE_ID,
    secretId: process.env.VAULT_SECRET_ID,
    authPath: process.env.VAULT_AUTH_PATH || 'approle',
    mountPrefix: process.env.VAULT_MOUNT_PREFIX || 'kv-',
    timeoutMs: Number(process.env.VAULT_TIMEOUT_MS) || 5_000,
  },
  cache: {
    enabled: process.env.SECRETS_CACHE_ENABLED !== 'false',
    ttlMs: Number(process.env.SECRETS_CACHE_TTL_MS) || 60_000,
  },
}));
