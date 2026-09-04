/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import {
  DataSource,
  type EntityManager,
  type MigrationInterface,
} from 'typeorm';
import {
  PERMISSION_CATALOG,
  ROLE_PERMISSION_KEYS,
} from '../src/common/auth/permission-catalog';
import { resolveScriptDatabaseOptions } from '../src/database/scripts/script-database-options';
import {
  ALLOWED_SHARED_MIGRATION_TIMESTAMPS,
  EXPECTED_MIGRATION_NAMES,
} from '../src/database/scripts/migration-manifest';
import { FiscalIngestionFoundation1787690600000 } from '../src/database/migrations/1787690600000-FiscalIngestionFoundation';
import { FiscalRlsWorkerClaims1787690610000 } from '../src/database/migrations/1787690610000-FiscalRlsWorkerClaims';
import { IngestionAutomaticRetryBudget1787690620000 } from '../src/database/migrations/1787690620000-IngestionAutomaticRetryBudget';
import { PhaseZeroRuntimeCompatibility1787690630000 } from '../src/database/migrations/1787690630000-PhaseZeroRuntimeCompatibility';
import { PhaseOneCfdiDomain1787690700000 } from '../src/database/migrations/1787690700000-PhaseOneCfdiDomain';
import { seedDatabase } from '../src/database/seeds/seed-database';
import { ROLE_DEFINITIONS } from '../src/modules/permissions/entities/role.entity';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const EXPECTED_MIGRATIONS = EXPECTED_MIGRATION_NAMES;
const FISCAL_ROLES = [
  'balanz_fiscal_owner',
  'balanz_fiscal_cancel_owner',
  'balanz_api',
  'balanz_worker',
  'balanz_fiscal_claim_owner',
  'balanz_fiscal_reconcile_owner',
] as const;

interface AppliedMigrationRow {
  id: number;
  timestamp: string | number;
  name: string;
}

interface RoleStateRow {
  name: string;
  canLogin: boolean;
  bypassRls: boolean;
  superuser: boolean;
}

interface MembershipRow {
  grantedRole: string;
  memberRole: string;
}

interface DatabaseBaseline {
  migrationLogPresent: boolean;
  appliedMigrations: AppliedMigrationRow[];
  phaseZeroRelations: Record<string, string | null>;
  seedState: SeedState | null;
  roles: RoleStateRow[];
  memberships: MembershipRow[];
}

interface SeedState {
  roles: number;
  distinctRoles: number;
  permissions: number;
  distinctPermissions: number;
  rolePermissions: number;
}

async function validateMigrationLifecycle(): Promise<void> {
  assertSafeEnvironment();
  const options = await resolveScriptDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('Migration lifecycle QA requires PostgreSQL');
  }

  const dataSource = new DataSource({ ...options, logging: false });
  const report: Record<string, unknown> = {
    mode: 'TRANSACTIONAL_DEVELOPMENT_VALIDATION',
    persistentDestructiveDatabaseOperations: false,
    expectedMigrations: EXPECTED_MIGRATIONS,
  };
  let transactionStarted = false;
  let baseline: DatabaseBaseline | undefined;
  const queryRunner = dataSource.createQueryRunner();

  try {
    await dataSource.initialize();
    await queryRunner.connect();
    const databaseSafety = await inspectDatabaseSafety(queryRunner.manager);
    report.databaseSafety = databaseSafety;
    if (Number(databaseSafety.server_version_num) < 160000) {
      throw new Error('Phase 0 lifecycle requires PostgreSQL 16 or newer');
    }
    if (!databaseSafety.rolsuper && !databaseSafety.rolcreaterole) {
      throw new Error('Migration principal cannot create constrained roles');
    }

    const configuredNames = dataSource.migrations.map((migration) => {
      if (!migration.name) throw new Error('Configured migration has no name');
      return migration.name;
    });
    validateMigrationManifest(configuredNames);
    report.configuredMigrationOrder = configuredNames;

    baseline = await captureBaseline(queryRunner.manager);
    validateAppliedMigrationLedger(baseline.appliedMigrations);
    const appliedNames = new Set(
      baseline.appliedMigrations.map((migration) => migration.name),
    );
    const pendingNames = EXPECTED_MIGRATIONS.filter(
      (name) => !appliedNames.has(name),
    );
    report.appliedMigrationsBefore = baseline.appliedMigrations;
    report.unknownExecutedMigrations = [];
    report.allowedSharedTimestamps = Object.fromEntries(
      [...ALLOWED_SHARED_MIGRATION_TIMESTAMPS].map(([timestamp, names]) => [
        timestamp,
        [...names],
      ]),
    );
    report.pendingExpectedMigrations = pendingNames;

    await queryRunner.startTransaction();
    transactionStarted = true;

    if (!baseline.migrationLogPresent) {
      await queryRunner.query(`
        CREATE TABLE migrations (
          id serial NOT NULL,
          timestamp bigint NOT NULL,
          name varchar NOT NULL,
          CONSTRAINT pk_migrations_qa PRIMARY KEY (id)
        )
      `);
    }

    const pending = pendingNames.map((name) => findMigration(dataSource, name));
    for (const migration of pending) {
      await migration.up(queryRunner);
      await queryRunner.query(
        `INSERT INTO migrations(timestamp, name) VALUES ($1, $2)`,
        [migrationTimestamp(migration.name), migration.name],
      );
    }
    report.transactionallyApplied = pending.map((migration) => migration.name);
    const transactionalMigrationLog = (await queryRunner.query(
      `SELECT id, timestamp, name FROM migrations ORDER BY id`,
    )) as AppliedMigrationRow[];
    validateAppliedMigrationLedger(transactionalMigrationLog, true);
    report.transactionalMigrationLog = transactionalMigrationLog;

    await validatePhaseZeroSchema(queryRunner.manager, report);
    await validatePhaseOneCfdiSchema(queryRunner.manager, report);
    await validateCounterReconciliationPlan(queryRunner.manager, report);
    await validateFiscalOwnerMembershipRejection(queryRunner.manager, report);
    await validateSeedsTwice(queryRunner.manager, report);
    await validateCompositeForeignKeyRejection(queryRunner.manager, report);

    const databaseName =
      typeof databaseSafety.database === 'string'
        ? databaseSafety.database
        : '';
    const downUpAllowed =
      isExplicitTestDatabase(databaseName) &&
      process.env.QA_ALLOW_TRANSACTIONAL_MIGRATION_DOWN_UP === 'true';
    if (downUpAllowed) {
      await validatePhaseZeroDownUpSavepoint(queryRunner.manager, report);
    } else {
      report.phaseZeroDownUp = {
        status: 'SKIPPED_SAFETY_GUARD',
        database: databaseName,
        requiredDatabasePattern: 'test_* or *_test',
        requiredFlag: 'QA_ALLOW_TRANSACTIONAL_MIGRATION_DOWN_UP=true',
      };
    }

    if (pending.length === 0) {
      const schemaLog = await dataSource.driver.createSchemaBuilder().log();
      report.entitySchemaDrift = {
        status: 'VALIDATED',
        upQueries: schemaLog.upQueries.length,
        downQueries: schemaLog.downQueries.length,
      };
      assertEqual(schemaLog.upQueries.length, 0, 'schema drift up query count');
      assertEqual(
        schemaLog.downQueries.length,
        0,
        'schema drift down query count',
      );
    } else {
      report.entitySchemaDrift = {
        status: 'DEFERRED_UNTIL_MIGRATIONS_ARE_COMMITTED',
        reason:
          'TypeORM schema diff opens an independent connection, which cannot see transactionally applied DDL.',
        transactionalSchemaInspection: 'PASSED',
      };
    }

    report.concurrentClaimsAndIdempotency = {
      status: 'DEFERRED_TO_POST_MIGRATION_INTEGRATION',
      reason:
        'Independent PostgreSQL connections cannot observe the uncommitted Phase 0 DDL required by this non-destructive validator.',
    };
  } finally {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
      transactionStarted = false;
      report.outerTransactionRolledBack = true;
    }
    if (queryRunner.isReleased === false) await queryRunner.release();

    if (baseline && dataSource.isInitialized) {
      await assertBaselineRestored(dataSource.manager, baseline);
      report.baselineRestored = true;
    }
    if (dataSource.isInitialized) await dataSource.destroy();
  }

  if (transactionStarted) {
    throw new Error('Transactional migration validator did not roll back');
  }
  console.log(JSON.stringify(report, null, 2));
}

