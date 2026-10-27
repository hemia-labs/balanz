/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import * as dotenv from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { createClient } from 'redis';
import { CorrelationIdService } from '../src/common/correlation/correlation-id.service';
import type { FiscalEventLogger } from '../src/common/observability/fiscal-event-logger.service';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import type { FiscalPlatformConfig } from '../src/config/fiscal-platform.config';
import { withRuntimeDatabaseRole } from '../src/config/database.config';
import {
  resolveRuntimeDatabaseCredential,
  type RuntimeDatabaseCredential,
} from '../src/database/database-options.factory';
import { RuntimeDatabaseGuard } from '../src/database/runtime-database-guard.service';
import { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import { resolveScriptDatabaseOptions } from '../src/database/scripts/script-database-options';
import {
  IngestionJobSourceType,
  IngestionJobStatus,
} from '../src/modules/ingestion/entities/ingestion-job.entity';
import {
  IngestionUploadType,
  IngestionUploadWorkflow,
} from '../src/modules/ingestion/entities/ingestion-upload.entity';
import {
  type FiscalIngestionScope,
  IdempotencyConflictError,
  IngestionIdempotencyRepository,
  JobInputConflictError,
} from '../src/modules/ingestion/services/ingestion-idempotency.repository';
import { IngestionJobRepository } from '../src/modules/ingestion/services/ingestion-job.repository';
import {
  IngestionJobRegistry,
  type IngestionJobHandler,
} from '../src/modules/ingestion/workers/ingestion-job.registry';
import { IngestionWorkerRunner } from '../src/modules/ingestion/workers/ingestion-worker.runner';
import {
  ObjectEncryptionClass,
  StorageProvider,
  StoredObjectKind,
} from '../src/modules/object-storage/entities/stored-object.entity';
import { OpaqueObjectKeyFactory } from '../src/modules/object-storage/services/opaque-object-key.factory';
import { shutdownRedisClient } from '../src/modules/redis/redis-client-shutdown';
import type { RedisClient } from '../src/modules/redis/redis.module';
import { RedisWakeupService } from '../src/modules/redis/redis-wakeup.service';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

interface TenantFixtureIds {
  roleId: string;
  userIds: string[];
  organizationIds: string[];
  membershipIds: string[];
  clientAccountIds: string[];
  legalEntityIds: string[];
}

interface TenantFixtures {
  scopeA: FiscalIngestionScope;
  scopeB: FiscalIngestionScope;
  inactiveMembershipId: string;
  ids: TenantFixtureIds;
}

interface WakeupStub {
  calls: number;
  subscriptions: number;
  publishJobsAvailable(): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}

const SAFE_ROLE = /^[a-z][a-z0-9_]{1,62}$/;

async function validateFiscalFoundationRuntime(): Promise<void> {
  if (
    !['development', 'test'].includes(process.env.NODE_ENV ?? 'development')
  ) {
    throw new Error('Runtime validation is restricted to development/test');
  }
  const options = await resolveScriptDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('Runtime validation requires PostgreSQL');
  }
  const [apiCredential, workerCredential] = await Promise.all([
    resolveRuntimeDatabaseCredential('api'),
    resolveRuntimeDatabaseCredential('worker'),
  ]);
  assertRuntimeCredentialTargets(options, [apiCredential, workerCredential]);

  const admin = new DataSource({ ...options, logging: false });
  let api: DataSource | undefined;
  let worker: DataSource | undefined;
  let runtimeRunner: IngestionWorkerRunner | undefined;
  let offlineRedisPublisher: RedisClient | undefined;
  let offlineWakeup: RedisWakeupService | undefined;
  let onlineRedisPublisher: RedisClient | undefined;
  let onlineWakeup: RedisWakeupService | undefined;
  let tenantFixtures: TenantFixtures | undefined;
  const suffix = randomBytes(6).toString('hex');
  const apiRole = apiCredential.username;
  const workerRole = workerCredential.username;
  const apiPassword = apiCredential.password;
  const workerPassword = workerCredential.password;
  const rogueRole = `balanz_api_rogue_${suffix}`;
  const roguePassword = randomBytes(24).toString('hex');
  const runtimeOwnedFunction = `balanz_runtime_owned_${suffix}`;
  const correlations: string[] = [];
  let rogueRoleCreated = false;
  let rogueMembershipGranted = false;
  let apiDirectAclGranted = false;
  let workerDirectAclGranted = false;
  let runtimeOwnedFunctionCreated = false;
  let advisoryLocked = false;
  let validationError: unknown;
  const cleanupErrors: Error[] = [];
  const report: Record<string, unknown> = {};

  try {
    await admin.initialize();
    const databaseState = await admin.query(`
      SELECT
        current_database() AS database_name,
        current_user,
        role.rolsuper,
        to_regclass('public.stored_objects') IS NOT NULL AS foundation_applied
      FROM pg_roles AS role
      WHERE role.rolname = current_user
    `);
    const state = databaseState[0];
    if (
      !state ||
      !(
        state.database_name.startsWith('test_') ||
        state.database_name.endsWith('_test')
      ) ||
      process.env.QA_ALLOW_FISCAL_RUNTIME_VALIDATION !== 'true'
    ) {
      throw new Error(
        'Runtime validation requires a dedicated test_*/*_test database and QA_ALLOW_FISCAL_RUNTIME_VALIDATION=true',
      );
    }
    if (!state.rolsuper) {
      throw new Error('A development migrator role is required for QA logins');
    }
    if (!state.foundation_applied) {
      throw new Error(
        'Phase 0 migrations must be committed before runtime concurrency validation',
      );
    }

    const lockRows = await admin.query(
      `SELECT pg_try_advisory_lock(hashtextextended('balanz:cfdi:runtime-validator', 55321)) AS acquired`,
    );
    if (!lockRows[0]?.acquired) {
      throw new Error('Another fiscal runtime validator is already active');
    }
    advisoryLocked = true;

    tenantFixtures = await createTenantFixtures(admin, suffix);
    const scope = tenantFixtures.scopeA;
    const otherTenantScope = tenantFixtures.scopeB;
    report.tenantFixtures = {
      organizations: 2,
      activeMemberships: 2,
      inactiveMemberships: 1,
      source: 'synthetic',
    };

    assertRoleName(apiRole);
    assertRoleName(workerRole);
    assertRoleName(rogueRole);

    api = new DataSource(
      runtimeOptions(options, apiRole, apiPassword, 'balanz_api'),
    );
    worker = new DataSource(
      runtimeOptions(options, workerRole, workerPassword, 'balanz_worker'),
    );
    await Promise.all([api.initialize(), worker.initialize()]);

    let apiDirectAclRejected = false;
    await admin.query(
      `GRANT SELECT (id) ON TABLE ingestion_jobs TO ${quoteIdentifier(apiRole)}`,
    );
    apiDirectAclGranted = true;
    try {
      await new RuntimeDatabaseGuard(api, 'api').onApplicationBootstrap();
    } catch {
      apiDirectAclRejected = true;
    } finally {
      await admin.query(
        `REVOKE SELECT (id) ON TABLE ingestion_jobs FROM ${quoteIdentifier(apiRole)}`,
      );
      apiDirectAclGranted = false;
    }
    assert(
      apiDirectAclRejected,
      'runtime API login with a direct public column ACL must fail guard',
    );

    let workerDirectAclRejected = false;
    await admin.query(
      `GRANT EXECUTE ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer, integer) TO ${quoteIdentifier(workerRole)}`,
    );
    workerDirectAclGranted = true;
    try {
      await new RuntimeDatabaseGuard(worker, 'worker').onApplicationBootstrap();
    } catch {
      workerDirectAclRejected = true;
    } finally {
      await admin.query(
        `REVOKE EXECUTE ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer, integer) FROM ${quoteIdentifier(workerRole)}`,
      );
      workerDirectAclGranted = false;
    }
    assert(
      workerDirectAclRejected,
      'runtime worker login with a direct public function ACL must fail guard',
    );

    await admin.query(
      `CREATE FUNCTION public.${quoteIdentifier(runtimeOwnedFunction)}() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'`,
    );
    runtimeOwnedFunctionCreated = true;
    await admin.query(
      `ALTER FUNCTION public.${quoteIdentifier(runtimeOwnedFunction)}() OWNER TO ${quoteIdentifier(apiRole)}`,
    );
    let runtimeOwnershipRejected = false;
    try {
      await new RuntimeDatabaseGuard(api, 'api').onApplicationBootstrap();
    } catch (error) {
      runtimeOwnershipRejected =
        error instanceof Error && error.message.includes('public_object_owner');
    } finally {
      await admin.query(
        `DROP FUNCTION public.${quoteIdentifier(runtimeOwnedFunction)}()`,
      );
      runtimeOwnedFunctionCreated = false;
    }
    assert(
      runtimeOwnershipRejected,
      'runtime API login that owns a public function must fail guard',
    );

    await new RuntimeDatabaseGuard(api, 'api').onApplicationBootstrap();
    await admin.query(
      `CREATE ROLE ${quoteIdentifier(rogueRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${roguePassword}'`,
    );
    rogueRoleCreated = true;
    await admin.query(
      `GRANT balanz_api TO ${quoteIdentifier(rogueRole)} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
    );
    rogueMembershipGranted = true;
    let siblingMembershipRejected = false;
    try {
      await new RuntimeDatabaseGuard(api, 'api').onApplicationBootstrap();
    } catch (error) {
      siblingMembershipRejected =
        error instanceof Error &&
        error.message.includes('unexpected_runtime_group_member');
    } finally {
      await admin.query(`REVOKE balanz_api FROM ${quoteIdentifier(rogueRole)}`);
      rogueMembershipGranted = false;
      await admin.query(`DROP ROLE ${quoteIdentifier(rogueRole)}`);
      rogueRoleCreated = false;
    }
    assert(
      siblingMembershipRejected,
      'runtime API group with a SET-only sibling member must fail guard',
    );

    await new RuntimeDatabaseGuard(api, 'api').onApplicationBootstrap();
    await new RuntimeDatabaseGuard(worker, 'worker').onApplicationBootstrap();
    const [selectedApiCapabilities] = await api.query<
      Array<{ ready: boolean }>
    >(`
      SELECT COALESCE(bool_and(
        has_table_privilege(current_user, format('public.%I', relation_name), 'SELECT') = can_select
        AND has_table_privilege(current_user, format('public.%I', relation_name), 'INSERT') = can_insert
        AND has_table_privilege(current_user, format('public.%I', relation_name), 'UPDATE') = can_update
        AND has_table_privilege(current_user, format('public.%I', relation_name), 'DELETE') = can_delete
      ), false) AS ready
      FROM (VALUES
        ('auth_factors', true, true, true, false),
        ('auth_rate_limits', true, true, true, false),
        ('email_verification_tokens', true, true, true, false),
        ('roles', true, false, false, false),
        ('memberships', true, true, true, false),
        ('organizations', true, true, false, false),
        ('permissions', true, false, false, false),
        ('role_permissions', true, false, false, false),
        ('auth_sessions', true, true, true, false),
        ('subscriptions', true, true, true, false),
        ('users', true, true, true, false),
        ('client_accounts', true, true, true, false),
        ('legal_entities', true, true, true, false),
        ('account_assignments', true, true, true, false),
        ('fiscal_years', true, true, false, false),
        ('periods', true, true, true, false),
        ('password_reset_tokens', true, true, true, false),
        ('membership_permissions', true, true, true, false),
        ('fiscal_operations', true, true, true, false),
        ('object_access_grants', true, true, true, false),
        ('private_objects', true, false, false, false),
        ('audit_events', false, true, false, false)
      ) AS requirement(
        relation_name, can_select, can_insert, can_update, can_delete
      )
    `);
    const [selectedWorkerCapabilities] = await worker.query<
      Array<{ ready: boolean }>
    >(`
      SELECT
        has_function_privilege(
          current_user,
          'public.claim_ingestion_job(text,text,text[],integer,integer,integer,integer)',
          'EXECUTE'
        )
        AND has_function_privilege(
          current_user,
          'public.ingestion_queue_ages(text[],integer,integer)',
          'EXECUTE'
        )
        AND has_function_privilege(
          current_user,
          'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer,integer)',
          'EXECUTE'
        ) AS ready
    `);
    assert(
      selectedApiCapabilities?.ready,
      'API runtime connection must select the complete application-table ACL',
    );
    assert(
      selectedWorkerCapabilities?.ready,
      'worker runtime connection must select only the current durable-job functions',
    );
    report.runtimeGuards = {
      safePrincipals: 'PASSED',
      selectedApiGroupCapabilities: 'PASSED',
      selectedWorkerGroupCapabilities: 'PASSED',
      apiDirectColumnAclRejected: apiDirectAclRejected,
      workerDirectFunctionAclRejected: workerDirectAclRejected,
      runtimePublicFunctionOwnershipRejected: runtimeOwnershipRejected,
      setOnlySiblingMembershipRejected: siblingMembershipRejected,
    };

    const apiTransactions = new FiscalTenantTransactionService(api);
    const workerTransactions = new FiscalTenantTransactionService(worker);
    const [apiPrivileges] = await apiTransactions.run(scope, (manager) =>
      manager.query<
        Array<{
          current_user: string;
          can_select_jobs: boolean;
          can_insert_job_id: boolean;
          can_update_jobs: boolean;
        }>
      >(`SELECT
           current_user,
           has_table_privilege(current_user, 'ingestion_jobs', 'SELECT')
             AS can_select_jobs,
           has_column_privilege(current_user, 'ingestion_jobs', 'id', 'INSERT')
             AS can_insert_job_id,
           has_table_privilege(current_user, 'ingestion_jobs', 'UPDATE')
             AS can_update_jobs`),
    );
    report.apiRuntimePrivileges = apiPrivileges;
    assert(
      apiPrivileges?.current_user === 'balanz_api' &&
        apiPrivileges.can_select_jobs &&
        apiPrivileges.can_insert_job_id &&
        !apiPrivileges.can_update_jobs,
      `balanz_api must have the least privileges required to reserve jobs: ${JSON.stringify(apiPrivileges)}`,
    );
    const keyFactory = new OpaqueObjectKeyFactory('objects');
    const metrics = new FiscalMetricsService();
    const wakeup: WakeupStub = {
      calls: 0,
      subscriptions: 0,
      publishJobsAvailable(): Promise<boolean> {
        wakeup.calls += 1;
        return Promise.resolve(false);
      },
      subscribe(): () => void {
        wakeup.subscriptions += 1;
        return () => undefined;
      },
    };
    const config = runtimeConfig();
    const idempotency = new IngestionIdempotencyRepository(
      apiTransactions,
      wakeup as unknown as RedisWakeupService,
      metrics,
      keyFactory,
      config,
    );
    const jobs = new IngestionJobRepository(workerTransactions, config);

    let missingMembershipClosed = false;
    try {
      await apiTransactions.run(
        { organizationId: scope.organizationId } as never,
        () => Promise.resolve(undefined),
      );
    } catch {
      missingMembershipClosed = true;
    }
    assert(missingMembershipClosed, 'API scope without membership must fail');

    const uploadCorrelation = randomUUID();
    correlations.push(uploadCorrelation);
    const idempotencyKey = `qa-upload-${suffix}`;
    const baseIntent = {
      scope,
      workflow: IngestionUploadWorkflow.DIRECT,
      uploadType: IngestionUploadType.MANUAL_XML,
      idempotencyKey,
      requestFingerprint: 'a'.repeat(64),
      idempotencyExpiresAt: futureMinutes(30),
      correlationId: uploadCorrelation,
      object: {
        kind: StoredObjectKind.MANUAL_XML,
        storageProvider: StorageProvider.LOCAL,
        storageContainer: 'fiscal-private',
        encryptionClass: ObjectEncryptionClass.FISCAL,
      },
    } as const;
    const concurrentIntents = await Promise.all([
      idempotency.createUploadIntent({
        ...baseIntent,
        object: { ...baseIntent.object, objectKey: keyFactory.create() },
      }),
      idempotency.createUploadIntent({
        ...baseIntent,
        object: { ...baseIntent.object, objectKey: keyFactory.create() },
      }),
    ]);
    assertEqual(
      concurrentIntents.filter((result) => result.outcome === 'created').length,
      1,
      'concurrent upload creator count',
    );
    assertEqual(
      concurrentIntents.filter((result) => result.outcome === 'replayed')
        .length,
      1,
      'concurrent upload replay count',
    );
    assertEqual(
      concurrentIntents[0].value.uploadId,
      concurrentIntents[1].value.uploadId,
      'deterministic upload replay',
    );

    let fingerprintConflict = false;
    try {
      await idempotency.createUploadIntent({
        ...baseIntent,
        requestFingerprint: 'b'.repeat(64),
        object: { ...baseIntent.object, objectKey: keyFactory.create() },
      });
    } catch (error) {
      fingerprintConflict =
        error instanceof IdempotencyConflictError &&
        error.code === 'IDEMPOTENCY_CONFLICT';
    }
    assert(fingerprintConflict, 'fingerprint mismatch must be typed');

    let provenanceConflict = false;
    try {
      await idempotency.createUploadIntent({
        ...baseIntent,
        idempotencyKey: `${idempotencyKey}-provenance`,
        correlationId: randomUUID(),
        object: {
          ...baseIntent.object,
          kind: StoredObjectKind.MANUAL_ZIP,
          objectKey: keyFactory.create(),
        },
      });
    } catch (error) {
      provenanceConflict = error instanceof JobInputConflictError;
    }
    assert(provenanceConflict, 'upload/object provenance mismatch must fail');

    const upload = concurrentIntents[0].value;
    const uploadExpiryRows = await admin.query<Array<{ ttl_hours: number }>>(
      `SELECT extract(epoch FROM (upload_expires_at - created_at)) / 3600.0
         AS ttl_hours
       FROM ingestion_uploads
       WHERE id = $1`,
      [upload.uploadId],
    );
    const uploadTtlHours = Number(uploadExpiryRows[0]?.ttl_hours);
    assert(
      uploadTtlHours >= 23.99 && uploadTtlHours <= 24.01,
      'upload expiration must be derived from PostgreSQL at the configured 24-hour limit',
    );
    const unknownMembershipRows = await apiTransactions.run(
      { organizationId: scope.organizationId, membershipId: randomUUID() },
      async (manager) =>
        Number(
          (
            await manager.query<Array<{ count: number }>>(
              `SELECT count(*)::integer AS count
                 FROM stored_objects
                WHERE id = $1`,
              [upload.objectId],
            )
          )[0]?.count ?? 0,
        ),
    );
    const crossTenantMembershipRows = await apiTransactions.run(
      {
        organizationId: scope.organizationId,
        membershipId: otherTenantScope.membershipId,
      },
      async (manager) =>
        Number(
          (
            await manager.query<Array<{ count: number }>>(
              `SELECT count(*)::integer AS count
                 FROM stored_objects
                WHERE id = $1`,
              [upload.objectId],
            )
          )[0]?.count ?? 0,
        ),
    );
    const inactiveMembershipRows = await apiTransactions.run(
      {
        organizationId: scope.organizationId,
        membershipId: tenantFixtures.inactiveMembershipId,
      },
      async (manager) =>
        Number(
          (
            await manager.query<Array<{ count: number }>>(
              `SELECT count(*)::integer AS count
                 FROM stored_objects
                WHERE id = $1`,
              [upload.objectId],
            )
          )[0]?.count ?? 0,
        ),
    );
    assertEqual(unknownMembershipRows, 0, 'unknown membership RLS');
    assertEqual(crossTenantMembershipRows, 0, 'cross-tenant membership RLS');
    assertEqual(inactiveMembershipRows, 0, 'inactive membership RLS');

    const realDateNow = Date.now;
    let databaseClockReplay: Awaited<
      ReturnType<IngestionIdempotencyRepository['createUploadIntent']>
    >;
    try {
      Date.now = () => realDateNow() + 365 * 24 * 60 * 60 * 1_000;
      databaseClockReplay = await idempotency.createUploadIntent({
        ...baseIntent,
        object: { ...baseIntent.object, objectKey: keyFactory.create() },
      });
    } finally {
      Date.now = realDateNow;
    }
    assertEqual(
      databaseClockReplay.outcome,
      'replayed',
      'idempotency expiry uses PostgreSQL clock',
    );
    const pendingJobCorrelation = randomUUID();
    correlations.push(pendingJobCorrelation);
    let pendingJobRejected = false;
    let pendingJobError: unknown;
    try {
      await idempotency.createJob({
        scope,
        sourceType: IngestionJobSourceType.MANUAL_XML,
        idempotencyKey: `qa-pending-job-${suffix}`,
        requestFingerprint: 'c'.repeat(64),
        idempotencyExpiresAt: futureMinutes(30),
        correlationId: pendingJobCorrelation,
        status: IngestionJobStatus.QUEUED,
        uploadId: upload.uploadId,
        rootObjectId: upload.objectId,
        requestedByMembershipId: scope.membershipId,
      });
    } catch (error) {
      pendingJobError = error;
      pendingJobRejected = error instanceof JobInputConflictError;
    }
    assert(
      pendingJobRejected,
      `queued job over pending bytes must fail: ${errorMessage(pendingJobError)}`,
    );

    try {
      Date.now = () => realDateNow() + 365 * 24 * 60 * 60 * 1_000;
      await idempotency.confirmUpload({
        scope,
        uploadId: upload.uploadId,
        idempotencyKey: `qa-confirm-${suffix}`,
        requestFingerprint: 'd'.repeat(64),
        idempotencyExpiresAt: futureMinutesFrom(realDateNow(), 30),
        correlationId: uploadCorrelation,
        actualSizeBytes: '4',
        actualSha256: 'e'.repeat(64),
      });
    } finally {
      Date.now = realDateNow;
    }
    let requesterSpoofRejected = false;
    try {
      await idempotency.createJob({
        scope,
        sourceType: IngestionJobSourceType.MANUAL_XML,
        idempotencyKey: `qa-job-requester-spoof-${suffix}`,
        requestFingerprint: '6'.repeat(64),
        idempotencyExpiresAt: futureMinutes(30),
        correlationId: randomUUID(),
        status: IngestionJobStatus.QUEUED,
        uploadId: upload.uploadId,
        rootObjectId: upload.objectId,
        requestedByMembershipId: tenantFixtures.inactiveMembershipId,
      });
    } catch (error) {
      requesterSpoofRejected = error instanceof JobInputConflictError;
    }
    assert(
      requesterSpoofRejected,
      'manual ingestion requester cannot spoof another tenant membership',
    );
    const jobCorrelation = randomUUID();
    correlations.push(jobCorrelation);
    const job = await idempotency.createJob({
      scope,
      sourceType: IngestionJobSourceType.MANUAL_XML,
      idempotencyKey: `qa-job-${suffix}`,
      requestFingerprint: 'f'.repeat(64),
      idempotencyExpiresAt: futureMinutes(30),
      correlationId: jobCorrelation,
      status: IngestionJobStatus.QUEUED,
      uploadId: upload.uploadId,
      rootObjectId: upload.objectId,
      requestedByMembershipId: scope.membershipId,
    });

    const claims = await Promise.all([
      jobs.claimNext(`qa-worker-a-${suffix}`, [
        IngestionJobSourceType.MANUAL_XML,
      ]),
      jobs.claimNext(`qa-worker-b-${suffix}`, [
        IngestionJobSourceType.MANUAL_XML,
      ]),
    ]);
    const claimed = claims.filter((claim) => claim !== null);
    assertEqual(claimed.length, 1, 'two-worker atomic claim');
    assertEqual(claimed[0]?.jobId, job.value.jobId, 'claimed job identity');
    assertEqual(claimed[0]?.attemptCount, 1, 'initial claim attempt');
    assert(
      Number.isFinite(claimed[0]?.queueAgeSeconds),
      'claim queue age metric must be finite',
    );
    const lease = claimed[0];
    if (!lease) throw new Error('Expected one claimed job');
    assertEqual(await jobs.heartbeat(lease), 'renewed', 'repository heartbeat');
    assertEqual(
      await jobs.heartbeat(lease),
      'renewed',
      'repeated lease renewal',
    );
    const leaseState = await admin.query(
      `SELECT extract(epoch FROM lease_expires_at - clock_timestamp())::integer AS seconds
         FROM ingestion_jobs
        WHERE id = $1`,
      [lease.jobId],
    );
    assert(
      Number(leaseState[0]?.seconds) >= 85 &&
        Number(leaseState[0]?.seconds) <= 90,
      'heartbeat must renew a 90 second lease',
    );
    const apiJobs = new IngestionJobRepository(
      new FiscalTenantTransactionService(api),
      runtimeConfig(),
    );
    assertEqual(
      await apiJobs.requestCancellation(
        {
          organizationId: scope.organizationId,
          membershipId: otherTenantScope.membershipId,
        },
        lease.jobId,
      ),
      null,
      'cross-tenant membership cancellation fails closed',
    );
    assertEqual(
      await apiJobs.requestCancellation(
        {
          organizationId: scope.organizationId,
          membershipId: randomUUID(),
        },
        lease.jobId,
      ),
      null,
      'unknown membership cancellation fails closed',
    );
    assertEqual(
      await apiJobs.requestCancellation(scope, lease.jobId),
      IngestionJobStatus.CANCEL_REQUESTED,
      'API cancellation function',
    );
    assertEqual(
      await jobs.heartbeat(lease),
      'cancel_requested',
      'cooperative cancellation heartbeat',
    );
    assert(
      await jobs.complete(lease, IngestionJobStatus.CANCELLED),
      'cancel completion CAS',
    );
    assertEqual(
      await jobs.heartbeat(lease),
      'lost',
      'heartbeat after terminal transition',
    );
    const heartbeatAudits = await admin.query(
      `SELECT count(*)::integer AS count
         FROM audit_events
        WHERE object_id = $1
          AND action = 'ingestion.job.heartbeat'`,
      [lease.jobId],
    );
    assertEqual(
      Number(heartbeatAudits[0]?.count),
      0,
      'lease evaluations do not append heartbeat audit events',
    );
    const counterDirtyRace = await validateCounterDirtyRace(
      admin,
      scope,
      lease.jobId,
      upload.objectId,
    );

    const fairnessCorrelations = [randomUUID(), randomUUID(), randomUUID()];
    correlations.push(...fairnessCorrelations);
    const fairnessJobs = await Promise.all([
      createQueuedManualXmlJob(
        idempotency,
        keyFactory,
        scope,
        fairnessCorrelations[0],
        `qa-fair-a1-${suffix}`,
        '4',
      ),
      createQueuedManualXmlJob(
        idempotency,
        keyFactory,
        scope,
        fairnessCorrelations[1],
        `qa-fair-a2-${suffix}`,
        '5',
      ),
      createQueuedManualXmlJob(
        idempotency,
        keyFactory,
        otherTenantScope,
        fairnessCorrelations[2],
        `qa-fair-b1-${suffix}`,
        '6',
      ),
    ]);
    const concurrentFairClaims = await Promise.all([
      jobs.claimNext(`qa-worker-fair-a-${suffix}`, [
        IngestionJobSourceType.MANUAL_XML,
      ]),
      jobs.claimNext(`qa-worker-fair-b-${suffix}`, [
        IngestionJobSourceType.MANUAL_XML,
      ]),
    ]);
    assert(
      concurrentFairClaims.every((fairClaim) => fairClaim !== null),
      'fairness claims must both acquire work',
    );
    assertEqual(
      new Set(
        concurrentFairClaims.map((fairClaim) => fairClaim?.organizationId),
      ).size,
      2,
      'concurrent workers must distribute across ready tenants',
    );
    for (const fairClaim of concurrentFairClaims) {
      if (!fairClaim) throw new Error('Expected concurrent fairness claim');
      assert(
        await jobs.complete(fairClaim, IngestionJobStatus.COMPLETED),
        'fairness claim completion',
      );
    }
    const remainingFairClaim = await jobs.claimNext(
      `qa-worker-fair-last-${suffix}`,
      [IngestionJobSourceType.MANUAL_XML],
    );
    assert(
      remainingFairClaim !== null &&
        fairnessJobs.some(
          (fairJob) => fairJob.value.jobId === remainingFairClaim.jobId,
        ),
      'remaining fairness job must remain claimable',
    );
    assert(
      await jobs.complete(remainingFairClaim, IngestionJobStatus.COMPLETED),
      'remaining fairness claim completion',
    );

    const recoveryCorrelation = randomUUID();
    correlations.push(recoveryCorrelation);
    const recoveryJob = await createQueuedManualXmlJob(
      idempotency,
      keyFactory,
      scope,
      recoveryCorrelation,
      `qa-recovery-${suffix}`,
      '1',
    );
    const recoveryClaim = await jobs.claimNext(`qa-worker-r-${suffix}`, [
      IngestionJobSourceType.MANUAL_XML,
    ]);
    assertEqual(
      recoveryClaim?.jobId,
      recoveryJob.value.jobId,
      'recovery job claim',
    );
    await admin.query(
      `UPDATE ingestion_jobs
          SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = $1`,
      [recoveryJob.value.jobId],
    );
    const reconciled = await jobs.reconcile(100);
    assertEqual(reconciled.leaseRetryableCount, 1, 'expired lease recovery');
    const dirtyCounterState = await admin.query<
      Array<{
        total_items: number;
        pending_items: number;
        counters_reconciled_at: Date | null;
      }>
    >(
      `SELECT total_items, pending_items, counters_reconciled_at
         FROM ingestion_jobs
        WHERE id = $1`,
      [lease.jobId],
    );
    assertEqual(
      Number(dirtyCounterState[0]?.total_items),
      1,
      'dirty item insert is included by the next counter reconciliation',
    );
    assertEqual(
      Number(dirtyCounterState[0]?.pending_items),
      1,
      'dirty pending item counter is repaired',
    );
    assert(
      dirtyCounterState[0]?.counters_reconciled_at instanceof Date,
      'counter reconciliation marker is restored after repair',
    );
    await admin.query(
      `UPDATE ingestion_jobs SET next_attempt_at = clock_timestamp() WHERE id = $1`,
      [recoveryJob.value.jobId],
    );
    const reclaimed = await jobs.claimNext(`qa-worker-r-${suffix}`, [
      IngestionJobSourceType.MANUAL_XML,
    ]);
    assertEqual(reclaimed?.jobId, recoveryJob.value.jobId, 'ABA reclaim job');
    assert(
      reclaimed?.leaseToken !== recoveryClaim?.leaseToken,
      'each claim must receive a unique lease token',
    );
    if (!recoveryClaim || !reclaimed) throw new Error('Expected ABA claims');
    assert(
      !(await jobs.complete(recoveryClaim, IngestionJobStatus.COMPLETED)),
      'expired lease token must lose CAS after same-worker reclaim',
    );
    assert(
      await jobs.complete(reclaimed, IngestionJobStatus.COMPLETED),
      'new lease token must retain authority',
    );

    const shutdownCorrelation = randomUUID();
    correlations.push(shutdownCorrelation);
    const shutdownJob = await createQueuedManualXmlJob(
      idempotency,
      keyFactory,
      scope,
      shutdownCorrelation,
      `qa-shutdown-${suffix}`,
      '3',
    );
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const shutdownClaim = await jobs.claimNext(
        `qa-worker-shutdown-${suffix}`,
        [IngestionJobSourceType.MANUAL_XML],
      );
      assertEqual(
        shutdownClaim?.jobId,
        shutdownJob.value.jobId,
        `shutdown claim ${attempt}`,
      );
      assertEqual(shutdownClaim?.attemptCount, attempt, 'shutdown attempt');
      if (!shutdownClaim) throw new Error('Expected shutdown claim');
      assert(await jobs.releaseForShutdown(shutdownClaim), 'shutdown release');
    }
    const releasedShutdownState = await admin.query<
      Array<{
        status: string;
        attempt_count: number;
        automatic_retry_count: number;
      }>
    >(
      `SELECT status, attempt_count, automatic_retry_count
         FROM ingestion_jobs WHERE id = $1`,
      [shutdownJob.value.jobId],
    );
    assertEqual(
      releasedShutdownState[0]?.status,
      IngestionJobStatus.QUEUED,
      'repeated shutdown remains claimable',
    );
    assertEqual(
      releasedShutdownState[0]?.attempt_count,
      6,
      'shutdown claims remain monotonic evidence',
    );
    assertEqual(
      releasedShutdownState[0]?.automatic_retry_count,
      0,
      'shutdown does not consume automatic retries',
    );

    const failureRetryDelays: number[] = [];
    for (let failure = 1; failure <= 4; failure += 1) {
      const failureClaim = await jobs.claimNext(`qa-worker-failure-${suffix}`, [
        IngestionJobSourceType.MANUAL_XML,
      ]);
      assertEqual(
        failureClaim?.jobId,
        shutdownJob.value.jobId,
        `retryable failure claim ${failure}`,
      );
      if (!failureClaim) throw new Error('Expected retryable failure claim');
      const retry = await jobs.scheduleRetry(
        failureClaim,
        'MALWARE_SCANNER_UNAVAILABLE',
      );
      assert(retry !== null, 'retryable failure must retain its lease CAS');
      if (failure <= 3) {
        assertEqual(
          retry?.status,
          IngestionJobStatus.FAILED_RETRYABLE,
          `retry ${failure} status`,
        );
        assertEqual(
          retry?.automaticRetryCount,
          failure,
          `retry ${failure} durable budget`,
        );
        const [delayState] = await admin.query<
          Array<{ delay_seconds: number }>
        >(
          `SELECT round(
             extract(epoch FROM next_attempt_at - updated_at)
           )::integer AS delay_seconds
           FROM ingestion_jobs WHERE id = $1`,
          [shutdownJob.value.jobId],
        );
        failureRetryDelays.push(Number(delayState?.delay_seconds));
        await admin.query(
          `UPDATE ingestion_jobs
              SET next_attempt_at = clock_timestamp()
            WHERE id = $1`,
          [shutdownJob.value.jobId],
        );
      } else {
        assertEqual(
          retry?.status,
          IngestionJobStatus.FAILED_FINAL,
          'fourth retryable failure is terminal',
        );
        assertEqual(
          retry?.automaticRetryCount,
          3,
          'terminal failure does not exceed retry budget',
        );
      }
    }
    assertEqual(
      failureRetryDelays.join(','),
      '10,30,120',
      'normal failure retry schedule',
    );
    const shutdownState = await admin.query<
      Array<{
        status: string;
        attempt_count: number;
        automatic_retry_count: number;
      }>
    >(
      `SELECT status, attempt_count, automatic_retry_count
         FROM ingestion_jobs WHERE id = $1`,
      [shutdownJob.value.jobId],
    );
    assertEqual(
      shutdownState[0]?.status,
      IngestionJobStatus.FAILED_FINAL,
      'retry budget exhaustion is terminal',
    );
    assertEqual(
      shutdownState[0]?.attempt_count,
      10,
      'shutdown claims do not block four budgeted executions',
    );
    assertEqual(
      shutdownState[0]?.automatic_retry_count,
      3,
      'automatic retry budget is capped at three',
    );
    const retryAudits = await admin.query<
      Array<{ action: string; count: number }>
    >(
      `SELECT action, count(*)::integer AS count
         FROM audit_events
        WHERE object_id = $1
          AND action IN (
            'ingestion.job.retry_scheduled',
            'ingestion.job.retry_exhausted'
          )
        GROUP BY action`,
      [shutdownJob.value.jobId],
    );
    const retryAuditCounts = new Map(
      retryAudits.map((row) => [row.action, Number(row.count)]),
    );
    assertEqual(
      retryAuditCounts.get('ingestion.job.retry_scheduled'),
      3,
      'retry scheduled audits',
    );
    assertEqual(
      retryAuditCounts.get('ingestion.job.retry_exhausted'),
      1,
      'retry exhausted audit',
    );

    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: () => Promise.resolve('completed'),
    };
    const closedRedisPort = await reserveClosedLoopbackPort();
    offlineRedisPublisher = createClient({
      socket: {
        host: '127.0.0.1',
        port: closedRedisPort,
        connectTimeout: 100,
        reconnectStrategy: false,
      },
    });
    offlineRedisPublisher.on('error', () => undefined);
    offlineWakeup = new RedisWakeupService(
      offlineRedisPublisher,
      config,
      metrics,
    );
    assert(
      !(await offlineWakeup.publishJobsAvailable()),
      'closed-loopback Redis publisher must report unavailable',
    );
    runtimeRunner = new IngestionWorkerRunner(
      config,
      jobs,
      new IngestionJobRegistry([handler]),
      offlineWakeup,
      new CorrelationIdService(),
      metrics,
      { write: () => undefined } as unknown as FiscalEventLogger,
    );
    runtimeRunner.onApplicationBootstrap();
    await eventually(
      () => runtimeRunner?.status().cycles.poll.lastCompletedAt !== undefined,
    );
    const runnerCorrelation = randomUUID();
    correlations.push(runnerCorrelation);
    const runnerJob = await createQueuedManualXmlJob(
      idempotency,
      keyFactory,
      scope,
      runnerCorrelation,
      `qa-runner-${suffix}`,
      '2',
    );
    await eventually(async () => {
      const rows = await admin.query(
        `SELECT status FROM ingestion_jobs WHERE id = $1`,
        [runnerJob.value.jobId],
      );
      return rows[0]?.status === IngestionJobStatus.COMPLETED;
    });
    const offlineRedisStatus = offlineWakeup.status();
    assertEqual(
      offlineRedisStatus.subscriptionFailures,
      0,
      'subscriber attempts while the publisher is unavailable',
    );
    assert(
      !offlineRedisStatus.publisherReady && !offlineRedisStatus.subscriberReady,
      'offline Redis must leave both wakeup clients unavailable',
    );
    await runtimeRunner.onApplicationShutdown();
    runtimeRunner = undefined;
    await offlineWakeup.onApplicationShutdown();
    offlineWakeup = undefined;
    await shutdownRedisClient(offlineRedisPublisher, 100);
    offlineRedisPublisher = undefined;

    let onlineRedisWakeupResult: Record<string, unknown> = {
      status: 'SKIPPED',
      requiredFlag: 'RUN_REDIS_INTEGRATION=true',
    };
    if (process.env.RUN_REDIS_INTEGRATION === 'true') {
      const redisUrl = process.env.REDIS_URL;
      assert(
        typeof redisUrl === 'string' && redisUrl.length > 0,
        'REDIS_URL is required when RUN_REDIS_INTEGRATION=true',
      );
      const onlineConfig = runtimeConfig({
        pollIntervalMs: 30_000,
        redisChannel: `balanz:test:cfdi-phase0-runtime:${suffix}`,
      });
      onlineRedisPublisher = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 1_000,
          reconnectStrategy: false,
        },
      });
      onlineRedisPublisher.on('error', () => undefined);
      await onlineRedisPublisher.connect();
      onlineWakeup = new RedisWakeupService(
        onlineRedisPublisher,
        onlineConfig,
        metrics,
      );
      runtimeRunner = new IngestionWorkerRunner(
        onlineConfig,
        jobs,
        new IngestionJobRegistry([handler]),
        onlineWakeup,
        new CorrelationIdService(),
        metrics,
        { write: () => undefined } as unknown as FiscalEventLogger,
      );
      runtimeRunner.onApplicationBootstrap();
      await eventually(
        () => onlineWakeup?.status().subscriberReady ?? false,
        5_000,
      );
      await eventually(
        () => runtimeRunner?.status().cycles.poll.lastCompletedAt !== undefined,
        5_000,
      );

      const onlineIdempotency = new IngestionIdempotencyRepository(
        apiTransactions,
        onlineWakeup,
        metrics,
        keyFactory,
        onlineConfig,
      );
      const onlineCorrelation = randomUUID();
      correlations.push(onlineCorrelation);
      const onlineStartedAt = Date.now();
      const onlineJob = await createQueuedManualXmlJob(
        onlineIdempotency,
        keyFactory,
        scope,
        onlineCorrelation,
        `qa-runner-redis-online-${suffix}`,
        '8',
      );
      await eventually(async () => {
        const rows = await admin.query(
          `SELECT status FROM ingestion_jobs WHERE id = $1`,
          [onlineJob.value.jobId],
        );
        return rows[0]?.status === IngestionJobStatus.COMPLETED;
      }, 5_000);
      const wakeupLatencyMs = Date.now() - onlineStartedAt;
      assert(
        wakeupLatencyMs < 5_000,
        'Redis wakeup must complete well before the 30-second polling fallback',
      );
      const onlineStatus = onlineWakeup.status();
      assertEqual(onlineStatus.publishFailures, 0, 'online Redis publish');
      onlineRedisWakeupResult = {
        status: 'PASSED',
        pollingFallbackMs: 30_000,
        wakeupLatencyMs,
        publisherReady: onlineStatus.publisherReady,
        subscriberReady: onlineStatus.subscriberReady,
      };
      await runtimeRunner.onApplicationShutdown();
      runtimeRunner = undefined;
      await onlineWakeup.onApplicationShutdown();
      onlineWakeup = undefined;
      await shutdownRedisClient(onlineRedisPublisher, 1_000);
      onlineRedisPublisher = undefined;
    }

    const shutdownRunnerCorrelation = randomUUID();
    correlations.push(shutdownRunnerCorrelation);
    const shutdownRunnerJob = await createQueuedManualXmlJob(
      idempotency,
      keyFactory,
      scope,
      shutdownRunnerCorrelation,
      `qa-runner-shutdown-${suffix}`,
      '7',
    );
    let shutdownRunnerLease:
      | Parameters<IngestionJobHandler['handle']>[0]
      | null = null;
    const blockingHandler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: (handlerClaim, signal) => {
        shutdownRunnerLease = handlerClaim;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error('Worker aborted'),
              ),
            { once: true },
          );
        });
      },
    };
    runtimeRunner = new IngestionWorkerRunner(
      runtimeConfig(),
      jobs,
      new IngestionJobRegistry([blockingHandler]),
      wakeup as unknown as RedisWakeupService,
      new CorrelationIdService(),
      metrics,
      { write: () => undefined } as unknown as FiscalEventLogger,
    );
    runtimeRunner.onApplicationBootstrap();
    await eventually(async () => {
      const rows = await admin.query(
        `SELECT status FROM ingestion_jobs WHERE id = $1`,
        [shutdownRunnerJob.value.jobId],
      );
      return rows[0]?.status === IngestionJobStatus.PROCESSING;
    });
    await runtimeRunner.onApplicationShutdown();
    runtimeRunner = undefined;
    const shutdownRunnerState = await admin.query<
      Array<{
        attempt_count: number;
        automatic_retry_count: number;
        locked_by: string | null;
        status: string;
      }>
    >(
      `SELECT status, attempt_count, automatic_retry_count, locked_by
         FROM ingestion_jobs
        WHERE id = $1`,
      [shutdownRunnerJob.value.jobId],
    );
    assertEqual(
      shutdownRunnerState[0]?.status,
      IngestionJobStatus.QUEUED,
      'real runner shutdown releases durable lease',
    );
    assertEqual(
      shutdownRunnerState[0]?.attempt_count,
      1,
      'real runner shutdown preserves attempt count',
    );
    assertEqual(
      shutdownRunnerState[0]?.automatic_retry_count,
      0,
      'real runner shutdown preserves automatic retry budget',
    );
    assertEqual(
      shutdownRunnerState[0]?.locked_by,
      null,
      'real runner shutdown clears lease token',
    );
    assert(shutdownRunnerLease !== null, 'blocking handler must receive claim');
    assert(
      !(await jobs.complete(shutdownRunnerLease, IngestionJobStatus.COMPLETED)),
      'stale shutdown handler cannot complete a released lease',
    );
    const postShutdownClaim = await jobs.claimNext(
      `qa-worker-after-shutdown-${suffix}`,
      [IngestionJobSourceType.MANUAL_XML],
    );
    assertEqual(
      postShutdownClaim?.jobId,
      shutdownRunnerJob.value.jobId,
      'real shutdown release remains claimable',
    );
    assertEqual(
      postShutdownClaim?.attemptCount,
      2,
      'post-shutdown claim keeps monotonic claim evidence',
    );
    if (!postShutdownClaim) throw new Error('Expected post-shutdown claim');
    assert(
      await jobs.complete(postShutdownClaim, IngestionJobStatus.COMPLETED),
      'post-shutdown execution can complete normally',
    );
    const shutdownReleaseAudits = await admin.query<Array<{ count: number }>>(
      `SELECT count(*)::integer AS count
         FROM audit_events
        WHERE object_id = $1
          AND action = 'ingestion.job.shutdown_released'`,
      [shutdownRunnerJob.value.jobId],
    );
    assertEqual(
      Number(shutdownReleaseAudits[0]?.count),
      1,
      'real runner shutdown release audit',
    );

    report.idempotency = {
      outcomes: concurrentIntents.map((result) => result.outcome).sort(),
      fingerprintConflict,
      provenanceConflict,
      requesterSpoofRejected,
      pendingJobRejected,
      counterDirtyRace,
      postgresClockAuthority: true,
      uploadTtlHours,
      unknownMembershipClosed: unknownMembershipRows === 0,
      crossTenantMembershipClosed: crossTenantMembershipRows === 0,
      inactiveMembershipClosed: inactiveMembershipRows === 0,
    };
    report.worker = {
      claims: claims.map((claim) => claim?.workerId ?? null),
      heartbeat: 'renewed',
      heartbeatLostAfterTerminal: true,
      leaseSecondsAfterHeartbeat: Number(leaseState[0]?.seconds),
      heartbeatAuditEvents: Number(heartbeatAudits[0]?.count),
      cancellation: 'cancelled',
      tenantFairness: concurrentFairClaims.map(
        (fairClaim) => fairClaim?.organizationId,
      ),
      leaseRecovery: reconciled.leaseRetryableCount,
      abaLeaseTokenProtected: true,
      shutdownAttemptBudget: shutdownState[0],
      wakeupsAfterCommit: wakeup.calls,
      pollingWithWakeupOffline: 'completed',
      offlineRedisStatus,
      onlineRedisWakeup: onlineRedisWakeupResult,
      realShutdownRelease: shutdownRunnerState[0],
      staleShutdownHandlerCas: 'lost',
      shutdownReleaseAuditEvents: Number(shutdownReleaseAudits[0]?.count),
      wakeupSubscriptions: wakeup.subscriptions,
    };
    report.metricsContainFoundationSignals =
      metrics.render().includes('ingestion_jobs_created_total') &&
      metrics.render().includes('ingestion_upload_bytes_total');
  } catch (error) {
    validationError = error;
  } finally {
    const runnerToClose = runtimeRunner;
    if (runnerToClose) {
      await captureCleanup(cleanupErrors, 'worker shutdown', () =>
        runnerToClose.onApplicationShutdown(),
      );
    }
    const wakeupToClose = offlineWakeup;
    if (wakeupToClose) {
      await captureCleanup(cleanupErrors, 'offline Redis wakeup close', () =>
        wakeupToClose.onApplicationShutdown(),
      );
    }
    const publisherToClose = offlineRedisPublisher;
    if (publisherToClose) {
      await captureCleanup(cleanupErrors, 'offline Redis publisher close', () =>
        shutdownRedisClient(publisherToClose, 100),
      );
    }
    const onlineWakeupToClose = onlineWakeup;
    if (onlineWakeupToClose) {
      await captureCleanup(cleanupErrors, 'online Redis wakeup close', () =>
        onlineWakeupToClose.onApplicationShutdown(),
      );
    }
    const onlinePublisherToClose = onlineRedisPublisher;
    if (onlinePublisherToClose) {
      await captureCleanup(cleanupErrors, 'online Redis publisher close', () =>
        shutdownRedisClient(onlinePublisherToClose, 1_000),
      );
    }
    const apiToClose = api;
    if (apiToClose?.isInitialized) {
      await captureCleanup(cleanupErrors, 'API datasource close', () =>
        apiToClose.destroy(),
      );
    }
    const workerToClose = worker;
    if (workerToClose?.isInitialized) {
      await captureCleanup(cleanupErrors, 'worker datasource close', () =>
        workerToClose.destroy(),
      );
    }
    if (admin.isInitialized) {
      let objectIds: string[] = [];
      if (correlations.length > 0) {
        try {
          objectIds = await cleanupFixtures(admin, correlations);
        } catch (error) {
          cleanupErrors.push(cleanupError('fixture cleanup', error));
        }
      }
      if (tenantFixtures) {
        await captureCleanup(cleanupErrors, 'tenant fixture cleanup', () =>
          cleanupTenantFixtures(admin, tenantFixtures!.ids),
        );
      }
      if (apiDirectAclGranted) {
        await captureCleanup(cleanupErrors, 'API direct ACL revoke', () =>
          admin.query(
            `REVOKE SELECT (id) ON TABLE ingestion_jobs FROM ${quoteIdentifier(apiRole)}`,
          ),
        );
      }
      if (workerDirectAclGranted) {
        await captureCleanup(cleanupErrors, 'worker direct ACL revoke', () =>
          admin.query(
            `REVOKE EXECUTE ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer, integer) FROM ${quoteIdentifier(workerRole)}`,
          ),
        );
      }
      if (runtimeOwnedFunctionCreated) {
        await captureCleanup(cleanupErrors, 'runtime-owned function drop', () =>
          admin.query(
            `DROP FUNCTION IF EXISTS public.${quoteIdentifier(runtimeOwnedFunction)}()`,
          ),
        );
      }
      if (rogueMembershipGranted) {
        await captureCleanup(cleanupErrors, 'rogue membership revoke', () =>
          admin.query(`REVOKE balanz_api FROM ${quoteIdentifier(rogueRole)}`),
        );
      }
      if (rogueRoleCreated) {
        await captureCleanup(cleanupErrors, 'rogue role drop', () =>
          admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(rogueRole)}`),
        );
      }
      if (advisoryLocked) {
        await captureCleanup(cleanupErrors, 'validator advisory unlock', () =>
          admin.query(
            `SELECT pg_advisory_unlock(hashtextextended('balanz:cfdi:runtime-validator', 55321))`,
          ),
        );
      }
      await captureCleanup(cleanupErrors, 'cleanup residue verification', () =>
        verifyCleanup(
          admin,
          correlations,
          objectIds,
          [rogueRole],
          tenantFixtures?.ids,
        ),
      );
      await captureCleanup(cleanupErrors, 'admin datasource close', () =>
        admin.destroy(),
      );
    }
  }

  const failures = [validationError, ...cleanupErrors].filter(
    (failure): failure is unknown => failure !== undefined,
  );
  if (failures.length > 0) {
    throw new Error(
      `Fiscal runtime validation failed: ${failures.map(errorMessage).join(' | ')}`,
    );
  }
  console.log(JSON.stringify({ ...report, cleanedUp: true }, null, 2));
}

