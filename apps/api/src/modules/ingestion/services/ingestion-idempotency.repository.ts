import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { FiscalMetricsService } from '../../../common/observability/fiscal-metrics.service';
import type { FiscalPlatformConfig } from '../../../config/fiscal-platform.config';
import {
  FiscalTenantScope,
  FiscalTenantTransactionService,
} from '../../../database/rls/fiscal-tenant-transaction.service';
import type {
  ObjectEncryptionClass,
  StorageProvider,
  StoredObjectKind,
} from '../../object-storage/entities/stored-object.entity';
import { OpaqueObjectKeyFactory } from '../../object-storage/services/opaque-object-key.factory';
import { RedisWakeupService } from '../../redis/redis-wakeup.service';
import type {
  IngestionJobSourceType,
  IngestionJobStatus,
} from '../entities/ingestion-job.entity';
import type {
  IngestionUploadType,
  IngestionUploadWorkflow,
} from '../entities/ingestion-upload.entity';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type IdempotencyOperation =
  'upload_init' | 'upload_confirm' | 'job_create';

export interface FiscalIngestionScope extends FiscalTenantScope {
  clientAccountId: string;
  legalEntityId: string;
  membershipId: string;
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(
    readonly operation: IdempotencyOperation,
    readonly existingResourceId: string,
  ) {
    super('The idempotency key was already used for a different request');
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyExpiredError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_EXPIRED';

  constructor(readonly operation: IdempotencyOperation) {
    super('The idempotency replay window has expired');
    this.name = 'IdempotencyExpiredError';
  }
}

export class IngestionStateConflictError extends Error {
  constructor(
    readonly code:
      | 'UPLOAD_ALREADY_CONFIRMED'
      | 'UPLOAD_NOT_CONFIRMABLE'
      | 'UPLOAD_PAYLOAD_MISMATCH',
  ) {
    super(
      code === 'UPLOAD_ALREADY_CONFIRMED'
        ? 'The upload was already confirmed by another operation'
        : code === 'UPLOAD_NOT_CONFIRMABLE'
          ? 'The upload is not in a confirmable durable state'
          : 'The confirmed payload does not match the upload intent',
    );
    this.name = 'IngestionStateConflictError';
  }
}

export class JobInputConflictError extends Error {
  readonly code = 'JOB_STATE_CONFLICT';

