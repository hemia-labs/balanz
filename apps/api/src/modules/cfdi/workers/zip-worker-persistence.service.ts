import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { FiscalPlatformConfig } from '../../../config/fiscal-platform.config';
import { FiscalTenantTransactionService } from '../../../database/rls/fiscal-tenant-transaction.service';
import type { ClaimResult } from '../../ingestion/services/ingestion-job.repository';
import { DurableWorkerError } from '../../ingestion/workers/worker-error';
import { OpaqueObjectKeyFactory } from '../../object-storage/services/opaque-object-key.factory';
import type { ObjectStorageWriteResult } from '../../object-storage/ports/object-storage.port';
import type { ArchiveEntry } from './zip-extractor';

export interface ZipRoot {
  objectId: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  scanStatus: string;
}
export interface ReservedZipEntry {
  itemId: string;
  objectId: string | null;
  objectKey: string | null;
  terminal: boolean;
}

@Injectable()
export class ZipWorkerPersistenceService {
  private readonly config: FiscalPlatformConfig;
  constructor(
    private readonly transactions: FiscalTenantTransactionService,
    private readonly keys: OpaqueObjectKeyFactory,
    config: ConfigService,
  ) {
    this.config = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
  }
  run<T>(job: ClaimResult, work: (manager: EntityManager) => Promise<T>) {
    return this.transactions.runAsWorker(
      {
        organizationId: job.organizationId,
        membershipId: job.requestedByMembershipId,
      },
      work,
    );
  }
  async boundary(job: ClaimResult) {
    await this.run(job, (manager) => this.fence(manager, job));
  }
  async fence(manager: EntityManager, job: ClaimResult, lock = false) {
    const rows = await manager.query<Array<{ status: string }>>(
      `SELECT status FROM ingestion_jobs WHERE organization_id=$1 AND id=$2
      AND locked_by=$3 AND lease_expires_at>clock_timestamp() AND status IN ('processing','cancel_requested') ${lock ? 'FOR UPDATE' : ''}`,
      [job.organizationId, job.jobId, job.leaseToken],
    );
    if (!rows[0])
      throw new DurableWorkerError('JOB_LEASE_LOST', { retryable: false });
    if (rows[0].status === 'cancel_requested')
      throw new DurableWorkerError('ZIP_CANCELLED', { retryable: false });
  }
  async load(job: ClaimResult): Promise<ZipRoot> {
    return this.run(job, async (manager) => {
      await this.fence(manager, job);
      const rows = await manager.query<
        Array<{
          id: string;
          object_key: string;
          sha256: string;
          size_bytes: string;
          malware_scan_status: string;
        }>
      >(
        `
        SELECT object.id, object.object_key, object.sha256, object.size_bytes, object.malware_scan_status FROM stored_objects object
        JOIN ingestion_uploads upload ON upload.object_id=object.id AND upload.organization_id=object.organization_id
          AND upload.client_account_id=object.client_account_id AND upload.legal_entity_id=object.legal_entity_id
        JOIN legal_entities entity ON entity.id=object.legal_entity_id AND entity.organization_id=object.organization_id AND entity.status='active'
        WHERE object.id=$1 AND object.organization_id=$2 AND object.client_account_id=$3 AND object.legal_entity_id=$4
          AND upload.id=$5 AND upload.state='confirmed' AND upload.upload_type='manual_zip' AND object.kind='manual_zip'
          AND object.lifecycle_state IN ('uploaded','quarantined','available') AND object.cleanup_requested_at IS NULL`,
        [
          job.rootObjectId,
          job.organizationId,
          job.clientAccountId,
          job.legalEntityId,
          job.uploadId,
        ],
      );
      if (!rows[0]?.sha256)
        throw new DurableWorkerError('JOB_ROOT_OBJECT_UNAVAILABLE', {
          retryable: false,
        });
      const row = rows[0];
      await this.stageWithManager(manager, job, 'scanning');
      return {
        objectId: row.id,
        objectKey: row.object_key,
        sha256: row.sha256,
        sizeBytes: Number(row.size_bytes),
        scanStatus: row.malware_scan_status,
      };
    });
  }
  async rootScan(job: ClaimResult, verdict: 'clean' | 'bypassed' | 'infected') {
    await this.run(job, async (manager) => {
      await this.fence(manager, job, true);
      await manager.query(
        `UPDATE stored_objects SET lifecycle_state='quarantined', malware_scan_status=$3::text, malware_scanner_version=$4,
        malware_scanned_at=clock_timestamp(), quarantine_reason_code=$5, retention_until=clock_timestamp()+interval '30 days',
        hold_until=CASE WHEN $3::text='infected' THEN 'infinity'::timestamptz ELSE hold_until END, updated_at=clock_timestamp(), version=version+1
        WHERE organization_id=$1 AND id=$2`,
        [
          job.organizationId,
          job.rootObjectId,
          verdict,
          verdict === 'bypassed' ? 'development-bypass' : 'clamav-instream',
          verdict === 'infected' ? 'MALWARE_DETECTED' : 'ZIP_RETRY_WINDOW',
        ],
      );
      await this.audit(
        manager,
        job,
        verdict === 'infected'
          ? 'ingestion.zip.rejected'
          : 'ingestion.zip.scanned',
        verdict,
      );
    });
  }
  async reject(job: ClaimResult, code: string) {
    await this.run(job, async (manager) => {
      await this.fence(manager, job, true);
      await manager.query(
        `UPDATE stored_objects SET lifecycle_state='rejected', quarantine_reason_code=$3,
        retention_until=COALESCE(retention_until,clock_timestamp()+interval '7 days'), updated_at=clock_timestamp(),version=version+1
        WHERE organization_id=$1 AND id=$2 AND malware_scan_status<>'infected'`,
        [job.organizationId, job.rootObjectId, code],
      );
      await this.audit(manager, job, 'ingestion.zip.rejected', code);
    });
  }
  async stage(job: ClaimResult, stage: 'extracting' | 'parsing') {
    await this.run(job, (manager) =>
      this.stageWithManager(manager, job, stage),
    );
  }
  private async stageWithManager(
    manager: EntityManager,
    job: ClaimResult,
    stage: string,
  ) {
    await this.fence(manager, job, true);
    await manager.query(
      `UPDATE ingestion_jobs SET current_stage=$3,updated_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2`,
      [job.organizationId, job.jobId, stage],
    );
  }
  async reserve(
    job: ClaimResult,
    entry: ArchiveEntry,
  ): Promise<ReservedZipEntry> {
    return this.run(job, async (manager) => {
      await this.fence(manager, job, true);
      const rows = await manager.query<
        Array<{
          id: string;
          object_id: string | null;
          object_key: string | null;
          technical_status: string;
          archive_path_sha256: string;
        }>
      >(
        `
        SELECT item.id,item.object_id,object.object_key,item.technical_status,item.archive_path_sha256 FROM ingestion_items item
        LEFT JOIN stored_objects object ON object.id=item.object_id AND object.organization_id=item.organization_id
        WHERE item.organization_id=$1 AND item.ingestion_job_id=$2 AND item.ordinal=$3`,
        [job.organizationId, job.jobId, entry.ordinal],
      );
      if (rows[0]) {
        if (rows[0].archive_path_sha256 !== entry.pathSha256)
          throw new DurableWorkerError('OBJECT_HASH_MISMATCH', {
            retryable: false,
          });
        return {
          itemId: rows[0].id,
          objectId: rows[0].object_id,
          objectKey: rows[0].object_key,
          terminal: rows[0].technical_status === 'terminal',
        };
      }
      const processable =
        entry.xml && entry.uncompressedSize <= this.config.limits.xmlBytes;
      const objectId = processable ? randomUUID() : null;
      const objectKey = processable ? this.keys.create() : null;
      const itemId = randomUUID();
      if (objectId)
        await manager.query(
          `INSERT INTO stored_objects (id,organization_id,client_account_id,legal_entity_id,kind,storage_provider,storage_container,
        object_key,encryption_class,declared_mime_type,retention_until) VALUES ($1,$2,$3,$4,'extracted_xml',$5,$6,$7,'fiscal','application/xml',clock_timestamp()+interval '30 days')`,
          [
            objectId,
            job.organizationId,
            job.clientAccountId,
            job.legalEntityId,
            this.config.storage.driver,
            this.config.storage.driver === 's3'
              ? this.config.storage.s3.bucket!
              : 'local-private',
            objectKey,
          ],
        );
      await manager.query(
        `INSERT INTO ingestion_items (id,organization_id,client_account_id,legal_entity_id,ingestion_job_id,object_id,ordinal,safe_filename,
        archive_path_sha256,compressed_size_bytes,uncompressed_size_bytes,compression_method,directory_depth)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          itemId,
          job.organizationId,
          job.clientAccountId,
          job.legalEntityId,
          job.jobId,
          objectId,
          entry.ordinal,
          entry.safeFilename,
          entry.pathSha256,
          entry.compressedSize,
          entry.uncompressedSize,
          entry.compressionMethod,
          entry.directoryDepth,
        ],
      );
      return { itemId, objectId, objectKey, terminal: false };
    });
  }
  async extracted(
    job: ClaimResult,
    item: ReservedZipEntry,
    entry: ArchiveEntry,
    result: Pick<ObjectStorageWriteResult, 'sha256' | 'sizeBytes'>,
  ) {
    await this.run(job, async (manager) => {
      await this.fence(manager, job, true);
      if (item.terminal) return;
      if (item.objectId)
        await manager.query(
          `UPDATE stored_objects SET lifecycle_state='uploaded',size_bytes=$3,sha256=$4,uploaded_at=clock_timestamp(),
        updated_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2 AND lifecycle_state='pending_upload'`,
          [job.organizationId, item.objectId, result.sizeBytes, result.sha256],
        );
      await manager.query(
        `UPDATE ingestion_items SET sha256=$3,technical_status=CASE WHEN $4::boolean THEN 'pending' ELSE 'terminal' END,
        product_result=CASE WHEN $4::boolean THEN NULL ELSE $5 END,error_code=CASE WHEN $4::boolean THEN NULL ELSE $6 END,
        processed_at=CASE WHEN $4::boolean THEN NULL ELSE clock_timestamp() END,updated_at=clock_timestamp(),version=version+1
        WHERE organization_id=$1 AND id=$2 AND technical_status<>'terminal'`,
        [
          job.organizationId,
          item.itemId,
          result.sha256,
          Boolean(item.objectId),
          entry.xml ? 'invalid' : 'unsupported',
          entry.xml ? 'INGESTION_FILE_TOO_LARGE' : 'ZIP_ENTRY_UNSUPPORTED',
        ],
      );
      await manager.query(
        `UPDATE ingestion_jobs job SET
        total_items=a.total,pending_items=a.pending,processing_items=a.processing,incorporated_items=a.incorporated,
        duplicate_items=a.duplicate,foreign_items=a.foreign,invalid_items=a.invalid,unsupported_items=a.unsupported,internal_error_items=a.internal_error,
        counters_reconciled_at=clock_timestamp(),updated_at=clock_timestamp(),version=job.version+1
        FROM (SELECT count(*)::integer AS total,count(*) FILTER(WHERE technical_status='pending')::integer AS pending,
          count(*) FILTER(WHERE technical_status='processing')::integer AS processing,
          count(*) FILTER(WHERE product_result='incorporated')::integer AS incorporated,count(*) FILTER(WHERE product_result='duplicate')::integer AS duplicate,
          count(*) FILTER(WHERE product_result='foreign')::integer AS foreign,count(*) FILTER(WHERE product_result='invalid')::integer AS invalid,
          count(*) FILTER(WHERE product_result='unsupported')::integer AS unsupported,count(*) FILTER(WHERE product_result='internal_error')::integer AS internal_error
          FROM ingestion_items WHERE organization_id=$1 AND ingestion_job_id=$2) a
        WHERE job.organization_id=$1 AND job.id=$2`,
        [job.organizationId, job.jobId],
      );
    });
  }
  async completion(job: ClaimResult) {
    return this.run(job, async (manager) => {
      await this.fence(manager, job, true);
      const rows = await manager.query<
        Array<{ issues: boolean; pending: string }>
      >(
        `SELECT
        count(*) FILTER (WHERE technical_status<>'terminal')::text AS pending,
        COALESCE(bool_or(product_result IN ('foreign','invalid','unsupported','internal_error')),false)
        OR EXISTS(SELECT 1 FROM incidents incident JOIN ingestion_items i ON i.id=incident.ingestion_item_id AND i.organization_id=incident.organization_id
          WHERE i.organization_id=$1 AND i.ingestion_job_id=$2) AS issues
        FROM ingestion_items WHERE organization_id=$1 AND ingestion_job_id=$2`,
        [job.organizationId, job.jobId],
      );
      if (Number(rows[0].pending))
        throw new DurableWorkerError('JOB_STATE_CONFLICT', { retryable: true });
      await manager.query(
        `UPDATE ingestion_jobs SET current_stage=NULL,updated_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2`,
        [job.organizationId, job.jobId],
      );
      return rows[0].issues
        ? ('completed_with_issues' as const)
        : ('completed' as const);
    });
  }
  private audit(
    manager: EntityManager,
    job: ClaimResult,
    action: string,
    result: string,
  ) {
    return manager.query(
      `INSERT INTO audit_events (organization_id,actor_type,service_principal,client_account_id,legal_entity_id,action,decision,object_type,object_id,correlation_id,metadata)
      VALUES ($1,'service','cfdi-worker',$2,$3,$4,'ALLOW','ingestion_job',$5,$6,jsonb_build_object('result',$7::text))`,
      [
        job.organizationId,
        job.clientAccountId,
        job.legalEntityId,
        action,
        job.jobId,
        job.correlationId,
        result,
      ],
    );
  }
}

export async function hashStream(
  stream: AsyncIterable<Uint8Array>,
  maxBytes = 250 * 1024 * 1024,
) {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of stream) {
    sizeBytes += chunk.length;
    if (sizeBytes > maxBytes)
      throw new DurableWorkerError('ZIP_LIMIT_EXCEEDED', { retryable: false });
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}
