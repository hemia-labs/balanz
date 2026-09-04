import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type {
  CfdiParseResult,
  CfdiTaxLine,
  ParsedCfdi,
} from '../../cfdi-parser';
import {
  CFDI_PARSER_VERSION,
  CFDI_SCHEMA_SET_VERSION,
} from '../../cfdi-parser';
import type { FiscalPlatformConfig } from '../../../config/fiscal-platform.config';
import { FiscalTenantTransactionService } from '../../../database/rls/fiscal-tenant-transaction.service';
import type { ClaimResult } from '../../ingestion/services/ingestion-job.repository';
import { DurableWorkerError } from '../../ingestion/workers/worker-error';

export type PublishedItemResult =
  | 'incorporated'
  | 'duplicate'
  | 'foreign'
  | 'invalid'
  | 'unsupported'
  | 'internal_error';

export interface WorkerInput {
  objectId: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  lifecycleState: string;
  scanStatus: string;
  legalEntityRfc: string;
  itemId: string;
  itemStatus: string;
  itemResult: PublishedItemResult | null;
  hasIssues: boolean;
}

export interface PersistenceOutcome {
  completion: 'completed' | 'completed_with_issues';
  result: PublishedItemResult;
}

const PERIOD_POLICY_VERSION = 'cfdi-period-participation/1.0.0';
const FALLBACK_TIMEZONE = 'America/Mexico_City';
const UNSUPPORTED_RETENTION_DAYS = 30;
const HASH_CONFLICT_RETENTION_DAYS = 7;

@Injectable()
export class CfdiWorkerPersistenceService {
  private readonly duplicateRetentionHours: number;
  private readonly invalidRetentionDays: number;
  private readonly malwareRetentionDays: number;

  constructor(
    private readonly transactions: FiscalTenantTransactionService,
    config: ConfigService,
  ) {
    const retention =
      config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform').retention;
    this.duplicateRetentionHours = retention.duplicateBytesHours;
    this.invalidRetentionDays = retention.invalidObjectDays;
    this.malwareRetentionDays = retention.malwareQuarantineDays;
  }

  loadAndBegin(job: ClaimResult): Promise<WorkerInput> {
    return this.run(job, async (manager) => {
      const rows = await manager.query<
        Array<{
          object_id: string;
          object_key: string;
          sha256: string | null;
          size_bytes: string | null;
          lifecycle_state: string;
          malware_scan_status: string;
          legal_entity_rfc: string;
          item_id: string;
          item_status: string;
          item_result: PublishedItemResult | null;
          has_issues: boolean;
        }>
      >(
        `SELECT object.id AS object_id, object.object_key, object.sha256,
                object.size_bytes, object.lifecycle_state,
                object.malware_scan_status,
                entity.rfc AS legal_entity_rfc,
                item.id AS item_id, item.technical_status AS item_status,
                item.product_result AS item_result,
                EXISTS (
                  SELECT 1 FROM incidents incident
                   WHERE incident.organization_id = item.organization_id
                     AND incident.ingestion_item_id = item.id
                ) AS has_issues
           FROM ingestion_jobs job
           INNER JOIN ingestion_items item
             ON item.organization_id = job.organization_id
            AND item.client_account_id = job.client_account_id
            AND item.legal_entity_id = job.legal_entity_id
            AND item.ingestion_job_id = job.id
            AND item.ordinal = 1
           INNER JOIN stored_objects object
             ON object.organization_id = job.organization_id
            AND object.client_account_id = job.client_account_id
            AND object.legal_entity_id = job.legal_entity_id
            AND object.id = job.root_object_id
            AND object.id = item.object_id
           INNER JOIN legal_entities entity
             ON entity.organization_id = job.organization_id
            AND entity.client_account_id = job.client_account_id
            AND entity.id = job.legal_entity_id
          WHERE job.organization_id = $1
            AND job.id = $2
            AND job.locked_by = $3
            AND job.status = 'processing'
            AND job.lease_expires_at > clock_timestamp()
            AND job.source_type = 'manual_xml'
            AND entity.status = 'active'`,
        [job.organizationId, job.jobId, job.leaseToken],
      );
      const row = rows[0];
      if (!row || !row.sha256 || row.size_bytes === null) {
        throw new DurableWorkerError('JOB_ROOT_OBJECT_UNAVAILABLE', {
          retryable: true,
        });
      }
      if (row.item_status !== 'terminal') {
        const item = await manager.query<Array<{ id: string }>>(
          `WITH updated AS (
             UPDATE ingestion_items
              SET technical_status = 'processing',
                    attempt_count = attempt_count + 1,
                    updated_at = clock_timestamp(),
                    version = version + 1
              WHERE organization_id = $1
                AND id = $2
                AND technical_status IN ('pending','processing')
            RETURNING id
           )
           SELECT id FROM updated`,
          [job.organizationId, row.item_id],
        );
        if (item.length !== 1) {
          throw new DurableWorkerError('JOB_RETRY_EXHAUSTED', {
            retryable: false,
          });
        }
        await this.updateStage(manager, job, 'scanning');
      }
      return {
        objectId: row.object_id,
        objectKey: row.object_key,
        sha256: row.sha256,
        sizeBytes: Number(row.size_bytes),
        lifecycleState: row.lifecycle_state,
        scanStatus: row.malware_scan_status,
        legalEntityRfc: row.legal_entity_rfc,
        itemId: row.item_id,
        itemStatus: row.item_status,
        itemResult: row.item_result,
        hasIssues: row.has_issues,
      };
    });
  }

