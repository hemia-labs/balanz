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
});
