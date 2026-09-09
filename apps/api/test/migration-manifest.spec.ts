import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MigrationInterface } from 'typeorm';
import { EXPECTED_MIGRATION_IDENTITIES } from '../src/database/scripts/migration-manifest';

describe('migration manifest', () => {
  it('matches every migration file and exported identity exactly', () => {
    const directory = join(__dirname, '../src/database/migrations');
    const actual: Array<{ name: string; timestamp: number }> = [];
    for (const file of readdirSync(directory).filter((name) =>
      /^\d{13}-.+\.ts$/.test(name),
    )) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const exports = require(join(directory, file)) as Record<
        string,
        new () => MigrationInterface
      >;
      expect(Object.values(exports)).toHaveLength(1);
      const Migration = Object.values(exports)[0];
      const migration = new Migration();
      expect(migration.name).toBeDefined();
      actual.push({
        name: migration.name!,
        timestamp: Number(file.slice(0, 13)),
      });
    }
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name);
    expect(actual.sort(byName)).toEqual(
      [...EXPECTED_MIGRATION_IDENTITIES].sort(byName),
    );
  });
});
