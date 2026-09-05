import { envVarsSchema } from '../src/config/env.validation';

const requiredEnv = {
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_DATABASE: 'balanz_test',
  DB_API_USERNAME: 'balanz_api_login',
  DB_API_PASSWORD: 'api-runtime-password-for-tests',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BCRYPT_SALT_ROUNDS: 10,
  EMAIL_APP_URL: 'https://app.example',
  EMAIL_COMPANY_ADDRESS: 'Ciudad de México, México',
};

const requiredProductionFiscalEnv = {
  OBJECT_STORAGE_DRIVER: 's3',
  S3_BUCKET: 'balanz-production-private',
  S3_SSE_MODE: 'aws:kms',
  S3_KMS_KEY_ID: 'alias/balanz-fiscal',
  MALWARE_SCANNER_MODE: 'clamav',
};

describe('cookie configuration', () => {
  it('requires secure cookies in production', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      ...requiredProductionFiscalEnv,
      NODE_ENV: 'production',
      APP_CORS_ORIGINS: 'https://app.example',
      COOKIE_SECURE: false,
    });

    expect(error?.message).toContain('COOKIE_SECURE');
  });

  it('rejects SameSite=None without Secure', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      ...requiredProductionFiscalEnv,
      NODE_ENV: 'development',
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'none',
    });

    expect(error?.message).toContain('COOKIE_SAME_SITE');
  });

  it('accepts cross-site cookies with Secure', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      ...requiredProductionFiscalEnv,
      NODE_ENV: 'production',
      APP_CORS_ORIGINS: 'https://app.example',
      COOKIE_SECURE: true,
      COOKIE_SAME_SITE: 'none',
    });

    expect(error).toBeUndefined();
  });
});
