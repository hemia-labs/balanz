import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { resolveDatabaseOptions } from '../database-options.factory';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const PASSWORD_RESET_RETENTION_MS = 24 * 60 * 60 * 1_000;
const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1_000;
const BATCH_SIZE = 1_000;

type DeleteResult = [{ id: string }[], number];

async function deletePasswordResetBatch(
  dataSource: DataSource,
  column: 'expires_at' | 'used_at',
  cutoff: Date,
): Promise<number> {
  const condition =
    column === 'used_at'
      ? '"used_at" IS NOT NULL AND "used_at" < $1'
      : '"expires_at" < $1';
  const result = await dataSource.query<DeleteResult>(
    `DELETE FROM "password_reset_tokens"
     WHERE "id" IN (
       SELECT "id"
       FROM "password_reset_tokens"
       WHERE ${condition}
       ORDER BY "${column}", "id"
       LIMIT $2
     )
     RETURNING "id"`,
    [cutoff, BATCH_SIZE],
  );
  return result[0].length;
}

async function deleteRateLimitBatch(
  dataSource: DataSource,
  cutoff: Date,
): Promise<number> {
  const result = await dataSource.query<DeleteResult>(
    `DELETE FROM "auth_rate_limits"
     WHERE "id" IN (
       SELECT "id"
       FROM "auth_rate_limits"
       WHERE "expires_at" < $1
       ORDER BY "expires_at", "id"
       LIMIT $2
     )
     RETURNING "id"`,
    [cutoff, BATCH_SIZE],
  );
  return result[0].length;
}

async function deleteUntilEmpty(
  deleteBatch: () => Promise<number>,
): Promise<number> {
  let deleted = 0;
  while (true) {
    const batch = await deleteBatch();
    deleted += batch;
    if (batch < BATCH_SIZE) return deleted;
  }
}

async function main(): Promise<void> {
  const dataSource = new DataSource(await resolveDatabaseOptions());
  const startedAt = Date.now();

  try {
    await dataSource.initialize();
    const now = Date.now();
    const passwordResetCutoff = new Date(now - PASSWORD_RESET_RETENTION_MS);
    const rateLimitCutoff = new Date(now - RATE_LIMIT_RETENTION_MS);
    const expiredPasswordReset = await deleteUntilEmpty(() =>
      deletePasswordResetBatch(dataSource, 'expires_at', passwordResetCutoff),
    );
    const usedPasswordReset = await deleteUntilEmpty(() =>
      deletePasswordResetBatch(dataSource, 'used_at', passwordResetCutoff),
    );
    const rateLimits = await deleteUntilEmpty(() =>
      deleteRateLimitBatch(dataSource, rateLimitCutoff),
    );

    console.log(
      JSON.stringify({
        expiredPasswordReset,
        usedPasswordReset,
        rateLimits,
        durationMs: Date.now() - startedAt,
      }),
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : 'UnknownError',
    }),
  );
  process.exitCode = 1;
});
