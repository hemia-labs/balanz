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

export class IngestionAdmissionLimitError extends Error {
  readonly code = 'INGESTION_ACTIVE_JOB_LIMIT';

  constructor(readonly dimension: 'user' | 'tenant') {
    super('The active ingestion job limit was reached');
    this.name = 'IngestionAdmissionLimitError';
  }
}

export interface IdempotentResult<T> {
  outcome: 'created' | 'replayed';
  value: T;
}

export interface UploadIntentRecord {
  uploadId: string;
  objectId: string;
  objectKey: string;
  originalFilename: string | null;
  declaredMimeType: string | null;
  state: string;
  actualSizeBytes: string | null;
  actualSha256: string | null;
  storageEtag: string | null;
  storageVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  /** Present only for the request that currently owns the receiving fence. */
  receiverVersion: number | null;
  responseStatus: number;
  responseReference: string;
}

export interface UploadReceiverClaim {
  outcome: 'claimed' | 'busy';
  value: UploadIntentRecord;
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
  detectedMimeType?: string | null;
  /** Optimistic fence held by the streaming request. */
  receiverVersion?: number;
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
  initialItem?: {
    id?: string;
    objectId: string;
    ordinal?: number;
    safeFilename?: string | null;
    sha256: string;
  };
}

interface UploadIntentRow {
  id: string;
  object_id: string;
  object_key: string;
  original_filename: string | null;
  declared_mime_type: string | null;
  state: string;
  actual_size_bytes: string | null;
  actual_sha256: string | null;
  storage_etag: string | null;
  storage_version_id: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
  init_request_fingerprint: string;
  init_response_status: number | null;
  init_response_reference: string | null;
  init_idempotency_expires_at: Date;
  idempotency_valid: boolean;
}

interface ConfirmReplayRow extends UploadIntentRow {
  confirm_request_fingerprint: string;
  confirm_response_status: number | null;
  confirm_response_reference: string | null;
  confirm_idempotency_expires_at: Date;
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
  object_key: string;
  original_filename: string | null;
  declared_mime_type: string | null;
  storage_etag: string | null;
  storage_version_id: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

interface ConfirmedUploadRow {
  id: string;
  object_id: string;
  state: string;
  confirm_response_status: number;
  confirm_response_reference: string;
  updated_at: Date;
  version: number;
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
  private readonly activeJobsPerUser: number;
  private readonly activeJobsPerTenant: number;
  private readonly receiverLeaseSeconds: number;

  constructor(
    private readonly tenantTransactions: FiscalTenantTransactionService,
    private readonly redisWakeup: RedisWakeupService,
    private readonly metrics: FiscalMetricsService,
    private readonly objectKeys: OpaqueObjectKeyFactory,
    config: ConfigService,
  ) {
    const platform = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
    this.incompleteUploadHours = platform.retention.incompleteUploadHours;
    this.activeJobsPerUser = platform.limits.activeJobsPerUser;
    this.activeJobsPerTenant = platform.limits.activeJobsPerTenant;
    this.receiverLeaseSeconds = platform.worker.leaseSeconds;
    if (this.incompleteUploadHours !== 24) {
      throw new Error(
        'INGESTION_INCOMPLETE_UPLOAD_HOURS must remain fixed at 24 hours',
      );
    }
    if (this.activeJobsPerUser !== 2 || this.activeJobsPerTenant !== 4) {
      throw new Error(
        'INGESTION_ACTIVE_JOBS_PER_USER/TENANT must remain fixed at 2/4',
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

      if (input.workflow === 'direct' && input.uploadType === 'manual_xml') {
        await this.assertManualIngestionCapacity(
          manager,
          input.scope,
          input.scope.membershipId,
        );
      }

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
           workflow, upload_type, state,
           init_idempotency_key, init_request_fingerprint,
           init_response_status, init_response_reference,
           init_idempotency_expires_at, object_id,
           expected_size_bytes, expected_sha256, upload_expires_at,
           created_by_membership_id, correlation_id
         ) VALUES (
           $1,$2,$3,$4,$5::varchar,$6::varchar,
           CASE WHEN $5::varchar = 'direct' AND $6::varchar = 'manual_xml'
             THEN 'receiving' ELSE 'pending' END,
           $7,$8,201,$1::uuid::text,$9,$10,$11,$12,
           clock_timestamp() + make_interval(hours => $13),$14,$15
         )
          RETURNING
            id, object_id, state, actual_size_bytes, actual_sha256,
            created_at, updated_at, version, init_request_fingerprint,
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
      return {
        outcome: 'created',
        value: this.uploadIntentValue(
          {
            ...rows[0],
            object_key: input.object.objectKey,
            original_filename: input.object.originalFilename ?? null,
            declared_mime_type: input.object.declaredMimeType ?? null,
            storage_etag: null,
            storage_version_id: null,
          },
          Number(rows[0].version),
        ),
      };
    });
  }

