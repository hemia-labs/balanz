import { envVarsSchema } from '../src/config/env.validation';

const requiredEnv = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'balanz_test',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BCRYPT_SALT_ROUNDS: 10,
};

describe('auth session environment validation', () => {
  it.each([
    { idle: 300, persist: 300 },
    { idle: 300, persist: 301 },
  ])(
    'rejects persistence interval $persist when idle TTL is $idle',
    ({ idle, persist }) => {
      const { error } = envVarsSchema.validate({
        ...requiredEnv,
        AUTH_SESSION_IDLE_TTL_SECONDS: idle,
        AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS: persist,
      });

      expect(error?.message).toContain(
        'AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS',
      );
    },
  );

  it('allows a persistence interval below a short idle TTL', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      AUTH_SESSION_IDLE_TTL_SECONDS: 60,
      AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS: 30,
    });

    expect(error).toBeUndefined();
  });

  it('allows Horus to remain disabled when both values are empty', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      HORUS_URL: '',
      HORUS_KEY: '',
    });

    expect(error).toBeUndefined();
  });

  it.each([
    { HORUS_URL: 'https://horus.example.test', HORUS_KEY: '' },
    { HORUS_URL: '', HORUS_KEY: 'public-key' },
  ])('rejects partial Horus configuration', (horus) => {
    const { error } = envVarsSchema.validate({ ...requiredEnv, ...horus });

    expect(error?.message).toContain('HORUS_URL and HORUS_KEY');
  });

  it('allows HTTP for Horus outside production', () => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      HORUS_URL: 'http://localhost:4318',
      HORUS_KEY: 'development-key',
    });

    expect(error).toBeUndefined();
  });

  it.each([
    'https://horus.example.test?tenant=x',
    'https://horus.example.test#tenant',
    'https://user:password@horus.example.test',
  ])('rejects Horus URLs with unsafe components: %s', (HORUS_URL) => {
    const { error } = envVarsSchema.validate({
      ...requiredEnv,
      HORUS_URL,
      HORUS_KEY: 'development-key',
    });

    expect(error?.message).toContain(
      'HORUS_URL must not include query, fragment, or credentials',
    );
  });

  it('requires HTTPS for configured Horus in production', () => {
    const productionEnv = {
      ...requiredEnv,
      NODE_ENV: 'production',
      APP_CORS_ORIGINS: 'https://app.example.test',
      EMAIL_APP_URL: 'https://app.example.test',
      COOKIE_SECURE: true,
      HORUS_URL: 'http://horus.example.test',
      HORUS_KEY: 'production-key',
    };
    const { error } = envVarsSchema.validate(productionEnv);

    expect(error?.message).toContain('HORUS_URL must use HTTPS');
  });

  it('allows HTTPS for configured Horus in production', () => {
    const productionEnv = {
      ...requiredEnv,
      NODE_ENV: 'production',
      APP_CORS_ORIGINS: 'https://app.example.test',
      EMAIL_APP_URL: 'https://app.example.test',
      COOKIE_SECURE: true,
      HORUS_URL: 'https://horus.example.test',
      HORUS_KEY: 'production-key',
    };
    const { error } = envVarsSchema.validate(productionEnv);

    expect(error).toBeUndefined();
  });
});
