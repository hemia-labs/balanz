import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import { DataSource, type DataSourceOptions, type QueryRunner } from 'typeorm';
import { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import { resolveScriptDatabaseOptions } from '../src/database/scripts/script-database-options';
import {
  CFDI_PARSER_VERSION,
  CFDI_SCHEMA_SET_VERSION,
  type CfdiParseResult,
  type ParsedCfdi,
} from '../src/modules/cfdi-parser';
import {
  CfdiWorkerPersistenceService,
  type PersistenceOutcome,
  type WorkerInput,
} from '../src/modules/cfdi/workers/cfdi-worker-persistence.service';
import {
  IngestionJobSourceType,
  IngestionJobStatus,
} from '../src/modules/ingestion/entities/ingestion-job.entity';
import {
  IngestionJobRepository,
  type ClaimResult,
} from '../src/modules/ingestion/services/ingestion-job.repository';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const VALIDATOR_LOCK = 'balanz:cfdi:manual-xml-worker-transitions';
const LOCK_SEED = 74_021;
const OPERATION_TIMEOUT_MS = 1_000;
const WAIT_FOR_BARRIER_MS = 5_000;

interface QaScope {
  userId: string;
  organizationId: string;
  clientAccountId: string;
  legalEntityId: string;
  membershipId: string;
  legalEntityRfc: string;
}

interface JobFixture {
  claim: ClaimResult;
  input: WorkerInput;
}

interface PublicationObservation {
  settled: boolean;
  value?: PersistenceOutcome;
  error?: unknown;
  done: Promise<void>;
}

interface JobItemState {
  job_status: string;
  current_stage: string | null;
  locked_by: string | null;
  next_attempt_at: Date | null;
  job_attempt_count: number;
  automatic_retry_count: number;
  total_items: number;
  pending_items: number;
  processing_items: number;
  incorporated_items: number;
  internal_error_items: number;
  counters_reconciled_at: Date | null;
  item_status: string;
  item_result: string | null;
  item_error_code: string | null;
  item_safe_detail: string | null;
  item_attempt_count: number;
  cfdi_count: number;
}

async function validate(): Promise<void> {
  const baseOptions = await resolveScriptDatabaseOptions();
  if (baseOptions.type !== 'postgres') {
    throw new Error('Manual XML worker transition QA requires PostgreSQL');
  }
  const configuredDatabase = String(baseOptions.database ?? '').toLowerCase();
  if (
    !configuredDatabase.startsWith('test_') &&
    !configuredDatabase.endsWith('_test')
  ) {
    throw new Error(
      'Manual XML worker transition QA requires an isolated test database',
    );
  }

  const suffix = randomBytes(6).toString('hex');
  const applicationName = `cfdi-worker-transitions-${suffix}`;
  const options: DataSourceOptions = {
    ...baseOptions,
    logging: false,
    extra: {
      ...((baseOptions as { extra?: Record<string, unknown> }).extra ?? {}),
      application_name: applicationName,
    },
  };
  const dataSource = new DataSource(options);
  const control = dataSource.createQueryRunner();
  let scope: QaScope | undefined;
  let triggerName: string | undefined;
  let triggerFunction: string | undefined;
  let barrierKey: string | undefined;
  let validatorLocked = false;
  let barrierHeld = false;
  let validationError: unknown;
  const cleanupErrors: Error[] = [];
  let report: Record<string, unknown> = {};

  try {
    await dataSource.initialize();
    await control.connect();
    const [databaseState] = (await control.query(
      `SELECT current_database() AS database_name,
              to_regclass('public.cfdis') IS NOT NULL AS phase_one_applied`,
    )) as Array<{ database_name: string; phase_one_applied: boolean }>;
    if (
      databaseState?.database_name.toLowerCase() !== configuredDatabase ||
      !databaseState.phase_one_applied
    ) {
      throw new Error(
        'Manual XML worker transition QA database/schema precondition failed',
      );
    }
    const [lockState] = (await control.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1, $2)) AS acquired`,
      [VALIDATOR_LOCK, LOCK_SEED],
    )) as Array<{ acquired: boolean }>;
    if (!lockState?.acquired) {
      throw new Error('Another manual XML worker transition QA is active');
    }
    validatorLocked = true;

    scope = await createScope(dataSource, suffix);
    barrierKey = `cfdi-worker-barrier-${suffix}`;
    triggerName = `qa_cfdi_worker_barrier_${suffix}`;
    triggerFunction = `qa_cfdi_worker_barrier_fn_${suffix}`;
    await installPublicationBarrier(
      control,
      scope.organizationId,
      barrierKey,
      triggerName,
      triggerFunction,
    );

    const config = runtimeConfig();
    const transactions = new FiscalTenantTransactionService(dataSource);
    const persistence = new CfdiWorkerPersistenceService(transactions, config);
    const jobs = new IngestionJobRepository(transactions, config);

    const heartbeatFixture = await createJobFixture(
      dataSource,
      scope,
      suffix,
      'slow-heartbeat',
    );
    const heartbeatDocument = syntheticDocument(
      randomUUID(),
      scope.legalEntityRfc,
    );
    await acquireBarrier(control, barrierKey);
    barrierHeld = true;
    const heartbeatPublication = observePublication(
      persistence.publishParsed(
        heartbeatFixture.claim,
        heartbeatFixture.input,
        parsed(heartbeatDocument),
      ),
    );
    await waitForBlockedPublication(
      dataSource,
      applicationName,
      heartbeatPublication,
    );
    assertEqual(
      (
        await inspectJobItem(
          dataSource,
          heartbeatFixture.claim.jobId,
          heartbeatFixture.input.itemId,
          heartbeatDocument.stamp.uuid,
        )
      ).current_stage,
      'persisting',
      'slow persistence stage is committed before fiscal transaction',
    );
    const heartbeatPromise = jobs.heartbeat(heartbeatFixture.claim);
    let heartbeat: string | undefined;
    let heartbeatError: unknown;
    try {
      heartbeat = await within(
        heartbeatPromise,
        OPERATION_TIMEOUT_MS,
        'heartbeat blocked behind fiscal persistence',
      );
    } catch (error) {
      heartbeatError = error;
    } finally {
      await releaseBarrier(control, barrierKey);
      barrierHeld = false;
    }
    await heartbeatPromise.catch(() => undefined);
    await heartbeatPublication.done;
    if (heartbeatError) throw asError(heartbeatError);
    if (heartbeatPublication.error) throw asError(heartbeatPublication.error);
    assertEqual(heartbeat, 'renewed', 'heartbeat during fiscal persistence');
    assertEqual(
      heartbeatPublication.value?.result,
      'incorporated',
      'heartbeat publication result',
    );
    const heartbeatState = await inspectJobItem(
      dataSource,
      heartbeatFixture.claim.jobId,
      heartbeatFixture.input.itemId,
      heartbeatDocument.stamp.uuid,
    );
    assertEqual(heartbeatState.cfdi_count, 1, 'heartbeat publication CFDI');
    assertEqual(
      heartbeatState.item_result,
      'incorporated',
      'heartbeat publication item',
    );
    assertEqual(
      await jobs.requestCancellation(
        {
          organizationId: scope.organizationId,
          membershipId: scope.membershipId,
        },
        heartbeatFixture.claim.jobId,
      ),
      null,
      'published manual XML is no longer cancelable',
    );
    assertEqual(
      await jobs.complete(
        heartbeatFixture.claim,
        heartbeatPublication.value!.completion,
      ),
      true,
      'published manual XML completes after rejected cancellation',
    );
    const completedHeartbeatState = await inspectJobItem(
      dataSource,
      heartbeatFixture.claim.jobId,
      heartbeatFixture.input.itemId,
      heartbeatDocument.stamp.uuid,
    );
    assertEqual(
      completedHeartbeatState.job_status,
      'completed',
      'published manual XML terminal job state',
    );
    assertEqual(
      completedHeartbeatState.current_stage,
      null,
      'published manual XML terminal stage',
    );

    const cancelFixture = await createJobFixture(
      dataSource,
      scope,
      suffix,
      'slow-cancel',
    );
    const cancelledDocument = syntheticDocument(
      randomUUID(),
      scope.legalEntityRfc,
    );
    await acquireBarrier(control, barrierKey);
    barrierHeld = true;
    const cancelledPublication = observePublication(
      persistence.publishParsed(
        cancelFixture.claim,
        cancelFixture.input,
        parsed(cancelledDocument),
      ),
    );
    await waitForBlockedPublication(
      dataSource,
      applicationName,
      cancelledPublication,
    );
    const cancellationPromise = jobs.requestCancellation(
      {
        organizationId: scope.organizationId,
        membershipId: scope.membershipId,
      },
      cancelFixture.claim.jobId,
    );
    let cancellation: string | null | undefined;
    let cancellationError: unknown;
    try {
      cancellation = await within(
        cancellationPromise,
        OPERATION_TIMEOUT_MS,
        'cancellation blocked behind fiscal persistence',
      );
    } catch (error) {
      cancellationError = error;
    } finally {
      await releaseBarrier(control, barrierKey);
      barrierHeld = false;
    }
    await cancellationPromise.catch(() => undefined);
    await cancelledPublication.done;
    if (cancellationError) throw asError(cancellationError);
    assertEqual(
      cancellation,
      IngestionJobStatus.CANCEL_REQUESTED,
      'cancellation during fiscal persistence',
    );
    assertEqual(
      errorCode(cancelledPublication.error),
      'JOB_LEASE_LOST',
      'cancelled publication loses terminal fence',
    );
    const cancelledState = await inspectJobItem(
      dataSource,
      cancelFixture.claim.jobId,
      cancelFixture.input.itemId,
      cancelledDocument.stamp.uuid,
    );
    assertEqual(
      cancelledState.job_status,
      'cancel_requested',
      'cancelled publication job state',
    );
    assertEqual(
      cancelledState.item_status,
      'processing',
      'cancelled publication item rollback',
    );
    assertEqual(
      cancelledState.cfdi_count,
      0,
      'cancelled publication fiscal rollback',
    );
    assertEqual(
      await jobs.complete(cancelFixture.claim, IngestionJobStatus.CANCELLED),
      true,
      'cancelled publication terminal transition',
    );
    const terminalCancelledState = await inspectJobItem(
      dataSource,
      cancelFixture.claim.jobId,
      cancelFixture.input.itemId,
      cancelledDocument.stamp.uuid,
    );
    assertEqual(
      terminalCancelledState.job_status,
      'cancelled',
      'cancelled publication terminal job state',
    );
    assertEqual(
      terminalCancelledState.current_stage,
      null,
      'cancelled publication terminal stage',
    );

    const restartReclaims = await validateRestartReclaims(
      dataSource,
      jobs,
      persistence,
      scope,
      suffix,
    );

    const terminalization = await validateTerminalTransitions(
      dataSource,
      jobs,
      scope,
      suffix,
    );

    report = {
      mode: 'ISOLATED_POSTGRESQL_MANUAL_XML_WORKER_TRANSITIONS',
      database: configuredDatabase,
      publicationLockScope: 'fiscal rows only',
      heartbeatDuringSlowPersistence: 'renewed_without_blocking',
      cancellationDuringSlowPersistence: 'cancel_requested_without_blocking',
      lostLeasePublication: 'rolled_back',
      publishedManualXmlCancellation: 'rejected_before_job_completion',
      restartReclaims,
      ...terminalization,
      source: 'synthetic_postgresql',
    };
  } catch (error) {
    validationError = error;
  } finally {
    if (dataSource.isInitialized && control.isReleased === false) {
      if (barrierHeld && barrierKey) {
        await captureCleanup(cleanupErrors, 'publication barrier unlock', () =>
          releaseBarrier(control, barrierKey!),
        );
      }
      if (triggerName && triggerFunction) {
        await captureCleanup(cleanupErrors, 'publication barrier drop', () =>
          removePublicationBarrier(control, triggerName!, triggerFunction!),
        );
      }
      if (scope) {
        await captureCleanup(cleanupErrors, 'fixture cleanup', () =>
          cleanupScope(dataSource, scope!),
        );
      }
      if (validatorLocked) {
        await captureCleanup(cleanupErrors, 'validator advisory unlock', () =>
          control.query(`SELECT pg_advisory_unlock(hashtextextended($1, $2))`, [
            VALIDATOR_LOCK,
            LOCK_SEED,
          ]),
        );
      }
      await captureCleanup(cleanupErrors, 'control connection release', () =>
        control.release(),
      );
    }
    if (dataSource.isInitialized) {
      await captureCleanup(cleanupErrors, 'datasource close', () =>
        dataSource.destroy(),
      );
    }
  }

  const failures = [validationError, ...cleanupErrors].filter(
    (failure): failure is unknown => failure !== undefined,
  );
  if (failures.length > 0) {
    throw new Error(
      `Manual XML worker transition QA failed: ${failures
        .map(errorMessage)
        .join(' | ')}`,
    );
  }
  console.log(JSON.stringify({ ...report, cleanedUp: true }, null, 2));
}

async function validateRestartReclaims(
  dataSource: DataSource,
  jobs: IngestionJobRepository,
  persistence: CfdiWorkerPersistenceService,
  scope: QaScope,
  suffix: string,
): Promise<Record<string, unknown>> {
  const fixture = await createJobFixture(
    dataSource,
    scope,
    suffix,
    'restart-reclaims',
    { itemAttemptCount: 0 },
  );
  let claim = fixture.claim;
  const executions = 6;
  for (let index = 0; index < executions; index += 1) {
    const input = await persistence.loadAndBegin(claim);
    assertEqual(
      input.itemId,
      fixture.input.itemId,
      `restart load ${index + 1}`,
    );
    if (index === executions - 1) break;
    assertEqual(
      await jobs.releaseForShutdown(claim),
      true,
      `restart release ${index + 1}`,
    );
    const reclaimed = await jobs.claimNext(
      `worker:restart:${index}:${suffix}`,
      [IngestionJobSourceType.MANUAL_XML],
    );
    if (!reclaimed || reclaimed.jobId !== fixture.claim.jobId) {
      throw new Error(`restart reclaim ${index + 1} selected wrong job`);
    }
    claim = reclaimed;
  }
  const state = await inspectJobItem(
    dataSource,
    fixture.claim.jobId,
    fixture.input.itemId,
  );
  assertEqual(state.job_attempt_count, 6, 'restart claim observations');
  assertEqual(
    state.automatic_retry_count,
    0,
    'restart does not consume automatic retry budget',
  );
  assertEqual(
    state.item_attempt_count,
    6,
    'each restart/reclaim remains observable past four item entries',
  );
  assertEqual(
    await jobs.failFinal(
      claim,
      'UNEXPECTED_WORKER_ERROR',
      'Synthetic restart cleanup.',
    ),
    true,
    'restart fixture terminal cleanup',
  );
  return {
    executions,
    jobAttemptCount: state.job_attempt_count,
    automaticRetryCount: state.automatic_retry_count,
    itemAttemptCount: state.item_attempt_count,
  };
}

async function validateTerminalTransitions(
  dataSource: DataSource,
  jobs: IngestionJobRepository,
  scope: QaScope,
  suffix: string,
): Promise<Record<string, unknown>> {
  const safeDetail = 'Synthetic safe terminal failure.';
  const failed = await createJobFixture(
    dataSource,
    scope,
    suffix,
    'fail-final',
  );
  assertEqual(
    await jobs.failFinal(failed.claim, 'UNEXPECTED_WORKER_ERROR', safeDetail),
    true,
    'manual XML failFinal fence',
  );
  const failedState = await inspectJobItem(
    dataSource,
    failed.claim.jobId,
    failed.input.itemId,
  );
  assertTerminalInternalError(failedState, safeDetail, 'failFinal');

  const retryable = await createJobFixture(
    dataSource,
    scope,
    suffix,
    'retryable',
  );
  const retryableResult = await jobs.scheduleRetry(
    retryable.claim,
    'OBJECT_STORAGE_UNAVAILABLE',
    'Synthetic retryable failure.',
  );
  assertEqual(
    retryableResult?.status,
    IngestionJobStatus.FAILED_RETRYABLE,
    'retryable transition status',
  );
  const retryableState = await inspectJobItem(
    dataSource,
    retryable.claim.jobId,
    retryable.input.itemId,
  );
  assertEqual(
    retryableState.item_status,
    'processing',
    'retryable transition preserves item status',
  );
  assertEqual(
    retryableState.item_result,
    null,
    'retryable transition preserves item result',
  );
  assertEqual(
    retryableState.processing_items,
    1,
    'retryable transition preserves counters',
  );
  assertTrue(
    retryableState.next_attempt_at !== null,
    'retryable transition keeps next attempt',
  );

  const exhausted = await createJobFixture(
    dataSource,
    scope,
    suffix,
    'retry-exhausted',
    { automaticRetryCount: 3 },
  );
  const exhaustedResult = await jobs.scheduleRetry(
    exhausted.claim,
    'OBJECT_STORAGE_UNAVAILABLE',
    safeDetail,
  );
  assertEqual(
    exhaustedResult?.status,
    IngestionJobStatus.FAILED_FINAL,
    'exhausted retry status',
  );
  const exhaustedState = await inspectJobItem(
    dataSource,
    exhausted.claim.jobId,
    exhausted.input.itemId,
  );
  assertTerminalInternalError(exhaustedState, safeDetail, 'retry exhausted');

  const stale = await createJobFixture(
    dataSource,
    scope,
    suffix,
    'stale-fence',
  );
  const staleClaim = {
    ...stale.claim,
    leaseToken: `lease:stale:${randomBytes(8).toString('hex')}`,
  };
  assertEqual(
    await jobs.failFinal(staleClaim, 'UNEXPECTED_WORKER_ERROR', safeDetail),
    false,
    'stale failFinal fence',
  );
  const staleState = await inspectJobItem(
    dataSource,
    stale.claim.jobId,
    stale.input.itemId,
  );
  assertEqual(staleState.job_status, 'processing', 'stale job unchanged');
  assertEqual(staleState.item_status, 'processing', 'stale item unchanged');
  assertEqual(staleState.item_result, null, 'stale result unchanged');

  const otherSource = await createJobFixture(
    dataSource,
    scope,
    suffix,
    'manual-zip-control',
    { sourceType: IngestionJobSourceType.MANUAL_ZIP },
  );
  assertEqual(
    await jobs.failFinal(
      otherSource.claim,
      'UNEXPECTED_WORKER_ERROR',
      safeDetail,
    ),
    true,
    'non-XML failFinal fence',
  );
  const otherSourceState = await inspectJobItem(
    dataSource,
    otherSource.claim.jobId,
    otherSource.input.itemId,
  );
  assertEqual(
    otherSourceState.item_status,
    'processing',
    'non-XML item is outside Phase 1 terminalization',
  );
  assertEqual(
    otherSourceState.item_result,
    null,
    'non-XML result is outside Phase 1 terminalization',
  );

  return {
    failFinalManualXmlTerminalized: true,
    exhaustedRetryManualXmlTerminalized: true,
    retryableManualXmlPreserved: true,
    staleLeaseMutationRejected: true,
    nonManualXmlPreserved: true,
  };
}

function assertTerminalInternalError(
  state: JobItemState,
  safeDetail: string,
  label: string,
): void {
  assertEqual(state.job_status, 'failed_final', `${label} job status`);
  assertEqual(state.locked_by, null, `${label} lease cleared`);
  assertEqual(state.current_stage, null, `${label} stage cleared`);
  assertEqual(state.item_status, 'terminal', `${label} item status`);
  assertEqual(state.item_result, 'internal_error', `${label} item result`);
  assertEqual(
    state.item_error_code,
    label === 'retry exhausted'
      ? 'OBJECT_STORAGE_UNAVAILABLE'
      : 'UNEXPECTED_WORKER_ERROR',
    `${label} safe error code`,
  );
  assertEqual(state.item_safe_detail, safeDetail, `${label} safe error detail`);
  assertEqual(state.total_items, 1, `${label} total counter`);
  assertEqual(state.pending_items, 0, `${label} pending counter`);
  assertEqual(state.processing_items, 0, `${label} processing counter`);
  assertEqual(state.internal_error_items, 1, `${label} internal counter`);
  assertTrue(
    state.counters_reconciled_at !== null,
    `${label} counters reconciled`,
  );
}

function runtimeConfig(): ConfigService {
  return new ConfigService({
    fiscalPlatform: {
      worker: {
        leaseSeconds: 90,
        maxAttempts: 4,
        maxRetries: 3,
        backoffSeconds: [10, 30, 120],
        backoffJitterPercent: 20,
      },
      limits: { activeJobsPerTenant: 4 },
      retention: {
        orphanGraceMinutes: 60,
        duplicateBytesHours: 24,
        invalidObjectDays: 7,
        malwareQuarantineDays: 30,
      },
    },
  });
}

async function createScope(
  dataSource: DataSource,
  suffix: string,
): Promise<QaScope> {
  const scope: QaScope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    clientAccountId: randomUUID(),
    legalEntityId: randomUUID(),
    membershipId: randomUUID(),
    legalEntityRfc: 'QAW010101AA1',
  };
  await dataSource.transaction(async (manager) => {
    const [role] = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM roles WHERE key = 'accountant'`,
    );
    if (!role) throw new Error('Canonical accountant role is required for QA');
    await manager.query(
      `INSERT INTO users (
         id, first_name, last_name, email, status, password_hash
       ) VALUES ($1,'QA','Worker Transitions',$2,'active','synthetic-no-login')`,
      [scope.userId, `qa-worker-transitions-${suffix}@example.invalid`],
    );
    await manager.query(
      `INSERT INTO organizations (
         id, name, slug, owner_user_id, status, timezone
       ) VALUES ($1,$2,$3,$4,'active','America/Mexico_City')`,
      [
        scope.organizationId,
        `QA Worker Transitions ${suffix}`,
        `qa-worker-transitions-${suffix}`,
        scope.userId,
      ],
    );
    await manager.query(
      `INSERT INTO memberships (
         id, organization_id, user_id, role_id, status, joined_at
       ) VALUES ($1,$2,$3,$4,'active',clock_timestamp())`,
      [scope.membershipId, scope.organizationId, scope.userId, role.id],
    );
    await manager.query(
      `INSERT INTO client_accounts (
         id, organization_id, name, code, status
       ) VALUES ($1,$2,$3,$4,'active')`,
      [
        scope.clientAccountId,
        scope.organizationId,
        `QA Worker Account ${suffix}`,
        `QA-WRK-${suffix}`,
      ],
    );
    await manager.query(
      `INSERT INTO legal_entities (
         id, organization_id, client_account_id, rfc, legal_name, status
       ) VALUES ($1,$2,$3,$4,$5,'active')`,
      [
        scope.legalEntityId,
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityRfc,
        `QA Worker Legal ${suffix}`,
      ],
    );
    const fiscalYearId = randomUUID();
    await manager.query(
      `INSERT INTO fiscal_years (
         id, organization_id, client_account_id, legal_entity_id, year, status
       ) VALUES ($1,$2,$3,$4,2026,'active')`,
      [
        fiscalYearId,
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
      ],
    );
    await manager.query(
      `INSERT INTO periods (
         id, organization_id, client_account_id, legal_entity_id,
         fiscal_year_id, month, status
       ) VALUES ($1,$2,$3,$4,$5,1,'not_started')`,
      [
        randomUUID(),
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
        fiscalYearId,
      ],
    );
  });
  return scope;
}