async function validatePhaseZeroDownUpSavepoint(
  manager: EntityManager,
  report: Record<string, unknown>,
): Promise<void> {
  const queryRunner = manager.queryRunner;
  if (!queryRunner?.isTransactionActive) {
    throw new Error(
      'Phase 0 down/up validation requires an active transaction',
    );
  }

  const foundation = new FiscalIngestionFoundation1787690600000();
  const rls = new FiscalRlsWorkerClaims1787690610000();
  const retryBudget = new IngestionAutomaticRetryBudget1787690620000();
  const runtimeCompatibility = new PhaseZeroRuntimeCompatibility1787690630000();
  const phaseOne = new PhaseOneCfdiDomain1787690700000();
  await manager.query(`SAVEPOINT phase_zero_down_up_validation`);
  try {
    await phaseOne.down(queryRunner);
    const phaseOneDown = await inspectPhaseOneCfdiDownState(manager);
    assertAllTrue(phaseOneDown, 'migration 070 down state');

    await runtimeCompatibility.down(queryRunner);
    const runtimeCompatibilityDown =
      await inspectRuntimeCompatibilityDownState(manager);
    assertAllTrue(runtimeCompatibilityDown, 'migration 063 down state');

    await retryBudget.down(queryRunner);
    const retryBudgetDown = await inspectRetryBudgetDownState(manager);
    assertAllTrue(retryBudgetDown, 'migration 062 down state');

    await rls.down(queryRunner);
    const rlsDown = await inspectRlsDownState(manager);
    assertAllTrue(rlsDown, 'migration 061 down state');

    await foundation.down(queryRunner);
    const foundationDown = await inspectFoundationDownState(manager);
    assertAllTrue(foundationDown, 'migration 060 down state');

    await foundation.up(queryRunner);
    await rls.up(queryRunner);
    await retryBudget.up(queryRunner);
    await runtimeCompatibility.up(queryRunner);
    await phaseOne.up(queryRunner);
    const restored = await inspectPhaseZeroState(manager);
    assertPhaseZeroState(restored);
    const restoredPhaseOne = await inspectPhaseOneCfdiState(manager);
    assertPhaseOneCfdiState(restoredPhaseOne);

    report.phaseZeroDownUp = {
      savepoint: true,
      migration070Down: phaseOneDown,
      migration063Down: runtimeCompatibilityDown,
      migration062Down: retryBudgetDown,
      migration061Down: rlsDown,
      migration060Down: foundationDown,
      reappliedInOrder: [
        foundation.name,
        rls.name,
        retryBudget.name,
        runtimeCompatibility.name,
        phaseOne.name,
      ],
      restored,
      restoredPhaseOne,
    };
  } finally {
    await manager.query(`ROLLBACK TO SAVEPOINT phase_zero_down_up_validation`);
    await manager.query(`RELEASE SAVEPOINT phase_zero_down_up_validation`);
  }
}

