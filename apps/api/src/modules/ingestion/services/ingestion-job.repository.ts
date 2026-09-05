import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { assertCanonicalFiscalErrorCode } from '../../../common/observability/fiscal-error-code';
import type { FiscalPlatformConfig } from '../../../config/fiscal-platform.config';
import {
  FiscalApiTenantScope,
  FiscalTenantTransactionService,
} from '../../../database/rls/fiscal-tenant-transaction.service';
import {
  IngestionJobSourceType,
  IngestionJobStatus,
} from '../entities/ingestion-job.entity';

const WORKER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const SUPPORTED_SOURCE_TYPES = new Set<string>(
  Object.values(IngestionJobSourceType),
);

export interface ClaimResult {
  jobId: string;
  organizationId: string;
  clientAccountId: string;
  legalEntityId: string;
  sourceType: IngestionJobSourceType;
  uploadId: string | null;
  rootObjectId: string | null;
  requestedByMembershipId: string | null;
  correlationId: string;
  attemptCount: number;
  queueAgeSeconds: number;
  version: number;
  recovered: boolean;
  workerId: string;
  leaseToken: string;
}

export type JobLeaseIdentity = Pick<
  ClaimResult,
  | 'jobId'
  | 'organizationId'
  | 'requestedByMembershipId'
  | 'workerId'
  | 'leaseToken'
>;

export type HeartbeatResult = 'renewed' | 'cancel_requested' | 'lost';

export interface RetryScheduleResult {
  status:
    | typeof IngestionJobStatus.FAILED_RETRYABLE
    | typeof IngestionJobStatus.FAILED_FINAL;
  nextAttemptAt: Date | null;
  automaticRetryCount: number;
  version: number;
}

export interface FoundationReconciliationResult {
  leaseRetryableCount: number;
  leaseFinalCount: number;
  leaseCancelledCount: number;
  expiredUploadCount: number;
  rejectedOrphanObjectCount: number;
  confirmedObjectWithoutJobCount: number;
  orphanJobCount: number;
  repairedCounterCount: number;
  redundantObjectCount: number;
  retentionEligibleObjectCount: number;
}

export interface QueueAgeResult {
  sourceType: IngestionJobSourceType;
  queueAgeSeconds: number;
}

export type CompletionStatus =
  | typeof IngestionJobStatus.COMPLETED
  | typeof IngestionJobStatus.COMPLETED_WITH_ISSUES
  | typeof IngestionJobStatus.CANCELLED;

interface ClaimRow {
  job_id: string;
  organization_id: string;
  client_account_id: string;
  legal_entity_id: string;
  source_type: IngestionJobSourceType;
  upload_id: string | null;
  root_object_id: string | null;
  requested_by_membership_id: string | null;
  correlation_id: string;
  attempt_count: number;
  queue_age_seconds: number | string;
  version: number;
  recovered: boolean;
  lease_token: string;
}

interface RetryScheduleRow {
  status: RetryScheduleResult['status'];
  next_attempt_at: Date | null;
  automatic_retry_count: number;
  version: number;
}

interface TerminalJobRow {
  id: string;
  organization_id: string;
  client_account_id: string;
  legal_entity_id: string;
  correlation_id: string;
  source_type: IngestionJobSourceType;
  version: number;
}

interface RetryTransitionRow extends RetryScheduleRow, TerminalJobRow {}

interface FoundationReconciliationRow {
  lease_retryable_count: number;
  lease_final_count: number;
  lease_cancelled_count: number;
  expired_upload_count: number;
  rejected_orphan_object_count: number;
  confirmed_object_without_job_count: number;
  orphan_job_count: number;
  repaired_counter_count: number;
  redundant_object_count: number;
  retention_eligible_object_count: number;
}

interface QueueAgeRow {
  source_type: IngestionJobSourceType;
  queue_age_seconds: number | string;
}

