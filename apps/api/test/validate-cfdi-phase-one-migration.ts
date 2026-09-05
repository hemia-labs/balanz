/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import { PhaseOneCfdiDomain1787690700000 } from '../src/database/migrations/1787690700000-PhaseOneCfdiDomain';
import { CfdiUsageCodeLength1787690710000 } from '../src/database/migrations/1787690710000-CfdiUsageCodeLength';
import {
  WORKER_MEMBERSHIP_CONTEXT_ID,
  type FiscalTenantTransactionService,
} from '../src/database/rls/fiscal-tenant-transaction.service';
import { resolveScriptDatabaseOptions } from '../src/database/scripts/script-database-options';
import {
  CFDI_PARSER_VERSION,
  CFDI_SCHEMA_SET_VERSION,
  type CfdiParseResult,
  type ParsedCfdi,
} from '../src/modules/cfdi-parser';
import {
  CfdiWorkerPersistenceService,
  type WorkerInput,
} from '../src/modules/cfdi/workers/cfdi-worker-persistence.service';
import type { ClaimResult } from '../src/modules/ingestion/services/ingestion-job.repository';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const TABLES = [
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

interface PersistenceScope {
  userId: string;
  organizationId: string;
  clientAccountId: string;
  legalEntityId: string;
  membershipId: string;
  legalEntityRfc: string;
}

interface PersistenceFixture {
  claim: ClaimResult;
  input: WorkerInput;
}

async function validate(): Promise<void> {
  const options = await resolveScriptDatabaseOptions();
  if (options.type !== 'postgres') {
    throw new Error('Phase 1 migration QA requires PostgreSQL');
  }
  const database = String(options.database ?? '').toLowerCase();
  if (!database.startsWith('test_') && !database.endsWith('_test')) {
    throw new Error(
      'Phase 1 migration QA is restricted to an isolated test database',
    );
  }

  const dataSource = new DataSource({ ...options, logging: false });
  const queryRunner = dataSource.createQueryRunner();
  try {
    await dataSource.initialize();
    await queryRunner.connect();
    const before = await inspectUpState(queryRunner.manager);
    assertUpState(before);
    const schemaLog = await dataSource.driver.createSchemaBuilder().log();
    if (
      schemaLog.upQueries.length !== 0 ||
      schemaLog.downQueries.length !== 0
    ) {
      throw new Error(
        `Phase 1 entity/schema drift detected: ${JSON.stringify(
          schemaLog.upQueries.map(({ query }) => query),
        )}`,
      );
    }

    await queryRunner.startTransaction();
    const migration = new PhaseOneCfdiDomain1787690700000();
    const usageCodeLength = new CfdiUsageCodeLength1787690710000();
    await usageCodeLength.down(queryRunner);
    await migration.down(queryRunner);
    const down = await inspectDownState(queryRunner.manager);
    assertTrueValues(down, 'Phase 1 down');

    await migration.up(queryRunner);
    await usageCodeLength.up(queryRunner);
    const restored = await inspectUpState(queryRunner.manager);
    assertUpState(restored);
    const workerPersistence = await validateWorkerPersistence(queryRunner);
    await queryRunner.rollbackTransaction();

    console.log(
      JSON.stringify(
        {
          mode: 'ISOLATED_TRANSACTIONAL_PHASE_ONE_SCHEMA',
          before,
          entitySchemaDrift: { upQueries: 0, downQueries: 0 },
          down,
          restored,
          workerPersistence,
          outerTransactionRolledBack: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (queryRunner.isTransactionActive)
      await queryRunner.rollbackTransaction();
    if (!queryRunner.isReleased) await queryRunner.release();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

async function validateWorkerPersistence(
  queryRunner: QueryRunner,
): Promise<Record<string, unknown>> {
  const suffix = randomBytes(6).toString('hex');
  const scope = await createPersistenceScope(
    queryRunner,
    suffix,
    'a',
    'QAA010101AA1',
  );
  const tenantB = await createPersistenceScope(
    queryRunner,
    suffix,
    'b',
    'QAB010101BB2',
  );
  await queryRunner.query(`
    DO $$
    BEGIN
      EXECUTE format('GRANT balanz_worker TO %I', current_user);
      EXECUTE format('GRANT balanz_api TO %I', current_user);
    END $$
  `);
  const transactions = createSavepointWorkerTransactions(queryRunner);
  const service = new CfdiWorkerPersistenceService(
    transactions,
    new ConfigService({
      fiscalPlatform: {
        retention: {
          duplicateBytesHours: 24,
          invalidObjectDays: 7,
          malwareQuarantineDays: 30,
        },
      },
    }),
  );

  const primaryUuid = randomUUID();
  const auditCanary =
    '<Comprobante SYNTHETIC_XML_AUDIT_CANARY="must-not-leak"/>';
  const primaryDocument = paymentDocument(
    primaryUuid,
    2026,
    false,
    scope.legalEntityRfc,
  );
  primaryDocument.concepts[0].description = auditCanary;
  const incorporatedFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    'a'.repeat(64),
  );
  const incorporated = await persistenceStep('incorporated', () =>
    service.publishParsed(
      incorporatedFixture.claim,
      incorporatedFixture.input,
      parsed(primaryDocument),
    ),
  );
  assertEqual(incorporated.result, 'incorporated', 'incorporated result');

  const [primaryState] = (await queryRunner.query(
    `SELECT cfdi.id,
            cfdi.usage_code,
            (SELECT count(*)::integer FROM period_cfdis participation
              WHERE participation.cfdi_id = cfdi.id) AS periods,
            (SELECT count(*)::integer FROM cfdi_relations relation
              WHERE relation.cfdi_id = cfdi.id) AS relations,
            (SELECT count(DISTINCT relation_group_ordinal)::integer
               FROM cfdi_relations relation
              WHERE relation.cfdi_id = cfdi.id) AS relation_groups,
            (SELECT count(*)::integer
               FROM cfdi_payment_documents document
              WHERE document.cfdi_id = cfdi.id) AS payment_documents,
            (SELECT max(document_count)::integer FROM (
               SELECT count(*)::integer AS document_count
                 FROM cfdi_payment_documents document
                WHERE document.cfdi_id = cfdi.id
                GROUP BY document.payment_id
             ) grouped) AS max_documents_per_payment
       FROM cfdis cfdi
      WHERE cfdi.legal_entity_id = $1 AND cfdi.normalized_uuid = $2::uuid`,
    [scope.legalEntityId, primaryUuid],
  )) as Array<{
    id: string;
    usage_code: string | null;
    periods: number;
    relations: number;
    relation_groups: number;
    payment_documents: number;
    max_documents_per_payment: number;
  }>;
  if (!primaryState) throw new Error('Incorporated CFDI was not persisted');
  assertEqual(primaryState.usage_code, 'CP01', 'four-character UsoCFDI');
  assertEqual(primaryState.periods, 2, 'multi-period participation');
  assertEqual(primaryState.relations, 3, 'related CFDI observations');
  assertEqual(primaryState.relation_groups, 2, 'related CFDI groups');
  assertEqual(primaryState.payment_documents, 3, 'payment document rows');
  assertEqual(
    primaryState.max_documents_per_payment,
    2,
    'multiple documents in one payment',
  );
  const [auditSafety] = (await queryRunner.query(
    `SELECT
       (SELECT count(*)::integer FROM cfdi_concepts concept
         WHERE concept.cfdi_id = $1 AND concept.description = $2) AS persisted_canary,
       (SELECT count(*)::integer FROM audit_events event
         WHERE event.organization_id = $3
           AND event.correlation_id = $4) AS audit_events,
       (SELECT count(*)::integer FROM audit_events event
         WHERE event.organization_id = $3
           AND event.correlation_id = $4
           AND position($2 IN to_jsonb(event)::text) > 0) AS audit_leaks`,
    [
      primaryState.id,
      auditCanary,
      scope.organizationId,
      incorporatedFixture.claim.correlationId,
    ],
  )) as Array<{
    persisted_canary: number;
    audit_events: number;
    audit_leaks: number;
  }>;
  assertEqual(
    auditSafety?.persisted_canary,
    1,
    'audit canary persisted in domain',
  );
  assertEqual(auditSafety?.audit_events, 1, 'worker audit event count');
  assertEqual(auditSafety?.audit_leaks, 0, 'worker audit excludes XML canary');

  const duplicateFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    'a'.repeat(64),
  );
  const duplicate = await persistenceStep('duplicate', () =>
    service.publishParsed(
      duplicateFixture.claim,
      duplicateFixture.input,
      parsed(primaryDocument),
    ),
  );
  assertEqual(duplicate.result, 'duplicate', 'same-hash duplicate result');
  const [afterDuplicate] = (await queryRunner.query(
    `SELECT count(*)::integer AS cfdis,
            count(*) FILTER (WHERE product_result = 'duplicate')::integer AS duplicate_observations
       FROM ingestion_items item
       LEFT JOIN cfdis cfdi
         ON cfdi.legal_entity_id = item.legal_entity_id
        AND cfdi.normalized_uuid = item.normalized_uuid
      WHERE item.legal_entity_id = $1 AND item.normalized_uuid = $2::uuid`,
    [scope.legalEntityId, primaryUuid],
  )) as Array<{ cfdis: number; duplicate_observations: number }>;
  assertEqual(afterDuplicate?.cfdis, 2, 'duplicate provenance row join');
  assertEqual(
    afterDuplicate?.duplicate_observations,
    1,
    'duplicate observation retained',
  );
  const [cfdiCountAfterDuplicate] = (await queryRunner.query(
    `SELECT count(*)::integer AS count FROM cfdis
      WHERE legal_entity_id = $1 AND normalized_uuid = $2::uuid`,
    [scope.legalEntityId, primaryUuid],
  )) as Array<{ count: number }>;
  assertEqual(cfdiCountAfterDuplicate?.count, 1, 'duplicate CFDI identity');

  const conflictFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    'b'.repeat(64),
  );
  const conflict = await persistenceStep('hash conflict', () =>
    service.publishParsed(
      conflictFixture.claim,
      conflictFixture.input,
      parsed(primaryDocument),
    ),
  );
  assertEqual(conflict.result, 'invalid', 'UUID hash conflict result');
  const [conflictState] = (await queryRunner.query(
    `SELECT object.quarantine_reason_code,
            object.retention_until BETWEEN
              clock_timestamp() + interval '6 days 23 hours'
              AND clock_timestamp() + interval '7 days 1 minute'
              AS retention_is_seven_days,
            object.hold_until = object.retention_until AS hold_matches_retention,
            item.error_code,
            incident.severity,
            (SELECT count(*)::integer FROM cfdis
              WHERE legal_entity_id = $1 AND normalized_uuid = $2::uuid) AS cfdis
       FROM stored_objects object
       INNER JOIN ingestion_items item ON item.object_id = object.id
       INNER JOIN incidents incident ON incident.ingestion_item_id = item.id
      WHERE object.id = $3`,
    [scope.legalEntityId, primaryUuid, conflictFixture.input.objectId],
  )) as Array<{
    quarantine_reason_code: string;
    retention_is_seven_days: boolean;
    hold_matches_retention: boolean;
    error_code: string;
    severity: string;
    cfdis: number;
  }>;
  assertEqual(
    conflictState?.quarantine_reason_code,
    'CFDI_UUID_HASH_CONFLICT',
    'hash-conflict quarantine',
  );
  assertEqual(
    conflictState?.retention_is_seven_days,
    true,
    'hash-conflict seven-day retention',
  );
  assertEqual(
    conflictState?.hold_matches_retention,
    true,
    'hash-conflict hold bounded by retention',
  );
  assertEqual(
    conflictState?.error_code,
    'CFDI_UUID_HASH_CONFLICT',
    'hash-conflict item code',
  );
  assertEqual(conflictState?.severity, 'high', 'hash-conflict severity');
  assertEqual(conflictState?.cfdis, 1, 'hash-conflict original retained');

  const missingUuid = randomUUID();
  const missingDocument = paymentDocument(
    missingUuid,
    2027,
    true,
    scope.legalEntityRfc,
  );
  const missingFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    'c'.repeat(64),
  );
  const missing = await persistenceStep('missing period', () =>
    service.publishParsed(
      missingFixture.claim,
      missingFixture.input,
      parsed(missingDocument),
    ),
  );
  assertEqual(
    missing.completion,
    'completed_with_issues',
    'missing-period completion',
  );
  const [missingState] = (await queryRunner.query(
    `SELECT cfdi.id,
            (SELECT count(*)::integer FROM period_cfdis participation
              WHERE participation.cfdi_id = cfdi.id) AS periods,
            (SELECT count(*)::integer FROM incidents incident
              WHERE incident.cfdi_id = cfdi.id
                AND incident.code = 'FISCAL_PERIOD_NOT_CONFIGURED') AS incidents,
            (SELECT id FROM cfdi_payments payment
              WHERE payment.cfdi_id = cfdi.id ORDER BY ordinal LIMIT 1) AS payment_id
       FROM cfdis cfdi
      WHERE cfdi.legal_entity_id = $1 AND cfdi.normalized_uuid = $2::uuid`,
    [scope.legalEntityId, missingUuid],
  )) as Array<{
    id: string;
    periods: number;
    incidents: number;
    payment_id: string;
  }>;
  if (!missingState)
    throw new Error('Missing-period CFDI was not incorporated');
  assertEqual(missingState.periods, 0, 'missing period not synthesized');
  assertEqual(missingState.incidents, 1, 'missing period incident');

  const creditNoteUuid = randomUUID();
  const creditNoteFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    'e'.repeat(64),
  );
  const creditNote = await persistenceStep('credit note E', () =>
    service.publishParsed(
      creditNoteFixture.claim,
      creditNoteFixture.input,
      parsed(
        baseDocument(
          creditNoteUuid,
          'E',
          '2026-01-21T12:00:00',
          scope.legalEntityRfc,
        ),
      ),
    ),
  );
  assertEqual(creditNote.result, 'incorporated', 'credit note result');

  const transferUuid = randomUUID();
  const transferFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    'f'.repeat(64),
  );
  const transfer = await persistenceStep('transfer T', () =>
    service.publishParsed(
      transferFixture.claim,
      transferFixture.input,
      parsed(
        baseDocument(
          transferUuid,
          'T',
          '2026-02-08T08:00:00',
          scope.legalEntityRfc,
        ),
      ),
    ),
  );
  assertEqual(transfer.result, 'incorporated', 'transfer result');
  const [documentTypeState] = (await queryRunner.query(
    `SELECT
       (SELECT count(*)::integer FROM cfdis
         WHERE legal_entity_id = $1 AND normalized_uuid = $2::uuid
           AND document_type = 'E') AS credit_notes,
       (SELECT count(*)::integer FROM cfdis
         WHERE legal_entity_id = $1 AND normalized_uuid = $3::uuid
           AND document_type = 'T') AS transfers,
       (SELECT count(*)::integer
          FROM cfdi_concepts concept
          INNER JOIN cfdis cfdi ON cfdi.id = concept.cfdi_id
         WHERE cfdi.legal_entity_id = $1
           AND cfdi.normalized_uuid IN ($2::uuid,$3::uuid)) AS concepts,
       (SELECT count(*)::integer
          FROM period_cfdis participation
          INNER JOIN cfdis cfdi ON cfdi.id = participation.cfdi_id
         WHERE cfdi.legal_entity_id = $1
           AND cfdi.normalized_uuid IN ($2::uuid,$3::uuid)
           AND participation.participation_type = 'document_issue') AS periods`,
    [scope.legalEntityId, creditNoteUuid, transferUuid],
  )) as Array<{
    credit_notes: number;
    transfers: number;
    concepts: number;
    periods: number;
  }>;
  assertEqual(documentTypeState?.credit_notes, 1, 'credit note persisted');
  assertEqual(documentTypeState?.transfers, 1, 'transfer persisted');
  assertEqual(documentTypeState?.concepts, 2, 'E/T concepts persisted');
  assertEqual(documentTypeState?.periods, 2, 'E/T period participation');

  const payrollUuid = randomUUID();
  const payrollFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    '0'.repeat(64),
  );
  const payroll = await persistenceStep('payroll N', () =>
    service.publishParsed(
      payrollFixture.claim,
      payrollFixture.input,
      parsed(payrollDocument(payrollUuid, scope.legalEntityRfc)),
    ),
  );
  assertEqual(payroll.result, 'incorporated', 'payroll result');
  const [payrollState] = (await queryRunner.query(
    `SELECT cfdi.document_type,
            (SELECT count(*)::integer FROM cfdi_payrolls row
              WHERE row.cfdi_id = cfdi.id) AS payrolls,
            (SELECT count(*)::integer FROM cfdi_payroll_perceptions row
              INNER JOIN cfdi_payrolls payroll ON payroll.id = row.payroll_id
              WHERE payroll.cfdi_id = cfdi.id) AS perceptions,
            (SELECT count(*)::integer FROM cfdi_payroll_deductions row
              INNER JOIN cfdi_payrolls payroll ON payroll.id = row.payroll_id
              WHERE payroll.cfdi_id = cfdi.id) AS deductions,
            (SELECT count(*)::integer FROM cfdi_payroll_other_payments row
              INNER JOIN cfdi_payrolls payroll ON payroll.id = row.payroll_id
              WHERE payroll.cfdi_id = cfdi.id) AS other_payments,
            (SELECT count(*)::integer FROM cfdi_payroll_incapacities row
              INNER JOIN cfdi_payrolls payroll ON payroll.id = row.payroll_id
              WHERE payroll.cfdi_id = cfdi.id) AS incapacities,
            (SELECT count(*)::integer FROM period_cfdis participation
              WHERE participation.cfdi_id = cfdi.id
                AND participation.participation_type = 'payroll'
                AND participation.timezone = 'America/Mexico_City'
                AND EXTRACT(MONTH FROM participation.source_date
                  AT TIME ZONE participation.timezone) = 2) AS periods
       FROM cfdis cfdi
      WHERE cfdi.legal_entity_id = $1 AND cfdi.normalized_uuid = $2::uuid`,
    [scope.legalEntityId, payrollUuid],
  )) as Array<{
    document_type: string;
    payrolls: number;
    perceptions: number;
    deductions: number;
    other_payments: number;
    incapacities: number;
    periods: number;
  }>;
  assertEqual(payrollState?.document_type, 'N', 'payroll document type');
  assertEqual(payrollState?.payrolls, 1, 'payroll core row');
  assertEqual(payrollState?.perceptions, 1, 'payroll perception row');
  assertEqual(payrollState?.deductions, 1, 'payroll deduction row');
  assertEqual(payrollState?.other_payments, 1, 'payroll other payment row');
  assertEqual(payrollState?.incapacities, 1, 'payroll incapacity row');
  assertEqual(payrollState?.periods, 1, 'payroll period participation');

  const unknownComplementUuid = randomUUID();
  const unknownComplementFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    '1'.repeat(64),
  );
  const unknownComplementDocument = ingresoDocument(
    unknownComplementUuid,
    scope.legalEntityRfc,
  );
  unknownComplementDocument.unsupportedComplements = [
    {
      namespaceUri: 'urn:balanz:synthetic:unsupported-complement:1',
      localName: 'SyntheticComplement',
    },
  ];
  const unknownComplement = await persistenceStep('unknown complement', () =>
    service.publishParsed(
      unknownComplementFixture.claim,
      unknownComplementFixture.input,
      parsed(unknownComplementDocument),
    ),
  );
  assertEqual(
    unknownComplement.result,
    'incorporated',
    'unknown complement core result',
  );
  assertEqual(
    unknownComplement.completion,
    'completed_with_issues',
    'unknown complement completion',
  );
  const [unknownComplementState] = (await queryRunner.query(
    `SELECT count(*)::integer AS cfdis,
            count(*) FILTER (
              WHERE incident.code = 'COMPLEMENT_UNSUPPORTED'
            )::integer AS incidents,
            count(*) FILTER (
              WHERE item.cfdi_id = cfdi.id
                AND item.object_id = $3
            )::integer AS linked_observations
       FROM cfdis cfdi
       LEFT JOIN incidents incident ON incident.cfdi_id = cfdi.id
       LEFT JOIN ingestion_items item ON item.cfdi_id = cfdi.id
      WHERE cfdi.legal_entity_id = $1 AND cfdi.normalized_uuid = $2::uuid`,
    [
      scope.legalEntityId,
      unknownComplementUuid,
      unknownComplementFixture.input.objectId,
    ],
  )) as Array<{
    cfdis: number;
    incidents: number;
    linked_observations: number;
  }>;
  assertEqual(unknownComplementState?.cfdis, 1, 'unknown core persisted');
  assertEqual(
    unknownComplementState?.incidents,
    1,
    'unknown complement incident',
  );
  assertEqual(
    unknownComplementState?.linked_observations,
    1,
    'unknown complement provenance',
  );

  const unsupportedFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    '2'.repeat(64),
  );
  const unsupported = await persistenceStep('unsupported version', () =>
    service.publishRejected(
      unsupportedFixture.claim,
      unsupportedFixture.input,
      'unsupported',
      'CFDI_VERSION_UNSUPPORTED',
    ),
  );
  assertEqual(unsupported.result, 'unsupported', 'unsupported result');
  const [unsupportedState] = (await queryRunner.query(
    `SELECT item.product_result, item.error_code, item.cfdi_id,
            item.object_id, item.sha256,
            item.parser_version, item.schema_version,
            item.parsed_cfdi_version, item.parser_completed_at,
            object.lifecycle_state, object.quarantine_reason_code,
            object.retention_until BETWEEN
              clock_timestamp() + interval '29 days 23 hours'
              AND clock_timestamp() + interval '30 days 1 minute'
              AS retention_is_thirty_days,
            count(incident.id)::integer AS incidents
       FROM ingestion_items item
       INNER JOIN stored_objects object ON object.id = item.object_id
       LEFT JOIN incidents incident ON incident.ingestion_item_id = item.id
      WHERE item.id = $1
      GROUP BY item.id, object.id`,
    [unsupportedFixture.input.itemId],
  )) as Array<{
    product_result: string;
    error_code: string;
    cfdi_id: string | null;
    object_id: string;
    sha256: string;
    parser_version: string;
    schema_version: string;
    parsed_cfdi_version: string | null;
    parser_completed_at: Date;
    lifecycle_state: string;
    quarantine_reason_code: string;
    retention_is_thirty_days: boolean;
    incidents: number;
  }>;
  assertEqual(
    unsupportedState?.product_result,
    'unsupported',
    'unsupported item',
  );
  assertEqual(
    unsupportedState?.error_code,
    'CFDI_VERSION_UNSUPPORTED',
    'unsupported error code',
  );
  assertEqual(unsupportedState?.cfdi_id, null, 'unsupported no CFDI link');
  assertEqual(
    unsupportedState?.object_id,
    unsupportedFixture.input.objectId,
    'unsupported object provenance',
  );
  assertEqual(
    unsupportedState?.sha256,
    unsupportedFixture.input.sha256,
    'unsupported hash provenance',
  );
  assertEqual(
    unsupportedState?.parser_version,
    CFDI_PARSER_VERSION,
    'unsupported parser version provenance',
  );
  assertEqual(
    unsupportedState?.schema_version,
    CFDI_SCHEMA_SET_VERSION,
    'unsupported schema version provenance',
  );
  assertEqual(
    unsupportedState?.parsed_cfdi_version,
    null,
    'unsupported root version remains unknown',
  );
  assertEqual(
    unsupportedState?.parser_completed_at instanceof Date,
    true,
    'unsupported parser completion provenance',
  );
  assertEqual(
    unsupportedState?.quarantine_reason_code,
    'CFDI_VERSION_UNSUPPORTED',
    'unsupported object quarantine',
  );
  assertEqual(
    unsupportedState?.retention_is_thirty_days,
    true,
    'unsupported thirty-day retention',
  );
  assertEqual(unsupportedState?.incidents, 1, 'unsupported incident');

  const foreignUuid = randomUUID();
  const foreignFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    '3'.repeat(64),
  );
  const foreignDocument = baseDocument(
    foreignUuid,
    'I',
    '2026-02-20T12:00:00',
    'FOO010101AA1',
  );
  foreignDocument.receiver.rfc = 'BAR010101BB2';
  const foreign = await persistenceStep('foreign RFC', () =>
    service.publishParsed(
      foreignFixture.claim,
      foreignFixture.input,
      parsed(foreignDocument),
    ),
  );
  assertEqual(foreign.result, 'foreign', 'foreign result');
  const [foreignState] = (await queryRunner.query(
    `SELECT item.product_result, item.error_code, item.cfdi_id,
            item.object_id, item.sha256, item.normalized_uuid::text,
            item.parser_version, item.schema_version,
            object.lifecycle_state, object.quarantine_reason_code,
            (SELECT count(*)::integer FROM cfdis
              WHERE legal_entity_id = $2 AND normalized_uuid = $3::uuid) AS cfdis
       FROM ingestion_items item
       INNER JOIN stored_objects object ON object.id = item.object_id
      WHERE item.id = $1`,
    [foreignFixture.input.itemId, scope.legalEntityId, foreignUuid],
  )) as Array<{
    product_result: string;
    error_code: string;
    cfdi_id: string | null;
    object_id: string;
    sha256: string;
    normalized_uuid: string;
    parser_version: string;
    schema_version: string;
    lifecycle_state: string;
    quarantine_reason_code: string;
    cfdis: number;
  }>;
  assertEqual(foreignState?.product_result, 'foreign', 'foreign item');
  assertEqual(foreignState?.error_code, 'CFDI_RFC_FOREIGN', 'foreign code');
  assertEqual(foreignState?.cfdi_id, null, 'foreign no CFDI link');
  assertEqual(foreignState?.cfdis, 0, 'foreign no CFDI row');
  assertEqual(
    foreignState?.normalized_uuid,
    foreignUuid.toLowerCase(),
    'foreign UUID provenance',
  );
  assertEqual(
    foreignState?.object_id,
    foreignFixture.input.objectId,
    'foreign object provenance',
  );
  assertEqual(
    foreignState?.sha256,
    foreignFixture.input.sha256,
    'foreign hash provenance',
  );
  assertEqual(
    foreignState?.parser_version,
    parsed(foreignDocument).parserVersion,
    'foreign parser provenance',
  );
  assertEqual(
    foreignState?.quarantine_reason_code,
    'CFDI_RFC_FOREIGN',
    'foreign object quarantine',
  );

  const tenantBUuid = randomUUID();
  const tenantBFixture = await createPersistenceFixture(
    queryRunner,
    tenantB,
    suffix,
    '4'.repeat(64),
  );
  const tenantBResult = await persistenceStep('tenant B incorporated', () =>
    service.publishParsed(
      tenantBFixture.claim,
      tenantBFixture.input,
      parsed(ingresoDocument(tenantBUuid, tenantB.legalEntityRfc)),
    ),
  );
  assertEqual(tenantBResult.result, 'incorporated', 'tenant B seed result');
  const tenantIsolation = await inspectApiTenantIsolation(
    queryRunner,
    scope,
    tenantB,
    tenantBUuid,
  );
  assertEqual(tenantIsolation.ownCfdis > 0, true, 'tenant A visible rows');
  assertEqual(tenantIsolation.foreignCfdis, 0, 'tenant B CFDI blocked');
  assertEqual(tenantIsolation.foreignConcepts, 0, 'tenant B child blocked');

  const accessGrantSessionScope = await validateAccessGrantSessionScope(
    queryRunner,
    scope,
    tenantB,
    primaryState.id,
    incorporatedFixture.input.objectId,
  );

  const [auditState] = (await queryRunner.query(
    `SELECT count(*)::integer AS events,
            bool_and(reason IS NULL) AS safe_reason,
            bool_and(metadata = jsonb_build_object(
              'result', metadata ->> 'result'
            )) AS result_only,
            bool_and(position($2 in metadata::text) = 0) AS no_object_key,
            bool_and(position('<cfdi:' in lower(metadata::text)) = 0
              AND position('<?xml' in lower(metadata::text)) = 0
              AND metadata::text !~* '(storage_key|object_key)') AS no_xml_or_key
       FROM audit_events
      WHERE organization_id = $1
        AND action = 'cfdi.ingestion.item_published'`,
    [scope.organizationId, unknownComplementFixture.input.objectKey],
  )) as Array<{
    events: number;
    safe_reason: boolean;
    result_only: boolean;
    no_object_key: boolean;
    no_xml_or_key: boolean;
  }>;
  assertEqual(auditState?.events, 10, 'worker audit event count');
  assertEqual(
    auditState?.safe_reason,
    true,
    'audit reason contains no payload',
  );
  assertEqual(auditState?.result_only, true, 'audit metadata allowlist');
  assertEqual(
    auditState?.no_object_key,
    true,
    'audit omits concrete object key',
  );
  assertEqual(
    auditState?.no_xml_or_key,
    true,
    'audit omits XML and storage key',
  );

  const crossParentSqlState = await expectSqlState(
    queryRunner,
    'cross_parent_payment',
    async () => {
      await queryRunner.query(
        `INSERT INTO cfdi_payment_documents (
           id, organization_id, client_account_id, legal_entity_id,
           cfdi_id, payment_id, ordinal, related_uuid, currency,
           installment_number, previous_balance, paid_amount,
           remaining_balance, tax_object_code
         ) VALUES ($1,$2,$3,$4,$5,$6,99,$7,'MXN',1,1,1,0,'01')`,
        [
          randomUUID(),
          scope.organizationId,
          scope.clientAccountId,
          scope.legalEntityId,
          primaryState.id,
          missingState.payment_id,
          randomUUID(),
        ],
      );
    },
  );
  assertEqual(crossParentSqlState, '23503', 'cross-parent payment FK');

  const rollbackUuid = randomUUID();
  const rollbackFixture = await createPersistenceFixture(
    queryRunner,
    scope,
    suffix,
    'd'.repeat(64),
    500,
  );
  const delayFunction = `qa_cfdi_delay_${suffix}`;
  const delayTrigger = `qa_cfdi_delay_${suffix}`;
  await queryRunner.query(`
    CREATE FUNCTION public.${delayFunction}()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(0.75);
      RETURN NEW;
    END $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER ${delayTrigger}
    BEFORE INSERT ON cfdis
    FOR EACH ROW EXECUTE FUNCTION public.${delayFunction}()
  `);
  let leaseErrorCode: string | undefined;
  try {
    await service.publishParsed(
      rollbackFixture.claim,
      rollbackFixture.input,
      parsed(ingresoDocument(rollbackUuid)),
    );
  } catch (error) {
    leaseErrorCode = postgresCode(error);
  }
  await queryRunner.query(`DROP TRIGGER ${delayTrigger} ON cfdis`);
  await queryRunner.query(`DROP FUNCTION public.${delayFunction}()`);
  assertEqual(leaseErrorCode, 'JOB_LEASE_LOST', 'lost lease error');
  const [rollbackState] = (await queryRunner.query(
    `SELECT
       (SELECT count(*)::integer FROM cfdis
         WHERE legal_entity_id = $1 AND normalized_uuid = $2::uuid) AS cfdis,
       (SELECT technical_status FROM ingestion_items WHERE id = $3) AS item_status,
       (SELECT lifecycle_state FROM stored_objects WHERE id = $4) AS object_status`,
    [
      scope.legalEntityId,
      rollbackUuid,
      rollbackFixture.input.itemId,
      rollbackFixture.input.objectId,
    ],
  )) as Array<{
    cfdis: number;
    item_status: string;
    object_status: string;
  }>;
  assertEqual(rollbackState?.cfdis, 0, 'lost lease CFDI rollback');
  assertEqual(
    rollbackState?.item_status,
    'processing',
    'lost lease item rollback',
  );
  assertEqual(
    rollbackState?.object_status,
    'quarantined',
    'lost lease object rollback',
  );

  const [aggregateWithholdingState] = (await queryRunner.query(
    `SELECT
       count(*) FILTER (
         WHERE scope_type = 'document'
           AND direction = 'withheld'
           AND factor_type IS NULL
           AND base_amount IS NULL
           AND rate_or_quota IS NULL
           AND amount IS NOT NULL
       )::integer AS document_withholdings,
       count(*) FILTER (
         WHERE scope_type = 'payment'
           AND direction = 'withheld'
           AND factor_type IS NULL
           AND base_amount IS NULL
           AND rate_or_quota IS NULL
           AND amount IS NOT NULL
       )::integer AS payment_withholdings,
       count(*) FILTER (
         WHERE scope_type = 'payment'
           AND direction = 'withheld'
           AND ordinal = 1
       )::integer AS payment_withholdings_ordinal_one
     FROM cfdi_taxes
     WHERE organization_id = $1 AND legal_entity_id = $2`,
    [scope.organizationId, scope.legalEntityId],
  )) as Array<{
    document_withholdings: number;
    payment_withholdings: number;
    payment_withholdings_ordinal_one: number;
  }>;
  assertEqual(
    aggregateWithholdingState?.document_withholdings,
    1,
    'document aggregate withholding persistence',
  );
  assertEqual(
    aggregateWithholdingState?.payment_withholdings,
    3,
    'payment aggregate withholding persistence',
  );
  assertEqual(
    aggregateWithholdingState?.payment_withholdings_ordinal_one,
    3,
    'payment tax ordinal resets for each payment parent',
  );
  const [foreignBankState] = (await queryRunner.query(
    `SELECT
       count(*) FILTER (
         WHERE char_length(payer_foreign_bank_name) > 50
       )::integer AS long_bank_names,
       bool_and(payer_account = 'SYNTHETIC-ACCOUNT-001') AS accounts_preserved
     FROM cfdi_payments
     WHERE organization_id = $1 AND legal_entity_id = $2`,
    [scope.organizationId, scope.legalEntityId],
  )) as Array<{ long_bank_names: number; accounts_preserved: boolean }>;
  assertEqual(
    foreignBankState?.long_bank_names,
    3,
    'foreign bank names preserve the XSD length range',
  );
  assertEqual(
    foreignBankState?.accounts_preserved,
    true,
    'payer account remains separate from foreign bank name',
  );

  return {
    incorporated: true,
    creditNoteE: true,
    transferT: true,
    payrollN: true,
    multiplePaymentDocuments: true,
    aggregateWithholdings: true,
    foreignBankNameAndAccount: true,
    duplicateSameHash: true,
    uuidHashConflict: true,
    multiPeriod: true,
    missingPeriod: true,
    unknownComplementCoreAndIncident: true,
    unsupportedPreservesProvenanceWithoutCfdi: true,
    foreignPreservesProvenanceWithoutCfdi: true,
    relationGroups: true,
    crossParentForeignKey: true,
    tenantBBlockedOnCfdiAndChild: true,
    accessGrantSessionScope,
    lostLeaseRollback: true,
    auditWithoutXml: true,
    source: 'synthetic_transactional_postgresql',
  };
}