async function validatePhaseZeroSchema(
  manager: EntityManager,
  report: Record<string, unknown>,
): Promise<void> {
  const state = await inspectPhaseZeroState(manager);
  assertPhaseZeroState(state);

  const [migrationShape] = await manager.query(`
    SELECT
      (SELECT count(*)::integer
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ingestion_jobs'
          AND column_name IN (
            'organization_id', 'client_account_id', 'legal_entity_id',
            'idempotency_key', 'request_fingerprint', 'worker_id', 'locked_by',
            'lease_expires_at', 'heartbeat_at', 'attempt_count',
            'next_attempt_at', 'cancel_requested_at', 'started_at',
            'completed_at', 'last_error_code', 'correlation_id', 'version',
            'created_at', 'updated_at', 'counters_reconciled_at',
            'automatic_retry_count'
          )) = 21 AS durable_job_columns,
      (SELECT count(*) = 11
                AND bool_and(
                  cardinality(conkey) >= 2
                  AND cardinality(conkey) = cardinality(confkey)
                  AND pg_get_constraintdef(oid) ~
                    '^FOREIGN KEY \\(organization_id,.*REFERENCES .+\\(organization_id,'
                )
         FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND conrelid IN (
            'public.stored_objects'::regclass,
            'public.ingestion_uploads'::regclass,
            'public.ingestion_jobs'::regclass,
            'public.ingestion_items'::regclass
          )
          AND contype = 'f') AS composite_foreign_keys,
      (SELECT count(*)::integer
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN (
            'stored_objects', 'ingestion_uploads',
            'ingestion_jobs', 'ingestion_items'
          )) >= 22 AS foundation_indexes,
      (SELECT position('processing' IN pg_get_expr(indexes.indpred, indexes.indrelid)) > 0
              AND position('cancel_requested' IN pg_get_expr(indexes.indpred, indexes.indrelid)) > 0
         FROM pg_index AS indexes
        WHERE indexes.indexrelid =
          'public.ix_ingestion_jobs_active_tenant'::regclass)
        AS active_tenant_index_covers_cancellation,
      to_regclass('public.ix_ingestion_jobs_counter_reconcile') IS NOT NULL
        AS counter_reconcile_index,
      to_regclass('public.ix_ingestion_items_job_updated') IS NOT NULL
        AS counter_item_updated_index,
      to_regprocedure('public.mark_ingestion_job_counters_dirty()') IS NOT NULL
        AS counter_dirty_trigger_function,
      (SELECT count(*) = 1
         FROM pg_trigger
        WHERE tgrelid = 'public.ingestion_items'::regclass
          AND tgname = 'trg_ingestion_items_mark_counters_dirty'
          AND NOT tgisinternal) AS counter_dirty_trigger
  `);
  assertAllTrue(migrationShape, 'Phase 0 migration shape');
  report.phaseZeroSchema = { ...state, ...migrationShape };
}

const PHASE_ONE_CFDI_TABLES = [
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
  'cfdi_access_grants',
] as const;

async function validatePhaseOneCfdiSchema(
  manager: EntityManager,
  report: Record<string, unknown>,
): Promise<void> {
  const state = await inspectPhaseOneCfdiState(manager);
  assertPhaseOneCfdiState(state);
  report.phaseOneCfdiSchema = state;
}

async function inspectPhaseOneCfdiState(
  manager: EntityManager,
): Promise<Record<string, unknown>> {
  const [state] = await manager.query(
    `SELECT
       (SELECT count(*)::integer
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])) AS domainTables,
       (SELECT count(*)::integer
          FROM pg_class
         WHERE relnamespace = 'public'::regnamespace
           AND relname = ANY($1::text[])
           AND relrowsecurity
           AND relforcerowsecurity) AS forcedRlsTables,
       (SELECT count(*)::integer
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1::text[])) AS tenantPolicies,
       (SELECT count(*)::integer
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'ingestion_items'
           AND column_name IN (
             'cfdi_id', 'parser_version', 'schema_version',
             'parsed_cfdi_version', 'normalized_uuid', 'issuer_rfc',
             'receiver_rfc', 'document_type', 'parser_completed_at'
           )) AS ingestionProvenanceColumns,
       EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.cfdis'::regclass
           AND conname = 'uq_cfdis_legal_entity_uuid'
           AND contype = 'u'
       ) AS logicalIdentityUnique,
       COALESCE((
         SELECT bool_and(
           cardinality(conkey) >= 2
           AND pg_get_constraintdef(oid) ~ '^FOREIGN KEY \\(organization_id,'
         )
         FROM pg_constraint
         WHERE connamespace = 'public'::regnamespace
           AND conrelid = ANY(
             SELECT format('public.%I', relation_name)::regclass
             FROM unnest($1::text[]) AS relation(relation_name)
           )
           AND contype = 'f'
       ), false) AS allForeignKeysCarryScope,
       NOT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
           AND (
             data_type IN ('real', 'double precision', 'json', 'jsonb')
             OR column_name ~ 'xml'
           )
       ) AS exactModeledDomain,
       NOT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
           AND (
             column_name LIKE '%amount%'
             OR column_name IN (
               'exchange_rate', 'subtotal', 'discount', 'total',
               'quantity', 'unit_value', 'rate_or_quota', 'equivalence',
               'previous_balance', 'remaining_balance', 'paid_days',
               'base_salary', 'integrated_daily_salary', 'incapacity_days'
             )
           )
           AND data_type <> 'numeric'
       ) AS exactNumericColumns,
       COALESCE((
         SELECT bool_and(
           has_table_privilege('balanz_api', format('public.%I', relation_name), 'SELECT')
           AND NOT has_table_privilege('balanz_api', format('public.%I', relation_name), 'INSERT')
           AND NOT has_table_privilege('balanz_api', format('public.%I', relation_name), 'UPDATE')
           AND NOT has_table_privilege('balanz_api', format('public.%I', relation_name), 'DELETE')
         )
         FROM unnest($2::text[]) AS relation(relation_name)
       ), false) AS apiReadOnlyDomain,
       COALESCE((
         SELECT bool_and(
           has_table_privilege('balanz_worker', format('public.%I', relation_name), 'SELECT')
           AND has_table_privilege('balanz_worker', format('public.%I', relation_name), 'INSERT')
           AND NOT has_table_privilege('balanz_worker', format('public.%I', relation_name), 'UPDATE')
           AND NOT has_table_privilege('balanz_worker', format('public.%I', relation_name), 'DELETE')
         )
         FROM unnest($2::text[]) AS relation(relation_name)
       ), false) AS workerAppendOnlyDomain,
       has_table_privilege('balanz_api', 'public.cfdi_access_grants', 'SELECT')
         AND NOT has_table_privilege('balanz_api', 'public.cfdi_access_grants', 'INSERT')
         AND NOT has_table_privilege('balanz_api', 'public.cfdi_access_grants', 'UPDATE')
         AND NOT has_table_privilege('balanz_api', 'public.cfdi_access_grants', 'DELETE')
         AND has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'id', 'INSERT')
         AND has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'expires_at', 'INSERT')
         AND NOT has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'created_at', 'INSERT')
         AND has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'used_at', 'UPDATE')
         AND NOT has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'token_hash', 'UPDATE')
         AS accessGrantLeastPrivilege,
       (SELECT tableowner = 'balanz_fiscal_owner'
          FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'cfdis')
         AS constrainedOwner,
       NOT has_schema_privilege('balanz_fiscal_owner', 'public', 'CREATE')
         AS ownerCannotCreate
    `,
    [
      [...PHASE_ONE_CFDI_TABLES],
      PHASE_ONE_CFDI_TABLES.filter((table) => table !== 'cfdi_access_grants'),
    ],
  );
  return state;
}

