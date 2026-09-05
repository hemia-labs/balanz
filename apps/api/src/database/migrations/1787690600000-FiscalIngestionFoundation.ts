import { MigrationInterface, QueryRunner } from 'typeorm';

export class FiscalIngestionFoundation1787690600000 implements MigrationInterface {
  name = 'FiscalIngestionFoundation1787690600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.organizations') IS NULL
          OR to_regclass('public.memberships') IS NULL
          OR to_regclass('public.client_accounts') IS NULL
          OR to_regclass('public.legal_entities') IS NULL THEN
          RAISE EXCEPTION 'fiscal_ingestion_foundation: required tenant tables are missing';
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.legal_entities'::regclass
            AND contype = 'u'
            AND conname = 'uq_legal_entities_account_id'
        ) THEN
          RAISE EXCEPTION 'fiscal_ingestion_foundation: legal_entities composite candidate key is missing';
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.memberships'::regclass
            AND contype = 'u'
            AND conname = 'uq_memberships_organization_id'
        ) THEN
          RAISE EXCEPTION 'fiscal_ingestion_foundation: memberships tenant candidate key is missing';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM public.legal_entities le
          LEFT JOIN public.client_accounts ca
            ON ca.organization_id = le.organization_id
           AND ca.id = le.client_account_id
          WHERE ca.id IS NULL
        ) THEN
          RAISE EXCEPTION 'fiscal_ingestion_foundation: legal entity tenant/account orphans exist';
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE stored_objects (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        kind varchar(40) NOT NULL,
        storage_provider varchar(16) NOT NULL,
        storage_container varchar(255) NOT NULL,
        object_key varchar(512) NOT NULL,
        original_filename varchar(255),
        declared_mime_type varchar(160),
        detected_mime_type varchar(160),
        size_bytes bigint,
        sha256 char(64),
        storage_etag varchar(255),
        storage_version_id varchar(255),
        encryption_class varchar(24) NOT NULL,
        lifecycle_state varchar(24) NOT NULL DEFAULT 'pending_upload',
        malware_scan_status varchar(16) NOT NULL DEFAULT 'pending',
        malware_scanner_version varchar(120),
        malware_scanned_at timestamptz,
        quarantine_reason_code varchar(80),
        retention_until timestamptz,
        hold_until timestamptz,
        redundant_reported_at timestamptz,
        retention_eligible_reported_at timestamptz,
        uploaded_at timestamptz,
        available_at timestamptz,
        deleted_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_stored_objects PRIMARY KEY (id),
        CONSTRAINT uq_stored_objects_org_id UNIQUE (organization_id, id),
        CONSTRAINT uq_stored_objects_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_stored_objects_storage_location UNIQUE (storage_provider, storage_container, object_key),
        CONSTRAINT fk_stored_objects_legal_entity FOREIGN KEY (organization_id, client_account_id, legal_entity_id)
          REFERENCES legal_entities(organization_id, client_account_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_stored_objects_kind CHECK (kind IN ('manual_xml','manual_zip','sat_package','extracted_xml','credential_certificate','credential_private_key','export')),
        CONSTRAINT ck_stored_objects_provider CHECK (storage_provider IN ('local','s3')),
        CONSTRAINT ck_stored_objects_container CHECK (storage_container = btrim(storage_container) AND char_length(storage_container) BETWEEN 1 AND 255 AND position('/' in storage_container) = 0 AND position(chr(92) in storage_container) = 0),
        CONSTRAINT ck_stored_objects_encryption_class CHECK (encryption_class IN ('standard','fiscal','credential','export')),
        CONSTRAINT ck_stored_objects_lifecycle_state CHECK (lifecycle_state IN ('pending_upload','uploaded','quarantined','available','rejected','deleted')),
        CONSTRAINT ck_stored_objects_scan_status CHECK (malware_scan_status IN ('pending','clean','infected','failed','bypassed')),
        CONSTRAINT ck_stored_objects_size CHECK (size_bytes IS NULL OR size_bytes >= 0),
        CONSTRAINT ck_stored_objects_sha256 CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_stored_objects_object_key CHECK (object_key = btrim(object_key) AND char_length(object_key) BETWEEN 1 AND 512 AND object_key !~ '(^|/)\\.\\.(/|$)' AND object_key !~ '^/' AND position(chr(92) in object_key) = 0),
        CONSTRAINT ck_stored_objects_filename CHECK (original_filename IS NULL OR (original_filename = btrim(original_filename) AND char_length(original_filename) BETWEEN 1 AND 255 AND position('/' in original_filename) = 0 AND position(chr(92) in original_filename) = 0 AND original_filename !~ '[[:cntrl:]]')),
        CONSTRAINT ck_stored_objects_payload_state CHECK (
          (lifecycle_state = 'pending_upload' AND size_bytes IS NULL AND sha256 IS NULL AND uploaded_at IS NULL)
          OR (lifecycle_state IN ('uploaded','quarantined','available') AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND uploaded_at IS NOT NULL)
          OR lifecycle_state IN ('rejected','deleted')
        ),
        CONSTRAINT ck_stored_objects_deleted_state CHECK ((lifecycle_state = 'deleted') = (deleted_at IS NOT NULL)),
        CONSTRAINT ck_stored_objects_available_scan CHECK (lifecycle_state <> 'available' OR (malware_scan_status IN ('clean','bypassed') AND malware_scanned_at IS NOT NULL AND available_at IS NOT NULL)),
        CONSTRAINT ck_stored_objects_scan_timestamp CHECK ((malware_scan_status = 'pending' AND malware_scanned_at IS NULL) OR (malware_scan_status <> 'pending' AND malware_scanned_at IS NOT NULL)),
        CONSTRAINT ck_stored_objects_quarantine_reason CHECK (quarantine_reason_code IS NULL OR lifecycle_state IN ('quarantined','rejected','deleted')),
        CONSTRAINT ck_stored_objects_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_stored_objects_scope_hash ON stored_objects (organization_id, legal_entity_id, kind, sha256)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_stored_objects_lifecycle_updated ON stored_objects (lifecycle_state, updated_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_stored_objects_retention ON stored_objects (retention_until, id) WHERE lifecycle_state <> 'deleted' AND retention_until IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE FUNCTION enforce_stored_object_immutability()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog
      AS $$
      BEGIN
        IF ROW(
          NEW.organization_id,
          NEW.client_account_id,
          NEW.legal_entity_id,
          NEW.kind,
          NEW.storage_provider,
          NEW.storage_container,
          NEW.object_key,
          NEW.original_filename,
          NEW.declared_mime_type,
          NEW.encryption_class
        ) IS DISTINCT FROM ROW(
          OLD.organization_id,
          OLD.client_account_id,
          OLD.legal_entity_id,
          OLD.kind,
          OLD.storage_provider,
          OLD.storage_container,
          OLD.object_key,
          OLD.original_filename,
          OLD.declared_mime_type,
          OLD.encryption_class
        ) THEN
          RAISE EXCEPTION 'stored object identity and physical location are immutable'
            USING ERRCODE = '23514';
        END IF;

        IF OLD.lifecycle_state <> 'pending_upload'
          AND ROW(NEW.size_bytes, NEW.sha256, NEW.storage_etag, NEW.storage_version_id)
              IS DISTINCT FROM
              ROW(OLD.size_bytes, OLD.sha256, OLD.storage_etag, OLD.storage_version_id) THEN
          RAISE EXCEPTION 'confirmed stored object bytes are immutable'
            USING ERRCODE = '23514';
        END IF;

        IF NEW.lifecycle_state <> OLD.lifecycle_state AND NOT (
          (OLD.lifecycle_state = 'pending_upload' AND NEW.lifecycle_state IN ('uploaded','rejected','deleted'))
          OR (OLD.lifecycle_state = 'uploaded' AND NEW.lifecycle_state IN ('quarantined','available','rejected','deleted'))
          OR (OLD.lifecycle_state = 'quarantined' AND NEW.lifecycle_state IN ('available','rejected','deleted'))
          OR (OLD.lifecycle_state = 'available' AND NEW.lifecycle_state IN ('quarantined','deleted'))
          OR (OLD.lifecycle_state = 'rejected' AND NEW.lifecycle_state = 'deleted')
        ) THEN
          RAISE EXCEPTION 'invalid stored object lifecycle transition: % -> %', OLD.lifecycle_state, NEW.lifecycle_state
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_stored_objects_immutability
      BEFORE UPDATE ON stored_objects
      FOR EACH ROW
      EXECUTE FUNCTION enforce_stored_object_immutability()
    `);

    await queryRunner.query(`
      CREATE TABLE ingestion_uploads (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        workflow varchar(16) NOT NULL,
        upload_type varchar(20) NOT NULL,
        init_idempotency_key varchar(128) NOT NULL,
        init_request_fingerprint char(64) NOT NULL,
        init_response_status smallint,
        init_response_reference varchar(160),
        init_idempotency_expires_at timestamptz NOT NULL,
        confirm_idempotency_key varchar(128),
        confirm_request_fingerprint char(64),
        confirm_response_status smallint,
        confirm_response_reference varchar(160),
        confirm_idempotency_created_at timestamptz,
        confirm_idempotency_expires_at timestamptz,
        object_id uuid NOT NULL,
        state varchar(16) NOT NULL DEFAULT 'pending',
        expected_size_bytes bigint,
        expected_sha256 char(64),
        actual_size_bytes bigint,
        actual_sha256 char(64),
        upload_expires_at timestamptz NOT NULL,
        confirmed_at timestamptz,
        confirmed_without_job_reported_at timestamptz,
        created_by_membership_id uuid NOT NULL,
        correlation_id uuid NOT NULL,
        last_error_code varchar(80),
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_ingestion_uploads PRIMARY KEY (id),
        CONSTRAINT uq_ingestion_uploads_org_id UNIQUE (organization_id, id),
        CONSTRAINT uq_ingestion_uploads_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_ingestion_uploads_object UNIQUE (organization_id, object_id),
        CONSTRAINT uq_ingestion_uploads_init_idempotency UNIQUE (organization_id, legal_entity_id, init_idempotency_key),
        CONSTRAINT fk_ingestion_uploads_legal_entity FOREIGN KEY (organization_id, client_account_id, legal_entity_id)
          REFERENCES legal_entities(organization_id, client_account_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_ingestion_uploads_object FOREIGN KEY (organization_id, client_account_id, legal_entity_id, object_id)
          REFERENCES stored_objects(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_ingestion_uploads_created_by FOREIGN KEY (organization_id, created_by_membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_ingestion_uploads_workflow CHECK (workflow IN ('direct','presigned')),
        CONSTRAINT ck_ingestion_uploads_type CHECK (upload_type IN ('manual_xml','manual_zip')),
        CONSTRAINT ck_ingestion_uploads_state CHECK (state IN ('pending','receiving','uploaded','confirmed','expired','failed','cancelled')),
        CONSTRAINT ck_ingestion_uploads_init_idempotency_key CHECK (init_idempotency_key = btrim(init_idempotency_key) AND char_length(init_idempotency_key) BETWEEN 1 AND 128),
        CONSTRAINT ck_ingestion_uploads_init_request_fingerprint CHECK (init_request_fingerprint ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_ingestion_uploads_confirm_idempotency CHECK (
          (confirm_idempotency_key IS NULL AND confirm_request_fingerprint IS NULL AND confirm_idempotency_created_at IS NULL AND confirm_idempotency_expires_at IS NULL AND confirm_response_status IS NULL AND confirm_response_reference IS NULL)
          OR (confirm_idempotency_key = btrim(confirm_idempotency_key) AND char_length(confirm_idempotency_key) BETWEEN 1 AND 128 AND confirm_request_fingerprint ~ '^[0-9a-f]{64}$' AND confirm_idempotency_created_at IS NOT NULL AND confirm_idempotency_expires_at > confirm_idempotency_created_at)
        ),
        CONSTRAINT ck_ingestion_uploads_checksums CHECK ((expected_sha256 IS NULL OR expected_sha256 ~ '^[0-9a-f]{64}$') AND (actual_sha256 IS NULL OR actual_sha256 ~ '^[0-9a-f]{64}$')),
        CONSTRAINT ck_ingestion_uploads_sizes CHECK ((expected_size_bytes IS NULL OR expected_size_bytes >= 0) AND (actual_size_bytes IS NULL OR actual_size_bytes >= 0)),
        CONSTRAINT ck_ingestion_uploads_expiration CHECK (upload_expires_at > created_at AND init_idempotency_expires_at > created_at),
        CONSTRAINT ck_ingestion_uploads_confirmation CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL) AND (state <> 'confirmed' OR confirm_idempotency_key IS NOT NULL)),
        CONSTRAINT ck_ingestion_uploads_confirmed_payload CHECK (state <> 'confirmed' OR (actual_size_bytes IS NOT NULL AND actual_sha256 IS NOT NULL AND (expected_size_bytes IS NULL OR expected_size_bytes = actual_size_bytes) AND (expected_sha256 IS NULL OR expected_sha256 = actual_sha256))),
        CONSTRAINT ck_ingestion_uploads_response_statuses CHECK ((init_response_status IS NULL OR init_response_status BETWEEN 100 AND 599) AND (confirm_response_status IS NULL OR confirm_response_status BETWEEN 100 AND 599)),
        CONSTRAINT ck_ingestion_uploads_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_uploads_expiration ON ingestion_uploads (upload_expires_at, id) WHERE state IN ('pending','receiving','uploaded')`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_uploads_scope_state ON ingestion_uploads (organization_id, legal_entity_id, state, updated_at, id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_ingestion_uploads_confirm_idempotency ON ingestion_uploads (organization_id, legal_entity_id, confirm_idempotency_key) WHERE confirm_idempotency_key IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE ingestion_jobs (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        source_type varchar(20) NOT NULL,
        upload_id uuid,
        root_object_id uuid,
        requested_by_membership_id uuid,
        retry_of_job_id uuid,
        idempotency_key varchar(128) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        response_status smallint,
        response_reference varchar(160),
        idempotency_expires_at timestamptz NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'awaiting_upload',
        current_stage varchar(16),
        total_items integer NOT NULL DEFAULT 0,
        pending_items integer NOT NULL DEFAULT 0,
        processing_items integer NOT NULL DEFAULT 0,
        incorporated_items integer NOT NULL DEFAULT 0,
        duplicate_items integer NOT NULL DEFAULT 0,
        foreign_items integer NOT NULL DEFAULT 0,
        invalid_items integer NOT NULL DEFAULT 0,
        unsupported_items integer NOT NULL DEFAULT 0,
        internal_error_items integer NOT NULL DEFAULT 0,
        counters_reconciled_at timestamptz,
        attempt_count integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        worker_id varchar(128),
        locked_by varchar(128),
        lease_expires_at timestamptz,
        heartbeat_at timestamptz,
        last_claimed_at timestamptz,
        cancel_requested_at timestamptz,
        started_at timestamptz,
        completed_at timestamptz,
        last_error_code varchar(80),
        last_error_detail varchar(500),
        correlation_id uuid NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_ingestion_jobs PRIMARY KEY (id),
        CONSTRAINT uq_ingestion_jobs_org_id UNIQUE (organization_id, id),
        CONSTRAINT uq_ingestion_jobs_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_ingestion_jobs_idempotency UNIQUE (organization_id, legal_entity_id, idempotency_key),
        CONSTRAINT fk_ingestion_jobs_legal_entity FOREIGN KEY (organization_id, client_account_id, legal_entity_id)
          REFERENCES legal_entities(organization_id, client_account_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_ingestion_jobs_root_object FOREIGN KEY (organization_id, client_account_id, legal_entity_id, root_object_id)
          REFERENCES stored_objects(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_ingestion_jobs_upload FOREIGN KEY (organization_id, client_account_id, legal_entity_id, upload_id)
          REFERENCES ingestion_uploads(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_ingestion_jobs_requested_by FOREIGN KEY (organization_id, requested_by_membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_ingestion_jobs_retry_of FOREIGN KEY (organization_id, client_account_id, legal_entity_id, retry_of_job_id)
          REFERENCES ingestion_jobs(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_ingestion_jobs_source_type CHECK (source_type IN ('manual_xml','manual_zip','sat_package')),
        CONSTRAINT ck_ingestion_jobs_source_shape CHECK (
          (source_type IN ('manual_xml','manual_zip') AND upload_id IS NOT NULL AND root_object_id IS NOT NULL AND requested_by_membership_id IS NOT NULL)
          OR (source_type = 'sat_package' AND upload_id IS NULL AND root_object_id IS NOT NULL)
        ),
        CONSTRAINT ck_ingestion_jobs_status CHECK (status IN ('awaiting_upload','queued','processing','completed','completed_with_issues','failed_retryable','failed_final','cancel_requested','cancelled')),
        CONSTRAINT ck_ingestion_jobs_stage CHECK (current_stage IS NULL OR current_stage IN ('scanning','extracting','parsing','persisting')),
        CONSTRAINT ck_ingestion_jobs_idempotency_key CHECK (idempotency_key = btrim(idempotency_key) AND char_length(idempotency_key) BETWEEN 1 AND 128),
        CONSTRAINT ck_ingestion_jobs_request_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_ingestion_jobs_response_status CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
        CONSTRAINT ck_ingestion_jobs_attempt_count CHECK (attempt_count BETWEEN 0 AND 3),
        CONSTRAINT ck_ingestion_jobs_worker_ids CHECK ((worker_id IS NULL OR worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') AND (locked_by IS NULL OR locked_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')),
        CONSTRAINT ck_ingestion_jobs_counters CHECK (
          total_items >= 0
          AND pending_items >= 0
          AND processing_items >= 0
          AND incorporated_items >= 0
          AND duplicate_items >= 0
          AND foreign_items >= 0
          AND invalid_items >= 0
          AND unsupported_items >= 0
          AND internal_error_items >= 0
          AND pending_items + processing_items + incorporated_items + duplicate_items + foreign_items + invalid_items + unsupported_items + internal_error_items = total_items
        ),
        CONSTRAINT ck_ingestion_jobs_lease_state CHECK ((status = 'processing' AND locked_by IS NOT NULL AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL AND started_at IS NOT NULL) OR status <> 'processing'),
        CONSTRAINT ck_ingestion_jobs_unlocked_state CHECK (status IN ('processing','cancel_requested') OR (locked_by IS NULL AND lease_expires_at IS NULL)),
        CONSTRAINT ck_ingestion_jobs_cancel_state CHECK ((status IN ('cancel_requested','cancelled')) = (cancel_requested_at IS NOT NULL)),
        CONSTRAINT ck_ingestion_jobs_completion_state CHECK ((status IN ('completed','completed_with_issues','failed_final','cancelled')) = (completed_at IS NOT NULL)),
        CONSTRAINT ck_ingestion_jobs_retry_schedule CHECK (status NOT IN ('queued','failed_retryable') OR next_attempt_at IS NOT NULL),
        CONSTRAINT ck_ingestion_jobs_retry_of CHECK (retry_of_job_id IS NULL OR retry_of_job_id <> id),
        CONSTRAINT ck_ingestion_jobs_idempotency_expiration CHECK (idempotency_expires_at > created_at),
        CONSTRAINT ck_ingestion_jobs_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_jobs_claim ON ingestion_jobs (next_attempt_at, created_at, id) WHERE status IN ('queued','failed_retryable')`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_jobs_active_tenant ON ingestion_jobs (organization_id, lease_expires_at, id) WHERE status IN ('processing','cancel_requested')`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_jobs_counter_reconcile ON ingestion_jobs (counters_reconciled_at NULLS FIRST, updated_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_jobs_tenant_fairness ON ingestion_jobs (organization_id, last_claimed_at DESC NULLS LAST)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_jobs_scope_status ON ingestion_jobs (organization_id, legal_entity_id, status, updated_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_jobs_requested_by_status ON ingestion_jobs (organization_id, requested_by_membership_id, status, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_jobs_root_object ON ingestion_jobs (organization_id, root_object_id) WHERE root_object_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_jobs_retry_of ON ingestion_jobs (organization_id, retry_of_job_id) WHERE retry_of_job_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE ingestion_items (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        ingestion_job_id uuid NOT NULL,
        object_id uuid,
        ordinal integer NOT NULL,
        safe_filename varchar(255),
        technical_status varchar(16) NOT NULL DEFAULT 'pending',
        product_result varchar(24),
        sha256 char(64),
        error_code varchar(80),
        safe_error_detail varchar(1000),
        attempt_count integer NOT NULL DEFAULT 0,
        observed_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_ingestion_items PRIMARY KEY (id),
        CONSTRAINT uq_ingestion_items_org_id UNIQUE (organization_id, id),
        CONSTRAINT uq_ingestion_items_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_ingestion_items_job_ordinal UNIQUE (ingestion_job_id, ordinal),
        CONSTRAINT fk_ingestion_items_job FOREIGN KEY (organization_id, client_account_id, legal_entity_id, ingestion_job_id)
          REFERENCES ingestion_jobs(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_ingestion_items_object FOREIGN KEY (organization_id, client_account_id, legal_entity_id, object_id)
          REFERENCES stored_objects(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_ingestion_items_ordinal CHECK (ordinal > 0),
        CONSTRAINT ck_ingestion_items_technical_status CHECK (technical_status IN ('pending','processing','terminal')),
        CONSTRAINT ck_ingestion_items_product_result CHECK (product_result IS NULL OR product_result IN ('incorporated','duplicate','foreign','invalid','unsupported','internal_error')),
        CONSTRAINT ck_ingestion_items_hash CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_ingestion_items_attempt_count CHECK (attempt_count BETWEEN 0 AND 3),
        CONSTRAINT ck_ingestion_items_terminal_state CHECK ((technical_status = 'terminal' AND product_result IS NOT NULL AND processed_at IS NOT NULL) OR (technical_status <> 'terminal' AND product_result IS NULL AND processed_at IS NULL)),
        CONSTRAINT ck_ingestion_items_error_state CHECK ((product_result IN ('foreign','invalid','unsupported','internal_error') AND error_code IS NOT NULL) OR (product_result IS NULL OR product_result IN ('incorporated','duplicate'))),
        CONSTRAINT ck_ingestion_items_success_error CHECK (product_result NOT IN ('incorporated','duplicate') OR (error_code IS NULL AND safe_error_detail IS NULL)),
        CONSTRAINT ck_ingestion_items_safe_filename CHECK (safe_filename IS NULL OR (safe_filename = btrim(safe_filename) AND char_length(safe_filename) BETWEEN 1 AND 255 AND position('/' in safe_filename) = 0 AND position(chr(92) in safe_filename) = 0 AND safe_filename !~ '[[:cntrl:]]')),
        CONSTRAINT ck_ingestion_items_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_items_job_status ON ingestion_items (organization_id, ingestion_job_id, technical_status, ordinal)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_items_job_updated ON ingestion_items (organization_id, ingestion_job_id, updated_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_items_object ON ingestion_items (organization_id, object_id) WHERE object_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ingestion_items`);
    await queryRunner.query(`DROP TABLE ingestion_jobs`);
    await queryRunner.query(`DROP TABLE ingestion_uploads`);
    await queryRunner.query(
      `DROP TRIGGER trg_stored_objects_immutability ON stored_objects`,
    );
    await queryRunner.query(
      `DROP FUNCTION enforce_stored_object_immutability()`,
    );
    await queryRunner.query(`DROP TABLE stored_objects`);
  }
}
