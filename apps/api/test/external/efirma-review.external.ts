import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { getDatabaseOptions } from '../../src/config/database.config';

describe('Phase 3 review migration regression', () => {
  it('has no entity schema drift and passes the existing migration lifecycle check', async () => {
    if (process.env.RUN_EFIRMA_INTEGRATION !== 'true')
      throw new Error('Isolated QA opt-in required');
    const entries = JSON.parse(
      execFileSync(
        'docker',
        [
          'inspect',
          '--format',
          '{{json .Config.Env}}',
          'balanz-cfdi-phase0-postgres-1',
        ],
        { encoding: 'utf8', windowsHide: true },
      ),
    ) as string[];
    const env = Object.fromEntries(
      entries.map((value) => {
        const at = value.indexOf('=');
        return [value.slice(0, at), value.slice(at + 1)];
      }),
    );
    const database = 'test_efirma_review_' + randomBytes(6).toString('hex');
    const options = getDatabaseOptions({
      host: '127.0.0.1',
      port: 55432,
      username: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      name: env.POSTGRES_DB,
      logging: false,
      connectionTimeoutMs: 3000,
    });
    if (options.type !== 'postgres') throw new Error('PostgreSQL required');
    const admin = new DataSource({ ...options, entities: [], migrations: [] });
    const db = new DataSource({ ...options, database });
    try {
      await admin.initialize();
      await admin.query('CREATE DATABASE "' + database + '"');
      await db.initialize();
      await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await db.runMigrations({ transaction: 'all' });
      const drift = await db.driver.createSchemaBuilder().log();
      // Only generated DDL; never connection options or fixture/credential values.
      expect(drift.upQueries.map((query) => query.query)).toEqual([]);
      expect(drift.downQueries.map((query) => query.query)).toEqual([]);
      const planRunner = db.createQueryRunner();
      await planRunner.connect();
      try {
        await planRunner.startTransaction();
        // Verify that both indexes supply ordering; this is not a production cost benchmark.
        await planRunner.query('SET LOCAL enable_seqscan=off');
        await planRunner.query('SET LOCAL enable_bitmapscan=off');
        const pendingPlan: unknown =
          await planRunner.query(`EXPLAIN (FORMAT JSON) SELECT id FROM efirma_sessions
          WHERE cleanup_completed_at IS NULL AND (reconciled_at IS NULL OR reconciled_at<statement_timestamp()-interval '30 seconds')
          ORDER BY reconciled_at NULLS FIRST,id LIMIT 100 FOR UPDATE SKIP LOCKED`);
        const purgePlan: unknown =
          await planRunner.query(`EXPLAIN (FORMAT JSON) SELECT id,organization_id FROM efirma_sessions
          WHERE cleanup_completed_at IS NOT NULL AND terminal_at<statement_timestamp()-interval '90 days'
          ORDER BY terminal_at,id LIMIT 100`);
        expect(JSON.stringify(pendingPlan)).toContain(
          'ix_efirma_pending_reconcile',
        );
        expect(JSON.stringify(purgePlan)).toContain('ix_efirma_terminal');
        expect(JSON.stringify(pendingPlan)).not.toContain('"Node Type":"Sort"');
        expect(JSON.stringify(purgePlan)).not.toContain('"Node Type":"Sort"');
      } finally {
        if (planRunner.isTransactionActive)
          await planRunner.rollbackTransaction();
        await planRunner.release();
      }
      const output = execFileSync(
        process.execPath,
        [
          '-r',
          'ts-node/register/transpile-only',
          'test/validate-migration-lifecycle.ts',
        ],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 120000,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            SECRETS_ENABLED: 'false',
            DB_HOST: '127.0.0.1',
            DB_PORT: '55432',
            DB_USERNAME: env.POSTGRES_USER,
            DB_PASSWORD: env.POSTGRES_PASSWORD,
            DB_DATABASE: database,
            DB_LOGGING: 'false',
            CFDI_PHASE0_USE_TEST_DATABASE: 'false',
            QA_ALLOW_TRANSACTIONAL_MIGRATION_DOWN_UP: 'false',
          },
        },
      );
      expect(output).toContain('"upQueries": 0');
      expect(output).toContain('"downQueries": 0');
      console.log('Phase 3 review: qa:migrations PASS, zero schema drift');
    } finally {
      if (db.isInitialized) await db.destroy();
      if (admin.isInitialized) {
        await admin.query(
          'DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)',
        );
        await admin.destroy();
      }
    }
  }, 180000);
});