function assertPhaseOneCfdiState(state: Record<string, unknown>): void {
  assertEqual(state.domaintables, 14, 'Phase 1 CFDI table count');
  assertEqual(state.forcedrlstables, 14, 'Phase 1 FORCE RLS table count');
  assertEqual(state.tenantpolicies, 27, 'Phase 1 RLS policy count');
  assertEqual(
    state.ingestionprovenancecolumns,
    9,
    'ingestion provenance columns',
  );
  assertEqual(
    state.logicalidentityunique,
    true,
    'CFDI logical identity unique',
  );
  assertEqual(
    state.allforeignkeyscarryscope,
    true,
    'Phase 1 composite scope FKs',
  );
  assertEqual(
    state.exactmodeleddomain,
    true,
    'modeled domain has no float/JSON/XML',
  );
  assertEqual(state.exactnumericcolumns, true, 'exact numeric fiscal values');
  assertEqual(
    state.apireadonlydomain,
    true,
    'API read-only CFDI domain grants',
  );
  assertEqual(
    state.workerappendonlydomain,
    true,
    'worker append-only CFDI grants',
  );
  assertEqual(state.accessgrantleastprivilege, true, 'access grant ACL');
  assertEqual(state.constrainedowner, true, 'CFDI constrained table owner');
  assertEqual(state.ownercannotcreate, true, 'CFDI owner CREATE privilege');
}

async function validateCounterReconciliationPlan(
  manager: EntityManager,
  report: Record<string, unknown>,
): Promise<void> {
  await manager.query(`SET LOCAL enable_seqscan = off`);
  try {
    const plan = await manager.query(`
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
    `);
    const serialized = JSON.stringify(plan);
    if (
      !serialized.includes('ix_ingestion_jobs_counter_reconcile') ||
      !serialized.includes('ix_ingestion_items_job_updated')
    ) {
      throw new Error(
        'Bounded counter reconciliation plan did not use both foundation indexes',
      );
    }
    report.counterReconciliationExplain = {
      boundedJobs: 100,
      jobIndex: 'ix_ingestion_jobs_counter_reconcile',
      itemIndex: 'ix_ingestion_items_job_updated',
      status: 'PASSED',
    };
  } finally {
    await manager.query(`SET LOCAL enable_seqscan = on`);
  }
}

async function validateSeedsTwice(
  manager: EntityManager,
  report: Record<string, unknown>,
): Promise<void> {
  const transactionBoundDataSource = {
    transaction: async <T>(work: (seedManager: EntityManager) => Promise<T>) =>
      work(manager),
  } as DataSource;

  await seedDatabase(transactionBoundDataSource);
  const first = await inspectSeedState(manager);
  assertSeedState(first);
  await seedDatabase(transactionBoundDataSource);
  const second = await inspectSeedState(manager);
  assertSeedState(second);
  assertDeepEqual(second, first, 'second seed run must be idempotent');
  report.seeds = { firstRun: first, secondRun: second, idempotent: true };
}

async function validateCompositeForeignKeyRejection(
  manager: EntityManager,
  report: Record<string, unknown>,
): Promise<void> {
  const userId = randomUUID();
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const clientAccountId = randomUUID();
  const legalEntityId = randomUUID();
  const validObjectId = randomUUID();
  const invalidObjectId = randomUUID();

  await manager.query(
    `INSERT INTO users (
       id, first_name, last_name, email, password_hash, status
     ) VALUES ($1, 'Migration', 'QA', $2, $3, 'active')`,
    [userId, `migration-${userId}@example.test`, 'qa-not-a-real-password'],
  );
  await manager.query(
    `INSERT INTO organizations (
       id, name, slug, owner_user_id, status
     ) VALUES
       ($1, 'Migration QA A', $3, $5, 'active'),
       ($2, 'Migration QA B', $4, $5, 'active')`,
    [
      organizationA,
      organizationB,
      `migration-qa-a-${organizationA}`,
      `migration-qa-b-${organizationB}`,
      userId,
    ],
  );
  await manager.query(
    `INSERT INTO client_accounts (id, organization_id, name, code)
     VALUES ($1, $2, 'Migration QA Account', $3)`,
    [clientAccountId, organizationA, `QA-${clientAccountId}`],
  );
  await manager.query(
    `INSERT INTO legal_entities (
       id, organization_id, client_account_id, rfc, legal_name
     ) VALUES ($1, $2, $3, 'QAQ010101AAA', 'Migration QA Entity')`,
    [legalEntityId, organizationA, clientAccountId],
  );
  await manager.query(
    `INSERT INTO stored_objects (
       id, organization_id, client_account_id, legal_entity_id,
       kind, storage_provider, storage_container, object_key,
       encryption_class
     ) VALUES ($1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,'fiscal')`,
    [
      validObjectId,
      organizationA,
      clientAccountId,
      legalEntityId,
      randomUUID(),
    ],
  );

  await manager.query(`SAVEPOINT composite_fk_negative_insert`);
  let sqlState: string | undefined;
  try {
    await manager.query(
      `INSERT INTO stored_objects (
         id, organization_id, client_account_id, legal_entity_id,
         kind, storage_provider, storage_container, object_key,
         encryption_class
       ) VALUES ($1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,'fiscal')`,
      [
        invalidObjectId,
        organizationB,
        clientAccountId,
        legalEntityId,
        randomUUID(),
      ],
    );
  } catch (error) {
    sqlState = postgresCode(error);
  } finally {
    await manager.query(`ROLLBACK TO SAVEPOINT composite_fk_negative_insert`);
    await manager.query(`RELEASE SAVEPOINT composite_fk_negative_insert`);
  }
  assertEqual(sqlState, '23503', 'cross-tenant composite FK SQLSTATE');
  report.compositeForeignKeys = {
    catalogDefinitionValidated: true,
    sameScopeInsertAccepted: true,
    crossScopeInsertRejected: true,
    sqlState,
  };
}

