import {
  getDatabaseConfig,
  getDatabaseOptions,
  withRuntimeDatabaseRole,
} from '../src/config/database.config';
import { resolveDatabaseOptions } from '../src/database/database-options.factory';

describe('database configuration', () => {
  it('uses the same options and paths for the CLI DataSource', async () => {
    const env = {
      ...process.env,
      SECRETS_ENABLED: 'false',
    };
    const options = getDatabaseOptions(getDatabaseConfig(env));
    const resolved = await resolveDatabaseOptions(env);

    expect(resolved).toMatchObject(options);
    expect(resolved.entities).toEqual(options.entities);
    expect(resolved.migrations).toEqual(options.migrations);
    expect(resolved.logging).toBe(options.logging);
    expect(
      (resolved as typeof resolved & { installExtensions?: boolean })
        .installExtensions,
    ).toBe(false);
    expect(resolved.extra).toEqual(options.extra);
    expect(resolved.extra).toMatchObject({ connectionTimeoutMillis: 2_000 });
  });

  it('resolves database options from the secret provider for CLI tasks', async () => {
    const resolved = await resolveDatabaseOptions(
      {
        ...process.env,
        SECRETS_ENABLED: 'true',
      },
      {
        getRequired: jest.fn().mockResolvedValue({
          db_host: 'database.internal',
          db_port: 5433,
          db_username: 'api',
          db_password: 'secret',
          db_database: 'balanz',
          db_logging: true,
        }),
      },
    );

    expect(resolved).toMatchObject({
      host: 'database.internal',
      port: 5433,
      username: 'api',
      password: 'secret',
      database: 'balanz',
      logging: true,
      synchronize: false,
      installExtensions: false,
    });
  });

  it('adds one closed runtime role without changing CLI database options', () => {
    const base = getDatabaseOptions({
      host: 'database.internal',
      port: 5432,
      name: 'balanz',
      logging: false,
      connectionTimeoutMs: 2_000,
    });
    const runtime = withRuntimeDatabaseRole(base, 'balanz_api');

    expect(String((base.extra as { options?: string }).options)).not.toContain(
      'role=',
    );
    expect(String((runtime.extra as { options?: string }).options)).toContain(
      '-c role=balanz_api',
    );
    expect(() => withRuntimeDatabaseRole(runtime, 'balanz_worker')).toThrow(
      'must have one authority',
    );
  });
});