@Injectable()
export class IngestionJobRepository {
  private readonly worker: FiscalPlatformConfig['worker'];
  private readonly retention: FiscalPlatformConfig['retention'];
  private readonly activeJobsPerTenant: number;

  constructor(
    private readonly tenantTransactions: FiscalTenantTransactionService,
    config: ConfigService,
  ) {
    const platform = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
    this.worker = platform.worker;
    this.retention = platform.retention;
    this.activeJobsPerTenant = platform.limits.activeJobsPerTenant;
    if (
      this.worker.leaseSeconds !== 90 ||
      this.worker.maxAttempts !== 4 ||
      this.worker.maxRetries !== 3 ||
      this.worker.backoffSeconds.join(',') !== '10,30,120' ||
      this.activeJobsPerTenant !== 4 ||
      this.retention.orphanGraceMinutes !== 60 ||
      this.retention.duplicateBytesHours !== 24 ||
      this.retention.invalidObjectDays !== 7
    ) {
      throw new Error(
        'Durable ingestion repository requires the locked Phase 0 worker and reconciliation policy',
      );
    }
  }

  async claimNext(
    workerId: string,
    supportedSources: readonly string[],
  ): Promise<ClaimResult | null> {
    this.assertWorkerId(workerId);
    const sources = [...new Set(supportedSources)];
    if (
      sources.length === 0 ||
      sources.some((source) => !SUPPORTED_SOURCE_TYPES.has(source))
    ) {
      throw new Error('At least one valid ingestion source must be supported');
    }

    const leaseToken = randomUUID();
    const rows = await this.tenantTransactions.runWorkerMaintenance(
      async (manager) =>
        await manager.query<ClaimRow[]>(
          `SELECT *
             FROM claim_ingestion_job($1, $2, $3::text[], $4, $5, $6, $7)`,
          [
            workerId,
            leaseToken,
            sources,
            this.worker.leaseSeconds,
            this.worker.maxAttempts,
            this.worker.maxRetries,
            this.activeJobsPerTenant,
          ],
        ),
    );
    const row = rows[0];
    if (!row) return null;

    return {
      jobId: row.job_id,
      organizationId: row.organization_id,
      clientAccountId: row.client_account_id,
      legalEntityId: row.legal_entity_id,
      sourceType: row.source_type,
      uploadId: row.upload_id,
      rootObjectId: row.root_object_id,
      requestedByMembershipId: row.requested_by_membership_id,
      correlationId: row.correlation_id,
      attemptCount: row.attempt_count,
      queueAgeSeconds: Number(row.queue_age_seconds),
      version: row.version,
      recovered: row.recovered,
      workerId,
      leaseToken: row.lease_token,
    };
  }

  async queueAges(
    supportedSources: readonly string[],
  ): Promise<QueueAgeResult[]> {
    const sources = [...new Set(supportedSources)];
    if (
      sources.length === 0 ||
      sources.some((source) => !SUPPORTED_SOURCE_TYPES.has(source))
    ) {
      throw new Error('At least one valid ingestion source must be supported');
    }
    const rows = await this.tenantTransactions.runWorkerMaintenance(
      async (manager) =>
        manager.query<QueueAgeRow[]>(
          `SELECT * FROM ingestion_queue_ages($1::text[], $2, $3)`,
          [sources, this.worker.maxAttempts, this.worker.maxRetries],
        ),
    );
    const observed = new Map(
      rows.map((row) => [row.source_type, Number(row.queue_age_seconds)]),
    );
    return sources.map((source) => ({
      sourceType: source as IngestionJobSourceType,
      queueAgeSeconds: observed.get(source as IngestionJobSourceType) ?? 0,
    }));
  }