async function inspectPhaseZeroState(
  manager: EntityManager,
): Promise<Record<string, unknown>> {
  const [state] = await manager.query(`
    SELECT
      (SELECT count(*)::integer
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'stored_objects', 'ingestion_uploads',
            'ingestion_jobs', 'ingestion_items'
          )) AS foundationTables,
      (SELECT count(*)::integer
         FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname IN (
            'stored_objects', 'ingestion_uploads',
            'ingestion_jobs', 'ingestion_items'
          )
          AND relrowsecurity
          AND relforcerowsecurity) AS forcedRlsTables,
      (SELECT count(*)::integer
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
            'stored_objects', 'ingestion_uploads',
            'ingestion_jobs', 'ingestion_items'
          )) AS tenantPolicies,
      to_regprocedure(
        'public.claim_ingestion_job(text,text,text[],integer,integer,integer,integer)'
      ) IS NOT NULL AS claimFunction,
      to_regprocedure(
        'public.ingestion_queue_ages(text[],integer,integer)'
      ) IS NOT NULL AS queueAgeFunction,
      to_regprocedure(
        'public.request_ingestion_job_cancellation(uuid)'
      ) IS NOT NULL AS cancellationFunction,
      to_regprocedure(
        'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer,integer)'
      ) IS NOT NULL AS reconcileFunction,
      has_function_privilege(
        'balanz_worker',
        'public.claim_ingestion_job(text,text,text[],integer,integer,integer,integer)',
        'EXECUTE'
      ) AS workerCanExecuteRetryClaim,
      NOT has_function_privilege(
        'balanz_worker',
        'public.claim_ingestion_job(text,text,text[],integer,integer,integer)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'balanz_worker',
        'public.ingestion_queue_ages(text[],integer)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'balanz_worker',
        'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer)',
        'EXECUTE'
      ) AS workerCannotExecuteLegacyFunctions,
      COALESCE((
        SELECT bool_and(
          has_table_privilege('balanz_api', format('public.%I', relation_name), 'SELECT') = can_select
          AND has_table_privilege('balanz_api', format('public.%I', relation_name), 'INSERT') = can_insert
          AND has_table_privilege('balanz_api', format('public.%I', relation_name), 'UPDATE') = can_update
          AND has_table_privilege('balanz_api', format('public.%I', relation_name), 'DELETE') = can_delete
        )
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
      ), false)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_class AS sequence
        INNER JOIN pg_namespace AS namespace
          ON namespace.oid = sequence.relnamespace
        WHERE namespace.nspname = 'public'
          AND sequence.relkind = 'S'
          AND (
            has_sequence_privilege('balanz_api', sequence.oid, 'USAGE')
            OR has_sequence_privilege('balanz_api', sequence.oid, 'SELECT')
            OR has_sequence_privilege('balanz_api', sequence.oid, 'UPDATE')
          )
      ) AS apiHasLeastPrivileges,
      NOT EXISTS (
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
      ) AS ownerMembershipsIsolated,
      NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'balanz_fiscal_owner',
          'balanz_fiscal_cancel_owner',
          'balanz_fiscal_claim_owner',
          'balanz_fiscal_reconcile_owner'
        ]) AS fixed_owner(role_name)
        WHERE has_schema_privilege(fixed_owner.role_name, 'public', 'CREATE')
      ) AS ownersCannotCreateInPublic
  `);
  return state;
}

function assertPhaseZeroState(state: Record<string, unknown>): void {
  assertEqual(state.foundationtables, 4, 'foundation table count');
  assertEqual(state.forcedrlstables, 4, 'FORCE RLS table count');
  assertEqual(state.tenantpolicies, 9, 'RLS policy count');
  assertEqual(state.claimfunction, true, 'claim function');
  assertEqual(state.queueagefunction, true, 'queue age function');
  assertEqual(state.cancellationfunction, true, 'cancellation function');
  assertEqual(state.reconcilefunction, true, 'reconcile function');
  assertEqual(
    state.workercanexecuteretryclaim,
    true,
    'worker retry-budget claim privilege',
  );
  assertEqual(
    state.workercannotexecutelegacyfunctions,
    true,
    'legacy worker function privileges revoked',
  );
  assertEqual(
    state.apihasleastprivileges,
    true,
    'API least-privilege application ACL',
  );
  assertEqual(
    state.ownermembershipsisolated,
    true,
    'fixed owner role memberships',
  );
  assertEqual(
    state.ownerscannotcreateinpublic,
    true,
    'fixed owner CREATE privilege',
  );
}

async function validateFiscalOwnerMembershipRejection(
  manager: EntityManager,
  report: Record<string, unknown>,
): Promise<void> {
  const queryRunner = manager.queryRunner;
  if (!queryRunner?.isTransactionActive) {
    throw new Error(
      'Fiscal owner membership QA requires an active transaction',
    );
  }
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const cases = [
    {
      label: 'owner_inherits_parent',
      role: `qa_fiscal_parent_${suffix}`,
      grant: (role: string) => `GRANT ${role} TO balanz_fiscal_claim_owner`,
      expected: 'fixed fiscal roles must not inherit any parent role',
    },
    {
      label: 'owner_granted_to_member',
      role: `qa_fiscal_member_${suffix}`,
      grant: (role: string) => `GRANT balanz_fiscal_claim_owner TO ${role}`,
      expected: 'fixed fiscal owner roles must not be granted to any member',
    },
  ] as const;
  const results: Record<string, string> = {};

  for (const fixture of cases) {
    await manager.query(`SAVEPOINT fiscal_owner_membership_negative`);
    let rejection = '';
    try {
      await manager.query(`CREATE ROLE ${fixture.role} NOLOGIN`);
      await manager.query(fixture.grant(fixture.role));
      try {
        await new FiscalRlsWorkerClaims1787690610000().up(queryRunner);
      } catch (error) {
        rejection = errorMessage(error);
      }
    } finally {
      await manager.query(
        `ROLLBACK TO SAVEPOINT fiscal_owner_membership_negative`,
      );
      await manager.query(`RELEASE SAVEPOINT fiscal_owner_membership_negative`);
    }
    if (!rejection.includes(fixture.expected)) {
      throw new Error(
        `${fixture.label}: migration did not reject unsafe owner membership (${rejection})`,
      );
    }
    results[fixture.label] = 'REJECTED';
  }

  report.fiscalOwnerMembershipNegativeFixtures = results;
}