  /**
   * Reclaims a stalled direct XML receiver without retaining a database
   * connection while request bytes are in flight. `version` is the fence:
   * an older receiver cannot confirm or delete bytes after a takeover.
   */
  claimUploadReceiver(
    scope: FiscalIngestionScope,
    uploadId: string,
  ): Promise<UploadReceiverClaim> {
    this.assertScope(scope);
    this.assertUuid(uploadId, 'upload ID');
    return this.tenantTransactions.run(scope, async (manager) => {
      const rows = await manager.query<UploadIntentRow[]>(
        `WITH claimed AS (
           UPDATE ingestion_uploads
              SET state = 'receiving',
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND organization_id = $2
              AND client_account_id = $3
              AND legal_entity_id = $4
              AND workflow = 'direct'
              AND upload_type = 'manual_xml'
              AND upload_expires_at > clock_timestamp()
              AND (
                state = 'pending'
                OR (
                  state = 'receiving'
                  AND updated_at <= clock_timestamp()
                    - make_interval(secs => $5)
                )
              )
          RETURNING *
         )
         SELECT
           claimed.id, claimed.object_id, object.object_key,
           object.original_filename, object.declared_mime_type, claimed.state,
           claimed.actual_size_bytes, claimed.actual_sha256,
           object.storage_etag, object.storage_version_id,
           claimed.created_at, claimed.updated_at, claimed.version,
           claimed.init_request_fingerprint,
           claimed.init_response_status, claimed.init_response_reference,
           claimed.init_idempotency_expires_at,
           claimed.init_idempotency_expires_at > clock_timestamp()
             AS idempotency_valid
         FROM claimed
         INNER JOIN stored_objects object
           ON object.organization_id = claimed.organization_id
          AND object.client_account_id = claimed.client_account_id
          AND object.legal_entity_id = claimed.legal_entity_id
          AND object.id = claimed.object_id`,
        [
          uploadId,
          scope.organizationId,
          scope.clientAccountId,
          scope.legalEntityId,
          this.receiverLeaseSeconds,
        ],
      );
      if (rows[0]) {
        return {
          outcome: 'claimed',
          value: this.uploadIntentValue(rows[0], Number(rows[0].version)),
        };
      }

      const current = await this.findUploadIntentById(manager, scope, uploadId);
      if (!current) {
        throw new Error('Upload does not exist in the tenant scope');
      }
      return { outcome: 'busy', value: this.uploadIntentValue(current) };
    });
  }

