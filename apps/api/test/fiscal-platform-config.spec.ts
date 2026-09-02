import { envVarsSchema } from '../src/config/env.validation';
import { resolve } from 'node:path';
import { resolveLocalStorageRoot } from '../src/config/fiscal-platform.config';

const base = {
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_DATABASE: 'balanz_test',
  DB_API_USERNAME: 'balanz_api_login',
  DB_API_PASSWORD: 'api-runtime-password-for-tests',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BCRYPT_SALT_ROUNDS: 10,
};

const production = {
  ...base,
  NODE_ENV: 'production',
  APP_CORS_ORIGINS: 'https://app.example.test',
  EMAIL_APP_URL: 'https://app.example.test',
  COOKIE_SECURE: true,
  OBJECT_STORAGE_DRIVER: 's3',
  S3_BUCKET: 'balanz-production-private',
  S3_SSE_MODE: 'aws:kms',
  S3_KMS_KEY_ID: 'alias/balanz-fiscal',
  MALWARE_SCANNER_MODE: 'clamav',
};

describe('CFDI Phase 0 environment policy', () => {
  it('resolves the local storage root from the repository, not process cwd', () => {
    expect(resolveLocalStorageRoot('.local/fiscal-object-storage')).toBe(
      resolve(__dirname, '..', '..', '..', '.local', 'fiscal-object-storage'),
    );
  });

  it('accepts the locked production posture', () => {
    expect(envVarsSchema.validate(production).error).toBeUndefined();
  });

  it('pins an enabled production secret manager to the prod scope', () => {
    const productionWithVault = {
      ...production,
      SECRETS_ENABLED: true,
      SECRETS_ENVIRONMENT: 'prod',
      SECRETS_SYSTEM: 'api',
      VAULT_BASE_URL: 'https://vault.example.test',
      VAULT_ROLE_ID: 'production-role-id',
      VAULT_SECRET_ID: 'production-secret-id',
    };

    expect(envVarsSchema.validate(productionWithVault).error).toBeUndefined();
    expect(
      envVarsSchema.validate({
        ...productionWithVault,
        SECRETS_ENVIRONMENT: 'dev',
      }).error?.message,
    ).toContain('SECRETS_ENVIRONMENT=prod');
  });

  it.each([
    ['local object storage', { OBJECT_STORAGE_DRIVER: 'local' }],
    ['disabled scanner', { MALWARE_SCANNER_MODE: 'bypass' }],
    ['non-KMS encryption', { S3_SSE_MODE: 'AES256' }],
    ['plaintext S3 endpoint', { S3_ENDPOINT: 'http://minio:9000' }],
    [
      'Windows local-root attestation',
      { OBJECT_STORAGE_LOCAL_WINDOWS_PRESECURED: true },
    ],
    ['missing API runtime login', { DB_API_USERNAME: '' }],
  ])('fails closed in production for %s', (_case, override) => {
    expect(
      envVarsSchema.validate({ ...production, ...override }).error,
    ).toBeDefined();
  });

  it.each([
    ['WORKER_LEASE_SECONDS', 89],
    ['WORKER_HEARTBEAT_SECONDS', 21],
    ['WORKER_MAX_ATTEMPTS', 4],
    ['WORKER_BACKOFF_SECONDS', '10,30'],
    ['INGESTION_XML_MAX_BYTES', 6 * 1024 * 1024],
    ['INGESTION_ZIP_MAX_ENTRIES', 2_001],
    ['WORKER_MEMORY_TARGET_MIB', 512],
    ['REDIS_WAKEUP_TIMEOUT_MS', 49],
    ['REDIS_WAKEUP_TIMEOUT_MS', 5_001],
    ['METRICS_ENABLED', false],
    ['METRICS_PATH', '/internal/metrics'],
  ])('rejects drift from locked control %s', (name, value) => {
    expect(
      envVarsSchema.validate({ ...base, [name]: value }).error?.message,
    ).toContain(name);
  });

  it('allows scanner bypass only as an explicit development setting', () => {
    expect(
      envVarsSchema.validate({
        ...base,
        NODE_ENV: 'development',
        MALWARE_SCANNER_MODE: 'bypass',
      }).error,
    ).toBeUndefined();
    expect(
      envVarsSchema.validate({
        ...base,
        NODE_ENV: 'test',
        MALWARE_SCANNER_MODE: 'bypass',
      }).error?.message,
    ).toContain('allowed only in explicit development');
  });

  it('rejects a scanner stream limit smaller than an accepted ingestion object', () => {
    expect(
      envVarsSchema.validate({
        ...base,
        CLAMAV_MAX_STREAM_BYTES: 5 * 1024 * 1024,
      }).error?.message,
    ).toContain('CLAMAV_MAX_STREAM_BYTES');
  });

  it('bounds PostgreSQL pool acquisition by the readiness deadline', () => {
    expect(
      envVarsSchema.validate({
        ...base,
        HEALTH_CHECK_TIMEOUT_MS: 1_000,
        DB_CONNECTION_TIMEOUT_MS: 1_001,
      }).error?.message,
    ).toContain('DB_CONNECTION_TIMEOUT_MS');
  });

  it('allows the Windows pre-secured-root attestation only outside production', () => {
    expect(
      envVarsSchema.validate({
        ...base,
        NODE_ENV: 'development',
        OBJECT_STORAGE_LOCAL_WINDOWS_PRESECURED: true,
      }).error,
    ).toBeUndefined();
  });
});
