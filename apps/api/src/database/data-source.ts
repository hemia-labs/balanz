import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { resolveDatabaseOptions } from './database-options.factory';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const appDataSource = resolveDatabaseOptions().then(
  (options) => new DataSource(options),
);

export default appDataSource;
