import { randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import { DataSource, QueryRunner } from 'typeorm';
import { resolveScriptDatabaseOptions } from '../src/database/scripts/script-database-options';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

interface TenantScopeRow {
  organization_id: string;
  client_account_id: string;
  legal_entity_id: string;
  membership_id: string;
}

interface ClaimRow {
  job_id: string;
  attempt_count: number;
  queue_age_seconds: number;
  lease_token: string;
}

interface SyntheticTenantFixtures {
  scopeA: TenantScopeRow;
  scopeB: TenantScopeRow;
  inactiveMembershipId: string;
}

async function validateFiscalFoundationTransaction(): Promise<void> {
  const options = await resolveScriptDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('Fiscal foundation validation requires PostgreSQL');
  }
  if (
    !['development', 'test'].includes(process.env.NODE_ENV ?? 'development')
  ) {
    throw new Error(
      'Fiscal foundation validation is restricted to development/test',
    );
  }

  const dataSource = new DataSource({ ...options, logging: false });
  let queryRunner: QueryRunner | undefined;
  const report: Record<string, unknown> = {};

  try {
    await dataSource.initialize();
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const capabilities = (await queryRunner.query(`
      SELECT
        to_regclass('public.stored_objects') IS NOT NULL AS foundation,
        to_regprocedure(
          'public.claim_ingestion_job(text,text,text[],integer,integer,integer,integer)'
        ) IS NOT NULL AS claim_function,
        to_regprocedure(
          'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer,integer)'
        ) IS NOT NULL AS reconcile_function,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
          AS migrator_superuser
    `)) as Array<{
      foundation: boolean;
      claim_function: boolean;
      reconcile_function: boolean;
      migrator_superuser: boolean;
    }>;
    if (
      !capabilities[0]?.foundation ||
      !capabilities[0]?.claim_function ||
      !capabilities[0]?.reconcile_function
    ) {
      throw new Error(
        'Phase 0 migrations 060/061/062/063 must be committed before transactional validation',
      );
    }
    if (!capabilities[0]?.migrator_superuser) {
      throw new Error(
        'Transactional FORCE RLS table-owner validation requires a development/test superuser migrator',
      );
    }

    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const tenantFixtures = await createSyntheticTenantFixtures(
      queryRunner,
      suffix,
    );
    const scope = tenantFixtures.scopeA;
    const otherTenantScope = tenantFixtures.scopeB;
    report.tenantFixtures = {
      organizations: 2,
      activeMemberships: 2,
      inactiveMemberships: 1,
      source: 'synthetic_transactional',
    };

    // Runtime-group memberships required only for SET LOCAL ROLE are
    // transactional and roll back with every synthetic fixture below. Owner
    // roles deliberately never receive members; table-owner validation uses
    // the superuser migrator identity required by this validator.
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'GRANT balanz_api, balanz_worker TO %I',
          current_user
        );
      END $$
    `);
    await validateLockedSecurityDefinerParameters(queryRunner, report);

    await queryRunner.query(`SAVEPOINT composite_fk_check`);
    let compositeFkSqlState: string | undefined;
    try {
      await queryRunner.query(
        `INSERT INTO stored_objects (
           id, organization_id, client_account_id, legal_entity_id,
           kind, storage_provider, storage_container, object_key,
           encryption_class
         ) VALUES ($1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,'fiscal')`,
        [
          randomUUID(),
          randomUUID(),
          scope.client_account_id,
          scope.legal_entity_id,
          `qa/fk/${randomUUID()}`,
        ],
      );
    } catch (error) {
      compositeFkSqlState = postgresCode(error);
      await queryRunner.query(`ROLLBACK TO SAVEPOINT composite_fk_check`);
    }
    await queryRunner.query(`RELEASE SAVEPOINT composite_fk_check`);
    assertEqual(compositeFkSqlState, '23503', 'composite tenant FK');

    const lifecycleObjectId = randomUUID();
    await insertPendingObject(
      queryRunner,
      scope,
      lifecycleObjectId,
      'qa/lifecycle',
    );
    await queryRunner.query(
      `UPDATE stored_objects
          SET size_bytes = 1,
              sha256 = $2,
              lifecycle_state = 'uploaded',
              uploaded_at = clock_timestamp()
        WHERE id = $1`,
      [lifecycleObjectId, '9'.repeat(64)],
    );
    await queryRunner.query(`SAVEPOINT scanner_timestamp_check`);
    let scannerTimestampSqlState: string | undefined;
    try {
      await queryRunner.query(
        `UPDATE stored_objects
            SET malware_scan_status = 'clean'
          WHERE id = $1`,
        [lifecycleObjectId],
      );
    } catch (error) {
      scannerTimestampSqlState = postgresCode(error);
      await queryRunner.query(`ROLLBACK TO SAVEPOINT scanner_timestamp_check`);
    }
    await queryRunner.query(`RELEASE SAVEPOINT scanner_timestamp_check`);
    assertEqual(scannerTimestampSqlState, '23514', 'scanner timestamp check');
    await queryRunner.query(
      `UPDATE stored_objects
          SET malware_scan_status = 'clean',
              malware_scanned_at = clock_timestamp(),
              lifecycle_state = 'available',
              available_at = clock_timestamp()
        WHERE id = $1`,
      [lifecycleObjectId],
    );
    const lifecycleState = (await queryRunner.query(
      `SELECT lifecycle_state, malware_scan_status
         FROM stored_objects
        WHERE id = $1`,
      [lifecycleObjectId],
    )) as Array<{ lifecycle_state: string; malware_scan_status: string }>;
    assertEqual(
      lifecycleState[0]?.lifecycle_state,
      'available',
      'uploaded to available lifecycle',
    );

    await queryRunner.query(`SET LOCAL ROLE balanz_api`);
    const legacySmoke = (await queryRunner.query(`
      SELECT
        (SELECT count(*)::integer FROM users) AS users,
        (SELECT count(*)::integer FROM client_accounts) AS client_accounts,
        (SELECT count(*)::integer FROM auth_sessions) AS auth_sessions
    `)) as Array<{
      users: number;
      client_accounts: number;
      auth_sessions: number;
    }>;
    await queryRunner.query(`RESET ROLE`);

    const cancellationJobId = randomUUID();
    await insertManualXmlJob(queryRunner, scope, cancellationJobId, {
      pendingItems: 0,
      totalItems: 0,
    });
    await queryRunner.query(`SET LOCAL ROLE balanz_api`);
    await setContext(queryRunner, scope.organization_id, randomUUID());
    const invalidCancellation = (await queryRunner.query(
      `SELECT request_ingestion_job_cancellation($1) AS status`,
      [cancellationJobId],
    )) as Array<{ status: string | null }>;
    await setContext(queryRunner, scope.organization_id, scope.membership_id);
    const validCancellation = (await queryRunner.query(
      `SELECT request_ingestion_job_cancellation($1) AS status`,
      [cancellationJobId],
    )) as Array<{ status: string | null }>;
    await queryRunner.query(`RESET ROLE`);
    assertEqual(
      invalidCancellation[0]?.status,
      null,
      'unknown membership cancellation',
    );
    assertEqual(
      validCancellation[0]?.status,
      'cancelled',
      'valid membership cancellation',
    );
    report.legacyApiSmoke = legacySmoke[0];

    const objectId = randomUUID();
    await insertPendingObject(queryRunner, scope, objectId, 'qa/rls');
    const workerRlsJobId = randomUUID();
    await insertManualXmlJob(queryRunner, scope, workerRlsJobId, {
      pendingItems: 0,
      totalItems: 0,
    });
    await queryRunner.query(
      `UPDATE ingestion_jobs
          SET status = 'failed_final',
              next_attempt_at = NULL,
              completed_at = clock_timestamp(),
              last_error_code = 'QA_TERMINAL'
        WHERE id = $1`,
      [workerRlsJobId],
    );

    await clearContext(queryRunner);
    await queryRunner.query(`SET LOCAL ROLE balanz_api`);
    const missingContextRows = await scalarCount(
      queryRunner,
      `SELECT count(*)::integer AS value FROM stored_objects`,
    );
    await setContext(queryRunner, scope.organization_id, scope.membership_id);
    const apiTenantRows = await scalarCount(
      queryRunner,
      `SELECT count(*)::integer AS value FROM stored_objects WHERE id = $1`,
      [objectId],
    );
    await queryRunner.query(`RESET ROLE`);

    await queryRunner.query(`SET LOCAL ROLE balanz_api`);
    await setContext(
      queryRunner,
      otherTenantScope.organization_id,
      otherTenantScope.membership_id,
    );
    report.tenantBRows = await scalarCount(
      queryRunner,
      `SELECT count(*)::integer AS value FROM stored_objects WHERE id = $1`,
      [objectId],
    );
    await queryRunner.query(`RESET ROLE`);

    await queryRunner.query(`SET LOCAL ROLE balanz_api`);
    await setContext(queryRunner, scope.organization_id, randomUUID());
    const unknownMembershipRows = await scalarCount(
      queryRunner,
      `SELECT count(*)::integer AS value FROM stored_objects WHERE id = $1`,
      [objectId],
    );
    await setContext(
      queryRunner,
      scope.organization_id,
      otherTenantScope.membership_id,
    );
    const crossTenantMembershipRows = await scalarCount(
      queryRunner,
      `SELECT count(*)::integer AS value FROM stored_objects WHERE id = $1`,
      [objectId],
    );
    await setContext(
      queryRunner,
      scope.organization_id,
      tenantFixtures.inactiveMembershipId,
    );
    const inactiveMembershipRows = await scalarCount(
      queryRunner,
      `SELECT count(*)::integer AS value FROM stored_objects WHERE id = $1`,
      [objectId],
    );
    await queryRunner.query(`RESET ROLE`);

    await clearContext(queryRunner);
    await queryRunner.query(`SET LOCAL ROLE balanz_fiscal_owner`);
    const tableOwnerRows = await scalarCount(
      queryRunner,
      `SELECT count(*)::integer AS value FROM stored_objects`,
    );
    await queryRunner.query(`RESET ROLE`);

    await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
    await setContext(
      queryRunner,
      scope.organization_id,
      '00000000-0000-0000-0000-000000000000',
    );
    const workerTenantRows = await scalarCount(
      queryRunner,
      `SELECT count(id)::integer AS value FROM ingestion_jobs WHERE id = $1`,
      [workerRlsJobId],
    );
    await queryRunner.query(`RESET ROLE`);

    await queryRunner.query(`SAVEPOINT invalid_rls_context`);
    let invalidContextSqlState: string | undefined;
    try {
      await queryRunner.query(`SET LOCAL ROLE balanz_api`);
      await queryRunner.query(
        `SELECT set_config('app.organization_id', 'not-a-uuid', true)`,
      );
      await queryRunner.query(`SELECT count(*) FROM stored_objects`);
    } catch (error) {
      invalidContextSqlState = postgresCode(error);
      await queryRunner.query(`ROLLBACK TO SAVEPOINT invalid_rls_context`);
    }
    await queryRunner.query(`RELEASE SAVEPOINT invalid_rls_context`);
    await queryRunner.query(`RESET ROLE`);

    assertEqual(missingContextRows, 0, 'missing GUC must fail closed');
    assertEqual(apiTenantRows, 1, 'API tenant context');
    assertEqual(report.tenantBRows ?? 0, 0, 'tenant B isolation');
    assertEqual(unknownMembershipRows, 0, 'unknown membership fails closed');
    assertEqual(
      crossTenantMembershipRows,
      0,
      'cross-tenant membership fails closed',
    );
    assertEqual(inactiveMembershipRows, 0, 'inactive membership fails closed');
    assertEqual(tableOwnerRows, 0, 'FORCE RLS table owner');
    assertEqual(workerTenantRows, 1, 'worker tenant context');
    assertEqual(invalidContextSqlState, '22P02', 'invalid GUC SQLSTATE');

    const retryJobId = randomUUID();
    await insertManualXmlJob(queryRunner, scope, retryJobId, {
      pendingItems: 0,
      totalItems: 0,
    });
    await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
    const queueAgeRows = (await queryRunner.query(
      `SELECT * FROM ingestion_queue_ages($1::text[], $2, $3)`,
      [['manual_xml'], 4, 3],
    )) as Array<{ source_type: string; queue_age_seconds: number }>;
    await queryRunner.query(`RESET ROLE`);
    assertEqual(queueAgeRows[0]?.source_type, 'manual_xml', 'queue age source');
    assert(
      Number(queueAgeRows[0]?.queue_age_seconds) >= 0,
      'queue age must be non-negative',
    );
    const retryDelays: number[] = [];
    const queueAges: number[] = [];

    for (let claimNumber = 1; claimNumber <= 4; claimNumber += 1) {
      await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
      const claims = (await queryRunner.query(
        `SELECT * FROM claim_ingestion_job($1, $2, $3::text[], $4, $5, $6, $7)`,
        [`qa-worker-${claimNumber}`, randomUUID(), ['manual_xml'], 90, 4, 3, 4],
      )) as ClaimRow[];
      await queryRunner.query(`RESET ROLE`);
      const claim = claims[0];
      if (!claim || claim.job_id !== retryJobId) {
        throw new Error(`Claim ${claimNumber} did not return the expected job`);
      }
      assertEqual(Number(claim.attempt_count), claimNumber, 'claim attempt');
      queueAges.push(Number(claim.queue_age_seconds));

      if (claimNumber === 1) {
        await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
        await setContext(
          queryRunner,
          scope.organization_id,
          '00000000-0000-0000-0000-000000000000',
        );
        const heartbeatResult = (await queryRunner.query(
          `UPDATE ingestion_jobs
              SET heartbeat_at = clock_timestamp(),
                  lease_expires_at = clock_timestamp() + interval '90 seconds',
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND locked_by = $2
              AND status = 'processing'
              AND lease_expires_at > clock_timestamp()
          RETURNING id`,
          [retryJobId, claim.lease_token],
        )) as Array<{ id: string }> | [Array<{ id: string }>, number];
        const heartbeats = Array.isArray(heartbeatResult[0])
          ? heartbeatResult[0]
          : (heartbeatResult as Array<{ id: string }>);
        await queryRunner.query(`RESET ROLE`);
        assertEqual(heartbeats.length, 1, 'worker heartbeat CAS');
      }

      await queryRunner.query(
        `UPDATE ingestion_jobs
            SET lease_expires_at = clock_timestamp() - interval '1 second'
          WHERE id = $1`,
        [retryJobId],
      );
      await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
      const reconciled = (await queryRunner.query(
        `SELECT *
           FROM reconcile_fiscal_ingestion_foundation($1, $2, $3, $4, $5::integer[], $6, $7, $8)`,
        [100, 60, 24, 7, [10, 30, 120], 0, 4, 3],
      )) as Array<Record<string, number>>;
      await queryRunner.query(`RESET ROLE`);
      const jobState = (await queryRunner.query(
        `SELECT
           status,
           automatic_retry_count,
           CASE WHEN next_attempt_at IS NULL THEN NULL
             ELSE round(extract(epoch FROM next_attempt_at - updated_at))::integer
           END AS delay_seconds
         FROM ingestion_jobs
         WHERE id = $1`,
        [retryJobId],
      )) as Array<{
        status: string;
        automatic_retry_count: number;
        delay_seconds: number | null;
      }>;
      if (claimNumber <= 3) {
        assertEqual(
          Number(reconciled[0]?.lease_retryable_count),
          1,
          'retryable lease recovery',
        );
        retryDelays.push(Number(jobState[0]?.delay_seconds));
        assertEqual(
          Number(jobState[0]?.automatic_retry_count),
          claimNumber,
          'automatic retry budget',
        );
        await queryRunner.query(
          `UPDATE ingestion_jobs
              SET next_attempt_at = clock_timestamp()
            WHERE id = $1`,
          [retryJobId],
        );
      } else {
        assertEqual(
          Number(reconciled[0]?.lease_final_count),
          1,
          'fourth claim terminal recovery',
        );
        assertEqual(jobState[0]?.status, 'failed_final', 'terminal job status');
        assertEqual(
          Number(jobState[0]?.automatic_retry_count),
          3,
          'exhausted automatic retry budget',
        );
      }
    }
    assertEqual(retryDelays.join(','), '10,30,120', 'retry schedule');

    const jitterJobId = randomUUID();
    await insertManualXmlJob(queryRunner, scope, jitterJobId, {
      pendingItems: 0,
      totalItems: 0,
    });
    const jitterBases = [10, 30, 120] as const;
    const jitterDelays: number[] = [];
    for (let retryIndex = 0; retryIndex < jitterBases.length; retryIndex += 1) {
      await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
      const [jitterClaim] = (await queryRunner.query(
        `SELECT *
           FROM claim_ingestion_job($1, $2, $3::text[], $4, $5, $6, $7)`,
        [
          `qa-jitter-${retryIndex + 1}`,
          randomUUID(),
          ['manual_xml'],
          90,
          4,
          3,
          4,
        ],
      )) as ClaimRow[];
      await queryRunner.query(`RESET ROLE`);
      assertEqual(jitterClaim?.job_id, jitterJobId, 'jitter claim job');

      await queryRunner.query(
        `UPDATE ingestion_jobs
            SET lease_expires_at = clock_timestamp() - interval '1 second'
          WHERE id = $1`,
        [jitterJobId],
      );
      await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
      await queryRunner.query(
        `SELECT *
           FROM reconcile_fiscal_ingestion_foundation(
             $1, $2, $3, $4, $5::integer[], $6, $7, $8
           )`,
        [100, 60, 24, 7, [10, 30, 120], 20, 4, 3],
      );
      await queryRunner.query(`RESET ROLE`);

      const [jitterState] = (await queryRunner.query(
        `SELECT
           automatic_retry_count,
           round(extract(epoch FROM next_attempt_at - updated_at))::integer
             AS delay_seconds
         FROM ingestion_jobs
         WHERE id = $1`,
        [jitterJobId],
      )) as Array<{
        automatic_retry_count: number;
        delay_seconds: number;
      }>;
      const delaySeconds = Number(jitterState?.delay_seconds);
      const baseSeconds = jitterBases[retryIndex];
      assert(
        delaySeconds >= baseSeconds &&
          delaySeconds <= baseSeconds + Math.floor(baseSeconds * 0.2),
        `retry ${retryIndex + 1} jitter must remain within the configured range`,
      );
      assertEqual(
        Number(jitterState?.automatic_retry_count),
        retryIndex + 1,
        'jitter retry budget',
      );
      jitterDelays.push(delaySeconds);
      await queryRunner.query(
        `UPDATE ingestion_jobs SET next_attempt_at = clock_timestamp() WHERE id = $1`,
        [jitterJobId],
      );
    }
    report.retryJitterDelays = jitterDelays;

    const reconciliation = await createReconciliationFixtures(
      queryRunner,
      scope,
    );
    await queryRunner.query(`SET LOCAL enable_seqscan = off`);
    const counterReconciliationPlan = (await queryRunner.query(`
      EXPLAIN (FORMAT JSON)
      WITH selected AS (
        SELECT job.id, job.organization_id
        FROM ingestion_jobs AS job
        WHERE job.counters_reconciled_at IS NULL
           OR EXISTS (
             SELECT 1
             FROM ingestion_items AS dirty_item
             WHERE dirty_item.organization_id = job.organization_id
               AND dirty_item.ingestion_job_id = job.id
               AND dirty_item.updated_at > job.counters_reconciled_at
           )
        ORDER BY
          job.counters_reconciled_at ASC NULLS FIRST,
          job.updated_at,
          job.id
        FOR UPDATE OF job SKIP LOCKED
        LIMIT 100
      )
      SELECT selected.id, count(item.id)
      FROM selected
      LEFT JOIN ingestion_items AS item
        ON item.organization_id = selected.organization_id
       AND item.ingestion_job_id = selected.id
      GROUP BY selected.id
    `)) as unknown;
    await queryRunner.query(`SET LOCAL enable_seqscan = on`);
    const serializedCounterPlan = JSON.stringify(counterReconciliationPlan);
    assert(
      serializedCounterPlan.includes('ix_ingestion_jobs_counter_reconcile'),
      'counter reconciler candidate plan must use bounded job marker index',
    );
    assert(
      serializedCounterPlan.includes('ix_ingestion_items_job_updated'),
      'counter reconciler aggregate must use the selected-job item index',
    );
    report.counterReconciliationPlan = {
      boundedCandidateLimit: 100,
      jobIndex: 'ix_ingestion_jobs_counter_reconcile',
      itemIndex: 'ix_ingestion_items_job_updated',
    };
    await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
    const foundationResult = (await queryRunner.query(
      `SELECT *
         FROM reconcile_fiscal_ingestion_foundation($1, $2, $3, $4, $5::integer[], $6, $7, $8)`,
      [100, 60, 24, 7, [10, 30, 120], 0, 4, 3],
    )) as Array<Record<string, number>>;
    const idempotentResult = (await queryRunner.query(
      `SELECT *
         FROM reconcile_fiscal_ingestion_foundation($1, $2, $3, $4, $5::integer[], $6, $7, $8)`,
      [100, 60, 24, 7, [10, 30, 120], 0, 4, 3],
    )) as Array<Record<string, number>>;
    await queryRunner.query(`RESET ROLE`);

    const first = foundationResult[0] ?? {};
    assertEqual(Number(first.expired_upload_count), 2, 'expired upload');
    assertEqual(
      Number(first.rejected_orphan_object_count),
      3,
      'pending orphan object',
    );
    const expiredUploadedObject = (await queryRunner.query(
      `SELECT lifecycle_state, quarantine_reason_code, retention_until > clock_timestamp() AS retained
         FROM stored_objects
        WHERE id = $1`,
      [reconciliation.expiredUploadedObjectId],
    )) as Array<{
      lifecycle_state: string;
      quarantine_reason_code: string;
      retained: boolean;
    }>;
    assertEqual(
      expiredUploadedObject[0]?.lifecycle_state,
      'rejected',
      'expired uploaded object lifecycle',
    );
    assertEqual(
      expiredUploadedObject[0]?.quarantine_reason_code,
      'UPLOAD_EXPIRED',
      'expired uploaded object reason',
    );
    assertEqual(
      expiredUploadedObject[0]?.retained,
      true,
      'expired uploaded object retention',
    );
    assertEqual(
      Number(first.confirmed_object_without_job_count),
      1,
      'confirmed object without job report',
    );
    assertEqual(Number(first.orphan_job_count), 1, 'orphan job');
    assertEqual(Number(first.repaired_counter_count), 1, 'counter repair');
    assertEqual(Number(first.redundant_object_count), 1, 'redundant bytes');
    assertEqual(
      Number(first.retention_eligible_object_count),
      2,
      'retention eligibility',
    );
    assertEqual(
      Number(idempotentResult[0]?.expired_upload_count),
      0,
      'upload reconciler idempotency',
    );
    assertEqual(
      Number(idempotentResult[0]?.rejected_orphan_object_count),
      0,
      'object reconciler idempotency',
    );
    assertEqual(
      Number(idempotentResult[0]?.orphan_job_count),
      0,
      'job reconciler idempotency',
    );
    assertEqual(
      Number(idempotentResult[0]?.repaired_counter_count),
      0,
      'counter reconciler idempotency',
    );
    assertEqual(
      Number(idempotentResult[0]?.confirmed_object_without_job_count),
      0,
      'confirmed object report idempotency',
    );
    assertEqual(
      Number(idempotentResult[0]?.redundant_object_count),
      0,
      'redundant object report idempotency',
    );
    assertEqual(
      Number(idempotentResult[0]?.retention_eligible_object_count),
      0,
      'retention report idempotency',
    );

    const auditRows = await scalarCount(
      queryRunner,
      `SELECT count(*)::integer AS value
         FROM audit_events
        WHERE service_principal = 'cfdi-foundation-reconciler'
          AND object_id = ANY($1::uuid[])`,
      [reconciliation.auditedIds],
    );

    const schemaState = (await queryRunner.query(`
      SELECT
        (SELECT count(*)::integer
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'stored_objects','ingestion_uploads','ingestion_jobs','ingestion_items'
            )) AS tables,
        (SELECT count(*)::integer
           FROM pg_class
          WHERE relname IN (
            'stored_objects','ingestion_uploads','ingestion_jobs','ingestion_items'
          )
            AND relrowsecurity
            AND relforcerowsecurity) AS forced_rls,
        (SELECT count(*)::integer
           FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename IN (
              'stored_objects','ingestion_uploads','ingestion_jobs','ingestion_items'
            )) AS policies
    `)) as Array<{ tables: number; forced_rls: number; policies: number }>;
    const roleState = (await queryRunner.query(`
      SELECT
        (SELECT bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)
           FROM pg_roles
          WHERE rolname IN (
            'balanz_api','balanz_worker','balanz_fiscal_cancel_owner'
          )) AS runtime_roles_safe,
        (SELECT count(*)::integer
           FROM pg_auth_members AS membership
           INNER JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
           INNER JOIN pg_roles AS member_role ON member_role.oid = membership.member
          WHERE member_role.rolname = current_user
            AND granted_role.rolname IN (
              'balanz_fiscal_claim_owner','balanz_fiscal_reconcile_owner'
            )) AS leaked_bypass_memberships,
        (SELECT count(*)::integer
           FROM pg_auth_members AS membership
           INNER JOIN pg_roles AS member_role ON member_role.oid = membership.member
          WHERE member_role.rolname IN (
            'balanz_fiscal_owner','balanz_api','balanz_worker',
            'balanz_fiscal_cancel_owner','balanz_fiscal_claim_owner',
            'balanz_fiscal_reconcile_owner'
          )) AS fixed_parent_memberships,
        (
          has_schema_privilege('balanz_api', 'public', 'CREATE')
          OR has_schema_privilege('balanz_worker', 'public', 'CREATE')
          OR has_schema_privilege('balanz_fiscal_owner', 'public', 'CREATE')
          OR has_schema_privilege('balanz_fiscal_cancel_owner', 'public', 'CREATE')
          OR has_schema_privilege('balanz_fiscal_claim_owner', 'public', 'CREATE')
          OR has_schema_privilege('balanz_fiscal_reconcile_owner', 'public', 'CREATE')
        ) AS runtime_schema_create,
        EXISTS (
          SELECT 1
          FROM pg_database AS database
          INNER JOIN pg_roles AS owner ON owner.oid = database.datdba
          WHERE database.datname = current_database()
            AND owner.rolname IN (
              'balanz_api','balanz_worker','balanz_fiscal_cancel_owner'
            )
        ) AS runtime_group_owns_database
    `)) as Array<{
      runtime_roles_safe: boolean;
      leaked_bypass_memberships: number;
      fixed_parent_memberships: number;
      runtime_schema_create: boolean;
      runtime_group_owns_database: boolean;
    }>;

    report.schema = schemaState[0];
    report.roles = roleState[0];
    report.rls = {
      missingContextRows,
      apiTenantRows,
      tableOwnerRows,
      workerTenantRows,
      invalidContextSqlState,
      invalidCancellation: invalidCancellation[0]?.status ?? null,
      validCancellation: validCancellation[0]?.status ?? null,
      inactiveMembershipRows,
    };
    report.integrity = {
      compositeFkSqlState,
      scannerTimestampSqlState,
      lifecycleState: lifecycleState[0],
    };
    report.retryDelays = retryDelays;
    report.queueAges = queueAges;
    report.queueAgeAggregate = queueAgeRows[0];
    report.reconciliation = first;
    report.reconciliationSecondPass = idempotentResult[0];
    report.expiredUploadedObject = expiredUploadedObject[0];
    report.auditRows = auditRows;

    assertEqual(schemaState[0]?.tables, 4, 'foundation table count');
    assertEqual(schemaState[0]?.forced_rls, 4, 'FORCE RLS table count');
    assertEqual(schemaState[0]?.policies, 9, 'RLS policy count');
    assertEqual(roleState[0]?.runtime_roles_safe, true, 'runtime role flags');
    assertEqual(
      roleState[0]?.leaked_bypass_memberships,
      0,
      'migration user BYPASS membership leak',
    );
    assertEqual(
      roleState[0]?.fixed_parent_memberships,
      0,
      'fixed fiscal roles inherit no parent roles',
    );
    assertEqual(
      roleState[0]?.runtime_schema_create,
      false,
      'runtime groups cannot CREATE in public schema',
    );
    assertEqual(
      roleState[0]?.runtime_group_owns_database,
      false,
      'runtime groups do not own current database',
    );
    if (auditRows < 4) throw new Error('Expected reconciler audit evidence');
  } finally {
    if (queryRunner) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
        report.rolledBack = true;
      }
      await queryRunner.release();
    }
    if (dataSource.isInitialized) await dataSource.destroy();
  }

  console.log(JSON.stringify(report, null, 2));
}

async function createSyntheticTenantFixtures(
  queryRunner: QueryRunner,
  suffix: string,
): Promise<SyntheticTenantFixtures> {
  const [accountantRole] = (await queryRunner.query(
    `SELECT id FROM roles WHERE key = 'accountant'`,
  )) as Array<{ id: string }>;
  if (!accountantRole) {
    throw new Error('The canonical accountant role must be seeded before QA');
  }
  const roleId = accountantRole.id;
  const userIds = [randomUUID(), randomUUID(), randomUUID()];
  const organizationIds = [randomUUID(), randomUUID()];
  const membershipIds = [randomUUID(), randomUUID(), randomUUID()];
  const clientAccountIds = [randomUUID(), randomUUID()];
  const legalEntityIds = [randomUUID(), randomUUID()];

  await queryRunner.query(
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
      'qa-transactional-validator-no-login',
    ],
  );
  await queryRunner.query(
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
  await queryRunner.query(
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
  await queryRunner.query(
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
  await queryRunner.query(
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

  return {
    scopeA: {
      organization_id: organizationIds[0],
      client_account_id: clientAccountIds[0],
      legal_entity_id: legalEntityIds[0],
      membership_id: membershipIds[0],
    },
    scopeB: {
      organization_id: organizationIds[1],
      client_account_id: clientAccountIds[1],
      legal_entity_id: legalEntityIds[1],
      membership_id: membershipIds[1],
    },
    inactiveMembershipId: membershipIds[2],
  };
}

async function validateLockedSecurityDefinerParameters(
  queryRunner: QueryRunner,
  report: Record<string, unknown>,
): Promise<void> {
  const claimSql =
    'SELECT * FROM claim_ingestion_job($1,$2,$3::text[],$4,$5,$6,$7)';
  const reconcileSql =
    'SELECT * FROM reconcile_fiscal_ingestion_foundation($1,$2,$3,$4,$5::integer[],$6,$7,$8)';
  const cases: Array<{
    label: string;
    sql: string;
    parameters: unknown[];
  }> = [
    {
      label: 'claim_max_attempts',
      sql: claimSql,
      parameters: ['qa-policy', randomUUID(), ['manual_xml'], 90, 3, 3, 4],
    },
    {
      label: 'claim_max_retries',
      sql: claimSql,
      parameters: ['qa-policy', randomUUID(), ['manual_xml'], 90, 4, 2, 4],
    },
    {
      label: 'claim_tenant_cap',
      sql: claimSql,
      parameters: ['qa-policy', randomUUID(), ['manual_xml'], 90, 4, 3, 3],
    },
    {
      label: 'queue_age_max_attempts',
      sql: 'SELECT * FROM ingestion_queue_ages($1::text[],$2,$3)',
      parameters: [['manual_xml'], 3, 3],
    },
    {
      label: 'queue_age_max_retries',
      sql: 'SELECT * FROM ingestion_queue_ages($1::text[],$2,$3)',
      parameters: [['manual_xml'], 4, 2],
    },
    {
      label: 'reconcile_limit',
      sql: reconcileSql,
      parameters: [99, 60, 24, 7, [10, 30, 120], 20, 4, 3],
    },
    {
      label: 'reconcile_orphan_grace',
      sql: reconcileSql,
      parameters: [100, 5, 24, 7, [10, 30, 120], 20, 4, 3],
    },
    {
      label: 'reconcile_duplicate_grace',
      sql: reconcileSql,
      parameters: [100, 60, 23, 7, [10, 30, 120], 20, 4, 3],
    },
    {
      label: 'reconcile_invalid_retention',
      sql: reconcileSql,
      parameters: [100, 60, 24, 30, [10, 30, 120], 20, 4, 3],
    },
    {
      label: 'reconcile_backoff',
      sql: reconcileSql,
      parameters: [100, 60, 24, 7, [1, 2, 3], 20, 4, 3],
    },
    {
      label: 'reconcile_max_attempts',
      sql: reconcileSql,
      parameters: [100, 60, 24, 7, [10, 30, 120], 20, 3, 3],
    },
    {
      label: 'reconcile_max_retries',
      sql: reconcileSql,
      parameters: [100, 60, 24, 7, [10, 30, 120], 20, 4, 2],
    },
  ];
  const results: Record<string, string> = {};

  for (const fixture of cases) {
    await queryRunner.query(`SAVEPOINT locked_security_definer_parameter`);
    let sqlState: string | undefined;
    try {
      await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
      await queryRunner.query(fixture.sql, fixture.parameters);
    } catch (error) {
      sqlState = postgresCode(error);
    } finally {
      await queryRunner.query(
        `ROLLBACK TO SAVEPOINT locked_security_definer_parameter`,
      );
      await queryRunner.query(
        `RELEASE SAVEPOINT locked_security_definer_parameter`,
      );
    }
    assertEqual(sqlState, '22023', `${fixture.label} locked parameter`);
    results[fixture.label] = sqlState ?? 'missing';
  }

  report.lockedSecurityDefinerParameters = results;
}

async function createReconciliationFixtures(
  queryRunner: QueryRunner,
  scope: TenantScopeRow,
): Promise<{ auditedIds: string[]; expiredUploadedObjectId: string }> {
  const expiredObjectId = randomUUID();
  const expiredUploadId = randomUUID();
  await insertPendingObject(queryRunner, scope, expiredObjectId, 'qa/expired');
  await queryRunner.query(
    `UPDATE stored_objects
        SET created_at = clock_timestamp() - interval '2 days',
            updated_at = clock_timestamp() - interval '2 days'
      WHERE id = $1`,
    [expiredObjectId],
  );
  await insertUpload(queryRunner, scope, {
    id: expiredUploadId,
    objectId: expiredObjectId,
    state: 'pending',
    createdAt: `clock_timestamp() - interval '2 days'`,
    expiresAt: `clock_timestamp() - interval '1 day'`,
  });

  const expiredUploadedObjectId = randomUUID();
  const expiredUploadedUploadId = randomUUID();
  await queryRunner.query(
    `INSERT INTO stored_objects (
       id, organization_id, client_account_id, legal_entity_id,
       kind, storage_provider, storage_container, object_key,
       encryption_class, lifecycle_state, malware_scan_status,
       size_bytes, sha256, uploaded_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,
       'fiscal','uploaded','pending',1,$6,
       clock_timestamp() - interval '2 days',
       clock_timestamp() - interval '2 days',
       clock_timestamp() - interval '2 days'
     )`,
    [
      expiredUploadedObjectId,
      scope.organization_id,
      scope.client_account_id,
      scope.legal_entity_id,
      `qa/expired-uploaded/${expiredUploadedObjectId}`,
      '8'.repeat(64),
    ],
  );
  await insertUpload(queryRunner, scope, {
    id: expiredUploadedUploadId,
    objectId: expiredUploadedObjectId,
    state: 'uploaded',
    createdAt: `clock_timestamp() - interval '2 days'`,
    expiresAt: `clock_timestamp() - interval '1 day'`,
  });

  const orphanObjectId = randomUUID();
  await insertPendingObject(queryRunner, scope, orphanObjectId, 'qa/orphan');
  await queryRunner.query(
    `UPDATE stored_objects
        SET created_at = clock_timestamp() - interval '2 hours',
            updated_at = clock_timestamp() - interval '2 hours'
      WHERE id = $1`,
    [orphanObjectId],
  );

  const confirmedObjectId = randomUUID();
  const confirmedUploadId = randomUUID();
  await queryRunner.query(
    `INSERT INTO stored_objects (
       id, organization_id, client_account_id, legal_entity_id,
       kind, storage_provider, storage_container, object_key,
       encryption_class, lifecycle_state, malware_scan_status,
       size_bytes, sha256, uploaded_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,
       'fiscal','uploaded','pending',1,$6,
        clock_timestamp() - interval '2 hours',
        clock_timestamp() - interval '2 hours',
        clock_timestamp() - interval '2 hours'
     )`,
    [
      confirmedObjectId,
      scope.organization_id,
      scope.client_account_id,
      scope.legal_entity_id,
      `qa/confirmed/${confirmedObjectId}`,
      'b'.repeat(64),
    ],
  );
  await insertUpload(queryRunner, scope, {
    id: confirmedUploadId,
    objectId: confirmedObjectId,
    state: 'confirmed',
    createdAt: `clock_timestamp() - interval '2 hours'`,
    expiresAt: `clock_timestamp() + interval '1 day'`,
    confirmedAt: `clock_timestamp() - interval '90 minutes'`,
    payloadHash: 'b'.repeat(64),
  });

  const orphanJobObjectId = randomUUID();
  const orphanJobUploadId = randomUUID();
  await insertPendingObject(
    queryRunner,
    scope,
    orphanJobObjectId,
    'qa/orphan-job',
  );
  await queryRunner.query(
    `UPDATE stored_objects
        SET lifecycle_state = 'rejected',
            quarantine_reason_code = 'QA_UNAVAILABLE',
            retention_until = clock_timestamp() + interval '30 days'
      WHERE id = $1`,
    [orphanJobObjectId],
  );
  await insertUpload(queryRunner, scope, {
    id: orphanJobUploadId,
    objectId: orphanJobObjectId,
    state: 'expired',
    createdAt: `clock_timestamp() - interval '2 days'`,
    expiresAt: `clock_timestamp() - interval '1 day'`,
  });

  const orphanJobId = randomUUID();
  await queryRunner.query(
    `INSERT INTO ingestion_jobs (
       id, organization_id, client_account_id, legal_entity_id,
       source_type, upload_id, root_object_id, requested_by_membership_id,
       idempotency_key, request_fingerprint, idempotency_expires_at,
       status, next_attempt_at, correlation_id
     ) VALUES (
       $1,$2,$3,$4,'manual_xml',$5,$6,$7,$8,$9,
       clock_timestamp() + interval '1 day','queued',clock_timestamp(),$10
     )`,
    [
      orphanJobId,
      scope.organization_id,
      scope.client_account_id,
      scope.legal_entity_id,
      orphanJobUploadId,
      orphanJobObjectId,
      scope.membership_id,
      `qa-orphan-job-${orphanJobId}`,
      'c'.repeat(64),
      randomUUID(),
    ],
  );

  const counterJobId = randomUUID();
  await insertManualXmlJob(queryRunner, scope, counterJobId, {
    pendingItems: 5,
    totalItems: 5,
  });

  const redundantObjectId = randomUUID();
  await queryRunner.query(
    `INSERT INTO stored_objects (
       id, organization_id, client_account_id, legal_entity_id,
       kind, storage_provider, storage_container, object_key,
       encryption_class, lifecycle_state, malware_scan_status,
       size_bytes, sha256, uploaded_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,
       'fiscal','uploaded','pending',1,$6,
       clock_timestamp() - interval '2 days',
       clock_timestamp() - interval '2 days',
       clock_timestamp() - interval '2 days'
     )`,
    [
      redundantObjectId,
      scope.organization_id,
      scope.client_account_id,
      scope.legal_entity_id,
      `qa/redundant/${redundantObjectId}`,
      'f'.repeat(64),
    ],
  );
  await queryRunner.query(
    `INSERT INTO ingestion_items (
       id, organization_id, client_account_id, legal_entity_id,
       ingestion_job_id, object_id, ordinal,
       technical_status, product_result, sha256, processed_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,1,'terminal','duplicate',$7,clock_timestamp()
     )`,
    [
      randomUUID(),
      scope.organization_id,
      scope.client_account_id,
      scope.legal_entity_id,
      counterJobId,
      redundantObjectId,
      'f'.repeat(64),
    ],
  );

  const retentionObjectId = randomUUID();
  await insertPendingObject(
    queryRunner,
    scope,
    retentionObjectId,
    'qa/retention',
  );
  await queryRunner.query(
    `UPDATE stored_objects
        SET lifecycle_state = 'rejected',
            quarantine_reason_code = 'QA_RETENTION',
            retention_until = clock_timestamp() - interval '1 minute'
      WHERE id = $1`,
    [retentionObjectId],
  );

  return {
    auditedIds: [
      expiredUploadId,
      orphanObjectId,
      orphanJobId,
      counterJobId,
      redundantObjectId,
      retentionObjectId,
    ],
    expiredUploadedObjectId,
  };
}

async function insertPendingObject(
  queryRunner: QueryRunner,
  scope: TenantScopeRow,
  id: string,
  prefix: string,
): Promise<void> {
  await queryRunner.query(
    `INSERT INTO stored_objects (
       id, organization_id, client_account_id, legal_entity_id,
       kind, storage_provider, storage_container, object_key,
       encryption_class, lifecycle_state, malware_scan_status
     ) VALUES (
       $1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,
       'fiscal','pending_upload','pending'
     )`,
    [
      id,
      scope.organization_id,
      scope.client_account_id,
      scope.legal_entity_id,
      `${prefix}/${id}`,
    ],
  );
}

async function insertUpload(
  queryRunner: QueryRunner,
  scope: TenantScopeRow,
  fixture: {
    id: string;
    objectId: string;
    state: 'pending' | 'uploaded' | 'confirmed' | 'expired';
    createdAt: string;
    expiresAt: string;
    confirmedAt?: string;
    payloadHash?: string;
  },
): Promise<void> {
  const confirmedAt = fixture.confirmedAt ?? 'NULL';
  const actualSize = fixture.state === 'confirmed' ? '1' : 'NULL';
  const actualHash = '$10::char(64)';
  const parameters: unknown[] = [
    fixture.id,
    scope.organization_id,
    scope.client_account_id,
    scope.legal_entity_id,
    `qa-upload-${fixture.id}`,
    'd'.repeat(64),
    fixture.objectId,
    scope.membership_id,
    randomUUID(),
    fixture.payloadHash ?? null,
    fixture.state === 'confirmed' ? `qa-confirm-${fixture.id}` : null,
    fixture.state === 'confirmed' ? 'e'.repeat(64) : null,
  ];
  await queryRunner.query(
    `INSERT INTO ingestion_uploads (
       id, organization_id, client_account_id, legal_entity_id,
       workflow, upload_type,
       init_idempotency_key, init_request_fingerprint,
       init_idempotency_expires_at,
       confirm_idempotency_key, confirm_request_fingerprint,
       confirm_response_status, confirm_response_reference,
       confirm_idempotency_created_at, confirm_idempotency_expires_at,
       object_id, state,
       actual_size_bytes, actual_sha256, upload_expires_at, confirmed_at,
       created_by_membership_id, correlation_id, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,'direct','manual_xml',$5,$6,
       clock_timestamp() + interval '2 days',
       $11,$12,${fixture.state === 'confirmed' ? '200' : 'NULL'},
       ${fixture.state === 'confirmed' ? '($1::uuid)::text' : 'NULL'},
       ${fixture.state === 'confirmed' ? confirmedAt : 'NULL'},
       ${fixture.state === 'confirmed' ? "clock_timestamp() + interval '2 days'" : 'NULL'},
       $7,'${fixture.state}',
       ${actualSize},${actualHash},${fixture.expiresAt},${confirmedAt},
       $8,$9,${fixture.createdAt},${fixture.createdAt}
     )`,
    parameters,
  );
}

async function insertManualXmlJob(
  queryRunner: QueryRunner,
  scope: TenantScopeRow,
  id: string,
  counters: { pendingItems: number; totalItems: number },
): Promise<void> {
  const objectId = randomUUID();
  const uploadId = randomUUID();
  await queryRunner.query(
    `INSERT INTO stored_objects (
       id, organization_id, client_account_id, legal_entity_id,
       kind, storage_provider, storage_container, object_key,
       encryption_class, lifecycle_state, malware_scan_status,
       size_bytes, sha256, uploaded_at
     ) VALUES (
       $1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,
       'fiscal','uploaded','pending',1,$6,clock_timestamp()
     )`,
    [
      objectId,
      scope.organization_id,
      scope.client_account_id,
      scope.legal_entity_id,
      `qa/job-input/${objectId}`,
      '7'.repeat(64),
    ],
  );
  await insertUpload(queryRunner, scope, {
    id: uploadId,
    objectId,
    state: 'confirmed',
    createdAt: `clock_timestamp() - interval '1 minute'`,
    expiresAt: `clock_timestamp() + interval '1 day'`,
    confirmedAt: `clock_timestamp()`,
    payloadHash: '7'.repeat(64),
  });
  await queryRunner.query(
    `INSERT INTO ingestion_jobs (
       id, organization_id, client_account_id, legal_entity_id,
       source_type, upload_id, root_object_id, requested_by_membership_id,
       idempotency_key, request_fingerprint,
       idempotency_expires_at, status, next_attempt_at,
       total_items, pending_items, correlation_id
     ) VALUES (
       $1,$2,$3,$4,'manual_xml',$5,$6,$7,$8,$9,
       clock_timestamp() + interval '1 day','queued',clock_timestamp(),
       $10,$11,$12
     )`,
    [
      id,
      scope.organization_id,
      scope.client_account_id,
      scope.legal_entity_id,
      uploadId,
      objectId,
      scope.membership_id,
      `qa-job-${id}`,
      'a'.repeat(64),
      counters.totalItems,
      counters.pendingItems,
      randomUUID(),
    ],
  );
}

async function setContext(
  queryRunner: QueryRunner,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  await queryRunner.query(
    `SELECT
       set_config('app.organization_id', $1, true),
       set_config('app.membership_id', $2, true)`,
    [organizationId, membershipId],
  );
}

async function clearContext(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(
    `SELECT
       set_config('app.organization_id', '', true),
       set_config('app.membership_id', '', true)`,
  );
}

async function scalarCount(
  queryRunner: QueryRunner,
  sql: string,
  parameters: unknown[] = [],
): Promise<number> {
  const rows = (await queryRunner.query(sql, parameters)) as Array<{
    value: number;
  }>;
  return Number(rows[0]?.value ?? 0);
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? String(code)
    : undefined;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

void validateFiscalFoundationTransaction().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
