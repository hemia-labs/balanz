import { MigrationInterface, QueryRunner } from 'typeorm';

export class FiscalRlsWorkerClaims1787690610000 implements MigrationInterface {
  name = 'FiscalRlsWorkerClaims1787690610000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        role_is_unsafe boolean;
      BEGIN
        IF current_setting('server_version_num')::integer < 160000 THEN
          RAISE EXCEPTION 'fiscal runtime memberships require PostgreSQL 16 or newer';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balanz_fiscal_owner') THEN
          CREATE ROLE balanz_fiscal_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balanz_api') THEN
          CREATE ROLE balanz_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balanz_worker') THEN
          CREATE ROLE balanz_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balanz_fiscal_cancel_owner') THEN
          CREATE ROLE balanz_fiscal_cancel_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balanz_fiscal_claim_owner') THEN
          CREATE ROLE balanz_fiscal_claim_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balanz_fiscal_reconcile_owner') THEN
          CREATE ROLE balanz_fiscal_reconcile_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
        END IF;

        SELECT bool_or(rolsuper OR rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
          INTO role_is_unsafe
          FROM pg_roles
         WHERE rolname IN (
           'balanz_fiscal_owner',
           'balanz_api',
           'balanz_worker',
           'balanz_fiscal_cancel_owner'
         );
        IF role_is_unsafe THEN
          RAISE EXCEPTION 'fiscal RLS owner/API/worker roles must be NOLOGIN, NOSUPERUSER and NOBYPASSRLS';
        END IF;

        SELECT bool_or(
                 NOT rolbypassrls
                 OR rolsuper
                 OR rolcanlogin
                 OR rolcreaterole
                 OR rolcreatedb
                 OR rolreplication
               )
          INTO role_is_unsafe
          FROM pg_roles
         WHERE rolname IN (
           'balanz_fiscal_claim_owner',
           'balanz_fiscal_reconcile_owner'
         );
        IF role_is_unsafe THEN
          RAISE EXCEPTION 'fiscal SECURITY DEFINER owners must be constrained NOLOGIN BYPASSRLS roles';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM pg_auth_members AS membership
          INNER JOIN pg_roles AS member_role ON member_role.oid = membership.member
          WHERE member_role.rolname IN (
            'balanz_fiscal_owner',
            'balanz_api',
            'balanz_worker',
            'balanz_fiscal_cancel_owner',
            'balanz_fiscal_claim_owner',
            'balanz_fiscal_reconcile_owner'
          )
        ) THEN
          RAISE EXCEPTION 'fixed fiscal roles must not inherit any parent role';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM pg_auth_members AS membership
          INNER JOIN pg_roles AS granted_role
            ON granted_role.oid = membership.roleid
          WHERE granted_role.rolname IN (
            'balanz_fiscal_owner',
            'balanz_fiscal_cancel_owner',
            'balanz_fiscal_claim_owner',
            'balanz_fiscal_reconcile_owner'
          )
        ) THEN
          RAISE EXCEPTION 'fixed fiscal owner roles must not be granted to any member';
        END IF;

        -- PostgreSQL requires membership in a target owner role for ALTER
        -- OWNER. It is granted only for this migration transaction and is
        -- revoked after all ownership changes below.
        EXECUTE format(
          'GRANT balanz_fiscal_owner, balanz_fiscal_cancel_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner TO %I',
          current_user
        );
      END $$
    `);

    // ALTER OWNER requires the destination role to have CREATE on the
    // containing schema. Keep that authority only for this migration
    // transaction; SECURITY DEFINER owners retain USAGE but never CREATE.
    await queryRunner.query(`
      GRANT USAGE, CREATE ON SCHEMA public
      TO balanz_fiscal_owner,
         balanz_fiscal_cancel_owner,
         balanz_fiscal_claim_owner,
         balanz_fiscal_reconcile_owner
    `);

    await queryRunner.query(
      `ALTER TABLE stored_objects OWNER TO balanz_fiscal_owner`,
    );
    await queryRunner.query(
      `ALTER TABLE ingestion_uploads OWNER TO balanz_fiscal_owner`,
    );
    await queryRunner.query(
      `ALTER TABLE ingestion_jobs OWNER TO balanz_fiscal_owner`,
    );
    await queryRunner.query(
      `ALTER TABLE ingestion_items OWNER TO balanz_fiscal_owner`,
    );
    await queryRunner.query(
      `ALTER FUNCTION enforce_stored_object_immutability() OWNER TO balanz_fiscal_owner`,
    );

    for (const table of [
      'stored_objects',
      'ingestion_uploads',
      'ingestion_jobs',
      'ingestion_items',
    ]) {
      await queryRunner.query(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`);
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY ${table}_api_tenant_isolation
        ON ${table}
        AS PERMISSIVE
        FOR ALL
        TO balanz_api
        USING (
          organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
          AND EXISTS (
            SELECT 1
            FROM public.memberships AS membership
            WHERE membership.organization_id
                    = NULLIF(current_setting('app.organization_id', true), '')::uuid
              AND membership.id = NULLIF(current_setting('app.membership_id', true), '')::uuid
              AND membership.status = 'active'
          )
        )
        WITH CHECK (
          organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
          AND EXISTS (
            SELECT 1
            FROM public.memberships AS membership
            WHERE membership.organization_id
                    = NULLIF(current_setting('app.organization_id', true), '')::uuid
              AND membership.id = NULLIF(current_setting('app.membership_id', true), '')::uuid
              AND membership.status = 'active'
          )
        )
      `);
      await queryRunner.query(`
        CREATE POLICY ${table}_worker_tenant_isolation
        ON ${table}
        AS PERMISSIVE
        FOR ALL
        TO balanz_worker
        USING (
          organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
          AND NULLIF(current_setting('app.membership_id', true), '')::uuid
            = '00000000-0000-0000-0000-000000000000'::uuid
        )
        WITH CHECK (
          organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
          AND NULLIF(current_setting('app.membership_id', true), '')::uuid
            = '00000000-0000-0000-0000-000000000000'::uuid
        )
      `);
    }

    // This NOBYPASSRLS function owner gets only a tenant/membership policy and
    // the exact columns needed by the cancellation transition below.
    await queryRunner.query(`
      CREATE POLICY ingestion_jobs_cancel_tenant_isolation
      ON ingestion_jobs
      AS PERMISSIVE
      FOR ALL
      TO balanz_fiscal_cancel_owner
      USING (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
        AND EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.organization_id
                  = NULLIF(current_setting('app.organization_id', true), '')::uuid
            AND membership.id = NULLIF(current_setting('app.membership_id', true), '')::uuid
            AND membership.status = 'active'
        )
      )
      WITH CHECK (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
        AND EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.organization_id
                  = NULLIF(current_setting('app.organization_id', true), '')::uuid
            AND membership.id = NULLIF(current_setting('app.membership_id', true), '')::uuid
            AND membership.status = 'active'
        )
      )
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE
        auth_factors,
        auth_rate_limits,
        email_verification_tokens,
        roles,
        memberships,
        organizations,
        permissions,
        role_permissions,
        auth_sessions,
        subscriptions,
        users,
        client_accounts,
        legal_entities,
        account_assignments,
        fiscal_years,
        periods
      TO balanz_api
    `);
    await queryRunner.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
      TO balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT ON TABLE stored_objects, ingestion_uploads, ingestion_jobs
      TO balanz_api
    `);
    await queryRunner.query(`
      GRANT INSERT (
        id, organization_id, client_account_id, legal_entity_id,
        kind, storage_provider, storage_container, object_key,
        original_filename, declared_mime_type, encryption_class
      ) ON stored_objects TO balanz_api
    `);
    await queryRunner.query(`
      GRANT UPDATE (
        size_bytes, sha256, storage_etag, storage_version_id,
        lifecycle_state, uploaded_at, updated_at, version
      ) ON stored_objects TO balanz_api
    `);
    await queryRunner.query(`
      GRANT INSERT (
        id, organization_id, client_account_id, legal_entity_id,
        workflow, upload_type,
        init_idempotency_key, init_request_fingerprint,
        init_response_status, init_response_reference,
        init_idempotency_expires_at, object_id,
        expected_size_bytes, expected_sha256, upload_expires_at,
        created_by_membership_id, correlation_id
      ) ON ingestion_uploads TO balanz_api
    `);
    await queryRunner.query(`
      GRANT UPDATE (
        state, actual_size_bytes, actual_sha256,
        confirm_idempotency_key, confirm_request_fingerprint,
        confirm_response_status, confirm_response_reference,
        confirm_idempotency_created_at, confirm_idempotency_expires_at,
        confirmed_at, updated_at, version
      ) ON ingestion_uploads TO balanz_api
    `);
    await queryRunner.query(`
      GRANT INSERT (
        id, organization_id, client_account_id, legal_entity_id,
        source_type, upload_id, root_object_id, requested_by_membership_id,
        retry_of_job_id, idempotency_key, request_fingerprint,
        response_status, response_reference, idempotency_expires_at,
        status, next_attempt_at, correlation_id
      ) ON ingestion_jobs TO balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT (
        id, organization_id, client_account_id, legal_entity_id,
        status, attempt_count, next_attempt_at, worker_id, locked_by,
        lease_expires_at, heartbeat_at, cancel_requested_at,
        started_at, completed_at, last_error_code, last_error_detail,
        correlation_id, version
      ) ON ingestion_jobs TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT UPDATE (
        status, current_stage,
        attempt_count, next_attempt_at, worker_id, locked_by,
        lease_expires_at, heartbeat_at, last_claimed_at,
        cancel_requested_at, started_at, completed_at,
        last_error_code, last_error_detail, updated_at, version
      ) ON ingestion_jobs TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT SELECT ON TABLE ingestion_jobs
      TO balanz_fiscal_claim_owner
    `);
    await queryRunner.query(`
      GRANT UPDATE (
        status, attempt_count, next_attempt_at, worker_id, locked_by,
        lease_expires_at, heartbeat_at, last_claimed_at,
        started_at, completed_at, updated_at, version
      ) ON ingestion_jobs TO balanz_fiscal_claim_owner
    `);
    await queryRunner.query(`
      GRANT SELECT, UPDATE
      ON TABLE stored_objects, ingestion_uploads, ingestion_jobs, ingestion_items
      TO balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      GRANT SELECT (id, organization_id, status)
      ON memberships TO balanz_fiscal_cancel_owner
    `);
    await queryRunner.query(`
      GRANT SELECT (
        id, organization_id, client_account_id, legal_entity_id,
        status, next_attempt_at, cancel_requested_at,
        completed_at, correlation_id, version
      ) ON ingestion_jobs TO balanz_fiscal_cancel_owner
    `);
    await queryRunner.query(`
      GRANT UPDATE (
        status, cancel_requested_at, next_attempt_at,
        completed_at, updated_at, version
      ) ON ingestion_jobs TO balanz_fiscal_cancel_owner
    `);
    await queryRunner.query(`
      GRANT INSERT ON TABLE audit_events
      TO balanz_fiscal_owner, balanz_api, balanz_worker,
         balanz_fiscal_cancel_owner,
         balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(
      `REVOKE ALL ON FUNCTION enforce_stored_object_immutability() FROM PUBLIC`,
    );
    await queryRunner.query(`
      GRANT USAGE ON SCHEMA public
      TO balanz_fiscal_owner, balanz_api, balanz_worker,
         balanz_fiscal_cancel_owner,
         balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner
    `);

    // The counter scan uses a durable dirty marker. This trigger closes the
    // race where an item statement starts before a reconciliation snapshot,
    // waits on the parent row, and commits with an older updated_at value.
    // Its definer can update only the parent IDs derived from the trigger row;
    // callers cannot invoke it directly or pass an arbitrary tenant/job ID.
    await queryRunner.query(`
      CREATE FUNCTION mark_ingestion_job_counters_dirty()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp
      AS $$
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          UPDATE public.ingestion_jobs AS job
             SET counters_reconciled_at = NULL
           WHERE job.organization_id = OLD.organization_id
             AND job.id = OLD.ingestion_job_id
             AND job.counters_reconciled_at IS NOT NULL;
        END IF;

        IF TG_OP <> 'DELETE' THEN
          UPDATE public.ingestion_jobs AS job
             SET counters_reconciled_at = NULL
           WHERE job.organization_id = NEW.organization_id
             AND job.id = NEW.ingestion_job_id
             AND job.counters_reconciled_at IS NOT NULL;
        END IF;

        RETURN NULL;
      END
      $$
    `);
    await queryRunner.query(`
      ALTER FUNCTION mark_ingestion_job_counters_dirty()
      OWNER TO balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION mark_ingestion_job_counters_dirty()
      FROM PUBLIC
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_ingestion_items_mark_counters_dirty
      AFTER INSERT OR UPDATE OR DELETE ON ingestion_items
      FOR EACH ROW
      EXECUTE FUNCTION mark_ingestion_job_counters_dirty()
    `);

    await queryRunner.query(`
      CREATE FUNCTION claim_ingestion_job(
        p_worker_id text,
        p_lease_token text,
        p_supported_sources text[],
        p_lease_seconds integer,
        p_max_attempts integer,
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
        IF p_max_attempts IS DISTINCT FROM 3 THEN
          RAISE EXCEPTION 'maximum total attempts must be exactly 3' USING ERRCODE = '22023';
        END IF;
        IF p_active_jobs_per_tenant IS DISTINCT FROM 4 THEN
          RAISE EXCEPTION 'tenant concurrency cap must be exactly 4' USING ERRCODE = '22023';
        END IF;

        -- Skip a tenant already being claimed by another transaction and try
        -- the next fair candidate. A blocking lock taken after selecting the
        -- tenant would let concurrent workers queue behind tenant A and starve
        -- an equally ready tenant B.
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
              AND job.attempt_count < p_max_attempts
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
            AND job.attempt_count < p_max_attempts
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
      ALTER FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer)
      OWNER TO balanz_fiscal_claim_owner
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer)
      FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer)
      TO balanz_worker
    `);

    await queryRunner.query(`
      CREATE FUNCTION ingestion_queue_ages(
        p_supported_sources text[],
        p_max_attempts integer
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
        IF p_max_attempts IS DISTINCT FROM 3 THEN
          RAISE EXCEPTION 'maximum total attempts must be exactly 3' USING ERRCODE = '22023';
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
          AND job.attempt_count < p_max_attempts
          AND job.source_type::text = ANY (p_supported_sources)
        GROUP BY job.source_type
        ORDER BY job.source_type;
      END
      $$
    `);
    await queryRunner.query(`
      ALTER FUNCTION ingestion_queue_ages(text[], integer)
      OWNER TO balanz_fiscal_claim_owner
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION ingestion_queue_ages(text[], integer)
      FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION ingestion_queue_ages(text[], integer)
      TO balanz_worker
    `);

    await queryRunner.query(`
      CREATE FUNCTION request_ingestion_job_cancellation(p_job_id uuid)
      RETURNS varchar
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS $$
      DECLARE
        v_status varchar;
      BEGIN
        WITH cancelled AS (
          UPDATE public.ingestion_jobs AS job
             SET status = CASE
                   WHEN job.status IN ('processing','cancel_requested') THEN 'cancel_requested'
                   ELSE 'cancelled'
                 END,
                 cancel_requested_at = COALESCE(job.cancel_requested_at, clock_timestamp()),
                 next_attempt_at = CASE
                   WHEN job.status IN ('processing','cancel_requested') THEN job.next_attempt_at
                   ELSE NULL
                 END,
                 completed_at = CASE
                   WHEN job.status IN ('processing','cancel_requested') THEN NULL
                   ELSE clock_timestamp()
                 END,
                 updated_at = clock_timestamp(),
                 version = job.version + 1
           WHERE job.id = p_job_id
             AND job.organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
             AND job.status IN ('awaiting_upload','queued','processing','failed_retryable','cancel_requested')
          RETURNING
            job.id, job.organization_id, job.client_account_id,
            job.legal_entity_id, job.correlation_id, job.status
        ),
        audited AS (
          INSERT INTO public.audit_events (
            organization_id, actor_type, actor_membership_id,
            client_account_id, legal_entity_id, action, decision,
            object_type, object_id, reason, correlation_id, metadata
          )
          SELECT
            cancelled.organization_id, 'user',
            NULLIF(current_setting('app.membership_id', true), '')::uuid,
            cancelled.client_account_id, cancelled.legal_entity_id,
            'ingestion.job.cancel_requested', 'ALLOW',
            'ingestion_job', cancelled.id, 'Cancellation requested.',
            cancelled.correlation_id,
            jsonb_build_object('status', cancelled.status)
          FROM cancelled
          RETURNING 1
        )
        SELECT cancelled.status INTO v_status FROM cancelled;

        RETURN v_status;
      END
      $$
    `);
    await queryRunner.query(`
      ALTER FUNCTION request_ingestion_job_cancellation(uuid)
      OWNER TO balanz_fiscal_cancel_owner
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION request_ingestion_job_cancellation(uuid)
      FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION request_ingestion_job_cancellation(uuid)
      TO balanz_api
    `);

    await queryRunner.query(`
      CREATE FUNCTION reconcile_fiscal_ingestion_foundation(
        p_limit integer,
        p_orphan_grace_minutes integer,
        p_duplicate_bytes_hours integer,
        p_invalid_object_days integer,
        p_backoff_seconds integer[],
        p_jitter_percent integer,
        p_max_attempts integer
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
        IF p_max_attempts IS DISTINCT FROM 3 THEN
          RAISE EXCEPTION 'maximum total attempts must be exactly 3' USING ERRCODE = '22023';
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
                   WHEN job.attempt_count >= p_max_attempts THEN 'failed_final'
                   ELSE 'failed_retryable'
                 END,
                 next_attempt_at = CASE
                   WHEN job.status = 'cancel_requested' OR job.attempt_count >= p_max_attempts THEN NULL
                   ELSE clock_timestamp()
                     + make_interval(
                         secs => p_backoff_seconds[least(job.attempt_count, cardinality(p_backoff_seconds))]
                           + floor(
                               random()
                               * (
                                   p_backoff_seconds[least(job.attempt_count, cardinality(p_backoff_seconds))]
                                   * p_jitter_percent / 100.0
                                   + 1
                                 )
                             )::integer
                       )
                 END,
                 locked_by = NULL,
                 lease_expires_at = NULL,
                 completed_at = CASE
                   WHEN job.status = 'cancel_requested' OR job.attempt_count >= p_max_attempts
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
            job.status
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
            jsonb_build_object('result_status', recovered.status)
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
      ALTER FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer)
      OWNER TO balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      REVOKE ALL ON FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer)
      FROM PUBLIC
    `);
    await queryRunner.query(`
      GRANT EXECUTE ON FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer)
      TO balanz_worker
    `);
    await queryRunner.query(`
      REVOKE CREATE ON SCHEMA public
      FROM balanz_fiscal_owner,
           balanz_fiscal_cancel_owner,
           balanz_fiscal_claim_owner,
           balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM unnest(ARRAY[
            'balanz_fiscal_owner',
            'balanz_fiscal_cancel_owner',
            'balanz_fiscal_claim_owner',
            'balanz_fiscal_reconcile_owner'
          ]) AS fixed_role(role_name)
          WHERE has_schema_privilege(fixed_role.role_name, 'public', 'CREATE')
        ) THEN
          RAISE EXCEPTION 'fixed fiscal owners must not retain CREATE on schema public';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'REVOKE balanz_fiscal_owner, balanz_fiscal_cancel_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner FROM %I',
          current_user
        );
        IF EXISTS (
          SELECT 1
          FROM pg_auth_members AS membership
          INNER JOIN pg_roles AS fixed_owner
            ON fixed_owner.oid IN (membership.member, membership.roleid)
          WHERE fixed_owner.rolname IN (
            'balanz_fiscal_owner',
            'balanz_fiscal_cancel_owner',
            'balanz_fiscal_claim_owner',
            'balanz_fiscal_reconcile_owner'
          )
        ) THEN
          RAISE EXCEPTION 'fixed fiscal owner membership leaked after migration';
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'GRANT balanz_fiscal_owner, balanz_fiscal_cancel_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner TO %I',
          current_user
        );
      END $$
    `);
    await queryRunner.query(`
      DROP TRIGGER trg_ingestion_items_mark_counters_dirty
      ON ingestion_items
    `);
    await queryRunner.query(`
      DROP FUNCTION mark_ingestion_job_counters_dirty()
    `);
    await queryRunner.query(`
      DROP FUNCTION reconcile_fiscal_ingestion_foundation(integer, integer, integer, integer, integer[], integer, integer)
    `);
    await queryRunner.query(`
      DROP FUNCTION claim_ingestion_job(text, text, text[], integer, integer, integer)
    `);
    await queryRunner.query(`
      DROP FUNCTION ingestion_queue_ages(text[], integer)
    `);
    await queryRunner.query(`
      DROP FUNCTION request_ingestion_job_cancellation(uuid)
    `);
    await queryRunner.query(
      `REVOKE INSERT ON TABLE audit_events FROM balanz_fiscal_owner, balanz_api, balanz_worker, balanz_fiscal_cancel_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner`,
    );
    await queryRunner.query(`
      REVOKE ALL ON TABLE stored_objects, ingestion_uploads, ingestion_jobs, ingestion_items
      FROM balanz_api, balanz_worker, balanz_fiscal_cancel_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      REVOKE ALL
      ON TABLE
        auth_factors,
        auth_rate_limits,
        email_verification_tokens,
        roles,
        memberships,
        organizations,
        permissions,
        role_permissions,
        auth_sessions,
        subscriptions,
        users,
        client_accounts,
        legal_entities,
        account_assignments,
        fiscal_years,
        periods
      FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE ALL ON TABLE memberships FROM balanz_fiscal_cancel_owner
    `);

    await queryRunner.query(
      `DROP POLICY ingestion_jobs_cancel_tenant_isolation ON ingestion_jobs`,
    );

    for (const table of [
      'ingestion_items',
      'ingestion_jobs',
      'ingestion_uploads',
      'stored_objects',
    ]) {
      await queryRunner.query(
        `DROP POLICY ${table}_api_tenant_isolation ON ${table}`,
      );
      await queryRunner.query(
        `DROP POLICY ${table}_worker_tenant_isolation ON ${table}`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(`ALTER TABLE ${table} OWNER TO CURRENT_USER`);
    }

    await queryRunner.query(
      `ALTER FUNCTION enforce_stored_object_immutability() OWNER TO CURRENT_USER`,
    );
    await queryRunner.query(`
      REVOKE USAGE, CREATE ON SCHEMA public
      FROM balanz_fiscal_owner,
           balanz_fiscal_cancel_owner,
           balanz_fiscal_claim_owner,
           balanz_fiscal_reconcile_owner
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'REVOKE balanz_fiscal_owner, balanz_fiscal_cancel_owner, balanz_fiscal_claim_owner, balanz_fiscal_reconcile_owner FROM %I',
          current_user
        );
      END $$
    `);
  }
}