  constructor() {
    super('The ingestion job input is not confirmed and durable');
    this.name = 'JobInputConflictError';
  }
}

export interface IdempotentResult<T> {
  outcome: 'created' | 'replayed';
  value: T;
}

export interface UploadIntentRecord {
  uploadId: string;
  objectId: string;
  state: string;
  responseStatus: number;
  responseReference: string;
}

export interface CreateUploadIntentInput {
  scope: FiscalIngestionScope;
  workflow: IngestionUploadWorkflow;
  uploadType: IngestionUploadType;
  idempotencyKey: string;
  requestFingerprint: string;
  idempotencyExpiresAt: Date;
  correlationId: string;
  object: {
    id?: string;
    kind: StoredObjectKind;
    storageProvider: StorageProvider;
    storageContainer: string;
    objectKey: string;
    encryptionClass: ObjectEncryptionClass;
    originalFilename?: string | null;
    declaredMimeType?: string | null;
  };
  uploadId?: string;
  expectedSizeBytes?: string | null;
  expectedSha256?: string | null;
}

export interface ConfirmUploadInput {
  scope: FiscalIngestionScope;
  uploadId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  idempotencyExpiresAt: Date;
  correlationId: string;
  actualSizeBytes: string;
  actualSha256: string;
  storageEtag?: string | null;
  storageVersionId?: string | null;
}

export interface JobReservationRecord {
  jobId: string;
  status: IngestionJobStatus;
  responseStatus: number;
  responseReference: string;
}

export interface CreateJobReservationInput {
  scope: FiscalIngestionScope;
  sourceType: IngestionJobSourceType;
  idempotencyKey: string;
  requestFingerprint: string;
  idempotencyExpiresAt: Date;
  correlationId: string;
  status: Extract<IngestionJobStatus, 'awaiting_upload' | 'queued'>;
  nextAttemptAt?: Date | null;
  uploadId?: string | null;
  rootObjectId?: string | null;
  requestedByMembershipId?: string | null;
  retryOfJobId?: string | null;
  jobId?: string;
}

interface UploadIntentRow {
  id: string;
  object_id: string;
  state: string;
  init_request_fingerprint: string;
  init_response_status: number | null;
  init_response_reference: string | null;
  init_idempotency_expires_at: Date;
  idempotency_valid: boolean;
}

interface ConfirmReplayRow {
  id: string;
  object_id: string;
  state: string;
  confirm_request_fingerprint: string;
  confirm_response_status: number | null;
  confirm_response_reference: string | null;
  confirm_idempotency_expires_at: Date;
  idempotency_valid: boolean;
}

interface ConfirmableUploadRow {
  id: string;
  object_id: string;
  upload_type: IngestionUploadType;
  state: string;
  expected_size_bytes: string | null;
  expected_sha256: string | null;
  actual_size_bytes: string | null;
  actual_sha256: string | null;
  upload_expires_at: Date;
  upload_not_expired: boolean;
  confirm_idempotency_key: string | null;
  object_lifecycle_state: string;
}

interface ConfirmedUploadRow {
  id: string;
  object_id: string;
  state: string;
  confirm_response_status: number;
  confirm_response_reference: string;
}

interface JobReservationRow {
  id: string;
  status: IngestionJobStatus;
  request_fingerprint: string;
  response_status: number | null;
  response_reference: string | null;
  idempotency_expires_at: Date;
  idempotency_valid: boolean;
}

type MutationQueryResult<T> = T[] | [T[], number];

function mutationRows<T>(result: MutationQueryResult<T>): T[] {
  return Array.isArray(result[0]) ? result[0] : (result as T[]);
}

@Injectable()
export class IngestionIdempotencyRepository {
  private readonly incompleteUploadHours: number;

  constructor(
    private readonly tenantTransactions: FiscalTenantTransactionService,
    private readonly redisWakeup: RedisWakeupService,
    private readonly metrics: FiscalMetricsService,
    private readonly objectKeys: OpaqueObjectKeyFactory,
    config: ConfigService,
  ) {
    this.incompleteUploadHours =
      config.getOrThrow<FiscalPlatformConfig>(
        'fiscalPlatform',
      ).retention.incompleteUploadHours;
    if (this.incompleteUploadHours !== 24) {
      throw new Error(
        'INGESTION_INCOMPLETE_UPLOAD_HOURS must remain fixed at 24 hours',
      );
    }
  }