  async renewUploadReceiver(
    scope: FiscalIngestionScope,
    uploadId: string,
    receiverVersion: number,
  ): Promise<number | null> {
    this.assertScope(scope);
    this.assertUuid(uploadId, 'upload ID');
    this.assertPositiveVersion(receiverVersion);
    return this.tenantTransactions.run(scope, async (manager) => {
      const rows = await manager.query<Array<{ version: number }>>(
        `WITH renewed AS (
           UPDATE ingestion_uploads
              SET updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND organization_id = $2
              AND client_account_id = $3
              AND legal_entity_id = $4
              AND workflow = 'direct'
              AND upload_type = 'manual_xml'
              AND state = 'receiving'
              AND version = $5
              AND upload_expires_at > clock_timestamp()
          RETURNING version
         )
         SELECT version FROM renewed`,
        [
          uploadId,
          scope.organizationId,
          scope.clientAccountId,
          scope.legalEntityId,
          receiverVersion,
        ],
      );
      return rows[0] ? Number(rows[0].version) : null;
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
    if (input.receiverVersion !== undefined) {
      this.assertPositiveVersion(input.receiverVersion);
    }
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
           upload.id, upload.object_id, object.object_key,
           object.original_filename, object.declared_mime_type, upload.state,
           upload.actual_size_bytes, upload.actual_sha256,
           object.storage_etag, object.storage_version_id,
           upload.created_at, upload.updated_at, upload.version,
           upload.init_request_fingerprint,
           upload.init_response_status, upload.init_response_reference,
           upload.init_idempotency_expires_at,
           upload.confirm_request_fingerprint,
           upload.confirm_response_status, upload.confirm_response_reference,
           upload.confirm_idempotency_expires_at,
           upload.confirm_idempotency_expires_at > clock_timestamp()
             AS idempotency_valid
         FROM ingestion_uploads upload
         INNER JOIN stored_objects object
           ON object.organization_id = upload.organization_id
          AND object.client_account_id = upload.client_account_id
          AND object.legal_entity_id = upload.legal_entity_id
          AND object.id = upload.object_id
         WHERE upload.organization_id = $1
           AND upload.legal_entity_id = $2
           AND upload.confirm_idempotency_key = $3
         FOR UPDATE OF upload, object`,
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
            ...this.uploadIntentValue(replay),
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
           object.lifecycle_state AS object_lifecycle_state,
           object.object_key, object.original_filename,
           object.declared_mime_type,
           object.storage_etag, object.storage_version_id,
           upload.created_at, upload.updated_at, upload.version
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
      if (
        input.receiverVersion !== undefined &&
        (upload.state !== 'receiving' ||
          Number(upload.version) !== input.receiverVersion)
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
                detected_mime_type = $9,
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
          input.detectedMimeType ?? null,
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
            AND (
              $10::integer IS NULL
              OR (state = 'receiving' AND version = $10::integer)
            )
          RETURNING id, object_id, state, confirm_response_status,
                    confirm_response_reference, updated_at, version`,
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
          input.receiverVersion ?? null,
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
          objectKey: upload.object_key,
          originalFilename: upload.original_filename,
          declaredMimeType: upload.declared_mime_type,
          state: confirmed[0].state,
          actualSizeBytes: input.actualSizeBytes,
          actualSha256: input.actualSha256,
          storageEtag: input.storageEtag ?? upload.storage_etag,
          storageVersionId: input.storageVersionId ?? upload.storage_version_id,
          createdAt: upload.created_at,
          updatedAt: confirmed[0].updated_at,
          version: Number(confirmed[0].version),
          receiverVersion: null,
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
    if (input.initialItem) {
      this.assertUuid(input.initialItem.objectId, 'item object ID');
      this.assertHash(input.initialItem.sha256);
      if ((input.initialItem.ordinal ?? 1) < 1) {
        throw new Error('The ingestion item ordinal must be positive');
      }
    }
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
    const itemId = input.initialItem?.id ?? randomUUID();

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

      if (isManualSource) {
        await this.assertManualIngestionCapacity(
          manager,
          input.scope,
          input.scope.membershipId,
          input.uploadId ?? null,
        );
      }

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
           status, next_attempt_at, correlation_id,
           total_items, pending_items
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,202,$1::uuid::text,$12,$13::varchar,
           CASE
             WHEN $13::varchar = 'queued' THEN COALESCE($14::timestamptz, clock_timestamp())
             ELSE $14::timestamptz
           END,
           $15,$16,$16
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
          input.initialItem ? 1 : 0,
        ],
      );
      if (input.initialItem) {
        await manager.query(
          `INSERT INTO ingestion_items (
             id, organization_id, client_account_id, legal_entity_id,
             ingestion_job_id, object_id, ordinal, safe_filename, sha256
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            itemId,
            input.scope.organizationId,
            input.scope.clientAccountId,
            input.scope.legalEntityId,
            jobId,
            input.initialItem.objectId,
            input.initialItem.ordinal ?? 1,
            input.initialItem.safeFilename ?? null,
            input.initialItem.sha256,
          ],
        );
      }
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

  async failUpload(
    scope: FiscalIngestionScope,
    uploadId: string,
    errorCode: string,
    correlationId: string,
    receiverVersion: number,
  ): Promise<boolean> {
    this.assertScope(scope);
    this.assertUuid(uploadId, 'upload ID');
    this.assertUuid(correlationId, 'correlation ID');
    this.assertPositiveVersion(receiverVersion);
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(errorCode)) {
      throw new Error('Upload error code is invalid');
    }
    return this.tenantTransactions.run(scope, async (manager) => {
      const rows = await manager.query<Array<{ object_id: string }>>(
        `WITH failed AS (
           UPDATE ingestion_uploads
              SET state = 'failed',
                  last_error_code = $5,
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND organization_id = $2
              AND client_account_id = $3
              AND legal_entity_id = $4
              AND state = 'receiving'
              AND version = $6
          RETURNING object_id
         )
         SELECT object_id FROM failed`,
        [
          uploadId,
          scope.organizationId,
          scope.clientAccountId,
          scope.legalEntityId,
          errorCode,
          receiverVersion,
        ],
      );
      if (rows[0]) {
        await manager.query(
          `UPDATE stored_objects
              SET lifecycle_state = 'deleted',
                  quarantine_reason_code = $5,
                  deleted_at = clock_timestamp(),
                  updated_at = clock_timestamp(),
                  version = version + 1
            WHERE id = $1
              AND organization_id = $2
              AND client_account_id = $3
              AND legal_entity_id = $4
              AND lifecycle_state = 'pending_upload'`,
          [
            rows[0].object_id,
            scope.organizationId,
            scope.clientAccountId,
            scope.legalEntityId,
            errorCode,
          ],
        );
        await this.audit(manager, {
          scope,
          membershipId: scope.membershipId,
          action: 'ingestion.upload.failed',
          objectType: 'ingestion_upload',
          objectId: uploadId,
          correlationId,
        });
        return true;
      }
      return false;
    });
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
      const rows = await manager.query<
        Array<{ id: string; lifecycle_state: string }>
      >(
        `SELECT upload.id, object.lifecycle_state
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
      // Check under the object lock, after idempotency replay: a lost response
      // can recover an accepted retry, but a new key cannot reprocess XML that
      // another retry already published. The worker also protects old queued retries.
      if (
        input.sourceType === 'manual_xml' &&
        input.retryOfJobId &&
        rows[0].lifecycle_state === 'available'
      ) {
        throw new JobInputConflictError();
      }
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

  /**
   * Serializes producer admission per organization. Both counters are read
   * while this transaction-scoped lock is held, so concurrent API instances
   * cannot all observe the same remaining slot and oversubscribe it.
   */
  private async assertManualIngestionCapacity(
    manager: EntityManager,
    scope: FiscalIngestionScope,
    membershipId: string,
    convertingUploadId: string | null = null,
  ): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 84732))`,
      [`${scope.organizationId}:manual_ingestion_admission`],
    );
    const rows = await manager.query<
      Array<{ tenant_active_jobs: number; user_active_jobs: number }>
    >(
      `WITH active_jobs AS (
         SELECT requested_by_membership_id
           FROM ingestion_jobs
          WHERE organization_id = $1
            AND status IN (
              'awaiting_upload', 'queued', 'processing',
              'failed_retryable', 'cancel_requested'
            )
       ), unbound_uploads AS (
         SELECT upload.created_by_membership_id
           FROM ingestion_uploads upload
          WHERE upload.organization_id = $1
            AND upload.upload_type = 'manual_xml'
            AND upload.state IN ('pending','receiving','uploaded','confirmed')
            AND ($3::uuid IS NULL OR upload.id <> $3::uuid)
            AND NOT EXISTS (
              SELECT 1
                FROM ingestion_jobs job
               WHERE job.organization_id = upload.organization_id
                 AND job.upload_id = upload.id
            )
       )
       SELECT
         (
           (SELECT count(*) FROM active_jobs) +
           (SELECT count(*) FROM unbound_uploads)
         )::integer AS tenant_active_jobs,
         (
           (SELECT count(*) FROM active_jobs
             WHERE requested_by_membership_id = $2) +
           (SELECT count(*) FROM unbound_uploads
             WHERE created_by_membership_id = $2)
         )::integer AS user_active_jobs`,
      [scope.organizationId, membershipId, convertingUploadId],
    );
    const counts = rows[0] ?? {
      tenant_active_jobs: 0,
      user_active_jobs: 0,
    };
    if (Number(counts.user_active_jobs) >= this.activeJobsPerUser) {
      throw new IngestionAdmissionLimitError('user');
    }
    if (Number(counts.tenant_active_jobs) >= this.activeJobsPerTenant) {
      throw new IngestionAdmissionLimitError('tenant');
    }
  }

  private async findUploadIntent(
    manager: EntityManager,
    scope: FiscalIngestionScope,
    key: string,
  ): Promise<UploadIntentRow | undefined> {
    const rows = await manager.query<UploadIntentRow[]>(
      `SELECT
         upload.id, upload.object_id, object.object_key,
         object.original_filename, object.declared_mime_type, upload.state,
         upload.actual_size_bytes, upload.actual_sha256,
         object.storage_etag, object.storage_version_id,
         upload.created_at, upload.updated_at, upload.version,
         upload.init_request_fingerprint,
         upload.init_response_status, upload.init_response_reference,
         upload.init_idempotency_expires_at,
         upload.init_idempotency_expires_at > clock_timestamp() AS idempotency_valid
       FROM ingestion_uploads upload
       INNER JOIN stored_objects object
         ON object.organization_id = upload.organization_id
        AND object.client_account_id = upload.client_account_id
        AND object.legal_entity_id = upload.legal_entity_id
        AND object.id = upload.object_id
       WHERE upload.organization_id = $1
         AND upload.legal_entity_id = $2
         AND upload.init_idempotency_key = $3
       FOR UPDATE OF upload, object`,
      [scope.organizationId, scope.legalEntityId, key],
    );
    return rows[0];
  }

  private async findUploadIntentById(
    manager: EntityManager,
    scope: FiscalIngestionScope,
    uploadId: string,
  ): Promise<UploadIntentRow | undefined> {
    const rows = await manager.query<UploadIntentRow[]>(
      `SELECT
         upload.id, upload.object_id, object.object_key,
         object.original_filename, object.declared_mime_type, upload.state,
         upload.actual_size_bytes, upload.actual_sha256,
         object.storage_etag, object.storage_version_id,
         upload.created_at, upload.updated_at, upload.version,
         upload.init_request_fingerprint,
         upload.init_response_status, upload.init_response_reference,
         upload.init_idempotency_expires_at,
         upload.init_idempotency_expires_at > clock_timestamp()
           AS idempotency_valid
       FROM ingestion_uploads upload
       INNER JOIN stored_objects object
         ON object.organization_id = upload.organization_id
        AND object.client_account_id = upload.client_account_id
        AND object.legal_entity_id = upload.legal_entity_id
        AND object.id = upload.object_id
       WHERE upload.id = $1
         AND upload.organization_id = $2
         AND upload.client_account_id = $3
         AND upload.legal_entity_id = $4`,
      [
        uploadId,
        scope.organizationId,
        scope.clientAccountId,
        scope.legalEntityId,
      ],
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

  private uploadIntentValue(
    row: UploadIntentRow,
    receiverVersion: number | null = null,
  ): UploadIntentRecord {
    return {
      uploadId: row.id,
      objectId: row.object_id,
      objectKey: row.object_key,
      originalFilename: row.original_filename,
      declaredMimeType: row.declared_mime_type,
      state: row.state,
      actualSizeBytes: row.actual_size_bytes,
      actualSha256: row.actual_sha256,
      storageEtag: row.storage_etag,
      storageVersionId: row.storage_version_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: Number(row.version),
      receiverVersion,
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

  private assertPositiveVersion(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('A positive upload receiver version is required');
    }
  }

  private assertUuid(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new Error(`A valid ${label} is required`);
    }
  }
}