  recordCleanScan(
    job: ClaimResult,
    input: WorkerInput,
    verdict: 'clean' | 'bypassed',
  ): Promise<void> {
    return this.run(job, async (manager) => {
      await this.requireFence(manager, job);
      const updated = await manager.query<Array<{ id: string }>>(
        `WITH scanned AS (
           UPDATE stored_objects
              SET lifecycle_state = CASE
                    WHEN lifecycle_state = 'available' THEN 'available'
                    ELSE 'quarantined'
                  END,
                  malware_scan_status = $4,
                  malware_scanner_version = $5,
                  malware_scanned_at = clock_timestamp(),
                  quarantine_reason_code = CASE
                    WHEN lifecycle_state = 'available' THEN quarantine_reason_code
                    ELSE 'PENDING_CFDI_VALIDATION'
                  END,
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE organization_id = $1
              AND id = $2
              AND sha256 = $3
              AND lifecycle_state IN ('uploaded','quarantined','available')
          RETURNING id
         )
         SELECT id FROM scanned`,
        [
          job.organizationId,
          input.objectId,
          input.sha256,
          verdict,
          verdict === 'clean' ? 'clamav-instream' : 'development-bypass',
        ],
      );
      if (updated.length !== 1) throw rootUnavailable();
      await this.updateStage(manager, job, 'parsing');
    });
  }

  prepareParsing(job: ClaimResult): Promise<void> {
    return this.run(job, async (manager) => {
      await this.updateStage(manager, job, 'parsing');
    });
  }

  publishMalware(
    job: ClaimResult,
    input: WorkerInput,
  ): Promise<PersistenceOutcome> {
    return this.run(job, async (manager) => {
      await this.requireFence(manager, job);
      await manager.query(
        `UPDATE stored_objects
            SET lifecycle_state = 'quarantined',
                malware_scan_status = 'infected',
                malware_scanner_version = 'clamav-instream',
                malware_scanned_at = clock_timestamp(),
                quarantine_reason_code = 'MALWARE_DETECTED',
                retention_until = clock_timestamp() + make_interval(days => $3),
                updated_at = clock_timestamp(),
                version = version + 1
          WHERE organization_id = $1 AND id = $2`,
        [job.organizationId, input.objectId, this.malwareRetentionDays],
      );
      await this.insertIncident(manager, job, input, null, {
        code: 'MALWARE_DETECTED',
        severity: 'critical',
      });
      await this.finishItem(manager, job, input, {
        result: 'invalid',
        errorCode: 'MALWARE_DETECTED',
      });
      return { completion: 'completed_with_issues', result: 'invalid' };
    });
  }

  publishRejected(
    job: ClaimResult,
    input: WorkerInput,
    result: Extract<PublishedItemResult, 'foreign' | 'invalid' | 'unsupported'>,
    errorCode: string,
    parsed?: CfdiParseResult,
  ): Promise<PersistenceOutcome> {
    return this.run(job, async (manager) => {
      await this.requireFence(manager, job);
      await manager.query(
        `UPDATE stored_objects
            SET lifecycle_state = 'quarantined',
                quarantine_reason_code = $3,
                retention_until = clock_timestamp() + make_interval(days => $4),
                updated_at = clock_timestamp(),
                version = version + 1
          WHERE organization_id = $1 AND id = $2`,
        [
          job.organizationId,
          input.objectId,
          errorCode,
          result === 'unsupported'
            ? UNSUPPORTED_RETENTION_DAYS
            : this.invalidRetentionDays,
        ],
      );
      await this.insertIncident(manager, job, input, null, {
        code: errorCode,
        severity: result === 'foreign' ? 'medium' : 'high',
      });
      await this.finishItem(manager, job, input, {
        result,
        errorCode,
        parsed,
        parserAttempted: true,
      });
      return { completion: 'completed_with_issues', result };
    });
  }