async function inspectRlsDownState(
  manager: EntityManager,
): Promise<Record<string, boolean>> {
  const [state] = await manager.query(`
    SELECT
      to_regprocedure(
        'public.claim_ingestion_job(text,text,text[],integer,integer,integer)'
      ) IS NULL AS claim_removed,
      to_regprocedure(
        'public.ingestion_queue_ages(text[],integer)'
      ) IS NULL AS queue_age_removed,
      to_regprocedure(
        'public.request_ingestion_job_cancellation(uuid)'
      ) IS NULL AS cancellation_removed,
      to_regprocedure(
        'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer)'
      ) IS NULL AS reconcile_removed,
      (SELECT count(*)::integer
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
            'stored_objects', 'ingestion_uploads',
            'ingestion_jobs', 'ingestion_items'
          )) = 0 AS policies_removed,
      (SELECT count(*)::integer
         FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname IN (
            'stored_objects', 'ingestion_uploads',
            'ingestion_jobs', 'ingestion_items'
          )
          AND (relrowsecurity OR relforcerowsecurity)) = 0 AS rls_disabled,
      (SELECT count(*)::integer
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'stored_objects', 'ingestion_uploads',
            'ingestion_jobs', 'ingestion_items'
          )) = 4 AS foundation_preserved
  `);
  return state;
}

async function inspectPhaseOneCfdiDownState(
  manager: EntityManager,
): Promise<Record<string, boolean>> {
  const [state] = await manager.query(
    `SELECT
       (SELECT count(*)::integer
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])) = 0 AS domain_tables_removed,
       (SELECT count(*)::integer
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'ingestion_items'
           AND column_name IN (
             'cfdi_id', 'parser_version', 'schema_version',
             'parsed_cfdi_version', 'normalized_uuid', 'issuer_rfc',
             'receiver_rfc', 'document_type', 'parser_completed_at'
           )) = 0 AS provenance_columns_removed,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.periods'::regclass
           AND conname = 'uq_periods_scope_id'
       ) AS period_scope_key_removed,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.auth_sessions'::regclass
           AND conname = 'uq_auth_sessions_scope_membership_id'
       ) AS session_scope_key_removed
    `,
    [[...PHASE_ONE_CFDI_TABLES]],
  );
  return state;
}

async function inspectRetryBudgetDownState(
  manager: EntityManager,
): Promise<Record<string, boolean>> {
  const [state] = await manager.query(`
    SELECT
      to_regprocedure(
        'public.claim_ingestion_job(text,text,text[],integer,integer,integer,integer)'
      ) IS NULL AS retry_claim_removed,
      to_regprocedure(
        'public.ingestion_queue_ages(text[],integer,integer)'
      ) IS NULL AS retry_queue_age_removed,
      to_regprocedure(
        'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer,integer)'
      ) IS NULL AS retry_reconcile_removed,
      to_regprocedure(
        'public.claim_ingestion_job(text,text,text[],integer,integer,integer)'
      ) IS NOT NULL AS prior_claim_preserved,
      to_regprocedure(
        'public.ingestion_queue_ages(text[],integer)'
      ) IS NOT NULL AS prior_queue_age_preserved,
      to_regprocedure(
        'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer)'
      ) IS NOT NULL AS prior_reconcile_preserved,
      NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ingestion_jobs'
          AND column_name = 'automatic_retry_count'
      ) AS retry_column_removed,
      has_function_privilege(
        'balanz_worker',
        'public.claim_ingestion_job(text,text,text[],integer,integer,integer)',
        'EXECUTE'
      ) AS prior_worker_claim_restored,
      has_function_privilege(
        'balanz_worker',
        'public.ingestion_queue_ages(text[],integer)',
        'EXECUTE'
      ) AS prior_worker_queue_age_restored,
      has_function_privilege(
        'balanz_worker',
        'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer)',
        'EXECUTE'
      ) AS prior_worker_reconcile_restored
  `);
  return state;
}