  heartbeat(claim: JobLeaseIdentity): Promise<HeartbeatResult> {
    this.assertLeaseIdentity(claim);
    return this.withClaimScope(claim, async (manager) => {
      const rows = await manager.query<Array<{ outcome: HeartbeatResult }>>(
        `WITH owned AS MATERIALIZED (
           SELECT
             id, organization_id, client_account_id, legal_entity_id,
             correlation_id, status
           FROM ingestion_jobs
           WHERE id = $1
             AND organization_id = $2
             AND locked_by = $3
             AND status IN ('processing','cancel_requested')
             AND lease_expires_at > clock_timestamp()
           FOR UPDATE
         ),
         renewed AS (
           UPDATE ingestion_jobs AS job
              SET heartbeat_at = clock_timestamp(),
                  lease_expires_at = clock_timestamp() + make_interval(secs => $4::integer),
                  updated_at = clock_timestamp(),
                  version = job.version + 1
             FROM owned
            WHERE job.id = owned.id
              AND owned.status = 'processing'
           RETURNING job.id
         )
         SELECT CASE
           WHEN owned.status = 'cancel_requested' THEN 'cancel_requested'
           WHEN renewed.id IS NOT NULL THEN 'renewed'
           ELSE 'lost'
         END AS outcome
         FROM owned
         LEFT JOIN renewed ON renewed.id = owned.id`,
        [
          claim.jobId,
          claim.organizationId,
          claim.leaseToken,
          this.worker.leaseSeconds,
        ],
      );
      return rows[0]?.outcome ?? 'lost';
    });
  }

  failFinal(
    claim: JobLeaseIdentity,
    errorCode: string,
    safeDetail?: string,
  ): Promise<boolean> {
    this.assertLeaseIdentity(claim);
    this.assertSafeError(errorCode, safeDetail);
    return this.withClaimScope(claim, async (manager) => {
      const rows = await manager.query<TerminalJobRow[]>(
        `WITH failed AS (
           UPDATE ingestion_jobs
              SET status = 'failed_final',
                  next_attempt_at = NULL,
                  locked_by = NULL,
                  lease_expires_at = NULL,
                  completed_at = clock_timestamp(),
                  last_error_code = $4,
                  last_error_detail = $5,
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND organization_id = $2
              AND locked_by = $3
              AND status = 'processing'
              AND lease_expires_at > clock_timestamp()
          RETURNING
            id, organization_id, client_account_id, legal_entity_id,
            correlation_id, source_type, version
         )
         SELECT * FROM failed`,
        [
          claim.jobId,
          claim.organizationId,
          claim.leaseToken,
          errorCode,
          safeDetail ?? null,
        ],
      );
      const failed = rows[0];
      if (!failed) return false;
      if (failed.source_type === IngestionJobSourceType.MANUAL_XML) {
        failed.version = await this.terminalizeManualXmlItems(
          manager,
          failed,
          errorCode,
          safeDetail,
        );
      }
      await manager.query(
        `INSERT INTO audit_events (
           organization_id, actor_type, service_principal,
           client_account_id, legal_entity_id, action, decision,
           object_type, object_id, reason, correlation_id, metadata
         ) VALUES (
           $1,'service','cfdi-worker',$2,$3,
           'ingestion.job.failed_final','ALLOW','ingestion_job',$4,
           'Worker reported a terminal error.',$5,
           jsonb_build_object('error_code',$6::text)
         )`,
        [
          failed.organization_id,
          failed.client_account_id,
          failed.legal_entity_id,
          failed.id,
          failed.correlation_id,
          errorCode,
        ],
      );
      return true;
    });
  }