async function createJobFixture(
  dataSource: DataSource,
  scope: QaScope,
  suffix: string,
  label: string,
  options: {
    automaticRetryCount?: number;
    itemAttemptCount?: number;
    sourceType?:
      | typeof IngestionJobSourceType.MANUAL_XML
      | typeof IngestionJobSourceType.MANUAL_ZIP;
  } = {},
): Promise<JobFixture> {
  const sourceType = options.sourceType ?? IngestionJobSourceType.MANUAL_XML;
  const objectId = randomUUID();
  const uploadId = randomUUID();
  const jobId = randomUUID();
  const itemId = randomUUID();
  const correlationId = randomUUID();
  const leaseToken = `lease:qa:${randomBytes(8).toString('hex')}`;
  const sha256 = randomBytes(32).toString('hex');
  const extension =
    sourceType === IngestionJobSourceType.MANUAL_XML ? 'xml' : 'zip';
  const mimeType =
    sourceType === IngestionJobSourceType.MANUAL_XML
      ? 'application/xml'
      : 'application/zip';
  const automaticRetryCount = options.automaticRetryCount ?? 0;
  const attemptCount = Math.max(1, automaticRetryCount + 1);
  const itemAttemptCount = options.itemAttemptCount ?? attemptCount;

  await dataSource.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO stored_objects (
         id, organization_id, client_account_id, legal_entity_id,
         kind, storage_provider, storage_container, object_key,
         original_filename, declared_mime_type, detected_mime_type,
         size_bytes, sha256, encryption_class, lifecycle_state,
         malware_scan_status, malware_scanner_version, malware_scanned_at,
         quarantine_reason_code, uploaded_at
       ) VALUES (
         $1,$2,$3,$4,$5,'local','fiscal-private',$6,$7,$8,$8,
         128,$9,'fiscal','quarantined','clean','clamav-synthetic',
         clock_timestamp(),'PENDING_CFDI_VALIDATION',clock_timestamp()
       )`,
      [
        objectId,
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
        sourceType,
        `qa/worker-transitions/${suffix}/${objectId}`,
        `synthetic-${label}.${extension}`,
        mimeType,
        sha256,
      ],
    );
    await manager.query(
      `INSERT INTO ingestion_uploads (
         id, organization_id, client_account_id, legal_entity_id,
         workflow, upload_type, init_idempotency_key,
         init_request_fingerprint, init_idempotency_expires_at,
         confirm_idempotency_key, confirm_request_fingerprint,
         confirm_response_status, confirm_response_reference,
         confirm_idempotency_created_at, confirm_idempotency_expires_at,
         object_id, state, actual_size_bytes, actual_sha256,
         upload_expires_at, confirmed_at, created_by_membership_id,
         correlation_id
       ) VALUES (
         $1,$2,$3,$4,'direct',$5,$6,$7,clock_timestamp() + interval '1 day',
         $8,$9,202,$1::uuid::text,clock_timestamp(),
         clock_timestamp() + interval '1 day',$10,'confirmed',128,$11,
         clock_timestamp() + interval '1 day',clock_timestamp(),$12,$13
       )`,
      [
        uploadId,
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
        sourceType,
        `qa-upload-${label}-${uploadId}`,
        'a'.repeat(64),
        `qa-confirm-${label}-${uploadId}`,
        'b'.repeat(64),
        objectId,
        sha256,
        scope.membershipId,
        correlationId,
      ],
    );
    await manager.query(
      `INSERT INTO ingestion_jobs (
         id, organization_id, client_account_id, legal_entity_id,
         source_type, upload_id, root_object_id, requested_by_membership_id,
         idempotency_key, request_fingerprint, idempotency_expires_at,
         status, current_stage, total_items, processing_items,
         attempt_count, automatic_retry_count, worker_id, locked_by,
         lease_expires_at, heartbeat_at, started_at, correlation_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         clock_timestamp() + interval '1 day','processing','parsing',1,1,
         $11,$12,'worker:qa',$13,clock_timestamp() + interval '5 minutes',
         clock_timestamp(),clock_timestamp(),$14
       )`,
      [
        jobId,
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
        sourceType,
        uploadId,
        objectId,
        scope.membershipId,
        `qa-job-${label}-${jobId}`,
        'c'.repeat(64),
        attemptCount,
        automaticRetryCount,
        leaseToken,
        correlationId,
      ],
    );
    await manager.query(
      `INSERT INTO ingestion_items (
         id, organization_id, client_account_id, legal_entity_id,
         ingestion_job_id, object_id, ordinal, safe_filename,
         technical_status, sha256, attempt_count
       ) VALUES ($1,$2,$3,$4,$5,$6,1,$7,'processing',$8,$9)`,
      [
        itemId,
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
        jobId,
        objectId,
        `synthetic-${label}.${extension}`,
        sha256,
        itemAttemptCount,
      ],
    );
  });

  return {
    claim: {
      jobId,
      organizationId: scope.organizationId,
      clientAccountId: scope.clientAccountId,
      legalEntityId: scope.legalEntityId,
      sourceType,
      uploadId,
      rootObjectId: objectId,
      requestedByMembershipId: scope.membershipId,
      correlationId,
      attemptCount,
      queueAgeSeconds: 0,
      version: 1,
      recovered: false,
      workerId: 'worker:qa',
      leaseToken,
    },
    input: {
      objectId,
      objectKey: `qa/worker-transitions/${suffix}/${objectId}`,
      sha256,
      sizeBytes: 128,
      lifecycleState: 'quarantined',
      scanStatus: 'clean',
      legalEntityRfc: scope.legalEntityRfc,
      itemId,
      itemStatus: 'processing',
      itemResult: null,
      hasIssues: false,
    },
  };
}

function syntheticDocument(uuid: string, issuerRfc: string): ParsedCfdi {
  return {
    version: '4.0',
    issuedAt: '2026-01-15T10:00:00',
    stamp: {
      version: '1.1',
      uuid,
      stampedAt: '2026-01-15T10:00:00',
      certifyingProviderRfc: 'AAA010101AAA',
      satCertificateNumber: '00001000000500000000',
      cfdiSeal: 'synthetic',
      satSeal: 'synthetic',
    },
    subtotal: '100.000000',
    currency: 'MXN',
    total: '100.000000',
    documentType: 'I',
    issueLocation: '01000',
    issuer: { rfc: issuerRfc, name: 'SYNTHETIC ISSUER' },
    receiver: {
      rfc: 'XAXX010101000',
      name: 'SYNTHETIC RECEIVER',
      fiscalAddress: '01000',
      fiscalRegime: '616',
      cfdiUse: 'S01',
    },
    concepts: [
      {
        productServiceCode: '01010101',
        quantity: '1',
        unitCode: 'ACT',
        description: 'SYNTHETIC WORKER TRANSITION CONCEPT',
        unitValue: '100.000000',
        amount: '100.000000',
        taxObject: '01',
        taxes: { lines: [] },
      },
    ],
    taxes: { lines: [] },
    relations: [],
    unsupportedComplements: [],
  };
}

function parsed(document: ParsedCfdi): CfdiParseResult {
  return {
    parserVersion: CFDI_PARSER_VERSION,
    schemaVersion: CFDI_SCHEMA_SET_VERSION,
    sizeBytes: 128,
    document,
  };
}

function observePublication(
  promise: Promise<PersistenceOutcome>,
): PublicationObservation {
  const observation: PublicationObservation = {
    settled: false,
    done: Promise.resolve(),
  };
  observation.done = promise.then(
    (value) => {
      observation.value = value;
      observation.settled = true;
    },
    (error: unknown) => {
      observation.error = error;
      observation.settled = true;
    },
  );
  return observation;
}

async function installPublicationBarrier(
  queryRunner: QueryRunner,
  organizationId: string,
  barrierKey: string,
  triggerName: string,
  triggerFunction: string,
): Promise<void> {
  assertSafeIdentifier(triggerName);
  assertSafeIdentifier(triggerFunction);
  if (!/^[0-9a-f-]{36}$/.test(organizationId)) {
    throw new Error('Unsafe QA organization identifier');
  }
  if (!/^[a-z0-9-]+$/.test(barrierKey)) {
    throw new Error('Unsafe QA advisory barrier key');
  }
  await queryRunner.query(`
    CREATE FUNCTION public.${triggerFunction}()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.organization_id = '${organizationId}'::uuid THEN
        PERFORM pg_advisory_xact_lock(
          hashtextextended('${barrierKey}', ${LOCK_SEED})
        );
      END IF;
      RETURN NEW;
    END
    $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON cfdis
    FOR EACH ROW
    EXECUTE FUNCTION public.${triggerFunction}()
  `);
}

async function removePublicationBarrier(
  queryRunner: QueryRunner,
  triggerName: string,
  triggerFunction: string,
): Promise<void> {
  assertSafeIdentifier(triggerName);
  assertSafeIdentifier(triggerFunction);
  await queryRunner.query(`DROP TRIGGER IF EXISTS ${triggerName} ON cfdis`);
  await queryRunner.query(
    `DROP FUNCTION IF EXISTS public.${triggerFunction}()`,
  );
}

async function acquireBarrier(
  queryRunner: QueryRunner,
  barrierKey: string,
): Promise<void> {
  await queryRunner.query(`SELECT pg_advisory_lock(hashtextextended($1, $2))`, [
    barrierKey,
    LOCK_SEED,
  ]);
}

async function releaseBarrier(
  queryRunner: QueryRunner,
  barrierKey: string,
): Promise<void> {
  const [state] = (await queryRunner.query(
    `SELECT pg_advisory_unlock(hashtextextended($1, $2)) AS released`,
    [barrierKey, LOCK_SEED],
  )) as Array<{ released: boolean }>;
  if (!state?.released) throw new Error('QA publication barrier was not held');
}

async function waitForBlockedPublication(
  dataSource: DataSource,
  applicationName: string,
  observation: PublicationObservation,
): Promise<void> {
  const deadline = Date.now() + WAIT_FOR_BARRIER_MS;
  while (Date.now() < deadline) {
    if (observation.settled) {
      throw new Error(
        `Fiscal publication settled before QA barrier: ${errorMessage(
          observation.error ?? observation.value,
        )}`,
      );
    }
    const [state] = await dataSource.query<Array<{ waiting: boolean }>>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name = $1
            AND state = 'active'
            AND wait_event_type = 'Lock'
            AND wait_event = 'advisory'
            AND query ILIKE '%INSERT INTO cfdis%'
      ) AS waiting`,
      [applicationName],
    );
    if (state?.waiting) return;
    await delay(20);
  }
  throw new Error('Fiscal publication did not reach the QA advisory barrier');
}

