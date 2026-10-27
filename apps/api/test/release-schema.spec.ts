import { assertReleaseSchema } from '../src/database/scripts/check-release-schema';

const migrations = [{ name: 'First1700000000000' }] as never;

describe('release schema preflight', () => {
  it('only reads migration state from the expected database', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ database: 'balanz_test', table: 'migrations' }])
      .mockResolvedValueOnce([{ name: 'First1700000000000' }]);
    await expect(
      assertReleaseSchema({ query, migrations }, 'balanz_test'),
    ).resolves.toBeUndefined();
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual([
      "SELECT current_database() AS database, to_regclass('public.migrations')::text AS table",
      'SELECT name FROM public.migrations',
    ]);
  });

  it('rejects a wrong database without reading its migration table', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ database: 'other', table: 'migrations' }]);
    await expect(
      assertReleaseSchema({ query, migrations }, 'balanz_test'),
    ).rejects.toThrow('unexpected_database');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects an absent migration table without creating it', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ database: 'balanz_test', table: null }]);
    await expect(
      assertReleaseSchema({ query, migrations }, 'balanz_test'),
    ).rejects.toThrow('pending_migrations');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects pending migrations', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ database: 'balanz_test', table: 'migrations' }])
      .mockResolvedValueOnce([]);
    await expect(
      assertReleaseSchema({ query, migrations }, 'balanz_test'),
    ).rejects.toThrow('pending_migrations');
  });
});