  createUploadIntent(
    input: CreateUploadIntentInput,
  ): Promise<IdempotentResult<UploadIntentRecord>> {
    this.assertScope(input.scope);
    this.assertIdempotency(input.idempotencyKey, input.requestFingerprint);
    this.assertUuid(input.correlationId, 'correlation ID');
    if (input.expectedSha256) this.assertHash(input.expectedSha256);
    this.objectKeys.assertValid(input.object.objectKey);
    if (input.object.kind !== input.uploadType) {
      throw new JobInputConflictError();
    }
    const uploadId = input.uploadId ?? randomUUID();
    const objectId = input.object.id ?? randomUUID();

    return this.tenantTransactions.run(input.scope, async (manager) => {
      await this.lockOperation(
        manager,
        input.scope,
        'upload_init',
        input.idempotencyKey,
      );
      const existing = await this.findUploadIntent(
        manager,
        input.scope,
        input.idempotencyKey,
      );
      if (existing) {
        this.assertReplay(
          'upload_init',
          existing.id,
          existing.init_request_fingerprint,
          input.requestFingerprint,
          existing.idempotency_valid,
        );
        return {
          outcome: 'replayed',
          value: this.uploadIntentValue(existing),
        };
      }

      await this.assertFutureExpiration(
        manager,
        'upload_init',
        input.idempotencyExpiresAt,
      );

      await manager.query(
        `INSERT INTO stored_objects (
           id, organization_id, client_account_id, legal_entity_id,
           kind, storage_provider, storage_container, object_key,
           original_filename, declared_mime_type, encryption_class
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          objectId,
          input.scope.organizationId,
          input.scope.clientAccountId,
          input.scope.legalEntityId,
          input.object.kind,
          input.object.storageProvider,
          input.object.storageContainer,
          input.object.objectKey,
          input.object.originalFilename ?? null,
          input.object.declaredMimeType ?? null,
          input.object.encryptionClass,
        ],
      );
      const rows = await manager.query<UploadIntentRow[]>(
        `INSERT INTO ingestion_uploads (
           id, organization_id, client_account_id, legal_entity_id,
           workflow, upload_type,
           init_idempotency_key, init_request_fingerprint,
           init_response_status, init_response_reference,
           init_idempotency_expires_at, object_id,
           expected_size_bytes, expected_sha256, upload_expires_at,
           created_by_membership_id, correlation_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,201,$1::uuid::text,$9,$10,$11,$12,
           clock_timestamp() + make_interval(hours => $13),$14,$15
         )
         RETURNING
           id, object_id, state, init_request_fingerprint,
           init_response_status, init_response_reference,
           init_idempotency_expires_at,
           init_idempotency_expires_at > clock_timestamp() AS idempotency_valid`,
        [
          uploadId,
          input.scope.organizationId,
          input.scope.clientAccountId,
          input.scope.legalEntityId,
          input.workflow,
          input.uploadType,
          input.idempotencyKey,
          input.requestFingerprint,
          input.idempotencyExpiresAt,
          objectId,
          input.expectedSizeBytes ?? null,
          input.expectedSha256 ?? null,
          this.incompleteUploadHours,
          input.scope.membershipId,
          input.correlationId,
        ],
      );
      await this.audit(manager, {
        scope: input.scope,
        membershipId: input.scope.membershipId,
        action: 'ingestion.upload.intent_created',
        objectType: 'ingestion_upload',
        objectId: uploadId,
        correlationId: input.correlationId,
      });
      return { outcome: 'created', value: this.uploadIntentValue(rows[0]) };
    });
  }

  async confirmUpload(
    input: ConfirmUploadInput,
  ): Promise<IdempotentResult<UploadIntentRecord>> {
    this.assertScope(input.scope);
    this.assertUuid(input.uploadId, 'upload ID');
    this.assertUuid(input.correlationId, 'correlation ID');
    this.assertIdempotency(input.idempotencyKey, input.requestFingerprint);
    this.assertHash(input.actualSha256);
    if (!/^\d+$/.test(input.actualSizeBytes)) {
      throw new Error('Actual size must be a non-negative integer');
    }

    let confirmedSource: IngestionUploadType | undefined;
    const result = await this.tenantTransactions.run<
      IdempotentResult<UploadIntentRecord>
    >(input.scope, async (manager) => {
      await this.lockOperation(
        manager,
        input.scope,
        'upload_confirm',
        input.idempotencyKey,
      );
      const replayRows = await manager.query<ConfirmReplayRow[]>(
        `SELECT
           id, object_id, state, confirm_request_fingerprint,
           confirm_response_status, confirm_response_reference,
           confirm_idempotency_expires_at,
           confirm_idempotency_expires_at > clock_timestamp() AS idempotency_valid
         FROM ingestion_uploads
         WHERE organization_id = $1
           AND legal_entity_id = $2
           AND confirm_idempotency_key = $3
         FOR UPDATE`,
        [
          input.scope.organizationId,
          input.scope.legalEntityId,
          input.idempotencyKey,
        ],
      );
      const replay = replayRows[0];
      if (replay) {
        this.assertReplay(
          'upload_confirm',
          replay.id,
          replay.confirm_request_fingerprint,
          input.requestFingerprint,
          replay.idempotency_valid,
        );
        return {
          outcome: 'replayed',
          value: {
            uploadId: replay.id,
            objectId: replay.object_id,
            state: replay.state,
            responseStatus: replay.confirm_response_status ?? 200,
            responseReference: replay.confirm_response_reference ?? replay.id,
          },
        };
      }

      const uploads = await manager.query<ConfirmableUploadRow[]>(
        `SELECT
           upload.id, upload.object_id, upload.upload_type, upload.state,
           upload.expected_size_bytes, upload.expected_sha256,
           upload.actual_size_bytes, upload.actual_sha256,
           upload.upload_expires_at, upload.confirm_idempotency_key,
           upload.upload_expires_at > clock_timestamp() AS upload_not_expired,
           object.lifecycle_state AS object_lifecycle_state
         FROM ingestion_uploads AS upload
         INNER JOIN stored_objects AS object
           ON object.organization_id = upload.organization_id
          AND object.client_account_id = upload.client_account_id
          AND object.legal_entity_id = upload.legal_entity_id
          AND object.id = upload.object_id
         WHERE upload.id = $1
           AND upload.organization_id = $2
           AND upload.client_account_id = $3
           AND upload.legal_entity_id = $4
         FOR UPDATE OF upload, object`,
        [
          input.uploadId,
          input.scope.organizationId,
          input.scope.clientAccountId,
          input.scope.legalEntityId,
        ],
      );
      const upload = uploads[0];
      if (!upload) throw new Error('Upload does not exist in the tenant scope');
      if (upload.confirm_idempotency_key || upload.state === 'confirmed') {
        throw new IngestionStateConflictError('UPLOAD_ALREADY_CONFIRMED');
      }
      if (
        !['pending', 'receiving', 'uploaded'].includes(upload.state) ||
        !upload.upload_not_expired ||
        upload.object_lifecycle_state !== 'pending_upload'
      ) {
        throw new IngestionStateConflictError('UPLOAD_NOT_CONFIRMABLE');
      }
      await this.assertFutureExpiration(
        manager,
        'upload_confirm',
        input.idempotencyExpiresAt,
      );
      if (
        (upload.expected_size_bytes !== null &&
          upload.expected_size_bytes !== input.actualSizeBytes) ||
        (upload.expected_sha256 !== null &&
          upload.expected_sha256 !== input.actualSha256) ||
        (upload.actual_size_bytes !== null &&
          upload.actual_size_bytes !== input.actualSizeBytes) ||
        (upload.actual_sha256 !== null &&
          upload.actual_sha256 !== input.actualSha256)
      ) {
        this.metrics.increment('ingestion_hash_conflicts_total', {
          source: upload.upload_type,
        });
        throw new IngestionStateConflictError('UPLOAD_PAYLOAD_MISMATCH');
      }

      const updatedObjectsResult = await manager.query<
        MutationQueryResult<{ id: string }>
      >(
        `UPDATE stored_objects
            SET size_bytes = $5,
                sha256 = $6,
                storage_etag = $7,
                storage_version_id = $8,
                lifecycle_state = 'uploaded',
                uploaded_at = clock_timestamp(),
                updated_at = clock_timestamp(),
                version = version + 1
          WHERE id = $1
            AND organization_id = $2
            AND client_account_id = $3
            AND legal_entity_id = $4
            AND lifecycle_state = 'pending_upload'
        RETURNING id`,
        [
          upload.object_id,
          input.scope.organizationId,
          input.scope.clientAccountId,
          input.scope.legalEntityId,
          input.actualSizeBytes,
          input.actualSha256,
          input.storageEtag ?? null,
          input.storageVersionId ?? null,
        ],
      );
      const updatedObjects = mutationRows(updatedObjectsResult);
      if (updatedObjects.length !== 1) {
        throw new IngestionStateConflictError('UPLOAD_NOT_CONFIRMABLE');
      }
      const confirmedResult = await manager.query<
        MutationQueryResult<ConfirmedUploadRow>
      >(
        `UPDATE ingestion_uploads
            SET state = 'confirmed',
                actual_size_bytes = $5,
                actual_sha256 = $6,
                confirm_idempotency_key = $7,
                confirm_request_fingerprint = $8,
                confirm_response_status = 200,
                confirm_response_reference = id::text,
                confirm_idempotency_created_at = clock_timestamp(),
                confirm_idempotency_expires_at = $9,
                confirmed_at = clock_timestamp(),
                updated_at = clock_timestamp(),
                version = version + 1
          WHERE id = $1
            AND organization_id = $2
            AND client_account_id = $3
            AND legal_entity_id = $4
          RETURNING id, object_id, state, confirm_response_status, confirm_response_reference`,
        [
          input.uploadId,
          input.scope.organizationId,
          input.scope.clientAccountId,
          input.scope.legalEntityId,
          input.actualSizeBytes,
          input.actualSha256,
          input.idempotencyKey,
          input.requestFingerprint,
          input.idempotencyExpiresAt,
        ],
      );
      const confirmed = mutationRows(confirmedResult);
      if (confirmed.length !== 1) {
        throw new IngestionStateConflictError('UPLOAD_NOT_CONFIRMABLE');
      }
      await this.audit(manager, {
        scope: input.scope,
        membershipId: input.scope.membershipId,
        action: 'ingestion.upload.confirmed',
        objectType: 'ingestion_upload',
        objectId: input.uploadId,
        correlationId: input.correlationId,
      });
      confirmedSource = upload.upload_type;
      return {
        outcome: 'created',
        value: {
          uploadId: confirmed[0].id,
          objectId: confirmed[0].object_id,
          state: confirmed[0].state,
          responseStatus: confirmed[0].confirm_response_status,
          responseReference: confirmed[0].confirm_response_reference,
        },
      };
    });
    if (result.outcome === 'created' && confirmedSource) {
      this.metrics.increment(
        'ingestion_upload_bytes_total',
        { source: confirmedSource },
        Number(input.actualSizeBytes),
      );
    }
    return result;
  }

  async createJob(
    input: CreateJobReservationInput,
  ): Promise<IdempotentResult<JobReservationRecord>> {
    this.assertScope(input.scope);
    this.assertIdempotency(input.idempotencyKey, input.requestFingerprint);
    this.assertUuid(input.correlationId, 'correlation ID');
    if (input.uploadId) this.assertUuid(input.uploadId, 'upload ID');
    if (input.rootObjectId) {
      this.assertUuid(input.rootObjectId, 'root object ID');
    }
    if (input.requestedByMembershipId) {
      this.assertUuid(input.requestedByMembershipId, 'request membership ID');
    }
    if (input.retryOfJobId) this.assertUuid(input.retryOfJobId, 'retry job ID');
    const isManualSource =
      input.sourceType === 'manual_xml' || input.sourceType === 'manual_zip';
    if (
      isManualSource &&
      input.requestedByMembershipId !== undefined &&
      input.requestedByMembershipId !== null &&
      input.requestedByMembershipId !== input.scope.membershipId
    ) {
      throw new JobInputConflictError();
    }
    // User-originated ingestion is always attributed from the authenticated
    // tenant scope. A caller-provided membership can only confirm that value;
    // it cannot select another membership from the same organization.
    const requestedByMembershipId = isManualSource
      ? input.scope.membershipId
      : (input.requestedByMembershipId ?? null);
    const jobId = input.jobId ?? randomUUID();

    const result = await this.tenantTransactions.run<
      IdempotentResult<JobReservationRecord>
    >(input.scope, async (manager) => {
      await this.lockOperation(
        manager,
        input.scope,
        'job_create',
        input.idempotencyKey,
      );
      const existingRows = await manager.query<JobReservationRow[]>(
        `SELECT
           id, status, request_fingerprint, response_status,
           response_reference, idempotency_expires_at,
           idempotency_expires_at > clock_timestamp() AS idempotency_valid
         FROM ingestion_jobs
         WHERE organization_id = $1
           AND legal_entity_id = $2
           AND idempotency_key = $3`,
        [
          input.scope.organizationId,
          input.scope.legalEntityId,
          input.idempotencyKey,
        ],
      );
      const existing = existingRows[0];
      if (existing) {
        this.assertReplay(
          'job_create',
          existing.id,
          existing.request_fingerprint,
          input.requestFingerprint,
          existing.idempotency_valid,
        );
        return {
          outcome: 'replayed',
          value: this.jobValue(existing),
        };
      }

      await this.assertFutureExpiration(
        manager,
        'job_create',
        input.idempotencyExpiresAt,
      );

      if (input.status === 'queued') {
        await this.assertJobInputReady(manager, input);
      }

      const rows = await manager.query<JobReservationRow[]>(
        `INSERT INTO ingestion_jobs (
           id, organization_id, client_account_id, legal_entity_id,
           source_type, upload_id, root_object_id,
           requested_by_membership_id, retry_of_job_id,
           idempotency_key, request_fingerprint,
           response_status, response_reference, idempotency_expires_at,
           status, next_attempt_at, correlation_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,202,$1::uuid::text,$12,$13::varchar,
           CASE
             WHEN $13::varchar = 'queued' THEN COALESCE($14::timestamptz, clock_timestamp())
             ELSE $14::timestamptz
           END,
           $15
         )
         RETURNING
           id, status, request_fingerprint, response_status,
           response_reference, idempotency_expires_at,
           idempotency_expires_at > clock_timestamp() AS idempotency_valid`,
        [
          jobId,
          input.scope.organizationId,
          input.scope.clientAccountId,
          input.scope.legalEntityId,
          input.sourceType,
          input.uploadId ?? null,
          input.rootObjectId ?? null,
          requestedByMembershipId,
          input.retryOfJobId ?? null,
          input.idempotencyKey,
          input.requestFingerprint,
          input.idempotencyExpiresAt,
          input.status,
          input.nextAttemptAt ?? null,
          input.correlationId,
        ],
      );
      await this.audit(manager, {
        scope: input.scope,
        membershipId: requestedByMembershipId,
        action: 'ingestion.job.created',
        objectType: 'ingestion_job',
        objectId: jobId,
        correlationId: input.correlationId,
      });
      return { outcome: 'created', value: this.jobValue(rows[0]) };
    });

    if (result.outcome === 'created') {
      this.metrics.increment('ingestion_jobs_created_total', {
        source: input.sourceType,
      });
      if (result.value.status === 'queued') {
        // The transaction promise resolves only after COMMIT. Redis remains a
        // best-effort accelerator; PostgreSQL polling is always authoritative.
        await this.redisWakeup.publishJobsAvailable();
      }
    }
    return result;
  }

  private async assertJobInputReady(
    manager: EntityManager,
    input: CreateJobReservationInput,
  ): Promise<void> {
    if (
      input.sourceType === 'manual_xml' ||
      input.sourceType === 'manual_zip'
    ) {
      if (!input.uploadId || !input.rootObjectId) {
        throw new JobInputConflictError();
      }
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT upload.id
           FROM ingestion_uploads AS upload
           INNER JOIN stored_objects AS object
             ON object.organization_id = upload.organization_id
            AND object.client_account_id = upload.client_account_id
            AND object.legal_entity_id = upload.legal_entity_id
            AND object.id = upload.object_id
          WHERE upload.organization_id = $1
            AND upload.client_account_id = $2
            AND upload.legal_entity_id = $3
            AND upload.id = $4
            AND upload.object_id = $5
            AND upload.upload_type = $6
            AND object.kind = $6
            AND upload.state = 'confirmed'
            AND object.lifecycle_state IN ('uploaded','quarantined','available')
          FOR UPDATE OF upload, object`,
        [
          input.scope.organizationId,
          input.scope.clientAccountId,
          input.scope.legalEntityId,
          input.uploadId,
          input.rootObjectId,
          input.sourceType,
        ],
      );
      if (rows.length !== 1) throw new JobInputConflictError();
      return;
    }

    if (!input.rootObjectId) throw new JobInputConflictError();
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id
         FROM stored_objects
        WHERE organization_id = $1
          AND client_account_id = $2
          AND legal_entity_id = $3
          AND id = $4
          AND kind = $5
          AND lifecycle_state IN ('uploaded','quarantined','available')
        FOR UPDATE`,
      [
        input.scope.organizationId,
        input.scope.clientAccountId,
        input.scope.legalEntityId,
        input.rootObjectId,
        input.sourceType,
      ],
    );
    if (rows.length !== 1) throw new JobInputConflictError();
  }

  private async lockOperation(
    manager: EntityManager,
    scope: FiscalIngestionScope,
    operation: IdempotencyOperation,
    key: string,
  ): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 84731))`,
      [`${scope.organizationId}:${scope.legalEntityId}:${operation}:${key}`],
    );
  }