async function inspectJobItem(
  dataSource: DataSource,
  jobId: string,
  itemId: string,
  cfdiUuid?: string,
): Promise<JobItemState> {
  const [state] = await dataSource.query<JobItemState[]>(
    `SELECT job.status AS job_status,
            job.current_stage,
            job.locked_by,
            job.next_attempt_at,
            job.attempt_count::integer AS job_attempt_count,
            job.automatic_retry_count::integer,
            job.total_items::integer,
            job.pending_items::integer,
            job.processing_items::integer,
            job.incorporated_items::integer,
            job.internal_error_items::integer,
            job.counters_reconciled_at,
            item.technical_status AS item_status,
            item.product_result AS item_result,
            item.error_code AS item_error_code,
            item.safe_error_detail AS item_safe_detail,
            item.attempt_count::integer AS item_attempt_count,
            (SELECT count(*)::integer
               FROM cfdis
              WHERE normalized_uuid = $3::uuid) AS cfdi_count
       FROM ingestion_jobs AS job
       INNER JOIN ingestion_items AS item
         ON item.ingestion_job_id = job.id
      WHERE job.id = $1 AND item.id = $2`,
    [jobId, itemId, cfdiUuid ?? null],
  );
  if (!state) throw new Error('QA job/item state was not found');
  return state;
}

