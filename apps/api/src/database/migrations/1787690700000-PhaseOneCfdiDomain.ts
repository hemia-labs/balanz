import { MigrationInterface, QueryRunner } from 'typeorm';

const WORKER_SCOPED_TABLES = [
  'cfdis',
  'cfdi_concepts',
  'cfdi_relations',
  'cfdi_payments',
  'cfdi_payment_documents',
  'cfdi_taxes',
  'cfdi_payrolls',
  'cfdi_payroll_perceptions',
  'cfdi_payroll_deductions',
  'cfdi_payroll_other_payments',
  'cfdi_payroll_incapacities',
  'period_cfdis',
  'incidents',
] as const;

const ALL_SCOPED_TABLES = [
  ...WORKER_SCOPED_TABLES,
  'cfdi_access_grants',
] as const;

/**
 * Phase 1's immutable CFDI domain. Runtime services receive only row-level
 * tenant access and the operations required by their workflow; the fixed
 * table owner remains NOLOGIN/NOBYPASSRLS.
 */
export class PhaseOneCfdiDomain1787690700000 implements MigrationInterface {
  name = 'PhaseOneCfdiDomain1787690700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.legal_entities') IS NULL
          OR to_regclass('public.periods') IS NULL
          OR to_regclass('public.memberships') IS NULL
          OR to_regclass('public.auth_sessions') IS NULL
          OR to_regclass('public.stored_objects') IS NULL
          OR to_regclass('public.ingestion_items') IS NULL THEN
          RAISE EXCEPTION 'phase_one_cfdi_domain: required platform tables are missing';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.legal_entities'::regclass
            AND conname = 'uq_legal_entities_account_id'
            AND contype = 'u'
        ) OR NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.stored_objects'::regclass
            AND conname = 'uq_stored_objects_scope_id'
            AND contype = 'u'
        ) OR NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.ingestion_items'::regclass
            AND conname = 'uq_ingestion_items_scope_id'
            AND contype = 'u'
        ) THEN
          RAISE EXCEPTION 'phase_one_cfdi_domain: required composite candidate keys are missing';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = 'balanz_fiscal_owner'
            AND NOT rolcanlogin
            AND NOT rolsuper
            AND NOT rolbypassrls
        ) OR NOT EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = 'balanz_api'
            AND NOT rolcanlogin
            AND NOT rolsuper
            AND NOT rolbypassrls
        ) OR NOT EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = 'balanz_worker'
            AND NOT rolcanlogin
            AND NOT rolsuper
            AND NOT rolbypassrls
        ) OR NOT EXISTS (
          SELECT 1 FROM pg_roles
          WHERE rolname = 'balanz_fiscal_cancel_owner'
            AND NOT rolcanlogin
            AND NOT rolsuper
            AND NOT rolbypassrls
        ) THEN
          RAISE EXCEPTION 'phase_one_cfdi_domain: constrained Phase 0 roles are missing or unsafe';
        END IF;

        EXECUTE format(
          'GRANT balanz_fiscal_owner, balanz_fiscal_cancel_owner TO %I',
          current_user
        );
      END $$
    `);
    await queryRunner.query(`
      GRANT USAGE, CREATE ON SCHEMA public
      TO balanz_fiscal_owner, balanz_fiscal_cancel_owner
    `);

    await queryRunner.query(`
      ALTER TABLE periods
      ADD CONSTRAINT uq_periods_scope_id
      UNIQUE (organization_id, client_account_id, legal_entity_id, id)
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_items
        DROP CONSTRAINT ck_ingestion_items_attempt_count,
        ADD CONSTRAINT ck_ingestion_items_attempt_count
          CHECK (attempt_count >= 0)
    `);

    await queryRunner.query(`
      CREATE TABLE cfdis (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        source_object_id uuid NOT NULL,
        normalized_uuid uuid NOT NULL,
        cfdi_version varchar(10) NOT NULL,
        schema_version varchar(64) NOT NULL,
        parser_version varchar(64) NOT NULL,
        document_type char(1) NOT NULL,
        issued_at timestamptz NOT NULL,
        certified_at timestamptz NOT NULL,
        issuer_rfc varchar(13) NOT NULL,
        issuer_name varchar(300),
        receiver_rfc varchar(13) NOT NULL,
        receiver_name varchar(300),
        receiver_fiscal_zip varchar(5),
        receiver_fiscal_regime_code varchar(3),
        usage_code varchar(3),
        currency varchar(3) NOT NULL,
        exchange_rate numeric(24,10),
        subtotal numeric(24,6) NOT NULL,
        discount numeric(24,6),
        total numeric(24,6) NOT NULL,
        payment_form varchar(3),
        payment_method varchar(3),
        place_of_issue varchar(5),
        export_code varchar(3),
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdis PRIMARY KEY (id),
        CONSTRAINT uq_cfdis_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_cfdis_scope_source UNIQUE (organization_id, client_account_id, legal_entity_id, source_object_id),
        CONSTRAINT uq_cfdis_scope_id_source UNIQUE (organization_id, client_account_id, legal_entity_id, id, source_object_id),
        CONSTRAINT uq_cfdis_legal_entity_uuid UNIQUE (legal_entity_id, normalized_uuid),
        CONSTRAINT fk_cfdis_legal_entity FOREIGN KEY (organization_id, client_account_id, legal_entity_id)
          REFERENCES legal_entities(organization_id, client_account_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_cfdis_source_object FOREIGN KEY (organization_id, client_account_id, legal_entity_id, source_object_id)
          REFERENCES stored_objects(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdis_supported_version CHECK (cfdi_version = '4.0'),
        CONSTRAINT ck_cfdis_document_type CHECK (document_type IN ('I','E','T','N','P')),
        CONSTRAINT ck_cfdis_parser_versions CHECK (
          schema_version = btrim(schema_version) AND char_length(schema_version) BETWEEN 1 AND 64
          AND parser_version = btrim(parser_version) AND char_length(parser_version) BETWEEN 1 AND 64
        ),
        CONSTRAINT ck_cfdis_rfc CHECK (
          issuer_rfc = upper(btrim(issuer_rfc)) AND issuer_rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'
          AND receiver_rfc = upper(btrim(receiver_rfc)) AND receiver_rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'
        ),
        CONSTRAINT ck_cfdis_currency CHECK (currency = upper(btrim(currency)) AND currency ~ '^[A-Z]{3}$'),
        CONSTRAINT ck_cfdis_amounts CHECK (
          subtotal >= 0 AND total >= 0
          AND (discount IS NULL OR discount >= 0)
          AND (exchange_rate IS NULL OR exchange_rate > 0)
        ),
        CONSTRAINT ck_cfdis_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_cfdis_scope_issued ON cfdis (organization_id, legal_entity_id, issued_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_cfdis_scope_type_issued ON cfdis (organization_id, legal_entity_id, document_type, issued_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_cfdis_scope_receiver ON cfdis (organization_id, legal_entity_id, receiver_rfc, issued_at, id)`,
    );

    await queryRunner.query(`
      CREATE TABLE cfdi_concepts (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid NOT NULL,
        ordinal integer NOT NULL,
        product_service_code varchar(8) NOT NULL,
        identification_number varchar(100),
        quantity numeric(24,6) NOT NULL,
        unit_code varchar(3),
        unit_name varchar(100),
        description varchar(1000) NOT NULL,
        unit_value numeric(24,6) NOT NULL,
        amount numeric(24,6) NOT NULL,
        discount numeric(24,6),
        tax_object_code varchar(3) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdi_concepts PRIMARY KEY (id),
        CONSTRAINT uq_cfdi_concepts_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_cfdi_concepts_parent_id UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id, id),
        CONSTRAINT uq_cfdi_concepts_parent_ordinal UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id, ordinal),
        CONSTRAINT fk_cfdi_concepts_cfdi FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdi_concepts_ordinal CHECK (ordinal > 0),
        CONSTRAINT ck_cfdi_concepts_product_code CHECK (product_service_code ~ '^[0-9]{8}$'),
        CONSTRAINT ck_cfdi_concepts_values CHECK (
          quantity > 0 AND unit_value >= 0 AND amount >= 0 AND (discount IS NULL OR discount >= 0)
        ),
        CONSTRAINT ck_cfdi_concepts_description CHECK (
          description = btrim(description) AND char_length(description) BETWEEN 1 AND 1000
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_cfdi_concepts_parent ON cfdi_concepts (organization_id, cfdi_id, ordinal)`,
    );

    await queryRunner.query(`
      CREATE TABLE cfdi_relations (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid NOT NULL,
        relation_group_ordinal integer NOT NULL,
        ordinal integer NOT NULL,
        relation_type varchar(2) NOT NULL,
        related_uuid uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdi_relations PRIMARY KEY (id),
        CONSTRAINT uq_cfdi_relations_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_cfdi_relations_parent_ordinal UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id, relation_group_ordinal, ordinal),
        CONSTRAINT fk_cfdi_relations_cfdi FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdi_relations_ordinals CHECK (relation_group_ordinal > 0 AND ordinal > 0),
        CONSTRAINT ck_cfdi_relations_type CHECK (relation_type ~ '^[0-9]{2}$')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_cfdi_relations_related_uuid ON cfdi_relations (organization_id, legal_entity_id, related_uuid)`,
    );

    await queryRunner.query(`
      CREATE TABLE cfdi_payments (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid NOT NULL,
        ordinal integer NOT NULL,
        payment_date timestamptz NOT NULL,
        payment_form varchar(3) NOT NULL,
        currency varchar(3) NOT NULL,
        exchange_rate numeric(24,10),
        amount numeric(24,6) NOT NULL,
        operation_number varchar(100),
        payer_bank_rfc varchar(13),
        payer_foreign_bank_name varchar(300),
        payer_account varchar(50),
        beneficiary_bank_rfc varchar(13),
        beneficiary_account varchar(50),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdi_payments PRIMARY KEY (id),
        CONSTRAINT uq_cfdi_payments_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_cfdi_payments_parent_id UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id, id),
        CONSTRAINT uq_cfdi_payments_parent_ordinal UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id, ordinal),
        CONSTRAINT fk_cfdi_payments_cfdi FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdi_payments_ordinal CHECK (ordinal > 0),
        CONSTRAINT ck_cfdi_payments_currency CHECK (currency = upper(btrim(currency)) AND currency ~ '^[A-Z]{3}$'),
        CONSTRAINT ck_cfdi_payments_amount CHECK (amount > 0 AND (exchange_rate IS NULL OR exchange_rate > 0)),
        CONSTRAINT ck_cfdi_payments_bank_rfcs CHECK (
          (payer_bank_rfc IS NULL OR payer_bank_rfc = upper(btrim(payer_bank_rfc)))
          AND (beneficiary_bank_rfc IS NULL OR beneficiary_bank_rfc = upper(btrim(beneficiary_bank_rfc)))
        ),
        CONSTRAINT ck_cfdi_payments_foreign_bank_name CHECK (
          payer_foreign_bank_name IS NULL
          OR (payer_foreign_bank_name = btrim(payer_foreign_bank_name)
            AND char_length(payer_foreign_bank_name) BETWEEN 1 AND 300)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_cfdi_payments_parent_date ON cfdi_payments (organization_id, cfdi_id, payment_date, ordinal)`,
    );

    await queryRunner.query(`
      CREATE TABLE cfdi_payment_documents (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid NOT NULL,
        payment_id uuid NOT NULL,
        ordinal integer NOT NULL,
        related_uuid uuid NOT NULL,
        series varchar(25),
        folio varchar(40),
        currency varchar(3) NOT NULL,
        equivalence numeric(24,10),
        installment_number integer NOT NULL,
        previous_balance numeric(24,6) NOT NULL,
        paid_amount numeric(24,6) NOT NULL,
        remaining_balance numeric(24,6) NOT NULL,
        tax_object_code varchar(3) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdi_payment_documents PRIMARY KEY (id),
        CONSTRAINT uq_cfdi_payment_documents_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_cfdi_payment_documents_parent_id UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id, payment_id, id),
        CONSTRAINT uq_cfdi_payment_documents_parent_ordinal UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id, payment_id, ordinal),
        CONSTRAINT fk_cfdi_payment_documents_payment FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id, payment_id)
          REFERENCES cfdi_payments(organization_id, client_account_id, legal_entity_id, cfdi_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_cfdi_payment_documents_cfdi FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdi_payment_documents_ordinal CHECK (ordinal > 0),
        CONSTRAINT ck_cfdi_payment_documents_currency CHECK (currency = upper(btrim(currency)) AND currency ~ '^[A-Z]{3}$'),
        CONSTRAINT ck_cfdi_payment_documents_values CHECK (
          installment_number > 0 AND previous_balance >= 0 AND paid_amount >= 0 AND remaining_balance >= 0
          AND (equivalence IS NULL OR equivalence > 0)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_cfdi_payment_documents_uuid ON cfdi_payment_documents (organization_id, legal_entity_id, related_uuid)`,
    );

    await queryRunner.query(`
      CREATE TABLE cfdi_taxes (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid NOT NULL,
        concept_id uuid,
        payment_id uuid,
        payment_document_id uuid,
        scope_type varchar(24) NOT NULL,
        direction varchar(12) NOT NULL,
        ordinal integer NOT NULL,
        tax_code varchar(3) NOT NULL,
        factor_type varchar(8),
        base_amount numeric(24,6),
        rate_or_quota numeric(24,10),
        amount numeric(24,6),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdi_taxes PRIMARY KEY (id),
        CONSTRAINT uq_cfdi_taxes_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT fk_cfdi_taxes_cfdi FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_cfdi_taxes_concept FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id, concept_id)
          REFERENCES cfdi_concepts(organization_id, client_account_id, legal_entity_id, cfdi_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_cfdi_taxes_payment FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id, payment_id)
          REFERENCES cfdi_payments(organization_id, client_account_id, legal_entity_id, cfdi_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_cfdi_taxes_payment_document FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id, payment_id, payment_document_id)
          REFERENCES cfdi_payment_documents(organization_id, client_account_id, legal_entity_id, cfdi_id, payment_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdi_taxes_scope_type CHECK (scope_type IN ('document','concept','payment','payment_document')),
        CONSTRAINT ck_cfdi_taxes_direction CHECK (direction IN ('transferred','withheld')),
        CONSTRAINT ck_cfdi_taxes_factor CHECK (factor_type IS NULL OR factor_type IN ('rate','quota','exempt')),
        CONSTRAINT ck_cfdi_taxes_ordinal CHECK (ordinal > 0),
        CONSTRAINT ck_cfdi_taxes_parent CHECK (
          (scope_type = 'document' AND concept_id IS NULL AND payment_id IS NULL AND payment_document_id IS NULL)
          OR (scope_type = 'concept' AND concept_id IS NOT NULL AND payment_id IS NULL AND payment_document_id IS NULL)
          OR (scope_type = 'payment' AND concept_id IS NULL AND payment_id IS NOT NULL AND payment_document_id IS NULL)
          OR (scope_type = 'payment_document' AND concept_id IS NULL AND payment_id IS NOT NULL AND payment_document_id IS NOT NULL)
        ),
        CONSTRAINT ck_cfdi_taxes_values CHECK (
          (base_amount IS NULL OR base_amount >= 0)
          AND (rate_or_quota IS NULL OR rate_or_quota >= 0)
          AND (amount IS NULL OR amount >= 0)
          AND (
            (direction = 'withheld'
              AND scope_type IN ('document','payment')
              AND factor_type IS NULL
              AND base_amount IS NULL
              AND rate_or_quota IS NULL
              AND amount IS NOT NULL)
            OR (factor_type = 'exempt'
              AND base_amount IS NOT NULL
              AND rate_or_quota IS NULL
              AND amount IS NULL)
            OR (factor_type IN ('rate','quota')
              AND base_amount IS NOT NULL
              AND rate_or_quota IS NOT NULL
              AND amount IS NOT NULL)
          )
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_cfdi_taxes_parent ON cfdi_taxes (organization_id, cfdi_id, scope_type, ordinal)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_cfdi_taxes_document_ordinal
         ON cfdi_taxes (organization_id, client_account_id, legal_entity_id, cfdi_id, ordinal)
        WHERE scope_type = 'document'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_cfdi_taxes_concept_ordinal
         ON cfdi_taxes (organization_id, client_account_id, legal_entity_id, cfdi_id, concept_id, ordinal)
        WHERE scope_type = 'concept'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_cfdi_taxes_payment_ordinal
         ON cfdi_taxes (organization_id, client_account_id, legal_entity_id, cfdi_id, payment_id, ordinal)
        WHERE scope_type = 'payment'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_cfdi_taxes_payment_document_ordinal
         ON cfdi_taxes (organization_id, client_account_id, legal_entity_id, cfdi_id, payment_id, payment_document_id, ordinal)
        WHERE scope_type = 'payment_document'`,
    );

    await this.createPayrollTables(queryRunner);
    await this.createPeriodAndIncidentTables(queryRunner);
    await this.createAccessGrantTable(queryRunner);
    await this.extendIngestionItems(queryRunner);

    for (const table of ALL_SCOPED_TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${table} OWNER TO balanz_fiscal_owner`,
      );
      await queryRunner.query(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`);
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await this.createApiPolicy(queryRunner, table);
    }
    for (const table of WORKER_SCOPED_TABLES) {
      await this.createWorkerPolicy(queryRunner, table);
    }

    await queryRunner.query(`
      GRANT SELECT ON TABLE
        cfdis,
        cfdi_concepts,
        cfdi_relations,
        cfdi_payments,
        cfdi_payment_documents,
        cfdi_taxes,
        cfdi_payrolls,
        cfdi_payroll_perceptions,
        cfdi_payroll_deductions,
        cfdi_payroll_other_payments,
        cfdi_payroll_incapacities,
        period_cfdis,
        incidents,
        ingestion_items
      TO balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT ON TABLE
        cfdis,
        cfdi_concepts,
        cfdi_relations,
        cfdi_payments,
        cfdi_payment_documents,
        cfdi_taxes,
        cfdi_payrolls,
        cfdi_payroll_perceptions,
        cfdi_payroll_deductions,
        cfdi_payroll_other_payments,
        cfdi_payroll_incapacities,
        period_cfdis,
        incidents
      TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT SELECT ON TABLE cfdi_access_grants TO balanz_api
    `);
    await queryRunner.query(`
      GRANT INSERT (
        id, organization_id, client_account_id, legal_entity_id,
        cfdi_id, object_id, membership_id, session_id,
        token_hash, expires_at
      ) ON cfdi_access_grants TO balanz_api
    `);
    await queryRunner.query(`
      GRANT UPDATE (used_at) ON cfdi_access_grants TO balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT (source_type, total_items, pending_items, processing_items)
      ON ingestion_jobs TO balanz_fiscal_cancel_owner
    `);
    await this.replaceCancellationFunction(queryRunner, true);
    await this.grantWorkerFoundationAccess(queryRunner);

    await queryRunner.query(`
      REVOKE CREATE ON SCHEMA public
      FROM balanz_fiscal_owner, balanz_fiscal_cancel_owner
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'REVOKE balanz_fiscal_owner, balanz_fiscal_cancel_owner FROM %I',
          current_user
        );
        IF has_schema_privilege('balanz_fiscal_owner', 'public', 'CREATE')
          OR has_schema_privilege('balanz_fiscal_cancel_owner', 'public', 'CREATE') THEN
          RAISE EXCEPTION 'phase_one_cfdi_domain: constrained owner retained schema CREATE';
        END IF;
        IF EXISTS (
          SELECT 1
          FROM pg_auth_members AS membership
          INNER JOIN pg_roles AS role ON role.oid = membership.roleid
          WHERE role.rolname IN (
            'balanz_fiscal_owner',
            'balanz_fiscal_cancel_owner'
          )
        ) THEN
          RAISE EXCEPTION 'phase_one_cfdi_domain: constrained owner membership leaked';
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'GRANT balanz_fiscal_owner, balanz_fiscal_cancel_owner TO %I',
          current_user
        );
      END $$
    `);
    await queryRunner.query(`
      GRANT USAGE, CREATE ON SCHEMA public
      TO balanz_fiscal_owner, balanz_fiscal_cancel_owner
    `);
    await this.replaceCancellationFunction(queryRunner, false);

    await queryRunner.query(`
      REVOKE ALL ON TABLE
        cfdi_access_grants,
        incidents,
        period_cfdis,
        cfdi_payroll_incapacities,
        cfdi_payroll_other_payments,
        cfdi_payroll_deductions,
        cfdi_payroll_perceptions,
        cfdi_payrolls,
        cfdi_taxes,
        cfdi_payment_documents,
        cfdi_payments,
        cfdi_relations,
        cfdi_concepts,
        cfdis
      FROM balanz_api, balanz_worker
    `);
    await queryRunner.query(`
      REVOKE SELECT ON TABLE stored_objects, ingestion_items FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE INSERT (
        id, organization_id, client_account_id, legal_entity_id,
        ingestion_job_id, object_id, ordinal, safe_filename,
        technical_status, product_result, sha256, error_code,
        safe_error_detail, attempt_count, observed_at, processed_at,
        cfdi_id, parser_version, schema_version, parsed_cfdi_version,
        normalized_uuid, issuer_rfc, receiver_rfc, document_type,
        parser_completed_at
      ) ON ingestion_items FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE UPDATE (
        technical_status, product_result, sha256, error_code,
        safe_error_detail, attempt_count, processed_at,
        cfdi_id, parser_version, schema_version, parsed_cfdi_version,
        normalized_uuid, issuer_rfc, receiver_rfc, document_type,
        parser_completed_at, updated_at, version
      ) ON ingestion_items FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE UPDATE (
        detected_mime_type, lifecycle_state, malware_scan_status,
        malware_scanner_version, malware_scanned_at,
        quarantine_reason_code, retention_until, hold_until,
        available_at, updated_at, version
      ) ON stored_objects FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE SELECT (id, organization_id, client_account_id, rfc, status)
      ON legal_entities FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE SELECT (id, timezone) ON organizations FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE SELECT (id, organization_id, client_account_id, legal_entity_id, year)
      ON fiscal_years FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE SELECT (
        id, organization_id, client_account_id, legal_entity_id,
        fiscal_year_id, month, status
      ) ON periods FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE SELECT (
        source_type, root_object_id, current_stage,
        total_items, pending_items, processing_items,
        incorporated_items, duplicate_items, foreign_items,
        invalid_items, unsupported_items, internal_error_items,
        counters_reconciled_at
      ) ON ingestion_jobs FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE UPDATE (
        total_items, pending_items, processing_items,
        incorporated_items, duplicate_items, foreign_items,
        invalid_items, unsupported_items, internal_error_items,
        counters_reconciled_at
      ) ON ingestion_jobs FROM balanz_worker
    `);
    await queryRunner.query(`
      REVOKE SELECT ON TABLE ingestion_items FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE INSERT (
        id, organization_id, client_account_id, legal_entity_id,
        ingestion_job_id, object_id, ordinal, safe_filename, sha256
      ) ON ingestion_items FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE UPDATE (detected_mime_type, quarantine_reason_code, deleted_at)
      ON stored_objects FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE UPDATE (last_error_code) ON ingestion_uploads FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE INSERT (state) ON ingestion_uploads FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE INSERT (total_items, pending_items)
      ON ingestion_jobs FROM balanz_api
    `);
    await queryRunner.query(`
      REVOKE SELECT (source_type, total_items, pending_items, processing_items)
      ON ingestion_jobs FROM balanz_fiscal_cancel_owner
    `);

    for (const table of [...ALL_SCOPED_TABLES].reverse()) {
      await queryRunner.query(
        `DROP POLICY ${table}_api_tenant_isolation ON ${table}`,
      );
      if ((WORKER_SCOPED_TABLES as readonly string[]).includes(table)) {
        await queryRunner.query(
          `DROP POLICY ${table}_worker_tenant_isolation ON ${table}`,
        );
      }
      await queryRunner.query(
        `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(`ALTER TABLE ${table} OWNER TO CURRENT_USER`);
    }

    await queryRunner.query(`
      ALTER TABLE ingestion_items
        DROP CONSTRAINT fk_ingestion_items_cfdi,
        DROP CONSTRAINT ck_ingestion_items_parser_metadata,
        DROP CONSTRAINT ck_ingestion_items_cfdi_metadata,
        DROP COLUMN cfdi_id,
        DROP COLUMN parser_version,
        DROP COLUMN schema_version,
        DROP COLUMN parsed_cfdi_version,
        DROP COLUMN normalized_uuid,
        DROP COLUMN issuer_rfc,
        DROP COLUMN receiver_rfc,
        DROP COLUMN document_type,
        DROP COLUMN parser_completed_at
    `);

    for (const table of [...ALL_SCOPED_TABLES].reverse()) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }

    await queryRunner.query(`
      ALTER TABLE periods DROP CONSTRAINT uq_periods_scope_id
    `);
    await queryRunner.query(`
      ALTER TABLE ingestion_items
        DROP CONSTRAINT ck_ingestion_items_attempt_count,
        ADD CONSTRAINT ck_ingestion_items_attempt_count
          CHECK (attempt_count BETWEEN 0 AND 4)
    `);
    await queryRunner.query(`
      REVOKE CREATE ON SCHEMA public
      FROM balanz_fiscal_owner, balanz_fiscal_cancel_owner
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'REVOKE balanz_fiscal_owner, balanz_fiscal_cancel_owner FROM %I',
          current_user
        );
      END $$
    `);
  }

  private async replaceCancellationFunction(
    queryRunner: QueryRunner,
    rejectPublishedManualXml: boolean,
  ): Promise<void> {
    const publishedBoundary = rejectPublishedManualXml
      ? `AND (
             job.source_type <> 'manual_xml'
             OR job.total_items = 0
             OR job.pending_items + job.processing_items > 0
           )`
      : '';
    await queryRunner.query(`SET LOCAL ROLE balanz_fiscal_cancel_owner`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.request_ingestion_job_cancellation(
        p_job_id uuid
      )
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
             ${publishedBoundary}
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
    await queryRunner.query(`RESET ROLE`);
  }

  private async createPayrollTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cfdi_payrolls (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid NOT NULL,
        payroll_version varchar(10) NOT NULL,
        payroll_type char(1) NOT NULL,
        payment_date timestamptz NOT NULL,
        initial_payment_date timestamptz NOT NULL,
        final_payment_date timestamptz NOT NULL,
        paid_days numeric(12,3) NOT NULL,
        total_perceptions numeric(24,6),
        total_deductions numeric(24,6),
        total_other_payments numeric(24,6),
        employer_registration varchar(20),
        employee_curp char(18) NOT NULL,
        employee_social_security_number varchar(15),
        employment_start_date timestamptz,
        seniority varchar(20),
        contract_type varchar(3),
        regime_type varchar(3) NOT NULL,
        employee_number varchar(30) NOT NULL,
        position varchar(100),
        risk_position varchar(3),
        payment_periodicity varchar(3) NOT NULL,
        bank_code varchar(3),
        bank_account varchar(18),
        base_salary numeric(24,6),
        integrated_daily_salary numeric(24,6),
        state_code varchar(3),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdi_payrolls PRIMARY KEY (id),
        CONSTRAINT uq_cfdi_payrolls_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_cfdi_payrolls_cfdi UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id),
        CONSTRAINT fk_cfdi_payrolls_cfdi FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdi_payrolls_version CHECK (payroll_version = '1.2'),
        CONSTRAINT ck_cfdi_payrolls_type CHECK (payroll_type IN ('O','E')),
        CONSTRAINT ck_cfdi_payrolls_dates CHECK (initial_payment_date <= final_payment_date),
        CONSTRAINT ck_cfdi_payrolls_values CHECK (
          paid_days >= 0
          AND (total_perceptions IS NULL OR total_perceptions >= 0)
          AND (total_deductions IS NULL OR total_deductions >= 0)
          AND (total_other_payments IS NULL OR total_other_payments >= 0)
          AND (base_salary IS NULL OR base_salary >= 0)
          AND (integrated_daily_salary IS NULL OR integrated_daily_salary >= 0)
        )
      )
    `);

    for (const entry of [
      {
        table: 'cfdi_payroll_perceptions',
        code: 'perception_type',
        columns:
          'taxable_amount numeric(24,6) NOT NULL, exempt_amount numeric(24,6) NOT NULL',
        check: 'taxable_amount >= 0 AND exempt_amount >= 0',
      },
      {
        table: 'cfdi_payroll_deductions',
        code: 'deduction_type',
        columns: 'amount numeric(24,6) NOT NULL',
        check: 'amount >= 0',
      },
      {
        table: 'cfdi_payroll_other_payments',
        code: 'other_payment_type',
        columns: 'amount numeric(24,6) NOT NULL',
        check: 'amount >= 0',
      },
    ]) {
      await queryRunner.query(`
        CREATE TABLE ${entry.table} (
          id uuid NOT NULL,
          organization_id uuid NOT NULL,
          client_account_id uuid NOT NULL,
          legal_entity_id uuid NOT NULL,
          payroll_id uuid NOT NULL,
          ordinal integer NOT NULL,
          ${entry.code} varchar(3) NOT NULL,
          key varchar(15) NOT NULL,
          concept varchar(100) NOT NULL,
          ${entry.columns},
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT pk_${entry.table} PRIMARY KEY (id),
          CONSTRAINT uq_${entry.table}_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
          CONSTRAINT uq_${entry.table}_parent_ordinal UNIQUE (organization_id, client_account_id, legal_entity_id, payroll_id, ordinal),
          CONSTRAINT fk_${entry.table}_payroll FOREIGN KEY (organization_id, client_account_id, legal_entity_id, payroll_id)
            REFERENCES cfdi_payrolls(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
          CONSTRAINT ck_${entry.table}_ordinal CHECK (ordinal > 0),
          CONSTRAINT ck_${entry.table}_amounts CHECK (${entry.check})
        )
      `);
      await queryRunner.query(
        `CREATE INDEX ix_${entry.table}_parent ON ${entry.table} (organization_id, payroll_id, ordinal)`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE cfdi_payroll_incapacities (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        payroll_id uuid NOT NULL,
        ordinal integer NOT NULL,
        incapacity_days numeric(12,3) NOT NULL,
        incapacity_type varchar(3) NOT NULL,
        amount numeric(24,6),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdi_payroll_incapacities PRIMARY KEY (id),
        CONSTRAINT uq_cfdi_payroll_incapacities_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_cfdi_payroll_incapacities_parent_ordinal UNIQUE (organization_id, client_account_id, legal_entity_id, payroll_id, ordinal),
        CONSTRAINT fk_cfdi_payroll_incapacities_payroll FOREIGN KEY (organization_id, client_account_id, legal_entity_id, payroll_id)
          REFERENCES cfdi_payrolls(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdi_payroll_incapacities_ordinal CHECK (ordinal > 0),
        CONSTRAINT ck_cfdi_payroll_incapacities_values CHECK (incapacity_days > 0 AND (amount IS NULL OR amount >= 0))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_cfdi_payroll_incapacities_parent ON cfdi_payroll_incapacities (organization_id, payroll_id, ordinal)`,
    );
  }

  private async createPeriodAndIncidentTables(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE period_cfdis (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid NOT NULL,
        period_id uuid NOT NULL,
        participation_type varchar(24) NOT NULL,
        policy_version varchar(64) NOT NULL,
        timezone varchar(64) NOT NULL,
        source_date timestamptz NOT NULL,
        source_ordinal integer NOT NULL,
        origin varchar(12) NOT NULL,
        created_by_membership_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_period_cfdis PRIMARY KEY (id),
        CONSTRAINT uq_period_cfdis_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_period_cfdis_source UNIQUE (organization_id, client_account_id, legal_entity_id, cfdi_id, participation_type, source_ordinal),
        CONSTRAINT fk_period_cfdis_cfdi FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_period_cfdis_period FOREIGN KEY (organization_id, client_account_id, legal_entity_id, period_id)
          REFERENCES periods(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_period_cfdis_created_by FOREIGN KEY (organization_id, created_by_membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_period_cfdis_type CHECK (participation_type IN ('document_issue','payment','payroll')),
        CONSTRAINT ck_period_cfdis_policy CHECK (policy_version = btrim(policy_version) AND char_length(policy_version) BETWEEN 1 AND 64),
        CONSTRAINT ck_period_cfdis_timezone CHECK (timezone = btrim(timezone) AND char_length(timezone) BETWEEN 1 AND 64),
        CONSTRAINT ck_period_cfdis_source_ordinal CHECK (source_ordinal > 0),
        CONSTRAINT ck_period_cfdis_origin CHECK (
          (origin = 'automatic' AND created_by_membership_id IS NULL)
          OR (origin = 'manual' AND created_by_membership_id IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_period_cfdis_period ON period_cfdis (organization_id, legal_entity_id, period_id, source_date, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_period_cfdis_cfdi ON period_cfdis (organization_id, cfdi_id, participation_type, source_ordinal)`,
    );

    await queryRunner.query(`
      CREATE TABLE incidents (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid,
        ingestion_item_id uuid,
        stored_object_id uuid,
        code varchar(80) NOT NULL,
        severity varchar(12) NOT NULL,
        status varchar(12) NOT NULL DEFAULT 'open',
        safe_detail varchar(500),
        detected_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        resolved_by_membership_id uuid,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_incidents PRIMARY KEY (id),
        CONSTRAINT uq_incidents_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT fk_incidents_legal_entity FOREIGN KEY (organization_id, client_account_id, legal_entity_id)
          REFERENCES legal_entities(organization_id, client_account_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_incidents_cfdi FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_incidents_ingestion_item FOREIGN KEY (organization_id, client_account_id, legal_entity_id, ingestion_item_id)
          REFERENCES ingestion_items(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_incidents_stored_object FOREIGN KEY (organization_id, client_account_id, legal_entity_id, stored_object_id)
          REFERENCES stored_objects(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_incidents_resolved_by FOREIGN KEY (organization_id, resolved_by_membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_incidents_code CHECK (code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
        CONSTRAINT ck_incidents_severity CHECK (severity IN ('low','medium','high','critical')),
        CONSTRAINT ck_incidents_status CHECK (status IN ('open','resolved','dismissed')),
        CONSTRAINT ck_incidents_resolution CHECK (
          (status = 'open' AND resolved_at IS NULL AND resolved_by_membership_id IS NULL)
          OR (status IN ('resolved','dismissed') AND resolved_at IS NOT NULL AND resolved_by_membership_id IS NOT NULL)
        ),
        CONSTRAINT ck_incidents_reference CHECK (cfdi_id IS NOT NULL OR ingestion_item_id IS NOT NULL OR stored_object_id IS NOT NULL),
        CONSTRAINT ck_incidents_safe_detail CHECK (safe_detail IS NULL OR char_length(safe_detail) BETWEEN 1 AND 500),
        CONSTRAINT ck_incidents_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_incidents_open_scope ON incidents (organization_id, legal_entity_id, severity, detected_at DESC, id) WHERE status = 'open'`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_incidents_cfdi ON incidents (organization_id, cfdi_id, detected_at DESC, id) WHERE cfdi_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_incidents_item ON incidents (organization_id, ingestion_item_id, detected_at DESC, id) WHERE ingestion_item_id IS NOT NULL`,
    );
  }

  private async createAccessGrantTable(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cfdi_access_grants (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        client_account_id uuid NOT NULL,
        legal_entity_id uuid NOT NULL,
        cfdi_id uuid NOT NULL,
        object_id uuid NOT NULL,
        membership_id uuid NOT NULL,
        session_id uuid NOT NULL,
        token_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_cfdi_access_grants PRIMARY KEY (id),
        CONSTRAINT uq_cfdi_access_grants_scope_id UNIQUE (organization_id, client_account_id, legal_entity_id, id),
        CONSTRAINT uq_cfdi_access_grants_token_hash UNIQUE (token_hash),
        CONSTRAINT fk_cfdi_access_grants_source FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id, object_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id, source_object_id) ON DELETE RESTRICT,
        CONSTRAINT fk_cfdi_access_grants_membership FOREIGN KEY (organization_id, membership_id)
          REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_cfdi_access_grants_session FOREIGN KEY (session_id)
          REFERENCES auth_sessions(id) ON DELETE RESTRICT,
        CONSTRAINT ck_cfdi_access_grants_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_cfdi_access_grants_expiry CHECK (expires_at > created_at),
        CONSTRAINT ck_cfdi_access_grants_usage CHECK (used_at IS NULL OR (used_at >= created_at AND used_at <= expires_at))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_cfdi_access_grants_expiry ON cfdi_access_grants (expires_at, used_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_cfdi_access_grants_subject ON cfdi_access_grants (organization_id, membership_id, session_id, cfdi_id, created_at)`,
    );
  }

  private async extendIngestionItems(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ingestion_items
        ADD COLUMN cfdi_id uuid,
        ADD COLUMN parser_version varchar(64),
        ADD COLUMN schema_version varchar(64),
        ADD COLUMN parsed_cfdi_version varchar(10),
        ADD COLUMN normalized_uuid uuid,
        ADD COLUMN issuer_rfc varchar(13),
        ADD COLUMN receiver_rfc varchar(13),
        ADD COLUMN document_type char(1),
        ADD COLUMN parser_completed_at timestamptz,
        ADD CONSTRAINT fk_ingestion_items_cfdi
          FOREIGN KEY (organization_id, client_account_id, legal_entity_id, cfdi_id)
          REFERENCES cfdis(organization_id, client_account_id, legal_entity_id, id) ON DELETE RESTRICT,
        ADD CONSTRAINT ck_ingestion_items_parser_metadata CHECK (
          (parser_completed_at IS NULL AND parser_version IS NULL AND schema_version IS NULL AND parsed_cfdi_version IS NULL)
          OR (parser_completed_at IS NOT NULL AND parser_version IS NOT NULL AND schema_version IS NOT NULL)
        ),
        ADD CONSTRAINT ck_ingestion_items_cfdi_metadata CHECK (
          (document_type IS NULL OR document_type IN ('I','E','T','N','P'))
          AND (issuer_rfc IS NULL OR issuer_rfc = upper(btrim(issuer_rfc)))
          AND (receiver_rfc IS NULL OR receiver_rfc = upper(btrim(receiver_rfc)))
        )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_items_cfdi ON ingestion_items (organization_id, cfdi_id) WHERE cfdi_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ingestion_items_observed_uuid ON ingestion_items (organization_id, legal_entity_id, normalized_uuid, observed_at DESC) WHERE normalized_uuid IS NOT NULL`,
    );
  }

  private async createApiPolicy(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<void> {
    const membershipBinding =
      table === 'cfdi_access_grants'
        ? `AND membership_id = NULLIF(current_setting('app.membership_id', true), '')::uuid`
        : '';
    await queryRunner.query(`
      CREATE POLICY ${table}_api_tenant_isolation
      ON ${table}
      AS PERMISSIVE
      FOR ALL
      TO balanz_api
      USING (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
        ${membershipBinding}
        AND EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
            AND membership.id = NULLIF(current_setting('app.membership_id', true), '')::uuid
            AND membership.status = 'active'
        )
      )
      WITH CHECK (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
        ${membershipBinding}
        AND EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
            AND membership.id = NULLIF(current_setting('app.membership_id', true), '')::uuid
            AND membership.status = 'active'
        )
      )
    `);
  }

  private async createWorkerPolicy(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<void> {
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

  private async grantWorkerFoundationAccess(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      GRANT UPDATE (detected_mime_type, quarantine_reason_code, deleted_at)
      ON stored_objects TO balanz_api
    `);
    await queryRunner.query(`
      GRANT UPDATE (last_error_code) ON ingestion_uploads TO balanz_api
    `);
    await queryRunner.query(`
      GRANT INSERT (state) ON ingestion_uploads TO balanz_api
    `);
    await queryRunner.query(`
      GRANT INSERT (total_items, pending_items)
      ON ingestion_jobs TO balanz_api
    `);
    await queryRunner.query(`
      GRANT INSERT (
        id, organization_id, client_account_id, legal_entity_id,
        ingestion_job_id, object_id, ordinal, safe_filename, sha256
      ) ON ingestion_items TO balanz_api
    `);
    await queryRunner.query(`
      GRANT SELECT ON TABLE stored_objects, ingestion_items TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT SELECT (
        source_type, root_object_id, current_stage,
        total_items, pending_items, processing_items,
        incorporated_items, duplicate_items, foreign_items,
        invalid_items, unsupported_items, internal_error_items,
        counters_reconciled_at
      ) ON ingestion_jobs TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT UPDATE (
        total_items, pending_items, processing_items,
        incorporated_items, duplicate_items, foreign_items,
        invalid_items, unsupported_items, internal_error_items,
        counters_reconciled_at
      ) ON ingestion_jobs TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT INSERT (
        id, organization_id, client_account_id, legal_entity_id,
        ingestion_job_id, object_id, ordinal, safe_filename,
        technical_status, product_result, sha256, error_code,
        safe_error_detail, attempt_count, observed_at, processed_at,
        cfdi_id, parser_version, schema_version, parsed_cfdi_version,
        normalized_uuid, issuer_rfc, receiver_rfc, document_type,
        parser_completed_at
      ) ON ingestion_items TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT UPDATE (
        technical_status, product_result, sha256, error_code,
        safe_error_detail, attempt_count, processed_at,
        cfdi_id, parser_version, schema_version, parsed_cfdi_version,
        normalized_uuid, issuer_rfc, receiver_rfc, document_type,
        parser_completed_at, updated_at, version
      ) ON ingestion_items TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT UPDATE (
        detected_mime_type, lifecycle_state, malware_scan_status,
        malware_scanner_version, malware_scanned_at,
        quarantine_reason_code, retention_until, hold_until,
        available_at, updated_at, version
      ) ON stored_objects TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT SELECT (id, organization_id, client_account_id, rfc, status)
      ON legal_entities TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT SELECT (id, timezone) ON organizations TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT SELECT (id, organization_id, client_account_id, legal_entity_id, year)
      ON fiscal_years TO balanz_worker
    `);
    await queryRunner.query(`
      GRANT SELECT (id, organization_id, client_account_id, legal_entity_id, fiscal_year_id, month, status)
      ON periods TO balanz_worker
    `);
  }
}