function assertRuntimeCredentialTargets(
  options: { database?: string; host?: string; port?: number },
  credentials: readonly RuntimeDatabaseCredential[],
): void {
  for (const credential of credentials) {
    assertRoleName(credential.username);
    if (
      credential.database !== options.database ||
      credential.host !== options.host ||
      Number(credential.port) !== Number(options.port)
    ) {
      throw new Error(
        'Runtime credentials and validator must target the same PostgreSQL database',
      );
    }
  }
  if (credentials[0]?.username === credentials[1]?.username) {
    throw new Error('API and worker runtime credentials must be distinct');
  }
}

function runtimeOptions(
  options: DataSourceOptions,
  username: string,
  password: string,
  role: 'balanz_api' | 'balanz_worker',
): DataSourceOptions {
  return withRuntimeDatabaseRole(
    {
      ...options,
      username,
      password,
      logging: false,
      synchronize: false,
      entities: [],
      migrations: [],
    } as DataSourceOptions,
    role,
  );
}

function runtimeConfig(
  overrides: { pollIntervalMs?: number; redisChannel?: string } = {},
): ConfigService {
  const platform = {
    worker: {
      concurrency: 2,
      leaseSeconds: 90,
      heartbeatSeconds: 20,
      maxAttempts: 4,
      maxRetries: 3,
      backoffSeconds: [10, 30, 120],
      backoffJitterPercent: 0,
      pollIntervalMs: overrides.pollIntervalMs ?? 1_000,
      queueMetricsIntervalMs: 30_000,
      reconcileIntervalMs: 60_000,
      shutdownGraceMs: 5_000,
      healthHost: '127.0.0.1',
      healthPort: 0,
    },
    redisWakeup: {
      enabled: true,
      channel: overrides.redisChannel ?? 'balanz:test:cfdi-phase0-runtime',
      timeoutMs: 100,
    },
    retention: {
      incompleteUploadHours: 24,
      duplicateBytesHours: 24,
      orphanGraceMinutes: 60,
      invalidObjectDays: 7,
      malwareQuarantineDays: 30,
      completedObjectDays: 90,
    },
    limits: { activeJobsPerTenant: 4 },
  } as unknown as FiscalPlatformConfig;
  return {
    getOrThrow: (key: string) => {
      if (key !== 'fiscalPlatform') throw new Error(`Unexpected config ${key}`);
      return platform;
    },
  } as unknown as ConfigService;
}