  private async findUploadIntent(
    manager: EntityManager,
    scope: FiscalIngestionScope,
    key: string,
  ): Promise<UploadIntentRow | undefined> {
    const rows = await manager.query<UploadIntentRow[]>(
      `SELECT
         id, object_id, state, init_request_fingerprint,
         init_response_status, init_response_reference,
         init_idempotency_expires_at,
         init_idempotency_expires_at > clock_timestamp() AS idempotency_valid
       FROM ingestion_uploads
       WHERE organization_id = $1
         AND legal_entity_id = $2
         AND init_idempotency_key = $3
       FOR UPDATE`,
      [scope.organizationId, scope.legalEntityId, key],
    );
    return rows[0];
  }

  private assertReplay(
    operation: IdempotencyOperation,
    existingResourceId: string,
    existingFingerprint: string,
    requestedFingerprint: string,
    isValidAtDatabaseClock: boolean,
  ): void {
    if (existingFingerprint !== requestedFingerprint) {
      throw new IdempotencyConflictError(operation, existingResourceId);
    }
    if (!isValidAtDatabaseClock) {
      throw new IdempotencyExpiredError(operation);
    }
  }

  private async assertFutureExpiration(
    manager: EntityManager,
    operation: IdempotencyOperation,
    idempotencyExpiresAt: Date,
  ): Promise<void> {
    const rows = await manager.query<Array<{ idempotency_valid: boolean }>>(
      `SELECT $1::timestamptz > clock_timestamp() AS idempotency_valid`,
      [idempotencyExpiresAt],
    );
    if (!rows[0]?.idempotency_valid) {
      throw new IdempotencyExpiredError(operation);
    }
  }

