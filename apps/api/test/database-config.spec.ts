import { AppDataSource } from '../src/database/data-source';
import {
  getDatabaseConfig,
  getDatabaseOptions,
} from '../src/config/database.config';

describe('database configuration', () => {
  it('uses the same options and paths for the CLI DataSource', () => {
    const options = getDatabaseOptions(getDatabaseConfig());

    expect(AppDataSource.options).toMatchObject(options);
    expect(AppDataSource.options.entities).toEqual(options.entities);
    expect(AppDataSource.options.migrations).toEqual(options.migrations);
    expect(AppDataSource.options.logging).toBe(options.logging);
    expect(AppDataSource.options.extra).toEqual(options.extra);
  });
});