  complete(
    claim: JobLeaseIdentity,
    status: CompletionStatus,
  ): Promise<boolean> {
    this.assertLeaseIdentity(claim);
    if (
      ![
        IngestionJobStatus.COMPLETED,
        IngestionJobStatus.COMPLETED_WITH_ISSUES,
        IngestionJobStatus.CANCELLED,
      ].includes(status)
    ) {
      throw new Error('Invalid terminal ingestion job status');
    }

    return this.withClaimScope(claim, async (manager) => {
      const rows = await manager.query<Array<{ version: number }>>(
        `WITH completed AS (
           UPDATE ingestion_jobs
              SET status = $4,
                  current_stage = NULL,
                  next_attempt_at = NULL,
                  locked_by = NULL,
                  lease_expires_at = NULL,
                  completed_at = clock_timestamp(),
                  last_error_code = CASE WHEN $4 = 'cancelled' THEN last_error_code ELSE NULL END,
                  last_error_detail = CASE WHEN $4 = 'cancelled' THEN last_error_detail ELSE NULL END,
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND organization_id = $2
              AND locked_by = $3
              AND lease_expires_at > clock_timestamp()
              AND (
                (status = 'processing' AND $4 IN ('completed','completed_with_issues'))
                OR (status = 'cancel_requested' AND $4 = 'cancelled')
              )
          RETURNING
            id, organization_id, client_account_id, legal_entity_id,
            correlation_id, status, version
         ),
         audited AS (
           INSERT INTO audit_events (
             organization_id, actor_type, service_principal,
             client_account_id, legal_entity_id, action, decision,
             object_type, object_id, reason, correlation_id, metadata
           )
           SELECT
             completed.organization_id, 'service', 'cfdi-worker',
             completed.client_account_id, completed.legal_entity_id,
             'ingestion.job.completed', 'ALLOW',
             'ingestion_job', completed.id, 'Worker completed durable job.',
             completed.correlation_id,
             jsonb_build_object('status', completed.status)
           FROM completed
           RETURNING 1
         )
         SELECT version FROM completed`,
        [claim.jobId, claim.organizationId, claim.leaseToken, status],
      );
      return rows.length === 1;
    });
  }

  scheduleRetry(
    claim: JobLeaseIdentity,
    errorCode: string,
    safeDetail?: string,
  ): Promise<RetryScheduleResult | null> {
    this.assertLeaseIdentity(claim);
    this.assertSafeError(errorCode, safeDetail);

    return this.withClaimScope(claim, async (manager) => {
      const rows = await manager.query<RetryTransitionRow[]>(
        `WITH scheduled AS (
           UPDATE ingestion_jobs
            SET status = CASE
                    WHEN automatic_retry_count >= $6 THEN 'failed_final'
                    ELSE 'failed_retryable'
                  END,
                  automatic_retry_count = CASE
                    WHEN automatic_retry_count >= $6 THEN automatic_retry_count
                    ELSE automatic_retry_count + 1
                  END,
                  next_attempt_at = CASE
                    WHEN automatic_retry_count >= $6 THEN NULL
                    ELSE clock_timestamp()
                      + make_interval(
                          secs => ($7::integer[])[least(automatic_retry_count + 1, cardinality($7::integer[]))]
                            + floor(
                                random()
                                * (
                                    ($7::integer[])[least(automatic_retry_count + 1, cardinality($7::integer[]))]
                                    * $8::integer / 100.0
                                    + 1
                                  )
                              )::integer
                        )
                  END,
                  locked_by = NULL,
                  lease_expires_at = NULL,
                  completed_at = CASE
                    WHEN automatic_retry_count >= $6 THEN clock_timestamp()
                    ELSE NULL
                  END,
                  last_error_code = $4,
                  last_error_detail = $5,
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND organization_id = $2
              AND locked_by = $3
              AND status = 'processing'
              AND lease_expires_at > clock_timestamp()
          RETURNING
            id, organization_id, client_account_id, legal_entity_id,
            correlation_id, source_type, status, next_attempt_at,
            automatic_retry_count, version
         )
         SELECT * FROM scheduled`,
        [
          claim.jobId,
          claim.organizationId,
          claim.leaseToken,
          errorCode,
          safeDetail ?? null,
          this.worker.maxRetries,
          this.worker.backoffSeconds,
          this.worker.backoffJitterPercent,
        ],
      );
      const row = rows[0];
      if (
        row?.status === IngestionJobStatus.FAILED_FINAL &&
        row.source_type === IngestionJobSourceType.MANUAL_XML
      ) {
        row.version = await this.terminalizeManualXmlItems(
          manager,
          row,
          errorCode,
          safeDetail,
        );
      }
      if (row) {
        const retryable = row.status === IngestionJobStatus.FAILED_RETRYABLE;
        await manager.query(
          `INSERT INTO audit_events (
             organization_id, actor_type, service_principal,
             client_account_id, legal_entity_id, action, decision,
             object_type, object_id, reason, correlation_id, metadata
           ) VALUES (
             $1,'service','cfdi-worker',$2,$3,$4,'ALLOW',
             'ingestion_job',$5,$6,$7,
             jsonb_build_object(
               'status',$8::text,
               'error_code',$9::text,
               'automatic_retry_count',$10::integer
             )
           )`,
          [
            row.organization_id,
            row.client_account_id,
            row.legal_entity_id,
            retryable
              ? 'ingestion.job.retry_scheduled'
              : 'ingestion.job.retry_exhausted',
            row.id,
            retryable
              ? 'Worker scheduled durable automatic retry.'
              : 'Worker exhausted the durable automatic retry budget.',
            row.correlation_id,
            row.status,
            errorCode,
            row.automatic_retry_count,
          ],
        );
      }
      return row
        ? {
            status: row.status,
            nextAttemptAt: row.next_attempt_at,
            automaticRetryCount: row.automatic_retry_count,
            version: row.version,
          }
        : null;
    });
  }