  private uploadIntentValue(row: UploadIntentRow): UploadIntentRecord {
    return {
      uploadId: row.id,
      objectId: row.object_id,
      state: row.state,
      responseStatus: row.init_response_status ?? 201,
      responseReference: row.init_response_reference ?? row.id,
    };
  }

  private jobValue(row: JobReservationRow): JobReservationRecord {
    return {
      jobId: row.id,
      status: row.status,
      responseStatus: row.response_status ?? 202,
      responseReference: row.response_reference ?? row.id,
    };
  }

  private async audit(
    manager: EntityManager,
    event: {
      scope: FiscalIngestionScope;
      membershipId?: string | null;
      action: string;
      objectType: string;
      objectId: string;
      correlationId: string;
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO audit_events (
         organization_id, actor_type, actor_membership_id,
         client_account_id, legal_entity_id,
         action, decision, object_type, object_id,
         correlation_id, metadata
       ) VALUES ($1,'user',$2,$3,$4,$5,'ALLOW',$6,$7,$8,'{}'::jsonb)`,
      [
        event.scope.organizationId,
        event.membershipId ?? null,
        event.scope.clientAccountId,
        event.scope.legalEntityId,
        event.action,
        event.objectType,
        event.objectId,
        event.correlationId,
      ],
    );
  }

  private assertScope(scope: FiscalIngestionScope): void {
    this.assertUuid(scope.organizationId, 'organization ID');
    this.assertUuid(scope.clientAccountId, 'client account ID');
    this.assertUuid(scope.legalEntityId, 'legal entity ID');
    this.assertUuid(scope.membershipId, 'membership ID');
  }

  private assertIdempotency(key: string, fingerprint: string): void {
    if (!KEY_PATTERN.test(key) || key.trim() !== key) {
      throw new Error('Idempotency key is invalid');
    }
    this.assertHash(fingerprint);
  }

  private assertHash(value: string): void {
    if (!SHA256_PATTERN.test(value)) {
      throw new Error('SHA-256 fingerprint is invalid');
    }
  }

  private assertUuid(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new Error(`A valid ${label} is required`);
    }
  }
}
