import { MigrationInterface, QueryRunner } from 'typeorm';

export class IngestionAutomaticRetryBudget1787690620000 implements MigrationInterface {
  name = 'IngestionAutomaticRetryBudget1787690620000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'GRANT balanz_fiscal_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner TO %I',
          current_user
        );
      END $$
    `);

    await queryRunner.query(`
      ALTER TABLE ingestion_jobs
      ADD COLUMN automatic_retry_count integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      WITH retry_audits AS (
        SELECT
          event.object_id AS job_id,
          count(*) FILTER (
            WHERE (
              event.action = 'ingestion.job.retry_scheduled'
              AND event.metadata ->> 'status' = 'failed_retryable'
            ) OR (
              event.action = 'ingestion.job.lease_reconciled'
              AND event.metadata ->> 'result_status' = 'failed_retryable'
            )
          )::integer AS retry_count
        FROM audit_events AS event
        WHERE event.object_type = 'ingestion_job'
          AND event.action IN (
            'ingestion.job.retry_scheduled',
            'ingestion.job.lease_reconciled'
          )
        GROUP BY event.object_id
      )
      UPDATE ingestion_jobs AS job
         SET automatic_retry_count = least(
           3,
           greatest(0, COALESCE(retry_audits.retry_count, 0))
         )
        FROM retry_audits
       WHERE retry_audits.job_id = job.id
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM ingestion_jobs AS job
          WHERE job.status = 'failed_retryable'
            AND job.automatic_retry_count = 0
        ) THEN
          RAISE EXCEPTION
            'cannot infer automatic retry budget for an existing retryable job';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM ingestion_jobs AS job
          WHERE job.automatic_retry_count > job.attempt_count
        ) THEN
          RAISE EXCEPTION
            'automatic retry audit history exceeds durable attempt history';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_jobs
      DROP CONSTRAINT ck_ingestion_jobs_attempt_count
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_jobs
      ADD CONSTRAINT ck_ingestion_jobs_attempt_count
      CHECK (attempt_count >= 0)
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_jobs
      ADD CONSTRAINT ck_ingestion_jobs_automatic_retry_count
      CHECK (
        automatic_retry_count BETWEEN 0 AND 3
        AND automatic_retry_count <= attempt_count
      )
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_items
      DROP CONSTRAINT ck_ingestion_items_attempt_count
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_items
      ADD CONSTRAINT ck_ingestion_items_attempt_count
      CHECK (attempt_count BETWEEN 0 AND 4)
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN ingestion_jobs.automatic_retry_count IS
      'Automatic retries already granted after retryable execution failures; graceful shutdown does not increment it.'
    `);
    await queryRunner.query(`
      GRANT SELECT (automatic_retry_count), UPDATE (automatic_retry_count)
      ON ingestion_jobs TO balanz_worker
    `);

    await queryRunner.query(`
      CREATE FUNCTION claim_ingestion_job(
        p_worker_id text,
        p_lease_token text,
        p_supported_sources text[],
        p_lease_seconds integer,
        p_max_attempts integer,
        p_max_retries integer,
        p_active_jobs_per_tenant integer
      )
      RETURNS TABLE (
        job_id uuid,
        organization_id uuid,
        client_account_id uuid,
        legal_entity_id uuid,
        source_type varchar,
        upload_id uuid,
        root_object_id uuid,
        requested_by_membership_id uuid,
        correlation_id uuid,
        attempt_count integer,
        queue_age_seconds double precision,
        version integer,
        recovered boolean,
        lease_token varchar
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      SET row_security = off
      AS $$
      DECLARE
        v_candidate_organization uuid;
        v_ready record;
        v_tenant_lock_acquired boolean := false;
      BEGIN
        IF p_worker_id IS NULL
          OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN
          RAISE EXCEPTION 'invalid worker id' USING ERRCODE = '22023';
        END IF;
        IF p_lease_token IS NULL
          OR p_lease_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
          OR p_lease_token = p_worker_id THEN
          RAISE EXCEPTION 'invalid unique lease token' USING ERRCODE = '22023';
        END IF;
        IF p_supported_sources IS NULL OR cardinality(p_supported_sources) = 0 THEN
          RAISE EXCEPTION 'at least one supported source is required' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM unnest(p_supported_sources) AS source(value)
          WHERE source.value NOT IN ('manual_xml','manual_zip','sat_package')
        ) THEN
          RAISE EXCEPTION 'unsupported ingestion source requested by worker' USING ERRCODE = '22023';
        END IF;
        IF p_lease_seconds <> 90 THEN
          RAISE EXCEPTION 'lease must be exactly 90 seconds' USING ERRCODE = '22023';
        END IF;
        IF p_max_attempts IS DISTINCT FROM 4 THEN
          RAISE EXCEPTION 'maximum budgeted executions must be exactly 4' USING ERRCODE = '22023';
        END IF;
        IF p_max_retries IS DISTINCT FROM 3 THEN
          RAISE EXCEPTION 'maximum automatic retries must be exactly 3' USING ERRCODE = '22023';
        END IF;
        IF p_active_jobs_per_tenant IS DISTINCT FROM 4 THEN
          RAISE EXCEPTION 'tenant concurrency cap must be exactly 4' USING ERRCODE = '22023';
        END IF;

        FOR v_ready IN
          SELECT ready.organization_id
          FROM (
            SELECT
              job.organization_id,
              min(job.next_attempt_at) AS next_attempt_at,
              min(job.created_at) AS created_at,
              (
                SELECT max(history.last_claimed_at)
                FROM public.ingestion_jobs AS history
                WHERE history.organization_id = job.organization_id
              ) AS last_claimed_at
            FROM public.ingestion_jobs AS job
            WHERE job.status IN ('queued','failed_retryable')
              AND job.next_attempt_at <= clock_timestamp()
              AND job.cancel_requested_at IS NULL
              AND job.automatic_retry_count <= p_max_retries
              AND job.source_type::text = ANY (p_supported_sources)
              AND (
                SELECT count(*)
                FROM public.ingestion_jobs AS active
                WHERE active.organization_id = job.organization_id
                  AND active.status IN ('processing','cancel_requested')
                  AND active.lease_expires_at > clock_timestamp()
              ) < p_active_jobs_per_tenant
            GROUP BY job.organization_id
          ) AS ready
          ORDER BY
            ready.last_claimed_at ASC NULLS FIRST,
            ready.next_attempt_at,
            ready.created_at,
            ready.organization_id
        LOOP
          IF pg_try_advisory_xact_lock(
            hashtextextended('balanz:cfdi:claim:' || v_ready.organization_id::text, 97831)
          ) THEN
            v_candidate_organization := v_ready.organization_id;
            v_tenant_lock_acquired := true;
            EXIT;
          END IF;
        END LOOP;

        IF NOT v_tenant_lock_acquired THEN RETURN; END IF;

        RETURN QUERY
        WITH candidate AS (
          SELECT
            job.id,
            job.status = 'failed_retryable' AS recovered,
            greatest(
              0::double precision,
              extract(epoch FROM clock_timestamp() - job.created_at)::double precision
            ) AS queue_age_seconds
          FROM public.ingestion_jobs AS job
          WHERE job.organization_id = v_candidate_organization
            AND job.status IN ('queued','failed_retryable')
            AND job.next_attempt_at <= clock_timestamp()
            AND job.cancel_requested_at IS NULL
            AND job.automatic_retry_count <= p_max_retries
            AND job.source_type::text = ANY (p_supported_sources)
            AND (
              SELECT count(*)
              FROM public.ingestion_jobs AS active
              WHERE active.organization_id = job.organization_id
                AND active.status IN ('processing','cancel_requested')
                AND active.lease_expires_at > clock_timestamp()
            ) < p_active_jobs_per_tenant
          ORDER BY
            job.next_attempt_at,
            job.created_at,
            job.id
          FOR UPDATE OF job SKIP LOCKED
          LIMIT 1
        ),
        claimed AS (
          UPDATE public.ingestion_jobs AS job
             SET status = 'processing',
                 attempt_count = job.attempt_count + 1,
                 next_attempt_at = NULL,
                 worker_id = p_worker_id,
                 locked_by = p_lease_token,
                 lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
                 heartbeat_at = clock_timestamp(),
                 last_claimed_at = clock_timestamp(),
                 started_at = COALESCE(job.started_at, clock_timestamp()),
                 completed_at = NULL,
                 updated_at = clock_timestamp(),
                 version = job.version + 1
            FROM candidate
           WHERE job.id = candidate.id
          RETURNING
            job.id,
            job.organization_id,
            job.client_account_id,
            job.legal_entity_id,
            job.source_type,
            job.upload_id,
            job.root_object_id,
            job.requested_by_membership_id,
            job.correlation_id,
            job.attempt_count,
            job.automatic_retry_count,
            candidate.queue_age_seconds,
            job.version,
            candidate.recovered
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            claimed.organization_id, 'service', 'cfdi-worker',
            claimed.client_account_id, claimed.legal_entity_id,
            'ingestion.job.claimed', 'ALLOW',
            'ingestion_job', claimed.id, 'Durable job lease claimed.',
            claimed.correlation_id,
            jsonb_build_object(
              'attempt_count', claimed.attempt_count,
              'automatic_retry_count', claimed.automatic_retry_count,
              'recovered', claimed.recovered
            )
          FROM claimed
          RETURNING 1
        )
        SELECT
          claimed.id,
          claimed.organization_id,
          claimed.client_account_id,
          claimed.legal_entity_id,
          claimed.source_type,
          claimed.upload_id,
          claimed.root_object_id,
          claimed.requested_by_membership_id,
          claimed.correlation_id,
          claimed.attempt_count,
          claimed.queue_age_seconds,
          claimed.version,
          claimed.recovered,
          p_lease_token::varchar
        FROM claimed;
      END
      $$
    `);
    await queryRunner.query(`
      ALTER FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer, integer)
      OWNER TO balanz_fiscal_claim_owner
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer, integer)
      FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer, integer)
      TO balanz_worker
    `);
    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer)
      FROM balanz_worker
    `);

    await queryRunner.query(`
      CREATE FUNCTION ingestion_queue_ages(
        p_supported_sources text[],
        p_max_attempts integer,
        p_max_retries integer
      )
      RETURNS TABLE (
        source_type varchar,
        queue_age_seconds double precision
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      SET row_security = off
      AS $$
      BEGIN
        IF p_supported_sources IS NULL OR cardinality(p_supported_sources) = 0 THEN
          RAISE EXCEPTION 'at least one supported source is required' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM unnest(p_supported_sources) AS source(value)
          WHERE source.value NOT IN ('manual_xml','manual_zip','sat_package')
        ) THEN
          RAISE EXCEPTION 'unsupported ingestion source requested by worker' USING ERRCODE = '22023';
        END IF;
        IF p_max_attempts IS DISTINCT FROM 4 THEN
          RAISE EXCEPTION 'maximum budgeted executions must be exactly 4' USING ERRCODE = '22023';
        END IF;
        IF p_max_retries IS DISTINCT FROM 3 THEN
          RAISE EXCEPTION 'maximum automatic retries must be exactly 3' USING ERRCODE = '22023';
        END IF;

        RETURN QUERY
        SELECT
          job.source_type,
          greatest(
            0::double precision,
            extract(epoch FROM clock_timestamp() - min(job.created_at))::double precision
          ) AS queue_age_seconds
        FROM public.ingestion_jobs AS job
        WHERE job.status IN ('queued','failed_retryable')
          AND job.next_attempt_at <= clock_timestamp()
          AND job.cancel_requested_at IS NULL
          AND job.automatic_retry_count <= p_max_retries
          AND job.source_type::text = ANY (p_supported_sources)
        GROUP BY job.source_type
        ORDER BY job.source_type;
      END
      $$
    `);
    await queryRunner.query(`
      ALTER FUNCTION ingestion_queue_ages(text[], integer, integer)
      OWNER TO balanz_fiscal_claim_owner
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION ingestion_queue_ages(text[], integer, integer)
      FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION ingestion_queue_ages(text[], integer, integer)
      TO balanz_worker
    `);
    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION ingestion_queue_ages(text[], integer)
      FROM balanz_worker
    `);

    await this.createReconciler(queryRunner);

    await queryRunner.query(`
      REVOKE CREATE ON SCHEMA public
      FROM balanz_fiscal_owner,
           balanz_fiscal_claim_owner,
           balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'REVOKE balanz_fiscal_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner FROM %I',
          current_user
        );
      END $$
    `);
  }

  private async createReconciler(queryRunner: QueryRunner): Promise<void> {
    // Defined separately to keep the forward migration auditable: this is the
    // 061 reconciler with only its lease retry-budget transition changed.
    await queryRunner.query(`
      CREATE FUNCTION reconcile_fiscal_ingestion_foundation(
        p_limit integer,
        p_orphan_grace_minutes integer,
        p_duplicate_bytes_hours integer,
        p_invalid_object_days integer,
        p_backoff_seconds integer[],
        p_jitter_percent integer,
        p_max_attempts integer,
        p_max_retries integer
      )
      RETURNS TABLE (
        lease_retryable_count integer,
        lease_final_count integer,
        lease_cancelled_count integer,
        expired_upload_count integer,
        rejected_orphan_object_count integer,
        confirmed_object_without_job_count integer,
        orphan_job_count integer,
        repaired_counter_count integer,
        redundant_object_count integer,
        retention_eligible_object_count integer
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      SET row_security = off
      AS $$
      DECLARE
        v_lease_retryable integer := 0;
        v_lease_final integer := 0;
        v_lease_cancelled integer := 0;
        v_expired_upload integer := 0;
        v_rejected_orphan_object integer := 0;
        v_confirmed_without_job integer := 0;
        v_orphan_job integer := 0;
        v_repaired_counter integer := 0;
        v_redundant_object integer := 0;
        v_retention_eligible integer := 0;
      BEGIN
        IF p_limit IS DISTINCT FROM 100 THEN
          RAISE EXCEPTION 'reconciliation limit must be exactly 100' USING ERRCODE = '22023';
        END IF;
        IF p_orphan_grace_minutes IS DISTINCT FROM 60 THEN
          RAISE EXCEPTION 'orphan grace must be exactly 60 minutes' USING ERRCODE = '22023';
        END IF;
        IF p_duplicate_bytes_hours IS DISTINCT FROM 24 THEN
          RAISE EXCEPTION 'duplicate bytes grace must be exactly 24 hours' USING ERRCODE = '22023';
        END IF;
        IF p_invalid_object_days IS DISTINCT FROM 7 THEN
          RAISE EXCEPTION 'invalid object retention must be exactly 7 days' USING ERRCODE = '22023';
        END IF;
        IF p_backoff_seconds IS DISTINCT FROM ARRAY[10,30,120]::integer[] THEN
          RAISE EXCEPTION 'retry delays must be exactly 10,30,120 seconds' USING ERRCODE = '22023';
        END IF;
        IF p_jitter_percent IS NULL OR p_jitter_percent < 0 OR p_jitter_percent > 50 THEN
          RAISE EXCEPTION 'retry jitter must be between 0 and 50 percent' USING ERRCODE = '22023';
        END IF;
        IF p_max_attempts IS DISTINCT FROM 4 THEN
          RAISE EXCEPTION 'maximum budgeted executions must be exactly 4' USING ERRCODE = '22023';
        END IF;
        IF p_max_retries IS DISTINCT FROM 3 THEN
          RAISE EXCEPTION 'maximum automatic retries must be exactly 3' USING ERRCODE = '22023';
        END IF;

        WITH candidates AS (
          SELECT job.id
          FROM public.ingestion_jobs AS job
          WHERE job.status IN ('processing','cancel_requested')
            AND job.lease_expires_at <= clock_timestamp()
          ORDER BY job.lease_expires_at, job.id
          FOR UPDATE SKIP LOCKED
          LIMIT p_limit
        ),
        recovered AS (
          UPDATE public.ingestion_jobs AS job
             SET status = CASE
                   WHEN job.status = 'cancel_requested' THEN 'cancelled'
                   WHEN job.automatic_retry_count >= p_max_retries THEN 'failed_final'
                   ELSE 'failed_retryable'
                 END,
                 automatic_retry_count = CASE
                   WHEN job.status <> 'cancel_requested'
                     AND job.automatic_retry_count < p_max_retries
                     THEN job.automatic_retry_count + 1
                   ELSE job.automatic_retry_count
                 END,
                 next_attempt_at = CASE
                   WHEN job.status = 'cancel_requested'
                     OR job.automatic_retry_count >= p_max_retries THEN NULL
                   ELSE clock_timestamp()
                     + make_interval(
                         secs => p_backoff_seconds[
                           least(
                             job.automatic_retry_count + 1,
                             cardinality(p_backoff_seconds)
                           )
                         ]
                           + floor(
                               random()
                               * (
                                   p_backoff_seconds[
                                     least(
                                       job.automatic_retry_count + 1,
                                       cardinality(p_backoff_seconds)
                                     )
                                   ]
                                   * p_jitter_percent / 100.0
                                   + 1
                                 )
                             )::integer
                       )
                 END,
                 locked_by = NULL,
                 lease_expires_at = NULL,
                 completed_at = CASE
                   WHEN job.status = 'cancel_requested'
                     OR job.automatic_retry_count >= p_max_retries
                     THEN clock_timestamp()
                   ELSE NULL
                 END,
                 last_error_code = CASE
                   WHEN job.status = 'cancel_requested' THEN job.last_error_code
                   ELSE 'JOB_LEASE_LOST'
                 END,
                 last_error_detail = CASE
                   WHEN job.status = 'cancel_requested' THEN job.last_error_detail
                   ELSE 'Worker lease expired before completion.'
                 END,
                 updated_at = clock_timestamp(),
                 version = job.version + 1
            FROM candidates
           WHERE job.id = candidates.id
          RETURNING
            job.id,
            job.organization_id,
            job.client_account_id,
            job.legal_entity_id,
            job.correlation_id,
            job.status,
            job.automatic_retry_count
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            recovered.organization_id, 'system', 'cfdi-foundation-reconciler',
            recovered.client_account_id, recovered.legal_entity_id,
            'ingestion.job.lease_reconciled', 'ALLOW',
            'ingestion_job', recovered.id, 'Expired worker lease reconciled.',
            recovered.correlation_id,
            jsonb_build_object(
              'result_status', recovered.status,
              'automatic_retry_count', recovered.automatic_retry_count
            )
          FROM recovered
          RETURNING 1
        )
        SELECT
          count(*) FILTER (WHERE recovered.status = 'failed_retryable')::integer,
          count(*) FILTER (WHERE recovered.status = 'failed_final')::integer,
          count(*) FILTER (WHERE recovered.status = 'cancelled')::integer
        INTO v_lease_retryable, v_lease_final, v_lease_cancelled
        FROM recovered;

        WITH candidates AS (
          SELECT upload.id
          FROM public.ingestion_uploads AS upload
          WHERE upload.state IN ('pending','receiving','uploaded')
            AND upload.upload_expires_at <= clock_timestamp()
          ORDER BY upload.upload_expires_at, upload.id
          FOR UPDATE SKIP LOCKED
          LIMIT p_limit
        ),
        expired AS (
          UPDATE public.ingestion_uploads AS upload
             SET state = 'expired',
                 last_error_code = 'UPLOAD_EXPIRED',
                 updated_at = clock_timestamp(),
                 version = upload.version + 1
            FROM candidates
           WHERE upload.id = candidates.id
          RETURNING
            upload.id,
            upload.organization_id,
            upload.client_account_id,
            upload.legal_entity_id,
            upload.correlation_id
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            expired.organization_id, 'system', 'cfdi-foundation-reconciler',
            expired.client_account_id, expired.legal_entity_id,
            'ingestion.upload.expired', 'ALLOW',
            'ingestion_upload', expired.id, 'Incomplete upload expired.',
            expired.correlation_id, '{}'::jsonb
          FROM expired
          RETURNING 1
        )
        SELECT count(*)::integer INTO v_expired_upload FROM expired;

        WITH candidates AS (
          SELECT
            object.id,
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM public.ingestion_uploads AS expired_upload
                WHERE expired_upload.organization_id = object.organization_id
                  AND expired_upload.object_id = object.id
                  AND expired_upload.state = 'expired'
              ) THEN 'UPLOAD_EXPIRED'
              ELSE 'ORPHANED_PENDING_OBJECT'
            END AS reason_code
          FROM public.stored_objects AS object
          WHERE object.lifecycle_state IN ('pending_upload','uploaded')
            AND (
              (
                object.lifecycle_state = 'pending_upload'
                AND object.created_at <= clock_timestamp() - make_interval(mins => p_orphan_grace_minutes)
              )
              OR (
                object.lifecycle_state = 'uploaded'
                AND EXISTS (
                  SELECT 1
                  FROM public.ingestion_uploads AS expired_upload
                  WHERE expired_upload.organization_id = object.organization_id
                    AND expired_upload.object_id = object.id
                    AND expired_upload.state = 'expired'
                )
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.ingestion_uploads AS upload
              WHERE upload.organization_id = object.organization_id
                AND upload.object_id = object.id
                AND upload.state IN ('pending','receiving','uploaded','confirmed')
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.ingestion_jobs AS active_job
              WHERE active_job.organization_id = object.organization_id
                AND active_job.root_object_id = object.id
                AND active_job.status IN (
                  'awaiting_upload','queued','processing',
                  'failed_retryable','cancel_requested'
                )
            )
          ORDER BY object.created_at, object.id
          FOR UPDATE OF object SKIP LOCKED
          LIMIT p_limit
        ),
        rejected AS (
          UPDATE public.stored_objects AS object
             SET lifecycle_state = 'rejected',
                 quarantine_reason_code = candidates.reason_code,
                 retention_until = COALESCE(
                   object.retention_until,
                   clock_timestamp() + make_interval(days => p_invalid_object_days)
                 ),
                 updated_at = clock_timestamp(),
                 version = object.version + 1
            FROM candidates
           WHERE object.id = candidates.id
          RETURNING
            object.id,
            object.organization_id,
            object.client_account_id,
            object.legal_entity_id
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            rejected.organization_id, 'system', 'cfdi-foundation-reconciler',
            rejected.client_account_id, rejected.legal_entity_id,
            'stored_object.orphan_rejected', 'ALLOW',
            'stored_object', rejected.id, 'Unconfirmed orphan object rejected.',
            rejected.id, '{}'::jsonb
          FROM rejected
          RETURNING 1
        )
        SELECT count(*)::integer INTO v_rejected_orphan_object FROM rejected;

        WITH candidates AS (
          SELECT upload.id
          FROM public.stored_objects AS object
          INNER JOIN public.ingestion_uploads AS upload
            ON upload.organization_id = object.organization_id
           AND upload.object_id = object.id
           AND upload.state = 'confirmed'
          WHERE object.lifecycle_state IN ('uploaded','quarantined','available')
            AND upload.confirmed_at <= clock_timestamp() - make_interval(mins => p_orphan_grace_minutes)
            AND upload.confirmed_without_job_reported_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.ingestion_jobs AS job
              WHERE job.organization_id = object.organization_id
                AND (job.upload_id = upload.id OR job.root_object_id = object.id)
            )
          ORDER BY upload.confirmed_at, object.id
          FOR UPDATE OF upload SKIP LOCKED
          LIMIT p_limit
        ),
        reported AS (
          UPDATE public.ingestion_uploads AS upload
             SET confirmed_without_job_reported_at = clock_timestamp(),
                 updated_at = clock_timestamp(),
                 version = upload.version + 1
            FROM candidates
           WHERE upload.id = candidates.id
          RETURNING
            upload.id,
            upload.organization_id,
            upload.client_account_id,
            upload.legal_entity_id,
            upload.correlation_id
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            reported.organization_id, 'system', 'cfdi-foundation-reconciler',
            reported.client_account_id, reported.legal_entity_id,
            'ingestion.upload.confirmed_without_job', 'ALLOW',
            'ingestion_upload', reported.id,
            'Confirmed object has no durable job; no job was synthesized in Phase 0.',
            reported.correlation_id, '{}'::jsonb
          FROM reported
          RETURNING 1
        )
        SELECT count(*)::integer
        INTO v_confirmed_without_job
        FROM reported;

        WITH candidates AS (
          SELECT job.id
          FROM public.ingestion_jobs AS job
          LEFT JOIN public.stored_objects AS object
            ON object.organization_id = job.organization_id
           AND object.id = job.root_object_id
          LEFT JOIN public.ingestion_uploads AS upload
            ON upload.organization_id = job.organization_id
           AND upload.id = job.upload_id
          WHERE job.status IN ('awaiting_upload','queued','failed_retryable')
            AND (
              (
                job.source_type IN ('manual_xml','manual_zip','sat_package')
                AND (object.id IS NULL OR object.lifecycle_state IN ('rejected','deleted'))
              )
              OR (
                job.upload_id IS NOT NULL
                AND (upload.id IS NULL OR upload.state IN ('expired','failed','cancelled'))
              )
            )
          ORDER BY job.created_at, job.id
          FOR UPDATE OF job SKIP LOCKED
          LIMIT p_limit
        ),
        failed AS (
          UPDATE public.ingestion_jobs AS job
             SET status = 'failed_final',
                 next_attempt_at = NULL,
                 locked_by = NULL,
                 lease_expires_at = NULL,
                 completed_at = clock_timestamp(),
                 last_error_code = 'JOB_ROOT_OBJECT_UNAVAILABLE',
                 last_error_detail = 'The durable root object or upload is unavailable.',
                 updated_at = clock_timestamp(),
                 version = job.version + 1
            FROM candidates
           WHERE job.id = candidates.id
          RETURNING
            job.id,
            job.organization_id,
            job.client_account_id,
            job.legal_entity_id,
            job.correlation_id
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            failed.organization_id, 'system', 'cfdi-foundation-reconciler',
            failed.client_account_id, failed.legal_entity_id,
            'ingestion.job.orphan_failed', 'ALLOW',
            'ingestion_job', failed.id, 'Job root object or upload unavailable.',
            failed.correlation_id, '{}'::jsonb
          FROM failed
          RETURNING 1
        )
        SELECT count(*)::integer INTO v_orphan_job FROM failed;

        WITH selected AS (
          SELECT job.id, job.organization_id
          FROM public.ingestion_jobs AS job
          WHERE job.counters_reconciled_at IS NULL
             OR EXISTS (
               SELECT 1
               FROM public.ingestion_items AS dirty_item
               WHERE dirty_item.organization_id = job.organization_id
                 AND dirty_item.ingestion_job_id = job.id
                 AND dirty_item.updated_at > job.counters_reconciled_at
             )
          ORDER BY
            job.counters_reconciled_at ASC NULLS FIRST,
            job.updated_at,
            job.id
          FOR UPDATE OF job SKIP LOCKED
          LIMIT p_limit
        ),
        actual AS (
          SELECT
            selected.id,
            count(item.id)::integer AS total_items,
            count(*) FILTER (WHERE item.technical_status = 'pending')::integer AS pending_items,
            count(*) FILTER (WHERE item.technical_status = 'processing')::integer AS processing_items,
            count(*) FILTER (WHERE item.product_result = 'incorporated')::integer AS incorporated_items,
            count(*) FILTER (WHERE item.product_result = 'duplicate')::integer AS duplicate_items,
            count(*) FILTER (WHERE item.product_result = 'foreign')::integer AS foreign_items,
            count(*) FILTER (WHERE item.product_result = 'invalid')::integer AS invalid_items,
            count(*) FILTER (WHERE item.product_result = 'unsupported')::integer AS unsupported_items,
            count(*) FILTER (WHERE item.product_result = 'internal_error')::integer AS internal_error_items
          FROM selected
          LEFT JOIN public.ingestion_items AS item
            ON item.organization_id = selected.organization_id
           AND item.ingestion_job_id = selected.id
          GROUP BY selected.id
        ),
        evaluated AS (
          SELECT
            actual.*,
            ROW(
              job.total_items,
              job.pending_items,
              job.processing_items,
              job.incorporated_items,
              job.duplicate_items,
              job.foreign_items,
              job.invalid_items,
              job.unsupported_items,
              job.internal_error_items
            ) IS DISTINCT FROM ROW(
              actual.total_items,
              actual.pending_items,
              actual.processing_items,
              actual.incorporated_items,
              actual.duplicate_items,
              actual.foreign_items,
              actual.invalid_items,
              actual.unsupported_items,
              actual.internal_error_items
            ) AS counters_changed
          FROM public.ingestion_jobs AS job
          INNER JOIN actual ON actual.id = job.id
        ),
        repaired AS (
          UPDATE public.ingestion_jobs AS job
             SET total_items = evaluated.total_items,
                 pending_items = evaluated.pending_items,
                 processing_items = evaluated.processing_items,
                 incorporated_items = evaluated.incorporated_items,
                 duplicate_items = evaluated.duplicate_items,
                 foreign_items = evaluated.foreign_items,
                 invalid_items = evaluated.invalid_items,
                 unsupported_items = evaluated.unsupported_items,
                 internal_error_items = evaluated.internal_error_items,
                 -- Record the statement start, not wall-clock time after the
                 -- aggregate. An item committed while this batch is running
                 -- will therefore remain newer than the marker and be picked
                 -- up by the next idempotent pass.
                 counters_reconciled_at = statement_timestamp(),
                 updated_at = CASE
                   WHEN evaluated.counters_changed THEN clock_timestamp()
                   ELSE job.updated_at
                 END,
                 version = CASE
                   WHEN evaluated.counters_changed THEN job.version + 1
                   ELSE job.version
                 END
            FROM evaluated
           WHERE job.id = evaluated.id
          RETURNING
            job.id,
            job.organization_id,
            job.client_account_id,
            job.legal_entity_id,
            job.correlation_id,
            evaluated.counters_changed
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            repaired.organization_id, 'system', 'cfdi-foundation-reconciler',
            repaired.client_account_id, repaired.legal_entity_id,
            'ingestion.job.counters_repaired', 'ALLOW',
            'ingestion_job', repaired.id, 'Durable item counters reconciled.',
            repaired.correlation_id, '{}'::jsonb
          FROM repaired
          WHERE repaired.counters_changed
          RETURNING 1
        )
        SELECT count(*) FILTER (WHERE counters_changed)::integer
          INTO v_repaired_counter
        FROM repaired;

        WITH candidates AS (
          SELECT object.id
          FROM public.stored_objects AS object
          WHERE object.lifecycle_state IN ('uploaded','quarantined','available','rejected')
            AND object.redundant_reported_at IS NULL
            AND object.created_at <= clock_timestamp() - make_interval(hours => p_duplicate_bytes_hours)
            AND EXISTS (
              SELECT 1
              FROM public.ingestion_items AS item
              WHERE item.organization_id = object.organization_id
                AND item.object_id = object.id
                AND item.technical_status = 'terminal'
                AND item.product_result = 'duplicate'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.ingestion_items AS item
              WHERE item.organization_id = object.organization_id
                AND item.object_id = object.id
                AND (
                  item.technical_status <> 'terminal'
                  OR item.product_result <> 'duplicate'
                )
            )
          ORDER BY object.created_at, object.id
          FOR UPDATE SKIP LOCKED
          LIMIT p_limit
        ),
        reported AS (
          UPDATE public.stored_objects AS object
             SET redundant_reported_at = clock_timestamp(),
                 retention_until = least(
                   COALESCE(object.retention_until, clock_timestamp()),
                   clock_timestamp()
                 ),
                 updated_at = clock_timestamp(),
                 version = object.version + 1
            FROM candidates
           WHERE object.id = candidates.id
          RETURNING
            object.id,
            object.organization_id,
            object.client_account_id,
            object.legal_entity_id
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            reported.organization_id, 'system', 'cfdi-foundation-reconciler',
            reported.client_account_id, reported.legal_entity_id,
            'stored_object.duplicate_retention_eligible', 'ALLOW',
            'stored_object', reported.id,
            'Redundant duplicate bytes became eligible for storage cleanup.',
            reported.id, '{}'::jsonb
          FROM reported
          RETURNING 1
        )
        SELECT count(*)::integer INTO v_redundant_object FROM reported;

        WITH candidates AS (
          SELECT object.id
          FROM public.stored_objects AS object
          WHERE object.lifecycle_state <> 'deleted'
            AND object.retention_until <= clock_timestamp()
            AND (object.hold_until IS NULL OR object.hold_until <= clock_timestamp())
            AND object.retention_eligible_reported_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.ingestion_jobs AS job
              WHERE job.organization_id = object.organization_id
                AND job.root_object_id = object.id
                AND job.status IN ('queued','processing','failed_retryable','cancel_requested')
            )
          ORDER BY object.retention_until, object.id
          FOR UPDATE SKIP LOCKED
          LIMIT p_limit
        ),
        reported AS (
          UPDATE public.stored_objects AS object
             SET retention_eligible_reported_at = clock_timestamp(),
                 updated_at = clock_timestamp(),
                 version = object.version + 1
            FROM candidates
           WHERE object.id = candidates.id
          RETURNING
            object.id,
            object.organization_id,
            object.client_account_id,
            object.legal_entity_id
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, service_principal,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            reported.organization_id, 'system', 'cfdi-foundation-reconciler',
            reported.client_account_id, reported.legal_entity_id,
            'stored_object.retention_eligible', 'ALLOW',
            'stored_object', reported.id,
            'Object is eligible for verified storage deletion.',
            reported.id, '{}'::jsonb
          FROM reported
          RETURNING 1
        )
        SELECT count(*)::integer INTO v_retention_eligible FROM reported;

        RETURN QUERY SELECT
          v_lease_retryable,
          v_lease_final,
          v_lease_cancelled,
          v_expired_upload,
          v_rejected_orphan_object,
          v_confirmed_without_job,
          v_orphan_job,
          v_repaired_counter,
          v_redundant_object,
          v_retention_eligible;
      END
      $$
    `);
    await queryRunner.query(`
      ALTER FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer, integer)
      OWNER TO balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer, integer)
      FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer, integer)
      TO balanz_worker
    `);
    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer)
      FROM balanz_worker
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'GRANT balanz_fiscal_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner TO %I',
          current_user
        );
      END $$
    `);
    await queryRunner.query(`
      DROP FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer, integer)
    `);
    await queryRunner.query(`
      DROP FUNCTION ingestion_queue_ages(text[], integer, integer)
    `);
    await queryRunner.query(`
      DROP FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer, integer)
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer)
      TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION ingestion_queue_ages(text[], integer)
      TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer)
      TO balanz_worker
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM ingestion_jobs WHERE attempt_count > 3
        ) THEN
          RAISE EXCEPTION
            'cannot roll back retry budget with attempt_count greater than 3';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      REVOKE SELECT (automatic_retry_count), UPDATE (automatic_retry_count)
      ON ingestion_jobs FROM balanz_worker
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_items
      DROP CONSTRAINT ck_ingestion_items_attempt_count
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_items
      ADD CONSTRAINT ck_ingestion_items_attempt_count
      CHECK (attempt_count BETWEEN 0 AND 3)
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_jobs
      DROP CONSTRAINT ck_ingestion_jobs_automatic_retry_count
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_jobs
      DROP CONSTRAINT ck_ingestion_jobs_attempt_count
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_jobs
      ADD CONSTRAINT ck_ingestion_jobs_attempt_count
      CHECK (attempt_count BETWEEN 0 AND 3)
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_jobs
      DROP COLUMN automatic_retry_count
    `);
    await queryRunner.query(`
      REVOKE CREATE ON SCHEMA public
      FROM balanz_fiscal_owner,
           balanz_fiscal_claim_owner,
           balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'REVOKE balanz_fiscal_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner FROM %I',
          current_user
        );
      END $$
    `);
  }
}