  async publishParsed(
    job: ClaimResult,
    input: WorkerInput,
    parsed: CfdiParseResult,
  ): Promise<PersistenceOutcome> {
    // Publishing the stage in its own short transaction avoids retaining a
    // row lock on ingestion_jobs while the fiscal transaction persists all
    // normalized children. Heartbeat/cancellation remain able to observe and
    // mutate the durable lease while the slower work is in flight.
    await this.run(job, async (manager) => {
      await this.updateStage(manager, job, 'persisting');
    });
    return this.run(job, async (manager) => {
      await this.requireFence(manager, job);
      const entityRows = await manager.query<
        Array<{ rfc: string; timezone: string | null }>
      >(
        `SELECT entity.rfc, organization.timezone
           FROM legal_entities entity
           INNER JOIN organizations organization
             ON organization.id = entity.organization_id
          WHERE entity.organization_id = $1
            AND entity.client_account_id = $2
            AND entity.id = $3
            AND entity.status = 'active'`,
        [job.organizationId, job.clientAccountId, job.legalEntityId],
      );
      const entity = entityRows[0];
      if (!entity) throw rootUnavailable();
      if (
        entity.rfc !== parsed.document.issuer.rfc &&
        entity.rfc !== parsed.document.receiver.rfc
      ) {
        await manager.query(
          `UPDATE stored_objects
              SET lifecycle_state = 'quarantined',
                  quarantine_reason_code = 'CFDI_RFC_FOREIGN',
                  retention_until = clock_timestamp() + make_interval(days => $3),
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE organization_id = $1 AND id = $2`,
          [job.organizationId, input.objectId, this.invalidRetentionDays],
        );
        await this.insertIncident(manager, job, input, null, {
          code: 'CFDI_RFC_FOREIGN',
          severity: 'medium',
        });
        await this.finishItem(manager, job, input, {
          result: 'foreign',
          errorCode: 'CFDI_RFC_FOREIGN',
          parsed,
        });
        return { completion: 'completed_with_issues', result: 'foreign' };
      }
      const timezone = safeTimeZone(entity.timezone);
      const normalizedUuid = parsed.document.stamp.uuid.toLowerCase();
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 74021))`,
        [`${job.legalEntityId}:${normalizedUuid}`],
      );
      const existingRows = await manager.query<
        Array<{ id: string; sha256: string }>
      >(
        `SELECT cfdi.id, object.sha256
           FROM cfdis cfdi
           INNER JOIN stored_objects object
             ON object.organization_id = cfdi.organization_id
            AND object.client_account_id = cfdi.client_account_id
            AND object.legal_entity_id = cfdi.legal_entity_id
            AND object.id = cfdi.source_object_id
           WHERE cfdi.organization_id = $1
             AND cfdi.legal_entity_id = $2
             AND cfdi.normalized_uuid = $3::uuid`,
        [job.organizationId, job.legalEntityId, normalizedUuid],
      );
      const existing = existingRows[0];
      if (existing) {
        if (existing.sha256 === input.sha256) {
          await manager.query(
            `UPDATE stored_objects
                SET lifecycle_state = 'quarantined',
                    quarantine_reason_code = 'CFDI_DUPLICATE',
                    retention_until = clock_timestamp() + make_interval(hours => $3),
                    updated_at = clock_timestamp(),
                    version = version + 1
              WHERE organization_id = $1 AND id = $2`,
            [job.organizationId, input.objectId, this.duplicateRetentionHours],
          );
          await this.finishItem(manager, job, input, {
            result: 'duplicate',
            cfdiId: existing.id,
            parsed,
          });
          return { completion: 'completed', result: 'duplicate' };
        }
        await manager.query(
          `UPDATE stored_objects
              SET lifecycle_state = 'quarantined',
                  quarantine_reason_code = 'CFDI_UUID_HASH_CONFLICT',
                  retention_until = statement_timestamp() + make_interval(days => $3),
                  hold_until = statement_timestamp() + make_interval(days => $3),
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE organization_id = $1 AND id = $2`,
          [job.organizationId, input.objectId, HASH_CONFLICT_RETENTION_DAYS],
        );
        await this.insertIncident(manager, job, input, existing.id, {
          code: 'CFDI_UUID_HASH_CONFLICT',
          severity: 'high',
        });
        await this.finishItem(manager, job, input, {
          result: 'invalid',
          errorCode: 'CFDI_UUID_HASH_CONFLICT',
          cfdiId: existing.id,
          parsed,
        });
        return { completion: 'completed_with_issues', result: 'invalid' };
      }

      this.assertPersistable(parsed.document);
      const cfdiId = randomUUID();
      const document = parsed.document;
      await manager.query(
        `INSERT INTO cfdis (
           id, organization_id, client_account_id, legal_entity_id,
           source_object_id, normalized_uuid, cfdi_version, schema_version,
           parser_version, document_type, issued_at, certified_at,
           issuer_rfc, issuer_name, receiver_rfc, receiver_name,
           receiver_fiscal_zip, receiver_fiscal_regime_code, usage_code,
           currency, exchange_rate, subtotal, discount, total, payment_form,
           payment_method, place_of_issue, export_code
         ) VALUES (
           $1,$2,$3,$4,$5,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
           $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
         )`,
        [
          cfdiId,
          job.organizationId,
          job.clientAccountId,
          job.legalEntityId,
          input.objectId,
          normalizedUuid,
          document.version,
          parsed.schemaVersion,
          parsed.parserVersion,
          document.documentType,
          zonedDateTime(document.issuedAt, timezone),
          zonedDateTime(document.stamp.stampedAt, timezone),
          document.issuer.rfc,
          document.issuer.name ?? null,
          document.receiver.rfc,
          document.receiver.name ?? null,
          document.receiver.fiscalAddress ?? null,
          document.receiver.fiscalRegime ?? null,
          document.receiver.cfdiUse ?? null,
          document.currency,
          document.exchangeRate ?? null,
          document.subtotal,
          document.discount ?? null,
          document.total,
          document.paymentForm ?? null,
          document.paymentMethod ?? null,
          document.issueLocation,
          document.exportCode ?? null,
        ],
      );
      await this.insertDetails(manager, job, cfdiId, document, timezone);
      const missingPeriods = await this.insertPeriodParticipation(
        manager,
        job,
        input,
        cfdiId,
        document,
        timezone,
      );
      for (
        let index = 0;
        index < document.unsupportedComplements.length;
        index += 1
      ) {
        await this.insertIncident(manager, job, input, cfdiId, {
          code: 'COMPLEMENT_UNSUPPORTED',
          severity: 'medium',
        });
      }
      for (let index = 0; index < missingPeriods; index += 1) {
        await this.insertIncident(manager, job, input, cfdiId, {
          code: 'FISCAL_PERIOD_NOT_CONFIGURED',
          severity: 'medium',
        });
      }
      await manager.query(
        `UPDATE stored_objects
            SET lifecycle_state = 'available',
                quarantine_reason_code = NULL,
                retention_until = NULL,
                available_at = COALESCE(available_at, clock_timestamp()),
                updated_at = clock_timestamp(),
                version = version + 1
          WHERE organization_id = $1 AND id = $2`,
        [job.organizationId, input.objectId],
      );
      await this.finishItem(manager, job, input, {
        result: 'incorporated',
        cfdiId,
        parsed,
      });
      const hasIssues =
        missingPeriods > 0 || document.unsupportedComplements.length > 0;
      return {
        completion: hasIssues ? 'completed_with_issues' : 'completed',
        result: 'incorporated',
      };
    });
  }

  private async insertDetails(
    manager: EntityManager,
    job: ClaimResult,
    cfdiId: string,
    document: ParsedCfdi,
    timezone: string,
  ): Promise<void> {
    const scope = [job.organizationId, job.clientAccountId, job.legalEntityId];
    const conceptIds: string[] = [];
    for (const [index, concept] of document.concepts.entries()) {
      const id = randomUUID();
      conceptIds.push(id);
      await manager.query(
        `INSERT INTO cfdi_concepts (
           id, organization_id, client_account_id, legal_entity_id, cfdi_id,
           ordinal, product_service_code, identification_number, quantity,
           unit_code, unit_name, description, unit_value, amount, discount,
           tax_object_code
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          ...scope,
          cfdiId,
          index + 1,
          concept.productServiceCode,
          concept.identificationNumber ?? null,
          concept.quantity,
          concept.unitCode ?? null,
          concept.unit ?? null,
          concept.description,
          concept.unitValue,
          concept.amount,
          concept.discount ?? null,
          concept.taxObject!,
        ],
      );
    }
    for (const relation of document.relations) {
      await manager.query(
        `INSERT INTO cfdi_relations (
           id, organization_id, client_account_id, legal_entity_id, cfdi_id,
           relation_group_ordinal, ordinal, relation_type, related_uuid
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid)`,
        [
          randomUUID(),
          ...scope,
          cfdiId,
          relation.relationGroupOrdinal,
          relation.relationOrdinal,
          relation.relationType,
          relation.relatedUuid.toLowerCase(),
        ],
      );
    }

    let documentTaxOrdinal = 0;
    for (const line of document.taxes.lines) {
      documentTaxOrdinal += 1;
      await this.insertTax(manager, job, cfdiId, {
        line,
        scopeType: 'document',
        ordinal: documentTaxOrdinal,
      });
    }
    for (const [conceptIndex, concept] of document.concepts.entries()) {
      for (const [taxIndex, line] of concept.taxes.lines.entries()) {
        await this.insertTax(manager, job, cfdiId, {
          line,
          scopeType: 'concept',
          ordinal: taxIndex + 1,
          conceptId: conceptIds[conceptIndex],
        });
      }
    }

    for (const [paymentIndex, payment] of (
      document.payments?.payments ?? []
    ).entries()) {
      const paymentId = randomUUID();
      await manager.query(
        `INSERT INTO cfdi_payments (
           id, organization_id, client_account_id, legal_entity_id, cfdi_id,
           ordinal, payment_date, payment_form, currency, exchange_rate,
           amount, operation_number, payer_bank_rfc, payer_foreign_bank_name,
           payer_account, beneficiary_bank_rfc, beneficiary_account
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          paymentId,
          ...scope,
          cfdiId,
          paymentIndex + 1,
          zonedDateTime(payment.paidAt, timezone),
          payment.paymentForm,
          payment.currency,
          payment.exchangeRate ?? null,
          payment.amount,
          payment.operationNumber ?? null,
          payment.payerRfc ?? null,
          payment.payerForeignBankName ?? null,
          payment.payerAccount ?? null,
          payment.beneficiaryRfc ?? null,
          payment.beneficiaryAccount ?? null,
        ],
      );
      for (const [taxIndex, line] of payment.taxes.lines.entries()) {
        await this.insertTax(manager, job, cfdiId, {
          line,
          scopeType: 'payment',
          ordinal: taxIndex + 1,
          paymentId,
        });
      }
      for (const [
        documentIndex,
        related,
      ] of payment.relatedDocuments.entries()) {
        const paymentDocumentId = randomUUID();
        await manager.query(
          `INSERT INTO cfdi_payment_documents (
             id, organization_id, client_account_id, legal_entity_id, cfdi_id,
             payment_id, ordinal, related_uuid, series, folio, currency,
             equivalence, installment_number, previous_balance, paid_amount,
             remaining_balance, tax_object_code
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            paymentDocumentId,
            ...scope,
            cfdiId,
            paymentId,
            documentIndex + 1,
            related.uuid.toLowerCase(),
            related.series ?? null,
            related.folio ?? null,
            related.currency,
            related.equivalence ?? null,
            Number(related.partialityNumber),
            related.previousBalance,
            related.paidAmount,
            related.unpaidBalance,
            related.taxObject!,
          ],
        );
        for (const [taxIndex, line] of related.taxes.lines.entries()) {
          await this.insertTax(manager, job, cfdiId, {
            line,
            scopeType: 'payment_document',
            ordinal: taxIndex + 1,
            paymentId,
            paymentDocumentId,
          });
        }
      }
    }

    if (document.payroll) {
      const payroll = document.payroll;
      const payrollId = randomUUID();
      await manager.query(
        `INSERT INTO cfdi_payrolls (
           id, organization_id, client_account_id, legal_entity_id, cfdi_id,
           payroll_version, payroll_type, payment_date, initial_payment_date,
           final_payment_date, paid_days, total_perceptions, total_deductions,
           total_other_payments, employer_registration, employee_curp,
           employee_social_security_number, employment_start_date, seniority,
           contract_type, regime_type, employee_number, position, risk_position,
           payment_periodicity, bank_code, bank_account, base_salary,
           integrated_daily_salary, state_code
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
           $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
         )`,
        [
          payrollId,
          ...scope,
          cfdiId,
          payroll.version,
          payroll.payrollType,
          zonedDateTime(payroll.paymentDate, timezone),
          zonedDateTime(payroll.initialPaymentDate, timezone),
          zonedDateTime(payroll.finalPaymentDate, timezone),
          payroll.paidDays,
          payroll.totalPerceptions ?? null,
          payroll.totalDeductions ?? null,
          payroll.totalOtherPayments ?? null,
          payroll.issuer?.employerRegistration ?? null,
          payroll.receiver.curp,
          payroll.receiver.socialSecurityNumber ?? null,
          payroll.receiver.employmentStartDate
            ? zonedDateTime(payroll.receiver.employmentStartDate, timezone)
            : null,
          payroll.receiver.seniority ?? null,
          payroll.receiver.contractType ?? null,
          payroll.receiver.regimeType,
          payroll.receiver.employeeNumber,
          payroll.receiver.position ?? null,
          payroll.receiver.occupationalRisk ?? null,
          payroll.receiver.paymentFrequency,
          payroll.receiver.bank ?? null,
          payroll.receiver.bankAccount ?? null,
          payroll.receiver.contributionBaseSalary ?? null,
          payroll.receiver.integratedDailySalary ?? null,
          payroll.receiver.federalEntityCode,
        ],
      );
      for (const [index, perception] of payroll.perceptions.entries()) {
        await manager.query(
          `INSERT INTO cfdi_payroll_perceptions (
             id, organization_id, client_account_id, legal_entity_id,
             payroll_id, ordinal, perception_type, key, concept,
             taxable_amount, exempt_amount
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            randomUUID(),
            ...scope,
            payrollId,
            index + 1,
            perception.perceptionType,
            perception.code,
            perception.description,
            perception.taxableAmount,
            perception.exemptAmount,
          ],
        );
      }
      for (const [index, deduction] of payroll.deductions.entries()) {
        await manager.query(
          `INSERT INTO cfdi_payroll_deductions (
             id, organization_id, client_account_id, legal_entity_id,
             payroll_id, ordinal, deduction_type, key, concept, amount
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            randomUUID(),
            ...scope,
            payrollId,
            index + 1,
            deduction.deductionType,
            deduction.code,
            deduction.description,
            deduction.amount,
          ],
        );
      }
      for (const [index, other] of payroll.otherPayments.entries()) {
        await manager.query(
          `INSERT INTO cfdi_payroll_other_payments (
             id, organization_id, client_account_id, legal_entity_id,
             payroll_id, ordinal, other_payment_type, key, concept, amount
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            randomUUID(),
            ...scope,
            payrollId,
            index + 1,
            other.otherPaymentType,
            other.code,
            other.description,
            other.amount,
          ],
        );
      }
      for (const [index, incapacity] of payroll.incapacities.entries()) {
        await manager.query(
          `INSERT INTO cfdi_payroll_incapacities (
             id, organization_id, client_account_id, legal_entity_id,
             payroll_id, ordinal, incapacity_days, incapacity_type, amount
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            ...scope,
            payrollId,
            index + 1,
            incapacity.days,
            incapacity.incapacityType,
            incapacity.amount ?? null,
          ],
        );
      }
    }
  }

  private insertTax(
    manager: EntityManager,
    job: ClaimResult,
    cfdiId: string,
    input: {
      line: CfdiTaxLine;
      scopeType: 'document' | 'concept' | 'payment' | 'payment_document';
      ordinal: number;
      conceptId?: string;
      paymentId?: string;
      paymentDocumentId?: string;
    },
  ): Promise<unknown> {
    const line = input.line;
    const isAggregateWithholding =
      line.kind === 'withholding' &&
      (input.scopeType === 'document' || input.scopeType === 'payment') &&
      line.factorType === undefined;
    return manager.query(
      `INSERT INTO cfdi_taxes (
         id, organization_id, client_account_id, legal_entity_id, cfdi_id,
         concept_id, payment_id, payment_document_id, scope_type, direction,
         ordinal, tax_code, factor_type, base_amount, rate_or_quota, amount
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        randomUUID(),
        job.organizationId,
        job.clientAccountId,
        job.legalEntityId,
        cfdiId,
        input.conceptId ?? null,
        input.paymentId ?? null,
        input.paymentDocumentId ?? null,
        input.scopeType,
        line.kind === 'transfer' ? 'transferred' : 'withheld',
        input.ordinal,
        line.tax,
        isAggregateWithholding ? null : taxFactor(line.factorType),
        line.base ?? null,
        line.rateOrQuota ?? null,
        line.amount ?? null,
      ],
    );
  }

  private async insertPeriodParticipation(
    manager: EntityManager,
    job: ClaimResult,
    input: WorkerInput,
    cfdiId: string,
    document: ParsedCfdi,
    timezone: string,
  ): Promise<number> {
    const candidates: Array<{
      type: 'document_issue' | 'payment' | 'payroll';
      value: string;
      ordinal: number;
    }> = [];
    if (['I', 'E', 'T'].includes(document.documentType)) {
      candidates.push({
        type: 'document_issue',
        value: document.issuedAt,
        ordinal: 1,
      });
    } else if (document.documentType === 'P') {
      for (const [index, payment] of (
        document.payments?.payments ?? []
      ).entries()) {
        candidates.push({
          type: 'payment',
          value: payment.paidAt,
          ordinal: index + 1,
        });
      }
    } else if (document.documentType === 'N' && document.payroll) {
      candidates.push({
        type: 'payroll',
        value: document.payroll.paymentDate,
        ordinal: 1,
      });
    }
    let missing = 0;
    for (const candidate of candidates) {
      const sourceDate = zonedDateTime(candidate.value, timezone);
      const { year, month } = localYearMonth(candidate.value);
      const periodRows = await manager.query<Array<{ id: string }>>(
        `SELECT period.id
           FROM fiscal_years year
           INNER JOIN periods period
             ON period.organization_id = year.organization_id
            AND period.client_account_id = year.client_account_id
            AND period.legal_entity_id = year.legal_entity_id
            AND period.fiscal_year_id = year.id
          WHERE year.organization_id = $1
            AND year.client_account_id = $2
            AND year.legal_entity_id = $3
            AND year.year = $4
            AND period.month = $5`,
        [
          job.organizationId,
          job.clientAccountId,
          job.legalEntityId,
          year,
          month,
        ],
      );
      if (!periodRows[0]) {
        missing += 1;
        continue;
      }
      await manager.query(
        `INSERT INTO period_cfdis (
           id, organization_id, client_account_id, legal_entity_id, cfdi_id,
           period_id, participation_type, policy_version, timezone,
           source_date, source_ordinal, origin, created_by_membership_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'automatic',NULL)`,
        [
          randomUUID(),
          job.organizationId,
          job.clientAccountId,
          job.legalEntityId,
          cfdiId,
          periodRows[0].id,
          candidate.type,
          PERIOD_POLICY_VERSION,
          timezone,
          sourceDate,
          candidate.ordinal,
        ],
      );
    }
    return missing;
  }

  private async finishItem(
    manager: EntityManager,
    job: ClaimResult,
    input: WorkerInput,
    outcome: {
      result: PublishedItemResult;
      errorCode?: string;
      cfdiId?: string;
      parsed?: CfdiParseResult;
      parserAttempted?: boolean;
    },
  ): Promise<void> {
    const parsed = outcome.parsed;
    const parserAttempted = outcome.parserAttempted === true || Boolean(parsed);
    await manager.query(
      `UPDATE ingestion_items
          SET technical_status = 'terminal',
              product_result = $3,
              error_code = $4,
              safe_error_detail = NULL,
              cfdi_id = $5,
              parser_version = $6,
              schema_version = $7,
              parsed_cfdi_version = $8,
              normalized_uuid = $9,
              issuer_rfc = $10,
              receiver_rfc = $11,
              document_type = $12,
              parser_completed_at = $13,
              processed_at = clock_timestamp(),
              updated_at = clock_timestamp(),
              version = version + 1
        WHERE organization_id = $1 AND id = $2`,
      [
        job.organizationId,
        input.itemId,
        outcome.result,
        outcome.errorCode ?? null,
        outcome.cfdiId ?? null,
        parsed?.parserVersion ?? (parserAttempted ? CFDI_PARSER_VERSION : null),
        parsed?.schemaVersion ??
          (parserAttempted ? CFDI_SCHEMA_SET_VERSION : null),
        parsed?.document.version ?? null,
        parsed?.document.stamp.uuid.toLowerCase() ?? null,
        parsed?.document.issuer.rfc ?? null,
        parsed?.document.receiver.rfc ?? null,
        parsed?.document.documentType ?? null,
        parserAttempted ? new Date() : null,
      ],
    );
    const fenced = await manager.query<Array<{ id: string }>>(
      `WITH published AS (
         UPDATE ingestion_jobs job
            SET current_stage = NULL,
              total_items = aggregate.total_items,
              pending_items = aggregate.pending_items,
              processing_items = aggregate.processing_items,
              incorporated_items = aggregate.incorporated_items,
              duplicate_items = aggregate.duplicate_items,
              foreign_items = aggregate.foreign_items,
              invalid_items = aggregate.invalid_items,
              unsupported_items = aggregate.unsupported_items,
              internal_error_items = aggregate.internal_error_items,
              counters_reconciled_at = clock_timestamp(),
              updated_at = clock_timestamp(),
              version = version + 1
           FROM (
           SELECT count(*)::integer AS total_items,
                  count(*) FILTER (WHERE technical_status = 'pending')::integer AS pending_items,
                  count(*) FILTER (WHERE technical_status = 'processing')::integer AS processing_items,
                  count(*) FILTER (WHERE product_result = 'incorporated')::integer AS incorporated_items,
                  count(*) FILTER (WHERE product_result = 'duplicate')::integer AS duplicate_items,
                  count(*) FILTER (WHERE product_result = 'foreign')::integer AS foreign_items,
                  count(*) FILTER (WHERE product_result = 'invalid')::integer AS invalid_items,
                  count(*) FILTER (WHERE product_result = 'unsupported')::integer AS unsupported_items,
                  count(*) FILTER (WHERE product_result = 'internal_error')::integer AS internal_error_items
             FROM ingestion_items
            WHERE organization_id = $1 AND ingestion_job_id = $2
         ) aggregate
          WHERE job.organization_id = $1
            AND job.id = $2
            AND job.locked_by = $3
            AND job.status = 'processing'
            AND job.lease_expires_at > clock_timestamp()
        RETURNING job.id
       )
       SELECT id FROM published`,
      [job.organizationId, job.jobId, job.leaseToken],
    );
    if (fenced.length !== 1) throw leaseLost();
    await manager.query(
      `INSERT INTO audit_events (
         organization_id, actor_type, service_principal,
         client_account_id, legal_entity_id, action, decision,
         object_type, object_id, correlation_id, metadata
       ) VALUES (
         $1,'service','cfdi-worker',$2,$3,'cfdi.ingestion.item_published',
         'ALLOW','ingestion_item',$4,$5,jsonb_build_object('result',$6::text)
       )`,
      [
        job.organizationId,
        job.clientAccountId,
        job.legalEntityId,
        input.itemId,
        job.correlationId,
        outcome.result,
      ],
    );
  }

  private insertIncident(
    manager: EntityManager,
    job: ClaimResult,
    input: WorkerInput,
    cfdiId: string | null,
    incident: {
      code: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
    },
  ): Promise<unknown> {
    return manager.query(
      `INSERT INTO incidents (
         id, organization_id, client_account_id, legal_entity_id,
         cfdi_id, ingestion_item_id, stored_object_id, code, severity,
         status, safe_detail
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',NULL)`,
      [
        randomUUID(),
        job.organizationId,
        job.clientAccountId,
        job.legalEntityId,
        cfdiId,
        input.itemId,
        input.objectId,
        incident.code,
        incident.severity,
      ],
    );
  }

  private async requireFence(
    manager: EntityManager,
    job: ClaimResult,
  ): Promise<void> {
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM ingestion_jobs
        WHERE organization_id = $1 AND id = $2 AND locked_by = $3
          AND status = 'processing' AND lease_expires_at > clock_timestamp()`,
      [job.organizationId, job.jobId, job.leaseToken],
    );
    if (rows.length !== 1) throw leaseLost();
  }

  private async updateStage(
    manager: EntityManager,
    job: ClaimResult,
    stage: 'scanning' | 'parsing' | 'persisting',
  ): Promise<void> {
    const rows = await manager.query<Array<{ id: string }>>(
      `WITH staged AS (
         UPDATE ingestion_jobs
            SET current_stage = $4,
                updated_at = clock_timestamp(),
                version = version + 1
          WHERE organization_id = $1 AND id = $2 AND locked_by = $3
            AND status = 'processing' AND lease_expires_at > clock_timestamp()
        RETURNING id
       )
       SELECT id FROM staged`,
      [job.organizationId, job.jobId, job.leaseToken, stage],
    );
    if (rows.length !== 1) throw leaseLost();
  }

  private assertPersistable(document: ParsedCfdi): void {
    if (
      document.concepts.some(
        (concept) => !concept.taxObject || !concept.productServiceCode,
      ) ||
      (document.documentType === 'P' && !document.payments) ||
      (document.documentType === 'N' && !document.payroll) ||
      (document.payments?.payments ?? []).some((payment) =>
        payment.relatedDocuments.some(
          (related) =>
            !related.taxObject || !/^\d+$/.test(related.partialityNumber),
        ),
      )
    ) {
      throw new DurableWorkerError('XML_MALFORMED', { retryable: false });
    }
  }

  private run<T>(
    job: ClaimResult,
    work: (manager: EntityManager) => Promise<T>,
  ) {
    return this.transactions.runAsWorker(
      {
        organizationId: job.organizationId,
        membershipId: job.requestedByMembershipId,
      },
      work,
    );
  }
}

function taxFactor(value: string | undefined): 'rate' | 'quota' | 'exempt' {
  switch (value?.toLowerCase()) {
    case 'tasa':
    case 'rate':
      return 'rate';
    case 'cuota':
    case 'quota':
      return 'quota';
    case 'exento':
    case 'exempt':
      return 'exempt';
    default:
      throw new DurableWorkerError('XML_MALFORMED', { retryable: false });
  }
}

function safeTimeZone(value: string | null): string {
  const candidate = value?.trim() || FALLBACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function localYearMonth(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match)
    throw new DurableWorkerError('XML_MALFORMED', { retryable: false });
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function zonedDateTime(value: string, timeZone: string): Date {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const absolute = new Date(value);
    if (Number.isNaN(absolute.getTime())) throw malformedDate();
    return absolute;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (!match) throw malformedDate();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw malformedDate();
  }
  const target = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const calendarProbe = new Date(target);
  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day ||
    calendarProbe.getUTCHours() !== hour ||
    calendarProbe.getUTCMinutes() !== minute ||
    calendarProbe.getUTCSeconds() !== second
  ) {
    throw malformedDate();
  }
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      millisecond,
    );
    guess += target - represented;
  }
  const result = new Date(guess);
  if (Number.isNaN(result.getTime())) throw malformedDate();
  const represented = Object.fromEntries(
    formatter
      .formatToParts(result)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  if (
    Number(represented.year) !== year ||
    Number(represented.month) !== month ||
    Number(represented.day) !== day ||
    Number(represented.hour) !== hour ||
    Number(represented.minute) !== minute ||
    Number(represented.second) !== second
  ) {
    throw malformedDate();
  }
  return result;
}

function malformedDate(): DurableWorkerError {
  return new DurableWorkerError('XML_MALFORMED', { retryable: false });
}

function rootUnavailable(): DurableWorkerError {
  return new DurableWorkerError('JOB_ROOT_OBJECT_UNAVAILABLE', {
    retryable: true,
  });
}

function leaseLost(): DurableWorkerError {
  return new DurableWorkerError('JOB_LEASE_LOST', { retryable: false });
}