async function inspectApiTenantIsolation(
  queryRunner: QueryRunner,
  ownScope: PersistenceScope,
  foreignScope: PersistenceScope,
  foreignUuid: string,
): Promise<{
  ownCfdis: number;
  foreignCfdis: number;
  foreignConcepts: number;
}> {
  const savepoint = 'qa_api_tenant_isolation';
  await queryRunner.query(`SAVEPOINT ${savepoint}`);
  try {
    await queryRunner.query(`SET LOCAL ROLE balanz_api`);
    await queryRunner.query(
      `SELECT set_config('app.organization_id', $1, true),
              set_config('app.membership_id', $2, true)`,
      [ownScope.organizationId, ownScope.membershipId],
    );
    const [state] = (await queryRunner.query(
      `SELECT
         (SELECT count(*)::integer
            FROM cfdis
           WHERE organization_id = $1) AS own_cfdis,
         (SELECT count(*)::integer
            FROM cfdis
           WHERE organization_id = $2
             AND legal_entity_id = $3
             AND normalized_uuid = $4::uuid) AS foreign_cfdis,
         (SELECT count(*)::integer
            FROM cfdi_concepts
           WHERE organization_id = $2
             AND legal_entity_id = $3) AS foreign_concepts`,
      [
        ownScope.organizationId,
        foreignScope.organizationId,
        foreignScope.legalEntityId,
        foreignUuid,
      ],
    )) as Array<{
      own_cfdis: number;
      foreign_cfdis: number;
      foreign_concepts: number;
    }>;
    await queryRunner.query(`RESET ROLE`);
    await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
    if (!state) throw new Error('API tenant isolation returned no state');
    return {
      ownCfdis: state.own_cfdis,
      foreignCfdis: state.foreign_cfdis,
      foreignConcepts: state.foreign_concepts,
    };
  } catch (error) {
    await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

async function validateAccessGrantSessionScope(
  queryRunner: QueryRunner,
  sourceScope: PersistenceScope,
  destinationScope: PersistenceScope,
  cfdiId: string,
  objectId: string,
): Promise<Record<string, boolean>> {
  const destinationMembershipId = randomUUID();
  const sessionId = randomUUID();
  const grantId = randomUUID();
  await queryRunner.query(
    `INSERT INTO memberships (
       id, organization_id, user_id, role_id, status, joined_at
     )
     SELECT $1, $2, $3, membership.role_id, 'active', clock_timestamp()
       FROM memberships AS membership
      WHERE membership.organization_id = $4 AND membership.id = $5`,
    [
      destinationMembershipId,
      destinationScope.organizationId,
      sourceScope.userId,
      sourceScope.organizationId,
      sourceScope.membershipId,
    ],
  );
  await queryRunner.query(
    `INSERT INTO auth_sessions (
       id, session_token_hash, user_id, membership_id, organization_id,
       status, mfa_verified_at, reauthenticated_at, requires_mfa,
       expires_at, last_activity_at
     ) VALUES (
       $1,$2,$3,$4,$5,'active',clock_timestamp(),clock_timestamp(),false,
       clock_timestamp() + interval '1 hour',clock_timestamp()
     )`,
    [
      sessionId,
      randomBytes(32).toString('hex'),
      sourceScope.userId,
      sourceScope.membershipId,
      sourceScope.organizationId,
    ],
  );
  await queryRunner.query(
    `INSERT INTO cfdi_access_grants (
       id, organization_id, client_account_id, legal_entity_id,
       cfdi_id, object_id, membership_id, session_id, token_hash, expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp() + interval '5 minutes')`,
    [
      grantId,
      sourceScope.organizationId,
      sourceScope.clientAccountId,
      sourceScope.legalEntityId,
      cfdiId,
      objectId,
      sourceScope.membershipId,
      sessionId,
      randomBytes(32).toString('hex'),
    ],
  );

  await queryRunner.query(
    `UPDATE auth_sessions
        SET organization_id = $2,
            membership_id = $3,
            reauthenticated_at = NULL,
            last_activity_at = clock_timestamp()
      WHERE id = $1`,
    [sessionId, destinationScope.organizationId, destinationMembershipId],
  );

  const [state] = (await queryRunner.query(
    `SELECT
       session.organization_id = $3::uuid
         AND session.membership_id = $4::uuid AS tenant_changed,
       access_grant.session_id = session.id
         AND access_grant.organization_id = $5::uuid AS grant_retained,
       array_length(constraint_row.conkey, 1) = 1
         AND array_length(constraint_row.confkey, 1) = 1
         AND child_column.attname = 'session_id'
         AND parent_column.attname = 'id' AS id_only_foreign_key
     FROM auth_sessions AS session
     INNER JOIN cfdi_access_grants AS access_grant ON access_grant.id = $2
     INNER JOIN pg_constraint AS constraint_row
       ON constraint_row.conrelid = 'public.cfdi_access_grants'::regclass
      AND constraint_row.conname = 'fk_cfdi_access_grants_session'
     INNER JOIN pg_attribute AS child_column
       ON child_column.attrelid = constraint_row.conrelid
      AND child_column.attnum = constraint_row.conkey[1]
     INNER JOIN pg_attribute AS parent_column
       ON parent_column.attrelid = constraint_row.confrelid
      AND parent_column.attnum = constraint_row.confkey[1]
    WHERE session.id = $1`,
    [
      sessionId,
      grantId,
      destinationScope.organizationId,
      destinationMembershipId,
      sourceScope.organizationId,
    ],
  )) as Array<{
    tenant_changed: boolean;
    grant_retained: boolean;
    id_only_foreign_key: boolean;
  }>;
  if (!state)
    throw new Error('Access-grant session-scope QA returned no state');
  const result = {
    tenantChanged: state.tenant_changed,
    grantRetained: state.grant_retained,
    idOnlyForeignKey: state.id_only_foreign_key,
  };
  assertTrueValues(result, 'Access-grant session scope');
  return result;
}

function createSavepointWorkerTransactions(
  queryRunner: QueryRunner,
): FiscalTenantTransactionService {
  let call = 0;
  return {
    runAsWorker: async <T>(
      scope: { organizationId: string },
      work: (manager: EntityManager) => Promise<T>,
    ): Promise<T> => {
      call += 1;
      const savepoint = `cfdi_worker_call_${call}`;
      await queryRunner.query(`SAVEPOINT ${savepoint}`);
      try {
        await queryRunner.query(`SET LOCAL ROLE balanz_worker`);
        await queryRunner.query(
          `SELECT set_config('app.organization_id', $1, true),
                  set_config('app.membership_id', $2, true)`,
          [scope.organizationId, WORKER_MEMBERSHIP_CONTEXT_ID],
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

async function createPersistenceScope(
  queryRunner: QueryRunner,
  suffix: string,
  label = 'a',
  legalEntityRfc = 'QAA010101AA1',
): Promise<PersistenceScope> {
  const [role] = (await queryRunner.query(
    `SELECT id FROM roles WHERE key = 'accountant'`,
  )) as Array<{ id: string }>;
  if (!role) throw new Error('Canonical accountant role is required for QA');
  const userId = randomUUID();
  const scope: PersistenceScope = {
    userId,
    organizationId: randomUUID(),
    clientAccountId: randomUUID(),
    legalEntityId: randomUUID(),
    membershipId: randomUUID(),
    legalEntityRfc,
  };
  await queryRunner.query(
    `INSERT INTO users (id, first_name, last_name, email, status, password_hash)
     VALUES ($1,'QA','CFDI Persistence',$2,'active','synthetic-no-login')`,
    [userId, `qa-cfdi-persistence-${label}-${suffix}@example.invalid`],
  );
  await queryRunner.query(
    `INSERT INTO organizations (
       id, name, slug, owner_user_id, status, timezone
     ) VALUES ($1,$2,$3,$4,'active','America/Mexico_City')`,
    [
      scope.organizationId,
      `QA CFDI Persistence ${label} ${suffix}`,
      `qa-cfdi-persistence-${label}-${suffix}`,
      userId,
    ],
  );
  await queryRunner.query(
    `INSERT INTO memberships (
       id, organization_id, user_id, role_id, status, joined_at
     ) VALUES ($1,$2,$3,$4,'active',clock_timestamp())`,
    [scope.membershipId, scope.organizationId, userId, role.id],
  );
  await queryRunner.query(
    `INSERT INTO client_accounts (id, organization_id, name, code, status)
     VALUES ($1,$2,$3,$4,'active')`,
    [
      scope.clientAccountId,
      scope.organizationId,
      `QA CFDI Account ${label} ${suffix}`,
      `QA-${label.toUpperCase()}-${suffix}`,
    ],
  );
  await queryRunner.query(
    `INSERT INTO legal_entities (
       id, organization_id, client_account_id, rfc, legal_name, status
     ) VALUES ($1,$2,$3,$4,$5,'active')`,
    [
      scope.legalEntityId,
      scope.organizationId,
      scope.clientAccountId,
      scope.legalEntityRfc,
      `QA CFDI Legal ${label} ${suffix}`,
    ],
  );
  const fiscalYearId = randomUUID();
  await queryRunner.query(
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
  for (const month of [1, 2]) {
    await queryRunner.query(
      `INSERT INTO periods (
         id, organization_id, client_account_id, legal_entity_id,
         fiscal_year_id, month, status
       ) VALUES ($1,$2,$3,$4,$5,$6,'not_started')`,
      [
        randomUUID(),
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
        fiscalYearId,
        month,
      ],
    );
  }
  return scope;
}

async function createPersistenceFixture(
  queryRunner: QueryRunner,
  scope: PersistenceScope,
  suffix: string,
  sha256: string,
  leaseMilliseconds = 60_000,
): Promise<PersistenceFixture> {
  const objectId = randomUUID();
  const uploadId = randomUUID();
  const jobId = randomUUID();
  const itemId = randomUUID();
  const correlationId = randomUUID();
  const token = `worker:qa:${randomBytes(8).toString('hex')}`;
  await queryRunner.query(
    `INSERT INTO stored_objects (
       id, organization_id, client_account_id, legal_entity_id,
       kind, storage_provider, storage_container, object_key,
       original_filename, declared_mime_type, detected_mime_type,
       size_bytes, sha256, encryption_class, lifecycle_state,
       malware_scan_status, malware_scanner_version, malware_scanned_at,
       quarantine_reason_code, uploaded_at
     ) VALUES (
       $1,$2,$3,$4,'manual_xml','local','fiscal-private',$5,
       'synthetic.xml','application/xml','application/xml',128,$6,
       'fiscal','quarantined','clean','clamav-synthetic',clock_timestamp(),
       'PENDING_CFDI_VALIDATION',clock_timestamp()
     )`,
    [
      objectId,
      scope.organizationId,
      scope.clientAccountId,
      scope.legalEntityId,
      `qa/phase1/${suffix}/${objectId}`,
      sha256,
    ],
  );
  await queryRunner.query(
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
       $1,$2,$3,$4,'direct','manual_xml',$5,$6,
       clock_timestamp() + interval '1 day',$7,$8,202,$1::uuid::text,
       clock_timestamp(),clock_timestamp() + interval '1 day',
       $9,'confirmed',128,$10,clock_timestamp() + interval '1 day',
       clock_timestamp(),$11,$12
     )`,
    [
      uploadId,
      scope.organizationId,
      scope.clientAccountId,
      scope.legalEntityId,
      `qa-upload-${uploadId}`,
      'e'.repeat(64),
      `qa-confirm-${uploadId}`,
      'f'.repeat(64),
      objectId,
      sha256,
      scope.membershipId,
      correlationId,
    ],
  );
  await queryRunner.query(
    `INSERT INTO ingestion_jobs (
       id, organization_id, client_account_id, legal_entity_id,
       source_type, upload_id, root_object_id, requested_by_membership_id,
       idempotency_key, request_fingerprint, idempotency_expires_at,
       status, current_stage, total_items, processing_items,
       attempt_count, worker_id, locked_by, lease_expires_at,
       heartbeat_at, started_at, correlation_id
     ) VALUES (
       $1,$2,$3,$4,'manual_xml',$5,$6,$7,$8,$9,
       clock_timestamp() + interval '1 day','processing','parsing',1,1,
       1,'worker:qa',$10,
       clock_timestamp() + make_interval(secs => $11::double precision / 1000),
       clock_timestamp(),clock_timestamp(),$12
     )`,
    [
      jobId,
      scope.organizationId,
      scope.clientAccountId,
      scope.legalEntityId,
      uploadId,
      objectId,
      scope.membershipId,
      `qa-job-${jobId}`,
      '1'.repeat(64),
      token,
      leaseMilliseconds,
      correlationId,
    ],
  );
  await queryRunner.query(
    `INSERT INTO ingestion_items (
       id, organization_id, client_account_id, legal_entity_id,
       ingestion_job_id, object_id, ordinal, safe_filename,
       technical_status, sha256, attempt_count
     ) VALUES ($1,$2,$3,$4,$5,$6,1,'synthetic.xml','processing',$7,1)`,
    [
      itemId,
      scope.organizationId,
      scope.clientAccountId,
      scope.legalEntityId,
      jobId,
      objectId,
      sha256,
    ],
  );
  return {
    claim: {
      jobId,
      organizationId: scope.organizationId,
      clientAccountId: scope.clientAccountId,
      legalEntityId: scope.legalEntityId,
      sourceType: 'manual_xml',
      uploadId,
      rootObjectId: objectId,
      requestedByMembershipId: scope.membershipId,
      correlationId,
      attemptCount: 1,
      queueAgeSeconds: 0,
      version: 1,
      recovered: false,
      workerId: 'worker:qa',
      leaseToken: token,
    },
    input: {
      objectId,
      objectKey: `qa/phase1/${suffix}/${objectId}`,
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

function parsed(document: ParsedCfdi): CfdiParseResult {
  return {
    parserVersion: 'balanz-cfdi-saxes/1.0.0',
    schemaVersion: 'sat-cfdi-4.0+tfd-1.1+pagos-2.0+nomina-1.2@2026-09-03',
    sizeBytes: 128,
    document,
  };
}

function paymentDocument(
  uuid: string,
  year: number,
  missingOnly = false,
  issuerRfc = 'QAA010101AA1',
): ParsedCfdi {
  const payments = missingOnly
    ? [syntheticPayment(`${year}-03-15T10:00:00`)]
    : [
        syntheticPayment(`${year}-01-15T10:00:00`, 2),
        syntheticPayment(`${year}-02-16T11:00:00`),
      ];
  const document = baseDocument(uuid, 'P', `${year}-01-01T09:00:00`, issuerRfc);
  return {
    ...document,
    receiver: { ...document.receiver, cfdiUse: 'CP01' },
    relations: [
      {
        relationGroupOrdinal: 1,
        relationOrdinal: 1,
        relationType: '04',
        relatedUuid: randomUUID(),
      },
      {
        relationGroupOrdinal: 1,
        relationOrdinal: 2,
        relationType: '04',
        relatedUuid: randomUUID(),
      },
      {
        relationGroupOrdinal: 2,
        relationOrdinal: 1,
        relationType: '01',
        relatedUuid: randomUUID(),
      },
    ],
    payments: {
      version: '2.0',
      totals: { totalPayments: String(payments.length * 100) },
      payments,
    },
  };
}

function ingresoDocument(uuid: string, issuerRfc = 'QAA010101AA1'): ParsedCfdi {
  return {
    ...baseDocument(uuid, 'I', '2026-01-20T12:00:00', issuerRfc),
    taxes: {
      totalWithheld: '10.000000',
      lines: [
        {
          kind: 'withholding',
          tax: '002',
          amount: '10.000000',
        },
      ],
    },
  };
}

function payrollDocument(uuid: string, issuerRfc = 'QAA010101AA1'): ParsedCfdi {
  return {
    ...baseDocument(uuid, 'N', '2026-02-28T12:00:00', issuerRfc),
    payroll: {
      version: '1.2',
      payrollType: 'O',
      paymentDate: '2026-02-28',
      initialPaymentDate: '2026-02-16',
      finalPaymentDate: '2026-02-28',
      paidDays: '13.000',
      totalPerceptions: '1000.000000',
      totalDeductions: '100.000000',
      totalOtherPayments: '25.000000',
      issuer: { employerRegistration: 'SYNTHETIC-REG' },
      receiver: {
        curp: 'XEXX010101HNEXXXA4',
        socialSecurityNumber: '00000000000',
        employmentStartDate: '2024-01-01',
        seniority: 'P2Y1M27D',
        contractType: '01',
        regimeType: '02',
        employeeNumber: 'SYNTHETIC-001',
        position: 'QA',
        occupationalRisk: '1',
        paymentFrequency: '04',
        contributionBaseSalary: '100.000000',
        integratedDailySalary: '116.000000',
        federalEntityCode: 'CMX',
      },
      perceptions: [
        {
          perceptionType: '001',
          code: 'P001',
          description: 'SYNTHETIC SALARY',
          taxableAmount: '900.000000',
          exemptAmount: '100.000000',
        },
      ],
      deductions: [
        {
          deductionType: '002',
          code: 'D001',
          description: 'SYNTHETIC TAX',
          amount: '100.000000',
        },
      ],
      otherPayments: [
        {
          otherPaymentType: '002',
          code: 'O001',
          description: 'SYNTHETIC SUBSIDY',
          amount: '25.000000',
        },
      ],
      incapacities: [
        {
          days: '1.000',
          incapacityType: '01',
          amount: '50.000000',
        },
      ],
    },
  };
}

function baseDocument(
  uuid: string,
  documentType: ParsedCfdi['documentType'],
  issuedAt: string,
  issuerRfc = 'QAA010101AA1',
): ParsedCfdi {
  return {
    version: '4.0',
    issuedAt,
    stamp: {
      version: '1.1',
      uuid,
      stampedAt: issuedAt,
      certifyingProviderRfc: 'AAA010101AAA',
      satCertificateNumber: '00001000000500000000',
      cfdiSeal: 'synthetic',
      satSeal: 'synthetic',
    },
    subtotal: documentType === 'P' ? '0' : '100.000000',
    currency: documentType === 'P' ? 'XXX' : 'MXN',
    total: documentType === 'P' ? '0' : '116.000000',
    documentType,
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
        productServiceCode: documentType === 'P' ? '84111506' : '01010101',
        quantity: '1',
        unitCode: 'ACT',
        description: 'SYNTHETIC CONCEPT',
        unitValue: documentType === 'P' ? '0' : '100.000000',
        amount: documentType === 'P' ? '0' : '100.000000',
        taxObject: '01',
        taxes: { lines: [] },
      },
    ],
    taxes: { lines: [] },
    relations: [],
    unsupportedComplements: [],
  };
}

function syntheticPayment(paidAt: string, documentCount = 1) {
  return {
    paidAt,
    paymentForm: '03',
    currency: 'MXN',
    amount: '100.000000',
    payerForeignBankName:
      'SYNTHETIC FOREIGN BANK NAME WITH MORE THAN FIFTY CHARACTERS FOR QA',
    payerAccount: 'SYNTHETIC-ACCOUNT-001',
    relatedDocuments: Array.from({ length: documentCount }, (_, index) => {
      const paidAmount = (100 / documentCount).toFixed(6);
      return {
        uuid: randomUUID(),
        currency: 'MXN',
        partialityNumber: String(index + 1),
        previousBalance: '100.000000',
        paidAmount,
        unpaidBalance: (100 - Number(paidAmount)).toFixed(6),
        taxObject: '01',
        taxes: { lines: [] },
      };
    }),
    taxes: {
      lines: [
        {
          kind: 'withholding' as const,
          tax: '002',
          amount: '10.000000',
        },
      ],
    },
  };
}

async function expectSqlState(
  queryRunner: QueryRunner,
  name: string,
  operation: () => Promise<void>,
): Promise<string | undefined> {
  const savepoint = `qa_${name}`;
  await queryRunner.query(`SAVEPOINT ${savepoint}`);
  try {
    await operation();
    await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
    return undefined;
  } catch (error) {
    await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
    return postgresCode(error);
  }
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

async function persistenceStep<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) {
      error.message = `${label}: ${error.message}`;
    }
    throw error;
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

async function inspectUpState(
  manager: EntityManager,
): Promise<Record<string, unknown>> {
  const [state] = await manager.query(
    `SELECT
       (SELECT count(*)::integer FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])) AS tables,
       (SELECT count(*)::integer FROM pg_class
         WHERE relnamespace = 'public'::regnamespace
           AND relname = ANY($1::text[])
           AND relrowsecurity AND relforcerowsecurity) AS forced_rls,
       (SELECT count(*)::integer FROM pg_policies
         WHERE schemaname = 'public' AND tablename = ANY($1::text[])) AS policies,
       (SELECT count(*)::integer FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ingestion_items'
           AND column_name IN (
             'cfdi_id', 'parser_version', 'schema_version',
             'parsed_cfdi_version', 'normalized_uuid', 'issuer_rfc',
             'receiver_rfc', 'document_type', 'parser_completed_at'
           )) AS provenance_columns,
       EXISTS (SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.cfdis'::regclass
           AND conname = 'uq_cfdis_legal_entity_uuid') AS uuid_lock,
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.ingestion_items'::regclass
            AND conname = 'ck_ingestion_items_attempt_count'
            AND position(
              'attempt_count >= 0' IN pg_get_constraintdef(oid)
            ) > 0
            AND position('BETWEEN' IN pg_get_constraintdef(oid)) = 0
       ) AS unbounded_item_attempt_evidence,
       NOT EXISTS (SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])
           AND (data_type IN ('real','double precision','json','jsonb')
             OR column_name ~ 'xml')) AS exact_normalized_values,
       (SELECT character_maximum_length = 4
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'cfdis'
           AND column_name = 'usage_code') AS usage_code_supports_cp01,
       (SELECT tableowner = 'balanz_fiscal_owner' FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'cfdis') AS constrained_owner,
       NOT has_schema_privilege('balanz_fiscal_owner', 'public', 'CREATE')
         AS owner_cannot_create,
       NOT has_table_privilege('balanz_api', 'public.cfdi_access_grants', 'INSERT')
         AND has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'id', 'INSERT')
         AND NOT has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'created_at', 'INSERT')
         AND has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'used_at', 'UPDATE')
         AND NOT has_column_privilege('balanz_api', 'public.cfdi_access_grants', 'token_hash', 'UPDATE')
         AS one_time_grant_acl,
       has_column_privilege('balanz_api', 'public.stored_objects', 'detected_mime_type', 'UPDATE')
         AND has_column_privilege('balanz_api', 'public.ingestion_uploads', 'last_error_code', 'UPDATE')
         AND has_column_privilege('balanz_api', 'public.ingestion_uploads', 'state', 'INSERT')
         AND has_column_privilege('balanz_api', 'public.ingestion_jobs', 'total_items', 'INSERT')
         AND has_column_privilege('balanz_api', 'public.ingestion_items', 'id', 'INSERT')
         AND has_column_privilege('balanz_worker', 'public.ingestion_jobs', 'root_object_id', 'SELECT')
         AND has_column_privilege('balanz_worker', 'public.ingestion_jobs', 'total_items', 'UPDATE')
         AND has_column_privilege('balanz_worker', 'public.stored_objects', 'malware_scan_status', 'UPDATE')
         AND has_column_privilege('balanz_worker', 'public.ingestion_items', 'cfdi_id', 'UPDATE')
         AS phase_one_runtime_acl,
       has_column_privilege(
         'balanz_fiscal_cancel_owner',
         'public.ingestion_jobs',
         'source_type',
         'SELECT'
       )
         AND has_column_privilege(
           'balanz_fiscal_cancel_owner',
           'public.ingestion_jobs',
           'total_items',
           'SELECT'
         )
         AND has_column_privilege(
           'balanz_fiscal_cancel_owner',
           'public.ingestion_jobs',
           'pending_items',
           'SELECT'
         )
         AND has_column_privilege(
           'balanz_fiscal_cancel_owner',
           'public.ingestion_jobs',
           'processing_items',
           'SELECT'
         )
         AND position(
           'job.pending_items + job.processing_items > 0'
           IN pg_get_functiondef(
             'public.request_ingestion_job_cancellation(uuid)'::regprocedure
           )
         ) > 0 AS published_xml_cancellation_boundary`,
    [[...TABLES]],
  );
  return state as Record<string, unknown>;
}

function assertUpState(state: Record<string, unknown>): void {
  if (state.tables !== 14 || state.forced_rls !== 14 || state.policies !== 27) {
    throw new Error(
      `Unexpected Phase 1 schema counts: ${JSON.stringify(state)}`,
    );
  }
  if (state.provenance_columns !== 9) {
    throw new Error('Ingestion provenance columns are incomplete');
  }
  assertTrueValues(
    {
      uuid_lock: Boolean(state.uuid_lock),
      unbounded_item_attempt_evidence: Boolean(
        state.unbounded_item_attempt_evidence,
      ),
      exact_normalized_values: Boolean(state.exact_normalized_values),
      usage_code_supports_cp01: Boolean(state.usage_code_supports_cp01),
      constrained_owner: Boolean(state.constrained_owner),
      owner_cannot_create: Boolean(state.owner_cannot_create),
      one_time_grant_acl: Boolean(state.one_time_grant_acl),
      phase_one_runtime_acl: Boolean(state.phase_one_runtime_acl),
      published_xml_cancellation_boundary: Boolean(
        state.published_xml_cancellation_boundary,
      ),
    },
    'Phase 1 up',
  );
}

async function inspectDownState(
  manager: EntityManager,
): Promise<Record<string, boolean>> {
  const [state] = await manager.query(
    `SELECT
       (SELECT count(*)::integer FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])) = 0
         AS tables_removed,
       (SELECT count(*)::integer FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ingestion_items'
           AND column_name IN (
             'cfdi_id', 'parser_version', 'schema_version',
             'parsed_cfdi_version', 'normalized_uuid', 'issuer_rfc',
             'receiver_rfc', 'document_type', 'parser_completed_at'
           )) = 0 AS provenance_removed,
       NOT EXISTS (SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.periods'::regclass
           AND conname = 'uq_periods_scope_id') AS period_key_removed,
       NOT EXISTS (SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.auth_sessions'::regclass
           AND conname = 'uq_auth_sessions_scope_membership_id') AS session_key_removed,
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.ingestion_items'::regclass
            AND conname = 'ck_ingestion_items_attempt_count'
            AND position(
              'attempt_count >= 0' IN pg_get_constraintdef(oid)
            ) > 0
            AND position(
              'attempt_count <= 4' IN pg_get_constraintdef(oid)
            ) > 0
       ) AS phase_zero_item_attempt_bound_restored,
       NOT has_column_privilege('balanz_api', 'public.stored_objects', 'detected_mime_type', 'UPDATE')
         AND NOT has_column_privilege('balanz_api', 'public.ingestion_uploads', 'last_error_code', 'UPDATE')
         AND NOT has_column_privilege('balanz_api', 'public.ingestion_uploads', 'state', 'INSERT')
         AND NOT has_column_privilege('balanz_api', 'public.ingestion_jobs', 'total_items', 'INSERT')
         AND NOT has_column_privilege('balanz_api', 'public.ingestion_items', 'id', 'INSERT')
         AND NOT has_column_privilege('balanz_worker', 'public.ingestion_jobs', 'root_object_id', 'SELECT')
         AND NOT has_column_privilege('balanz_worker', 'public.ingestion_jobs', 'total_items', 'UPDATE')
         AS runtime_acl_removed,
       NOT has_column_privilege(
         'balanz_fiscal_cancel_owner',
         'public.ingestion_jobs',
         'source_type',
         'SELECT'
       )
         AND NOT has_column_privilege(
           'balanz_fiscal_cancel_owner',
           'public.ingestion_jobs',
           'total_items',
           'SELECT'
         )
         AND NOT has_column_privilege(
           'balanz_fiscal_cancel_owner',
           'public.ingestion_jobs',
           'pending_items',
           'SELECT'
         )
         AND NOT has_column_privilege(
           'balanz_fiscal_cancel_owner',
           'public.ingestion_jobs',
           'processing_items',
           'SELECT'
         )
         AND position(
           'job.pending_items + job.processing_items > 0'
           IN pg_get_functiondef(
             'public.request_ingestion_job_cancellation(uuid)'::regprocedure
           )
         ) = 0 AS published_xml_cancellation_boundary_removed`,
    [[...TABLES]],
  );
  return state as Record<string, boolean>;
}

function assertTrueValues(
  values: Record<string, boolean>,
  label: string,
): void {
  const failed = Object.entries(values)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (failed.length > 0)
    throw new Error(`${label} failed: ${failed.join(', ')}`);
}

void validate().catch((error: unknown) => {
  const databaseError =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; detail?: unknown; message?: unknown })
      : undefined;
  console.error(
    JSON.stringify({
      message:
        typeof databaseError?.message === 'string'
          ? databaseError.message
          : String(error),
      code: typeof databaseError?.code === 'string' ? databaseError.code : null,
      detail:
        typeof databaseError?.detail === 'string' ? databaseError.detail : null,
    }),
  );
  process.exitCode = 1;
});