async function cleanupScope(
  dataSource: DataSource,
  scope: QaScope,
): Promise<void> {
  await dataSource.transaction(async (manager) => {
    const scopedTables = [
      'cfdi_access_grants',
      'incidents',
      'period_cfdis',
      'cfdi_payroll_perceptions',
      'cfdi_payroll_deductions',
      'cfdi_payroll_other_payments',
      'cfdi_payroll_incapacities',
      'cfdi_payrolls',
      'cfdi_taxes',
      'cfdi_payment_documents',
      'cfdi_payments',
      'cfdi_relations',
      'cfdi_concepts',
      'ingestion_items',
      'cfdis',
      'ingestion_jobs',
      'ingestion_uploads',
      'stored_objects',
    ];
    await manager.query(`DELETE FROM audit_events WHERE organization_id = $1`, [
      scope.organizationId,
    ]);
    for (const table of scopedTables) {
      assertSafeIdentifier(table);
      await manager.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
        scope.organizationId,
      ]);
    }
    await manager.query(`DELETE FROM periods WHERE organization_id = $1`, [
      scope.organizationId,
    ]);
    await manager.query(`DELETE FROM fiscal_years WHERE organization_id = $1`, [
      scope.organizationId,
    ]);
    await manager.query(
      `DELETE FROM account_assignments WHERE organization_id = $1`,
      [scope.organizationId],
    );
    await manager.query(
      `DELETE FROM legal_entities WHERE organization_id = $1`,
      [scope.organizationId],
    );
    await manager.query(
      `DELETE FROM client_accounts WHERE organization_id = $1`,
      [scope.organizationId],
    );
    await manager.query(`DELETE FROM memberships WHERE organization_id = $1`, [
      scope.organizationId,
    ]);
    await manager.query(`DELETE FROM organizations WHERE id = $1`, [
      scope.organizationId,
    ]);
    await manager.query(`DELETE FROM users WHERE id = $1`, [scope.userId]);
  });
}

async function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function assertSafeIdentifier(value: string): void {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(value)) {
    throw new Error('Unsafe QA SQL identifier');
  }
}

function assertTrue(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, received ${String(actual)}`,
    );
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
    errors.push(new Error(`${label}: ${errorMessage(error)}`));
  }
}

void validate().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      message: errorMessage(error),
      code: errorCode(error) ?? null,
    }),
  );
  process.exitCode = 1;
});
