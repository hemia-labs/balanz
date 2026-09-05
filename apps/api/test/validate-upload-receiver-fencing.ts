import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import {
  FiscalTenantTransactionService,
  type FiscalApiTenantScope,
} from '../src/database/rls/fiscal-tenant-transaction.service';
import { resolveScriptDatabaseOptions } from '../src/database/scripts/script-database-options';
import {
  IngestionIdempotencyRepository,
  type FiscalIngestionScope,
} from '../src/modules/ingestion/services/ingestion-idempotency.repository';
import { OpaqueObjectKeyFactory } from '../src/modules/object-storage/services/opaque-object-key.factory';
import type { RedisWakeupService } from '../src/modules/redis/redis-wakeup.service';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const RECEIVER_LEASE_SECONDS = 5;

interface QaScope extends FiscalIngestionScope {
  userId: string;
}

interface ReceiverState {
  upload_state: string;
  upload_version: number;
  upload_updated_at: Date;
  last_error_code: string | null;
  confirmed_at: Date | null;
  confirm_idempotency_key: string | null;
  actual_size_bytes: string | null;
  actual_sha256: string | null;
  object_state: string;
  object_version: number;
  object_updated_at: Date;
  object_size_bytes: string | null;
  object_sha256: string | null;
  object_deleted_at: Date | null;
}

