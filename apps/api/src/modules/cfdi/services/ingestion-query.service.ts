import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import { FiscalTenantTransactionService } from '../../../database/rls/fiscal-tenant-transaction.service';
import { ClientAccountScopeService } from '../../client-accounts/client-account-scope.service';
import {
  IngestionAdmissionLimitError,
  IngestionIdempotencyRepository,
  JobInputConflictError,
} from '../../ingestion/services/ingestion-idempotency.repository';
import { IngestionJobRepository } from '../../ingestion/services/ingestion-job.repository';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import { cfdiHttpError } from '../cfdi-http.errors';
import type {
  IngestionItemsQueryDto,
  ProcessesQueryDto,
} from '../dtos/cfdi-query.dtos';

interface JobRow {
  id: string;
  client_account_id: string;
  legal_entity_id: string;
  source_type: string;
  upload_id: string | null;
  root_object_id: string | null;
  requested_by_membership_id: string | null;
  retry_of_job_id: string | null;
  status: string;
  current_stage: string | null;
  total_items: number;
  pending_items: number;
  processing_items: number;
  incorporated_items: number;
  duplicate_items: number;
  foreign_items: number;
  invalid_items: number;
  unsupported_items: number;
  internal_error_items: number;
  attempt_count: number;
  automatic_retry_count: number;
  next_attempt_at: Date | null;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  version: number;
}

@Injectable()
export class IngestionQueryService {
  constructor(
    private readonly transactions: FiscalTenantTransactionService,
    private readonly accountScope: ClientAccountScopeService,
    private readonly jobs: IngestionJobRepository,
    private readonly idempotency: IngestionIdempotencyRepository,
  ) {}

  async get(jobId: string, tenant: SessionAuthorizationContext) {
    return this.run(tenant, async (manager) => {
      const job = await this.requireJob(manager, jobId, tenant);
      return this.jobResponse(job);
    });
  }