async function validateCounterDirtyRace(
  admin: DataSource,
  scope: FiscalIngestionScope,
  jobId: string,
  objectId: string,
): Promise<{ writerBlocked: boolean; markerCleared: boolean }> {
  const locker = admin.createQueryRunner();
  const writer = admin.createQueryRunner();
  let insertSettled = false;
  let insertPromise: Promise<unknown> | undefined;

  await Promise.all([locker.connect(), writer.connect()]);
  try {
    await Promise.all([locker.startTransaction(), writer.startTransaction()]);
    await locker.query(
      `SELECT id FROM ingestion_jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    insertPromise = writer
      .query(
        `INSERT INTO ingestion_items (
           id, organization_id, client_account_id, legal_entity_id,
           ingestion_job_id, object_id, ordinal, technical_status
         ) VALUES ($1,$2,$3,$4,$5,$6,1,'pending')`,
        [
          randomUUID(),
          scope.organizationId,
          scope.clientAccountId,
          scope.legalEntityId,
          jobId,
          objectId,
        ],
      )
      .then(
        (value) => {
          insertSettled = true;
          return value;
        },
        (error: unknown) => {
          insertSettled = true;
          throw error;
        },
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const writerBlocked = !insertSettled;
    assert(
      writerBlocked,
      'item trigger must wait behind the reconciler parent-row lock',
    );

    await locker.query(
      `UPDATE ingestion_jobs
          SET counters_reconciled_at = clock_timestamp()
        WHERE id = $1`,
      [jobId],
    );
    await locker.commitTransaction();
    await insertPromise;
    await writer.commitTransaction();

    const markerRows = await admin.query<
      Array<{ counters_reconciled_at: Date | null }>
    >(`SELECT counters_reconciled_at FROM ingestion_jobs WHERE id = $1`, [
      jobId,
    ]);
    const markerCleared = markerRows[0]?.counters_reconciled_at === null;
    assert(
      markerCleared,
      'committed item mutation must clear a newer counter marker',
    );
    return { writerBlocked, markerCleared };
  } finally {
    if (locker.isTransactionActive) await locker.rollbackTransaction();
    if (insertPromise) await insertPromise.catch(() => undefined);
    if (writer.isTransactionActive) await writer.rollbackTransaction();
    await Promise.all([locker.release(), writer.release()]);
  }
}

async function createQueuedManualXmlJob(
  idempotency: IngestionIdempotencyRepository,
  keyFactory: OpaqueObjectKeyFactory,
  scope: FiscalIngestionScope,
  correlationId: string,
  keyPrefix: string,
  fingerprintDigit: string,
) {
  const fingerprint = fingerprintDigit.repeat(64);
  const intent = await idempotency.createUploadIntent({
    scope,
    workflow: IngestionUploadWorkflow.DIRECT,
    uploadType: IngestionUploadType.MANUAL_XML,
    idempotencyKey: `${keyPrefix}-upload`,
    requestFingerprint: fingerprint,
    idempotencyExpiresAt: futureMinutes(30),
    correlationId,
    object: {
      kind: StoredObjectKind.MANUAL_XML,
      storageProvider: StorageProvider.LOCAL,
      storageContainer: 'fiscal-private',
      objectKey: keyFactory.create(),
      encryptionClass: ObjectEncryptionClass.FISCAL,
    },
  });
  await idempotency.confirmUpload({
    scope,
    uploadId: intent.value.uploadId,
    idempotencyKey: `${keyPrefix}-confirm`,
    requestFingerprint: fingerprint,
    idempotencyExpiresAt: futureMinutes(30),
    correlationId,
    actualSizeBytes: '4',
    actualSha256: fingerprint,
  });
  return idempotency.createJob({
    scope,
    sourceType: IngestionJobSourceType.MANUAL_XML,
    idempotencyKey: `${keyPrefix}-job`,
    requestFingerprint: fingerprint,
    idempotencyExpiresAt: futureMinutes(30),
    correlationId,
    status: IngestionJobStatus.QUEUED,
    uploadId: intent.value.uploadId,
    rootObjectId: intent.value.objectId,
    requestedByMembershipId: scope.membershipId,
  });
}

async function createTenantFixtures(
  admin: DataSource,
  suffix: string,
): Promise<TenantFixtures> {
  const [accountantRole] = await admin.query<Array<{ id: string }>>(
    `SELECT id FROM roles WHERE key = 'accountant'`,
  );
  if (!accountantRole) {
    throw new Error('The canonical accountant role must be seeded before QA');
  }
  const roleId = accountantRole.id;
  const userIds = [randomUUID(), randomUUID(), randomUUID()];
  const organizationIds = [randomUUID(), randomUUID()];
  const membershipIds = [randomUUID(), randomUUID(), randomUUID()];
  const clientAccountIds = [randomUUID(), randomUUID()];
  const legalEntityIds = [randomUUID(), randomUUID()];

  await admin.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO users (
         id, first_name, last_name, email, status, password_hash
       ) VALUES
         ($1, 'QA', 'Tenant A', $4, 'active', $7),
         ($2, 'QA', 'Tenant B', $5, 'active', $7),
         ($3, 'QA', 'Inactive', $6, 'active', $7)`,
      [
        userIds[0],
        userIds[1],
        userIds[2],
        `qa-fiscal-a-${suffix}@example.invalid`,
        `qa-fiscal-b-${suffix}@example.invalid`,
        `qa-fiscal-inactive-${suffix}@example.invalid`,
        'qa-runtime-validator-no-login',
      ],
    );
    await manager.query(
      `INSERT INTO organizations (
         id, name, slug, owner_user_id, status
       ) VALUES
         ($1, $3, $5, $7, 'active'),
         ($2, $4, $6, $8, 'active')`,
      [
        organizationIds[0],
        organizationIds[1],
        `QA Fiscal Tenant A ${suffix}`,
        `QA Fiscal Tenant B ${suffix}`,
        `qa-fiscal-a-${suffix}`,
        `qa-fiscal-b-${suffix}`,
        userIds[0],
        userIds[1],
      ],
    );
    await manager.query(
      `INSERT INTO memberships (
         id, organization_id, user_id, role_id, status, joined_at, suspended_at
       ) VALUES
         ($1, $4, $6, $9, 'active', clock_timestamp(), NULL),
         ($2, $5, $7, $9, 'active', clock_timestamp(), NULL),
         ($3, $4, $8, $9, 'suspended', clock_timestamp(), clock_timestamp())`,
      [
        membershipIds[0],
        membershipIds[1],
        membershipIds[2],
        organizationIds[0],
        organizationIds[1],
        userIds[0],
        userIds[1],
        userIds[2],
        roleId,
      ],
    );
    await manager.query(
      `INSERT INTO client_accounts (
         id, organization_id, name, code, status
       ) VALUES
         ($1, $3, $5, $7, 'active'),
         ($2, $4, $6, $8, 'active')`,
      [
        clientAccountIds[0],
        clientAccountIds[1],
        organizationIds[0],
        organizationIds[1],
        `QA Fiscal Account A ${suffix}`,
        `QA Fiscal Account B ${suffix}`,
        `QA-A-${suffix}`,
        `QA-B-${suffix}`,
      ],
    );
    await manager.query(
      `INSERT INTO legal_entities (
         id, organization_id, client_account_id, rfc, legal_name, status
       ) VALUES
         ($1, $3, $5, 'QAA010101AA1', $7, 'active'),
         ($2, $4, $6, 'QAB010101BB2', $8, 'active')`,
      [
        legalEntityIds[0],
        legalEntityIds[1],
        organizationIds[0],
        organizationIds[1],
        clientAccountIds[0],
        clientAccountIds[1],
        `QA Fiscal Legal A ${suffix}`,
        `QA Fiscal Legal B ${suffix}`,
      ],
    );
  });

  return {
    scopeA: {
      organizationId: organizationIds[0],
      clientAccountId: clientAccountIds[0],
      legalEntityId: legalEntityIds[0],
      membershipId: membershipIds[0],
    },
    scopeB: {
      organizationId: organizationIds[1],
      clientAccountId: clientAccountIds[1],
      legalEntityId: legalEntityIds[1],
      membershipId: membershipIds[1],
    },
    inactiveMembershipId: membershipIds[2],
    ids: {
      roleId,
      userIds,
      organizationIds,
      membershipIds,
      clientAccountIds,
      legalEntityIds,
    },
  };
}