async function inspectRuntimeCompatibilityDownState(
  manager: EntityManager,
): Promise<Record<string, boolean>> {
  const [state] = await manager.query(`
    SELECT
      NOT has_function_privilege(
        'balanz_worker',
        'public.claim_ingestion_job(text,text,text[],integer,integer,integer)',
        'EXECUTE'
      ) AS legacy_claim_revoked,
      NOT has_function_privilege(
        'balanz_worker',
        'public.ingestion_queue_ages(text[],integer)',
        'EXECUTE'
      ) AS legacy_queue_age_revoked,
      NOT has_function_privilege(
        'balanz_worker',
        'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer)',
        'EXECUTE'
      ) AS legacy_reconciler_revoked,
      COALESCE((
        SELECT bool_and(
          NOT has_table_privilege(
            'balanz_api',
            format('public.%I', relation_name),
            'SELECT'
          )
          AND NOT has_table_privilege(
            'balanz_api',
            format('public.%I', relation_name),
            'INSERT'
          )
          AND NOT has_table_privilege(
            'balanz_api',
            format('public.%I', relation_name),
            'UPDATE'
          )
          AND NOT has_table_privilege(
            'balanz_api',
            format('public.%I', relation_name),
            'DELETE'
          )
        )
        FROM unnest(ARRAY[
          'password_reset_tokens',
          'membership_permissions',
          'fiscal_operations',
          'object_access_grants',
          'private_objects'
        ]) AS relation(relation_name)
      ), false) AS new_application_table_acl_revoked,
      COALESCE((
        SELECT bool_and(
          has_table_privilege('balanz_api', format('public.%I', relation_name), 'SELECT')
          AND has_table_privilege('balanz_api', format('public.%I', relation_name), 'INSERT')
          AND has_table_privilege('balanz_api', format('public.%I', relation_name), 'UPDATE')
          AND has_table_privilege('balanz_api', format('public.%I', relation_name), 'DELETE')
        )
        FROM unnest(ARRAY[
          'auth_factors',
          'auth_rate_limits',
          'email_verification_tokens',
          'roles',
          'memberships',
          'organizations',
          'permissions',
          'role_permissions',
          'auth_sessions',
          'subscriptions',
          'users',
          'client_accounts',
          'legal_entities',
          'account_assignments',
          'fiscal_years',
          'periods'
        ]) AS relation(relation_name)
      ), false) AS prior_application_table_acl_restored,
      NOT EXISTS (
        SELECT 1
        FROM pg_class AS sequence
        INNER JOIN pg_namespace AS namespace
          ON namespace.oid = sequence.relnamespace
        WHERE namespace.nspname = 'public'
          AND sequence.relkind = 'S'
          AND NOT (
            has_sequence_privilege('balanz_api', sequence.oid, 'USAGE')
            AND has_sequence_privilege('balanz_api', sequence.oid, 'SELECT')
          )
      ) AS prior_sequence_acl_restored
  `);
  return state;
}

async function inspectFoundationDownState(
  manager: EntityManager,
): Promise<Record<string, boolean>> {
  const [state] = await manager.query(`
    SELECT
      to_regclass('public.stored_objects') IS NULL AS objects_removed,
      to_regclass('public.ingestion_uploads') IS NULL AS uploads_removed,
      to_regclass('public.ingestion_jobs') IS NULL AS jobs_removed,
      to_regclass('public.ingestion_items') IS NULL AS items_removed,
      to_regclass('public.client_accounts') IS NOT NULL AS clients_preserved,
      to_regclass('public.legal_entities') IS NOT NULL AS entities_preserved,
      to_regclass('public.users') IS NOT NULL AS identity_preserved
  `);
  return state;
}

async function inspectDatabaseSafety(
  manager: EntityManager,
): Promise<Record<string, unknown>> {
  const [state] = await manager.query(`
    SELECT
      current_database() AS database,
      current_user AS migrator,
      current_setting('transaction_read_only') AS transaction_read_only,
      current_setting('server_version_num')::integer AS server_version_num,
      role.rolsuper,
      role.rolcreaterole
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  `);
  return state;
}

async function captureBaseline(
  manager: EntityManager,
): Promise<DatabaseBaseline> {
  const migrationLogPresent = await relationExists(
    manager,
    'public.migrations',
  );
  const appliedMigrations = migrationLogPresent
    ? await manager.query(`
        SELECT id, timestamp, name
          FROM migrations
         ORDER BY id
      `)
    : [];
  const [phaseZeroRelations] = await manager.query(`
    SELECT
      to_regclass('public.stored_objects')::text AS stored_objects,
      to_regclass('public.ingestion_uploads')::text AS ingestion_uploads,
      to_regclass('public.ingestion_jobs')::text AS ingestion_jobs,
      to_regclass('public.ingestion_items')::text AS ingestion_items
  `);
  return {
    migrationLogPresent,
    appliedMigrations,
    phaseZeroRelations,
    seedState:
      (await relationExists(manager, 'public.roles')) &&
      (await relationExists(manager, 'public.permissions'))
        ? await inspectSeedState(manager)
        : null,
    roles: await inspectFiscalRoles(manager),
    memberships: await inspectFiscalRoleMemberships(manager),
  };
}

async function assertBaselineRestored(
  manager: EntityManager,
  baseline: DatabaseBaseline,
): Promise<void> {
  const restored = await captureBaseline(manager);
  assertEqual(
    restored.migrationLogPresent,
    baseline.migrationLogPresent,
    'migration log relation restoration',
  );
  assertDeepEqual(
    restored.appliedMigrations,
    baseline.appliedMigrations,
    'migration log restoration',
  );
  assertDeepEqual(
    restored.phaseZeroRelations,
    baseline.phaseZeroRelations,
    'Phase 0 relation restoration',
  );
  assertDeepEqual(restored.seedState, baseline.seedState, 'seed restoration');
  assertDeepEqual(restored.roles, baseline.roles, 'fiscal role restoration');
  assertDeepEqual(
    restored.memberships,
    baseline.memberships,
    'fiscal role membership restoration',
  );
}

async function inspectSeedState(manager: EntityManager): Promise<SeedState> {
  const roleKeys = ROLE_DEFINITIONS.map((role) => role.key);
  const [state] = await manager.query(
    `SELECT
       (SELECT count(*)::integer FROM roles WHERE key = ANY($1::text[]))
         AS roles,
       (SELECT count(DISTINCT key)::integer
          FROM roles WHERE key = ANY($1::text[])) AS "distinctRoles",
       (SELECT count(*)::integer
          FROM permissions WHERE key = ANY($2::text[])) AS permissions,
       (SELECT count(DISTINCT key)::integer
          FROM permissions WHERE key = ANY($2::text[])) AS "distinctPermissions",
       (SELECT count(*)::integer
          FROM role_permissions AS rp
          INNER JOIN roles AS role ON role.id = rp.role_id
         WHERE role.key = ANY($1::text[])) AS "rolePermissions"`,
    [roleKeys, [...PERMISSION_CATALOG]],
  );
  return {
    roles: Number(state.roles),
    distinctRoles: Number(state.distinctRoles),
    permissions: Number(state.permissions),
    distinctPermissions: Number(state.distinctPermissions),
    rolePermissions: Number(state.rolePermissions),
  };
}