  async items(
    jobId: string,
    query: IngestionItemsQueryDto,
    tenant: SessionAuthorizationContext,
  ) {
    return this.run(tenant, async (manager) => {
      await this.requireJob(manager, jobId, tenant);
      const where = ['organization_id = $1', 'ingestion_job_id = $2'];
      const values: unknown[] = [tenant.organizationId, jobId];
      if (query.result) {
        values.push(query.result);
        where.push(`product_result = $${values.length}`);
      }
      const [{ total }] = await manager.query<Array<{ total: string }>>(
        `SELECT count(*)::text AS total FROM ingestion_items WHERE ${where.join(' AND ')}`,
        values,
      );
      const sort = query.sort === 'updatedAt' ? 'updated_at' : 'ordinal';
      const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
      values.push(query.limit, (query.page - 1) * query.limit);
      const rows = await manager.query<
        Array<{
          id: string;
          object_id: string | null;
          cfdi_id: string | null;
          ordinal: number;
          safe_filename: string | null;
          technical_status: string;
          product_result: string | null;
          error_code: string | null;
          safe_error_detail: string | null;
          attempt_count: number;
          parser_version: string | null;
          schema_version: string | null;
          parsed_cfdi_version: string | null;
          document_type: string | null;
          observed_at: Date;
          processed_at: Date | null;
          updated_at: Date;
          version: number;
        }>
      >(
        `SELECT id, object_id, cfdi_id, ordinal, safe_filename,
                technical_status, product_result, error_code, safe_error_detail,
                attempt_count, parser_version, schema_version,
                parsed_cfdi_version, document_type, observed_at, processed_at,
                updated_at, version
           FROM ingestion_items
          WHERE ${where.join(' AND ')}
          ORDER BY ${sort} ${direction}, id ${direction}
          LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          objectId: row.object_id,
          cfdiId: row.cfdi_id,
          ordinal: row.ordinal,
          filename: row.safe_filename,
          technicalStatus: row.technical_status,
          result: row.product_result,
          error: row.error_code
            ? { code: row.error_code, detail: row.safe_error_detail }
            : null,
          attemptCount: row.attempt_count,
          parser: row.parser_version
            ? {
                version: row.parser_version,
                schemaVersion: row.schema_version,
                cfdiVersion: row.parsed_cfdi_version,
              }
            : null,
          documentType: row.document_type,
          observedAt: row.observed_at,
          processedAt: row.processed_at,
          updatedAt: row.updated_at,
          version: row.version,
        })),
        meta: pageMeta(query.page, query.limit, Number(total)),
      };
    });
  }

  async processes(
    query: ProcessesQueryDto,
    tenant: SessionAuthorizationContext,
  ) {
    return this.run(tenant, async (manager) => {
      const where = ['job.organization_id = $1'];
      const values: unknown[] = [tenant.organizationId];
      if (tenant.accountAccessMode === 'assigned') {
        values.push(tenant.assignedAccountIds);
        where.push(`job.client_account_id = ANY($${values.length}::uuid[])`);
      }
      if (query.status) {
        values.push(query.status);
        where.push(`job.status = $${values.length}`);
      }
      if (query.source) {
        values.push(query.source);
        where.push(`job.source_type = $${values.length}`);
      } else {
        where.push(`job.source_type = 'manual_xml'`);
      }
      if (query.legalEntityId) {
        values.push(query.legalEntityId);
        where.push(`job.legal_entity_id = $${values.length}`);
      }
      const [{ total }] = await manager.query<Array<{ total: string }>>(
        `SELECT count(*)::text AS total FROM ingestion_jobs job WHERE ${where.join(' AND ')}`,
        values,
      );
      const sorts = {
        createdAt: 'job.created_at',
        updatedAt: 'job.updated_at',
        status: 'job.status',
      } as const;
      const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
      values.push(query.limit, (query.page - 1) * query.limit);
      const rows = await manager.query<JobRow[]>(
        `SELECT job.id, job.client_account_id, job.legal_entity_id,
                job.source_type, job.upload_id, job.root_object_id,
                job.requested_by_membership_id, job.retry_of_job_id,
                job.status, job.current_stage, job.total_items,
                job.pending_items, job.processing_items,
                job.incorporated_items, job.duplicate_items,
                job.foreign_items, job.invalid_items, job.unsupported_items,
                job.internal_error_items, job.attempt_count,
                job.automatic_retry_count, job.next_attempt_at,
                job.last_error_code, job.created_at, job.updated_at,
                job.completed_at, job.version
           FROM ingestion_jobs job
          WHERE ${where.join(' AND ')}
          ORDER BY ${sorts[query.sort]} ${direction}, job.id ${direction}
          LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return {
        items: rows.map((row) => this.jobResponse(row)),
        meta: pageMeta(query.page, query.limit, Number(total)),
      };
    });
  }

  async cancel(jobId: string, tenant: SessionAuthorizationContext) {
    await this.run(tenant, async (manager) => {
      const job = await this.requireJob(manager, jobId, tenant);
      this.assertCollaboratorOwns(job, tenant);
    });
    const status = await this.jobs.requestCancellation(
      {
        organizationId: tenant.organizationId!,
        membershipId: tenant.membershipId!,
      },
      jobId,
    );
    if (!status) {
      throw cfdiHttpError(
        HttpStatus.CONFLICT,
        'JOB_STATE_CONFLICT',
        'El proceso ya no puede cancelarse.',
      );
    }
    return { jobId, status };
  }

  async retry(
    jobId: string,
    idempotencyKey: string | undefined,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    assertIdempotencyKey(idempotencyKey);
    const original = await this.run(tenant, async (manager) => {
      const job = await this.requireJob(manager, jobId, tenant);
      this.assertCollaboratorOwns(job, tenant);
      if (
        job.status !== 'failed_final' ||
        !job.upload_id ||
        !job.root_object_id
      ) {
        throw cfdiHttpError(
          HttpStatus.CONFLICT,
          'JOB_NOT_RETRYABLE',
          'El proceso no admite un reintento manual.',
        );
      }
      const items = await manager.query<
        Array<{ safe_filename: string | null; sha256: string }>
      >(
        `SELECT safe_filename, sha256
           FROM ingestion_items
          WHERE organization_id = $1 AND ingestion_job_id = $2 AND ordinal = 1`,
        [tenant.organizationId, jobId],
      );
      if (!items[0]?.sha256) {
        throw cfdiHttpError(
          HttpStatus.CONFLICT,
          'JOB_NOT_RETRYABLE',
          'El proceso no conserva una entrada durable reintentable.',
        );
      }
      return {
        job,
        item: items[0],
        uploadId: job.upload_id,
        rootObjectId: job.root_object_id,
      };
    });
    const fingerprint = createHash('sha256')
      .update(
        [
          'manual_xml_retry_v1',
          tenant.organizationId,
          original.job.client_account_id,
          original.job.legal_entity_id,
          original.job.root_object_id,
          original.item.sha256,
          original.job.id,
        ].join('\n'),
      )
      .digest('hex');
    const result = await this.idempotency
      .createJob({
        scope: {
          organizationId: tenant.organizationId!,
          clientAccountId: original.job.client_account_id,
          legalEntityId: original.job.legal_entity_id,
          membershipId: tenant.membershipId!,
        },
        sourceType: 'manual_xml',
        idempotencyKey,
        requestFingerprint: fingerprint,
        idempotencyExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        correlationId: request.correlationId,
        status: 'queued',
        uploadId: original.uploadId,
        rootObjectId: original.rootObjectId,
        requestedByMembershipId: tenant.membershipId!,
        retryOfJobId: original.job.id,
        initialItem: {
          objectId: original.rootObjectId,
          safeFilename: original.item.safe_filename,
          sha256: original.item.sha256,
        },
      })
      .catch((error: unknown) => {
        if (error instanceof IngestionAdmissionLimitError) {
          throw cfdiHttpError(
            HttpStatus.TOO_MANY_REQUESTS,
            error.code,
            'Alcanzaste el límite de procesos de carga activos.',
          );
        }
        if (error instanceof JobInputConflictError) {
          throw cfdiHttpError(
            HttpStatus.CONFLICT,
            error.code,
            'El proceso cambió de estado; actualiza e intenta de nuevo.',
          );
        }
        throw error;
      });
    return { jobId: result.value.jobId, status: result.value.status };
  }

  private run<T>(
    tenant: SessionAuthorizationContext,
    work: (manager: EntityManager) => Promise<T>,
  ) {
    if (!tenant.organizationId || !tenant.membershipId) throw notFound();
    return this.transactions.run(
      {
        organizationId: tenant.organizationId,
        membershipId: tenant.membershipId,
      },
      work,
    );
  }

  private async requireJob(
    manager: EntityManager,
    jobId: string,
    tenant: SessionAuthorizationContext,
  ): Promise<JobRow> {
    const rows = await manager.query<JobRow[]>(
      `SELECT id, client_account_id, legal_entity_id, source_type, upload_id,
              root_object_id, requested_by_membership_id, retry_of_job_id,
              status, current_stage, total_items, pending_items,
              processing_items, incorporated_items, duplicate_items,
              foreign_items, invalid_items, unsupported_items,
              internal_error_items, attempt_count, automatic_retry_count,
              next_attempt_at, last_error_code, created_at, updated_at,
              completed_at, version
         FROM ingestion_jobs
        WHERE organization_id = $1 AND id = $2 AND source_type = 'manual_xml'`,
      [tenant.organizationId, jobId],
    );
    const job = rows[0];
    if (!job) throw notFound();
    try {
      await this.accountScope.requireAccessibleAccountWithManager(
        manager,
        job.client_account_id,
        tenant,
      );
    } catch {
      throw notFound();
    }
    return job;
  }

  private assertCollaboratorOwns(
    job: JobRow,
    tenant: SessionAuthorizationContext,
  ): void {
    if (
      tenant.role === 'collaborator' &&
      job.requested_by_membership_id !== tenant.membershipId
    ) {
      throw notFound();
    }
  }

  private jobResponse(row: JobRow) {
    return {
      id: row.id,
      clientAccountId: row.client_account_id,
      legalEntityId: row.legal_entity_id,
      source: row.source_type,
      uploadId: row.upload_id,
      objectId: row.root_object_id,
      retryOfJobId: row.retry_of_job_id,
      status: row.status,
      stage: row.current_stage,
      counters: {
        total: row.total_items,
        pending: row.pending_items,
        processing: row.processing_items,
        incorporated: row.incorporated_items,
        duplicate: row.duplicate_items,
        foreign: row.foreign_items,
        invalid: row.invalid_items,
        unsupported: row.unsupported_items,
        internalError: row.internal_error_items,
      },
      attempts: {
        total: row.attempt_count,
        automaticRetries: row.automatic_retry_count,
        nextAttemptAt: row.next_attempt_at,
      },
      errorCode: row.last_error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      version: row.version,
    };
  }
}

function pageMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

function assertIdempotencyKey(
  value: string | undefined,
): asserts value is string {
  if (!value || !/^[\x21-\x7e]{1,128}$/.test(value) || value.trim() !== value) {
    throw cfdiHttpError(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key es obligatorio.',
    );
  }
}

function notFound() {
  return cfdiHttpError(
    HttpStatus.NOT_FOUND,
    'RESOURCE_NOT_FOUND',
    'El recurso no existe o ya no tienes acceso.',
  );
}
