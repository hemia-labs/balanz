import { envVarsSchema } from '../src/config/env.validation';

const requiredEnv = {
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'balanz_test',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BCRYPT_SALT_ROUNDS: 10,
};

describe('cookie configuration', () => {
  it('requires secure cookies in production', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      NODE_ENV: 'production',
      APP_CORS_ORIGINS: 'https://app.example',
      COOKIE_SECURE: false,
    });

    expect(error?.message).toContain('COOKIE_SECURE');
  });

  it('rejects SameSite=None without Secure', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      NODE_ENV: 'development',
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'none',
    });

    expect(error?.message).toContain('COOKIE_SAME_SITE');
  });

  it('accepts cross-site cookies with Secure', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      NODE_ENV: 'production',
      APP_CORS_ORIGINS: 'https://app.example',
      COOKIE_SECURE: true,
      COOKIE_SAME_SITE: 'none',
    });

    expect(error).toBeUndefined();
  });
});