async function cleanupFixtures(
  admin: DataSource,
  correlations: string[],
): Promise<string[]> {
  let cleanedObjectIds: string[] = [];
  await admin.transaction(async (manager) => {
    const jobRows = await manager.query(
      `SELECT id FROM ingestion_jobs WHERE correlation_id = ANY($1::uuid[])`,
      [correlations],
    );
    const uploadRows = await manager.query(
      `SELECT id, object_id
         FROM ingestion_uploads
        WHERE correlation_id = ANY($1::uuid[])`,
      [correlations],
    );
    const jobIds = jobRows.map((row) => row.id);
    const uploadIds = uploadRows.map((row) => row.id);
    const objectIds = uploadRows.map((row) => row.object_id);
    cleanedObjectIds = objectIds;
    if (jobIds.length > 0) {
      await manager.query(
        `DELETE FROM ingestion_items WHERE ingestion_job_id = ANY($1::uuid[])`,
        [jobIds],
      );
      await manager.query(
        `DELETE FROM ingestion_jobs WHERE id = ANY($1::uuid[])`,
        [jobIds],
      );
    }
    if (uploadIds.length > 0) {
      await manager.query(
        `DELETE FROM ingestion_uploads WHERE id = ANY($1::uuid[])`,
        [uploadIds],
      );
    }
    if (objectIds.length > 0) {
      await manager.query(
        `DELETE FROM stored_objects WHERE id = ANY($1::uuid[])`,
        [objectIds],
      );
    }
    await manager.query(
      `DELETE FROM audit_events WHERE correlation_id = ANY($1::uuid[])`,
      [correlations],
    );
  });
  return cleanedObjectIds;
}