  releaseForShutdown(claim: JobLeaseIdentity): Promise<boolean> {
    this.assertLeaseIdentity(claim);
    return this.withClaimScope(claim, async (manager) => {
      const rows = await manager.query<Array<{ version: number }>>(
        `WITH released AS (
           UPDATE ingestion_jobs
              SET status = CASE
                    WHEN status = 'cancel_requested' THEN 'cancelled'
                    ELSE 'queued'
                  END,
                  next_attempt_at = CASE
                    WHEN status = 'cancel_requested' THEN NULL
                    ELSE clock_timestamp()
                  END,
                  locked_by = NULL,
                  lease_expires_at = NULL,
                  current_stage = NULL,
                  completed_at = CASE
                    WHEN status = 'cancel_requested' THEN clock_timestamp()
                    ELSE NULL
                  END,
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND organization_id = $2
              AND locked_by = $3
              AND status IN ('processing','cancel_requested')
              AND lease_expires_at > clock_timestamp()
          RETURNING
            id, organization_id, client_account_id, legal_entity_id,
            correlation_id, status, version
         ),
         audited AS (
           INSERT INTO audit_events (
             organization_id, actor_type, service_principal,
             client_account_id, legal_entity_id, action, decision,
             object_type, object_id, reason, correlation_id, metadata
           )
           SELECT
             released.organization_id, 'service', 'cfdi-worker',
             released.client_account_id, released.legal_entity_id,
             'ingestion.job.shutdown_released', 'ALLOW',
             'ingestion_job', released.id, 'Worker released lease during shutdown.',
             released.correlation_id, jsonb_build_object('status', released.status)
           FROM released
           RETURNING 1
         )
         SELECT version FROM released`,
        [claim.jobId, claim.organizationId, claim.leaseToken],
      );
      return rows.length === 1;
    });
  }

  requestCancellation(
    scope: FiscalApiTenantScope,
    jobId: string,
  ): Promise<IngestionJobStatus | null> {
    return this.tenantTransactions.run(scope, async (manager) => {
      const rows = await manager.query<Array<{ status: IngestionJobStatus }>>(
        `SELECT request_ingestion_job_cancellation($1) AS status`,
        [jobId],
      );
      return rows[0]?.status ?? null;
    });
  }