function assertSeedState(state: SeedState): void {
  const expectedRolePermissions = Object.values(ROLE_PERMISSION_KEYS).reduce(
    (total, permissions) => total + permissions.length,
    0,
  );
  assertEqual(state.roles, ROLE_DEFINITIONS.length, 'seed role count');
  assertEqual(
    state.distinctRoles,
    ROLE_DEFINITIONS.length,
    'distinct seed role count',
  );
  assertEqual(
    state.permissions,
    PERMISSION_CATALOG.length,
    'seed permission count',
  );
  assertEqual(
    state.distinctPermissions,
    PERMISSION_CATALOG.length,
    'distinct seed permission count',
  );
  assertEqual(
    state.rolePermissions,
    expectedRolePermissions,
    'seed role-permission count',
  );
}

async function inspectFiscalRoles(
  manager: EntityManager,
): Promise<RoleStateRow[]> {
  return await manager.query(
    `SELECT
       rolname AS name,
       rolcanlogin AS "canLogin",
       rolbypassrls AS "bypassRls",
       rolsuper AS superuser
     FROM pg_roles
     WHERE rolname = ANY($1::text[])
     ORDER BY rolname`,
    [[...FISCAL_ROLES]],
  );
}

async function inspectFiscalRoleMemberships(
  manager: EntityManager,
): Promise<MembershipRow[]> {
  return await manager.query(
    `SELECT
       granted.rolname AS "grantedRole",
       member.rolname AS "memberRole"
     FROM pg_auth_members AS membership
     INNER JOIN pg_roles AS granted ON granted.oid = membership.roleid
     INNER JOIN pg_roles AS member ON member.oid = membership.member
     WHERE granted.rolname = ANY($1::text[])
        OR member.rolname = ANY($1::text[])
     ORDER BY granted.rolname, member.rolname`,
    [[...FISCAL_ROLES]],
  );
}

async function relationExists(
  manager: EntityManager,
  relation: string,
): Promise<boolean> {
  const [row] = await manager.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [relation],
  );
  return row.present;
}

function findMigration(
  dataSource: DataSource,
  name: string,
): MigrationInterface & { name: string } {
  const migration = dataSource.migrations.find(
    (candidate) => candidate.name === name,
  );
  if (!migration?.name) {
    throw new Error(`Configured migration not found: ${name}`);
  }
  return migration as MigrationInterface & { name: string };
}

function validateMigrationManifest(configuredNames: string[]): void {
  const configuredUnique = new Set(configuredNames);
  if (configuredUnique.size !== configuredNames.length) {
    throw new Error('Configured migration names must be unique');
  }
  assertDeepEqual(
    configuredNames,
    [...EXPECTED_MIGRATIONS],
    'configured migration manifest and tie-break order',
  );

  const namesByTimestamp = new Map<number, Set<string>>();
  for (const name of EXPECTED_MIGRATIONS) {
    const timestamp = migrationTimestamp(name);
    const names = namesByTimestamp.get(timestamp) ?? new Set<string>();
    names.add(name);
    namesByTimestamp.set(timestamp, names);
  }
  for (const [timestamp, names] of namesByTimestamp) {
    if (names.size === 1) continue;
    const allowed = ALLOWED_SHARED_MIGRATION_TIMESTAMPS.get(timestamp);
    if (!allowed || !sameStringSet(names, allowed)) {
      throw new Error(
        `Unapproved migration timestamp collision at ${timestamp}: ${JSON.stringify([...names])}`,
      );
    }
  }
  for (const [timestamp, allowed] of ALLOWED_SHARED_MIGRATION_TIMESTAMPS) {
    const actual = namesByTimestamp.get(timestamp);
    if (!actual || !sameStringSet(actual, allowed)) {
      throw new Error(
        `Stale shared migration timestamp allowlist at ${timestamp}`,
      );
    }
  }
}

function validateAppliedMigrationLedger(
  rows: AppliedMigrationRow[],
  requireComplete = false,
): void {
  const expected = new Set<string>(EXPECTED_MIGRATIONS);
  const seen = new Set<string>();
  const unknown: AppliedMigrationRow[] = [];

  for (const row of rows) {
    if (seen.has(row.name)) {
      throw new Error(`Duplicate migration ledger name: ${row.name}`);
    }
    seen.add(row.name);
    if (!expected.has(row.name)) {
      unknown.push(row);
      continue;
    }
    const expectedTimestamp = migrationTimestamp(row.name);
    if (String(row.timestamp) !== String(expectedTimestamp)) {
      throw new Error(
        `Migration ledger identity mismatch for ${row.name}: expected ${expectedTimestamp}, received ${String(row.timestamp)}`,
      );
    }
  }

  if (unknown.length > 0) {
    throw new Error(`Unknown executed migrations: ${JSON.stringify(unknown)}`);
  }
  if (requireComplete) {
    const missing = EXPECTED_MIGRATIONS.filter((name) => !seen.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Missing expected migrations: ${JSON.stringify(missing)}`,
      );
    }
  }
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function migrationTimestamp(name: string): number {
  const match = name.match(/(\d+)$/);
  if (!match) throw new Error(`Migration name has no timestamp: ${name}`);
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp)) {
    throw new Error(`Migration timestamp is not a safe integer: ${name}`);
  }
  return timestamp;
}

function isExplicitTestDatabase(database: string): boolean {
  const normalized = database.toLowerCase();
  return normalized.startsWith('test_') || normalized.endsWith('_test');
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSafeEnvironment(): void {
  if (
    !['development', 'test'].includes(process.env.NODE_ENV ?? 'development')
  ) {
    throw new Error('Migration lifecycle QA is restricted to development/test');
  }
  if (
    process.env.SECRETS_ENABLED === 'true' &&
    (process.env.SECRETS_ENVIRONMENT || 'dev') !== 'dev'
  ) {
    throw new Error('Migration lifecycle QA requires the dev secrets scope');
  }
}

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${label}: expected ${expectedJson}, received ${actualJson}`,
    );
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

function assertAllTrue(values: Record<string, boolean>, label: string): void {
  const failures = Object.entries(values)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (failures.length > 0) {
    throw new Error(`${label} failed: ${failures.join(', ')}`);
  }
}

void validateMigrationLifecycle().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