async function cleanupTenantFixtures(
  admin: DataSource,
  ids: TenantFixtureIds,
): Promise<void> {
  await admin.transaction(async (manager) => {
    await manager.query(
      `DELETE FROM audit_events WHERE organization_id = ANY($1::uuid[])`,
      [ids.organizationIds],
    );
    await manager.query(
      `DELETE FROM legal_entities WHERE id = ANY($1::uuid[])`,
      [ids.legalEntityIds],
    );
    await manager.query(
      `DELETE FROM client_accounts WHERE id = ANY($1::uuid[])`,
      [ids.clientAccountIds],
    );
    await manager.query(`DELETE FROM memberships WHERE id = ANY($1::uuid[])`, [
      ids.membershipIds,
    ]);
    await manager.query(
      `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
      [ids.organizationIds],
    );
    await manager.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      ids.userIds,
    ]);
  });
}

async function verifyCleanup(
  admin: DataSource,
  correlations: string[],
  objectIds: string[],
  roleNames: string[],
  tenantIds?: TenantFixtureIds,
): Promise<void> {
  const emptyIds: string[] = [];
  const rows = await admin.query<
    Array<{
      fixture_count: number;
      object_count: number;
      role_count: number;
      tenant_fixture_count: number;
    }>
  >(
    `SELECT
       (
         (SELECT count(*) FROM ingestion_jobs WHERE correlation_id = ANY($1::uuid[]))
         + (SELECT count(*) FROM ingestion_uploads WHERE correlation_id = ANY($1::uuid[]))
         + (SELECT count(*) FROM audit_events WHERE correlation_id = ANY($1::uuid[]))
       )::integer AS fixture_count,
       (SELECT count(*)::integer FROM stored_objects WHERE id = ANY($2::uuid[])) AS object_count,
       (SELECT count(*)::integer FROM pg_roles WHERE rolname = ANY($3::text[])) AS role_count,
       (
         (SELECT count(*) FROM users WHERE id = ANY($4::uuid[]))
         + (SELECT count(*) FROM organizations WHERE id = ANY($5::uuid[]))
         + (SELECT count(*) FROM memberships WHERE id = ANY($6::uuid[]))
         + (SELECT count(*) FROM client_accounts WHERE id = ANY($7::uuid[]))
         + (SELECT count(*) FROM legal_entities WHERE id = ANY($8::uuid[]))
       )::integer AS tenant_fixture_count`,
    [
      correlations,
      objectIds,
      roleNames,
      tenantIds?.userIds ?? emptyIds,
      tenantIds?.organizationIds ?? emptyIds,
      tenantIds?.membershipIds ?? emptyIds,
      tenantIds?.clientAccountIds ?? emptyIds,
      tenantIds?.legalEntityIds ?? emptyIds,
    ],
  );
  const residue = rows[0];
  if (
    Number(residue?.fixture_count) !== 0 ||
    Number(residue?.object_count) !== 0 ||
    Number(residue?.role_count) !== 0 ||
    Number(residue?.tenant_fixture_count) !== 0
  ) {
    throw new Error('QA fixtures or login roles remain after cleanup');
  }
}

async function captureCleanup(
  errors: Error[],
  label: string,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    errors.push(cleanupError(label, error));
  }
}

function cleanupError(label: string, error: unknown): Error {
  return new Error(`${label}: ${errorMessage(error)}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function quoteIdentifier(value: string): string {
  assertRoleName(value);
  return `"${value}"`;
}

function assertRoleName(value: string): void {
  if (!SAFE_ROLE.test(value)) throw new Error('Unsafe QA role identifier');
}

function futureMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function futureMinutesFrom(epochMilliseconds: number, minutes: number): Date {
  return new Date(epochMilliseconds + minutes * 60_000);
}

async function reserveClosedLoopbackPort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not reserve a loopback QA port'));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function eventually(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the durable worker result');
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

validateFiscalFoundationRuntime().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