async function validate(): Promise<void> {
  const options = await resolveScriptDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('Upload receiver fencing QA requires PostgreSQL');
  }
  const database = String(options.database ?? '').toLowerCase();
  if (!database.startsWith('test_') && !database.endsWith('_test')) {
    throw new Error('Upload receiver fencing QA requires an isolated test DB');
  }

  const dataSource = new DataSource({ ...options, logging: false });
  const queryRunner = dataSource.createQueryRunner();
  try {
    await dataSource.initialize();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format('GRANT balanz_api TO %I', current_user);
      END $$
    `);

    const scope = await createScope(queryRunner);
    const transactions = createSavepointApiTransactions(queryRunner);
    const objectKeys = new OpaqueObjectKeyFactory('objects');
    const repository = new IngestionIdempotencyRepository(
      transactions,
      {
        publishJobsAvailable: () => Promise.resolve(false),
      } as unknown as RedisWakeupService,
      new FiscalMetricsService(),
      objectKeys,
      new ConfigService({
        fiscalPlatform: {
          retention: { incompleteUploadHours: 24 },
          limits: { activeJobsPerUser: 2, activeJobsPerTenant: 4 },
          worker: { leaseSeconds: RECEIVER_LEASE_SECONDS },
        },
      }),
    );

    const correlationId = randomUUID();
    const created = await repository.createUploadIntent({
      scope,
      workflow: 'direct',
      uploadType: 'manual_xml',
      idempotencyKey: `qa-receiver-${randomUUID()}`,
      requestFingerprint: 'a'.repeat(64),
      idempotencyExpiresAt: new Date(Date.now() + 60_000),
      correlationId,
      object: {
        kind: 'manual_xml',
        storageProvider: 'local',
        storageContainer: 'fiscal-private',
        objectKey: objectKeys.create(),
        encryptionClass: 'fiscal',
        originalFilename: 'synthetic.xml',
        declaredMimeType: 'application/xml',
      },
    });
    assertEqual(created.outcome, 'created', 'direct upload outcome');
    assertEqual(
      created.value.state,
      'receiving',
      'direct upload initial state',
    );
    assertEqual(created.value.version, 1, 'direct upload initial version');
    assertEqual(
      created.value.receiverVersion,
      1,
      'direct upload receiver fence',
    );

    const activeReceiver = await repository.claimUploadReceiver(
      scope,
      created.value.uploadId,
    );
    assertEqual(activeReceiver.outcome, 'busy', 'active receiver claim');
    assertEqual(activeReceiver.value.version, 1, 'busy claim version');
    assertEqual(
      activeReceiver.value.receiverVersion,
      null,
      'busy claim exposes no fence',
    );

    await queryRunner.query(
      `UPDATE ingestion_uploads
          SET updated_at = clock_timestamp() - make_interval(secs => $5)
        WHERE id = $1
          AND organization_id = $2
          AND client_account_id = $3
          AND legal_entity_id = $4`,
      [
        created.value.uploadId,
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
        RECEIVER_LEASE_SECONDS + 1,
      ],
    );

    const reclaimed = await repository.claimUploadReceiver(
      scope,
      created.value.uploadId,
    );
    assertEqual(reclaimed.outcome, 'claimed', 'stale receiver reclaim');
    assertEqual(reclaimed.value.state, 'receiving', 'reclaimed state');
    assertEqual(reclaimed.value.version, 2, 'reclaim increments version');
    assertEqual(reclaimed.value.receiverVersion, 2, 'reclaimed fence');

    const staleRenewal = await repository.renewUploadReceiver(
      scope,
      created.value.uploadId,
      1,
    );
    assertEqual(staleRenewal, null, 'stale receiver cannot renew');
    assertEqual(
      (await inspectState(queryRunner, created.value.uploadId)).upload_version,
      2,
      'stale renewal leaves version unchanged',
    );

    const renewedVersion = await repository.renewUploadReceiver(
      scope,
      created.value.uploadId,
      2,
    );
    assertEqual(renewedVersion, 3, 'current receiver renews');
    const repeatedOldRenewal = await repository.renewUploadReceiver(
      scope,
      created.value.uploadId,
      2,
    );
    assertEqual(
      repeatedOldRenewal,
      null,
      'superseded receiver version cannot renew',
    );

    const beforeStaleTerminal = await inspectState(
      queryRunner,
      created.value.uploadId,
    );
    let staleConfirmCode: string | undefined;
    try {
      await repository.confirmUpload({
        scope,
        uploadId: created.value.uploadId,
        idempotencyKey: `qa-confirm-${randomUUID()}`,
        requestFingerprint: 'b'.repeat(64),
        idempotencyExpiresAt: new Date(Date.now() + 60_000),
        correlationId,
        actualSizeBytes: '128',
        actualSha256: 'c'.repeat(64),
        detectedMimeType: 'application/xml',
        receiverVersion: 2,
      });
    } catch (error) {
      staleConfirmCode = errorCode(error);
    }
    assertEqual(
      staleConfirmCode,
      'UPLOAD_NOT_CONFIRMABLE',
      'stale receiver cannot confirm',
    );
    assertStateEqual(
      await inspectState(queryRunner, created.value.uploadId),
      beforeStaleTerminal,
      'stale confirm',
    );

    const staleFail = await repository.failUpload(
      scope,
      created.value.uploadId,
      'INGESTION_UPLOAD_ABORTED',
      correlationId,
      2,
    );
    assertEqual(staleFail, false, 'stale receiver cannot fail');
    const afterStaleTerminal = await inspectState(
      queryRunner,
      created.value.uploadId,
    );
    assertStateEqual(afterStaleTerminal, beforeStaleTerminal, 'stale fail');
    assertEqual(
      afterStaleTerminal.object_state,
      'pending_upload',
      'stale receiver does not delete object',
    );

    const [auditState] = (await queryRunner.query(
      `SELECT count(*) FILTER (
                WHERE action IN (
                  'ingestion.upload.confirmed',
                  'ingestion.upload.failed'
                )
              )::integer AS stale_terminal_events
         FROM audit_events
        WHERE correlation_id = $1`,
      [correlationId],
    )) as Array<{ stale_terminal_events: number }>;
    assertEqual(
      auditState?.stale_terminal_events,
      0,
      'stale terminal actions are not audited as successful',
    );

    await queryRunner.rollbackTransaction();
    console.log(
      JSON.stringify(
        {
          mode: 'ISOLATED_TRANSACTIONAL_UPLOAD_RECEIVER_FENCING',
          database,
          directManualXmlStartsReceiving: true,
          activeReceiverBusy: true,
          staleReceiverReclaimedWithNewVersion: true,
          renewalRequiresCurrentVersion: true,
          staleConfirmRejectedWithoutMutation: true,
          staleFailRejectedWithoutDeletion: true,
          outerTransactionRolledBack: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    if (!queryRunner.isReleased) await queryRunner.release();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

function createSavepointApiTransactions(
  queryRunner: QueryRunner,
): FiscalTenantTransactionService {
  let call = 0;
  return {
    run: async <T>(
      scope: FiscalApiTenantScope,
      work: (manager: EntityManager) => Promise<T>,
    ): Promise<T> => {
      call += 1;
      const savepoint = `upload_receiver_call_${call}`;
      await queryRunner.query(`SAVEPOINT ${savepoint}`);
      try {
        await queryRunner.query(`SET LOCAL ROLE balanz_api`);
        await queryRunner.query(
          `SELECT set_config('app.organization_id', $1, true),
                  set_config('app.membership_id', $2, true)`,
          [scope.organizationId, scope.membershipId],
        );
        const result = await work(queryRunner.manager);
        await queryRunner.query(`RESET ROLE`);
        await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    },
  } as FiscalTenantTransactionService;
}

async function createScope(queryRunner: QueryRunner): Promise<QaScope> {
  const suffix = randomBytes(6).toString('hex');
  const [role] = (await queryRunner.query(
    `SELECT id FROM roles WHERE key = 'accountant'`,
  )) as Array<{ id: string }>;
  if (!role) throw new Error('Canonical accountant role is required for QA');

  const scope: QaScope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    clientAccountId: randomUUID(),
    legalEntityId: randomUUID(),
    membershipId: randomUUID(),
  };
  await queryRunner.query(
    `INSERT INTO users (id, first_name, last_name, email, status, password_hash)
     VALUES ($1,'QA','Receiver Fencing',$2,'active','synthetic-no-login')`,
    [scope.userId, `qa-upload-receiver-${suffix}@example.invalid`],
  );
  await queryRunner.query(
    `INSERT INTO organizations (
       id, name, slug, owner_user_id, status, timezone
     ) VALUES ($1,$2,$3,$4,'active','America/Mexico_City')`,
    [
      scope.organizationId,
      `QA Upload Receiver ${suffix}`,
      `qa-upload-receiver-${suffix}`,
      scope.userId,
    ],
  );
  await queryRunner.query(
    `INSERT INTO memberships (
       id, organization_id, user_id, role_id, status, joined_at
     ) VALUES ($1,$2,$3,$4,'active',clock_timestamp())`,
    [scope.membershipId, scope.organizationId, scope.userId, role.id],
  );
  await queryRunner.query(
    `INSERT INTO client_accounts (id, organization_id, name, code, status)
     VALUES ($1,$2,$3,$4,'active')`,
    [
      scope.clientAccountId,
      scope.organizationId,
      `QA Receiver Account ${suffix}`,
      `QA-RCV-${suffix}`,
    ],
  );
  await queryRunner.query(
    `INSERT INTO legal_entities (
       id, organization_id, client_account_id, rfc, legal_name, status
     ) VALUES ($1,$2,$3,'QAR010101AA1',$4,'active')`,
    [
      scope.legalEntityId,
      scope.organizationId,
      scope.clientAccountId,
      `QA Receiver Legal ${suffix}`,
    ],
  );
  return scope;
}

async function inspectState(
  queryRunner: QueryRunner,
  uploadId: string,
): Promise<ReceiverState> {
  const [state] = (await queryRunner.query(
    `SELECT upload.state AS upload_state,
            upload.version::integer AS upload_version,
            upload.updated_at AS upload_updated_at,
            upload.last_error_code,
            upload.confirmed_at,
            upload.confirm_idempotency_key,
            upload.actual_size_bytes::text,
            upload.actual_sha256,
            object.lifecycle_state AS object_state,
            object.version::integer AS object_version,
            object.updated_at AS object_updated_at,
            object.size_bytes::text AS object_size_bytes,
            object.sha256 AS object_sha256,
            object.deleted_at AS object_deleted_at
       FROM ingestion_uploads AS upload
       INNER JOIN stored_objects AS object ON object.id = upload.object_id
      WHERE upload.id = $1`,
    [uploadId],
  )) as ReceiverState[];
  if (!state) throw new Error('Upload receiver state was not found');
  return state;
}

function assertStateEqual(
  actual: ReceiverState,
  expected: ReceiverState,
  label: string,
): void {
  const normalized = (value: ReceiverState) => ({
    ...value,
    upload_updated_at: value.upload_updated_at.toISOString(),
    object_updated_at: value.object_updated_at.toISOString(),
    confirmed_at: value.confirmed_at?.toISOString() ?? null,
    object_deleted_at: value.object_deleted_at?.toISOString() ?? null,
  });
  assertEqual(
    JSON.stringify(normalized(actual)),
    JSON.stringify(normalized(expected)),
    `${label} state`,
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

void validate().catch((error: unknown) => {
  const detail =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : undefined;
  console.error(
    JSON.stringify({
      message:
        typeof detail?.message === 'string' ? detail.message : String(error),
      code: typeof detail?.code === 'string' ? detail.code : null,
    }),
  );
  process.exitCode = 1;
});
