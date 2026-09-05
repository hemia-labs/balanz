import { assertPendingPhaseZeroMigrationsUseSuperuser } from '../src/database/scripts/run-migrations';

const phaseZeroMigrations = [
  { name: 'FiscalIngestionFoundation1787690600000' },
  { name: 'FiscalRlsWorkerClaims1787690610000' },
  { name: 'IngestionAutomaticRetryBudget1787690620000' },
];

function dataSourceFixture(
  responses: unknown[],
): Parameters<typeof assertPendingPhaseZeroMigrationsUseSuperuser>[0] {
  const query = jest.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  return {
    migrations: phaseZeroMigrations,
    query,
  } as unknown as Parameters<
    typeof assertPendingPhaseZeroMigrationsUseSuperuser
  >[0];
}

describe('Phase 0 migration authority guard', () => {
  it('fails closed before DDL when Phase 0 is pending for a non-superuser', async () => {
    const dataSource = dataSourceFixture([
      [{ present: false }],
      [{ superuser: false }],
    ]);

    await expect(
      assertPendingPhaseZeroMigrationsUseSuperuser(dataSource),
    ).rejects.toThrow('dedicated ephemeral PostgreSQL superuser/migrator');
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });

  it('allows the dedicated superuser to apply pending Phase 0 migrations', async () => {
    const dataSource = dataSourceFixture([
      [{ present: true }],
      [{ name: phaseZeroMigrations[0].name }],
      [{ superuser: true }],
    ]);

    await expect(
      assertPendingPhaseZeroMigrationsUseSuperuser(dataSource),
    ).resolves.toBeUndefined();
  });

  it('does not require elevated authority after all Phase 0 migrations', async () => {
    const dataSource = dataSourceFixture([
      [{ present: true }],
      phaseZeroMigrations,
    ]);

    await expect(
      assertPendingPhaseZeroMigrationsUseSuperuser(dataSource),
    ).resolves.toBeUndefined();
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });
});