  async reconcile(limit = 100): Promise<FoundationReconciliationResult> {
    if (limit !== 100) {
      throw new Error('Reconciliation limit must remain fixed at 100');
    }
    const rows = await this.tenantTransactions.runWorkerMaintenance(
      async (manager) =>
        await manager.query<FoundationReconciliationRow[]>(
          `SELECT *
             FROM reconcile_fiscal_ingestion_foundation($1, $2, $3, $4, $5::integer[], $6, $7, $8)`,
          [
            limit,
            this.retention.orphanGraceMinutes,
            this.retention.duplicateBytesHours,
            this.retention.invalidObjectDays,
            this.worker.backoffSeconds,
            this.worker.backoffJitterPercent,
            this.worker.maxAttempts,
            this.worker.maxRetries,
          ],
        ),
    );
    const row = rows[0];
    return {
      leaseRetryableCount: row?.lease_retryable_count ?? 0,
      leaseFinalCount: row?.lease_final_count ?? 0,
      leaseCancelledCount: row?.lease_cancelled_count ?? 0,
      expiredUploadCount: row?.expired_upload_count ?? 0,
      rejectedOrphanObjectCount: row?.rejected_orphan_object_count ?? 0,
      confirmedObjectWithoutJobCount:
        row?.confirmed_object_without_job_count ?? 0,
      orphanJobCount: row?.orphan_job_count ?? 0,
      repairedCounterCount: row?.repaired_counter_count ?? 0,
      redundantObjectCount: row?.redundant_object_count ?? 0,
      retentionEligibleObjectCount: row?.retention_eligible_object_count ?? 0,
    };
  }

  private withClaimScope<T>(
    claim: JobLeaseIdentity,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.tenantTransactions.runAsWorker(
      {
        organizationId: claim.organizationId,
        membershipId: claim.requestedByMembershipId,
      },
      work,
    );
  }

  private async terminalizeManualXmlItems(
    manager: EntityManager,
    job: TerminalJobRow,
    errorCode: string,
    safeDetail?: string,
  ): Promise<number> {
    await manager.query(
      `UPDATE ingestion_items
          SET technical_status = 'terminal',
              product_result = 'internal_error',
              error_code = $3,
              safe_error_detail = $4,
              processed_at = clock_timestamp(),
              updated_at = clock_timestamp(),
              version = version + 1
        WHERE organization_id = $1
          AND ingestion_job_id = $2
          AND technical_status IN ('pending','processing')`,
      [job.organization_id, job.id, errorCode, safeDetail ?? null],
    );
    const rows = await manager.query<Array<{ version: number }>>(
      `WITH aggregate AS MATERIALIZED (
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
       ), reconciled AS (
         UPDATE ingestion_jobs AS job
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
                version = job.version + 1
           FROM aggregate
          WHERE job.id = $2
            AND job.organization_id = $1
            AND job.source_type = 'manual_xml'
            AND job.status = 'failed_final'
        RETURNING job.version
       )
       SELECT version FROM reconciled`,
      [job.organization_id, job.id],
    );
    if (rows.length !== 1) {
      throw new Error('Manual XML terminal counter reconciliation failed');
    }
    return Number(rows[0].version);
  }

  private assertLeaseIdentity(claim: JobLeaseIdentity): void {
    this.assertWorkerId(claim.workerId);
    this.assertWorkerId(claim.leaseToken);
    if (!claim.jobId || !claim.organizationId) {
      throw new Error('Job and organization IDs are required');
    }
    if (claim.workerId === claim.leaseToken) {
      throw new Error('A unique lease token is required');
    }
  }

  private assertWorkerId(workerId: string): void {
    if (!WORKER_ID_PATTERN.test(workerId)) {
      throw new Error('Worker ID is invalid');
    }
  }

  private assertSafeError(errorCode: string, safeDetail?: string): void {
    assertCanonicalFiscalErrorCode(errorCode);
    if (
      safeDetail !== undefined &&
      (safeDetail.length > 500 || containsUnsafeControl(safeDetail))
    ) {
      throw new Error('Safe error detail is invalid');
    }
  }
}

function containsUnsafeControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}
