import * as dotenv from 'dotenv';
import type { DataSourceOptions } from 'typeorm';
import { resolveDatabaseOptions } from '../database-options.factory';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const TEST_DATABASE_PATTERN = /^(?:test_[a-z0-9_]+|[a-z0-9_]+_test)$/;

/**
 * Database scripts use the configured development DB by default. An explicit,
 * double-gated override can redirect QA commands to a clearly named test DB
 * without putting Vault credentials into shell history.
 */
export async function resolveScriptDatabaseOptions(): Promise<DataSourceOptions> {
  const options = await resolveDatabaseOptions();
  if (process.env.CFDI_PHASE0_USE_TEST_DATABASE !== 'true') return options;

  const nodeEnvironment = process.env.NODE_ENV ?? 'development';
  const target = process.env.CFDI_PHASE0_TEST_DATABASE?.trim() ?? '';
  if (
    !['development', 'test'].includes(nodeEnvironment) ||
    (process.env.SECRETS_ENABLED === 'true' &&
      (process.env.SECRETS_ENVIRONMENT || 'dev') !== 'dev') ||
    !TEST_DATABASE_PATTERN.test(target) ||
    target.length > 63
  ) {
    throw new Error(
      'The CFDI Phase 0 database override requires dev/test and a lowercase test_* or *_test database',
    );
  }

  return { ...options, database: target, logging: false } as DataSourceOptions;
}
