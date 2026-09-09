import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import type { FiscalPlatformConfig } from '../../../config/fiscal-platform.config';
import { FiscalTenantTransactionService } from '../../../database/rls/fiscal-tenant-transaction.service';
import { ClientAccountScopeService } from '../../client-accounts/client-account-scope.service';
import { IngestionIdempotencyRepository } from '../../ingestion/services/ingestion-idempotency.repository';
import { OBJECT_STORAGE_PORT } from '../../object-storage/object-storage.tokens';
import type { ObjectStoragePort } from '../../object-storage/ports/object-storage.port';
import { OpaqueObjectKeyFactory } from '../../object-storage/services/opaque-object-key.factory';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import { cfdiHttpError } from '../cfdi-http.errors';
import { ZIP_MAX_BYTES, type ZipUploadInitDto } from '../dtos/zip-upload.dtos';

interface ZipUploadRow {
  id: string;
  object_id: string;
  object_key: string;
  client_account_id: string;
  legal_entity_id: string;
  state: string;
  expected_size_bytes: string;
  expected_sha256: string;
  declared_mime_type: string;
  write_valid: boolean;
  upload_valid: boolean;
}

@Injectable()
export class ZipUploadService {
  private readonly config: FiscalPlatformConfig;
  private readonly prefix: string;
  constructor(
    private readonly transactions: FiscalTenantTransactionService,
    private readonly accounts: ClientAccountScopeService,
    private readonly idempotency: IngestionIdempotencyRepository,
    private readonly keys: OpaqueObjectKeyFactory,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    config: ConfigService,
  ) {
    this.config = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
    this.prefix =
      '/' +
      (config.get<string>('app.globalPrefix') ?? 'api/v1').replace(
        /^\/+|\/+$/g,
        '',
      );
  }

  async init(
    entityId: string,
    key: string | undefined,
    dto: ZipUploadInitDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    assertZipIdempotencyKey(key);
    const scope = await this.run(tenant, async (manager) => {
      const rows = await manager.query<Array<{ client_account_id: string }>>(
        `SELECT client_account_id FROM legal_entities WHERE id=$1 AND organization_id=$2 AND status='active'`,
        [entityId, tenant.organizationId],
      );
      if (!rows[0]) throw missing();
      try {
        await this.accounts.requireAccessibleAccountWithManager(
          manager,
          rows[0].client_account_id,
          tenant,
        );
      } catch {
        throw missing();
      }
      return {
        organizationId: tenant.organizationId!,
        membershipId: tenant.membershipId!,
        clientAccountId: rows[0].client_account_id,
        legalEntityId: entityId,
      };
    });
    try {
      const result = await this.idempotency.createUploadIntent({
        scope,
        workflow: this.storage.createSignedWriteUrl ? 'presigned' : 'direct',
        uploadType: 'manual_zip',
        idempotencyKey: key,
        requestFingerprint: fingerprint(
          'manual_zip_upload_init_v1',
          scope.organizationId,
          scope.legalEntityId,
          dto.filename,
          dto.mimeType,
          dto.sizeBytes,
          dto.sha256,
        ),
        idempotencyExpiresAt: tomorrow(),
        correlationId: request.correlationId,
        expectedSizeBytes: String(dto.sizeBytes),
        expectedSha256: dto.sha256,
        object: {
          kind: 'manual_zip',
          storageProvider: this.config.storage.driver,
          storageContainer:
            this.config.storage.driver === 's3'
              ? this.config.storage.s3.bucket!
              : 'local-private',
          objectKey: this.keys.create(),
          encryptionClass: 'fiscal',
          originalFilename: 'paquete.zip',
          declaredMimeType: dto.mimeType,
        },
      });
      const upload = result.value;
      let transfer: {
        method: string;
        url: string;
        headers: Record<string, string>;
        expiresAt: Date;
      } | null = null;
      if (['pending', 'uploaded'].includes(upload.state)) {
        const ttl = Math.min(300, this.config.storage.signedUrlTtlSeconds);
        const grant = this.storage.createSignedWriteUrl
          ? await this.storage.createSignedWriteUrl({
              objectKey: upload.objectKey,
              sizeBytes: dto.sizeBytes,
              sha256: dto.sha256,
              contentType: dto.mimeType,
              ttlSeconds: ttl,
            })
          : {
              url: `${this.prefix}/ingestion-uploads/${upload.uploadId}/zip/content`,
              headers: { 'content-type': dto.mimeType },
              expiresAt: new Date(Date.now() + ttl * 1000),
            };
        await this.run(tenant, async (manager) => {
          await manager.query(
            `UPDATE ingestion_uploads SET write_expires_at=$3 WHERE organization_id=$1 AND id=$2 AND state IN ('pending','uploaded')`,
            [scope.organizationId, upload.uploadId, grant.expiresAt],
          );
        });
        transfer = { method: 'PUT', ...grant };
      }
      return {
        uploadId: upload.uploadId,
        objectId: upload.objectId,
        state: upload.state,
        upload: transfer,
        links: {
          confirm: `${this.prefix}/ingestion-uploads/${upload.uploadId}/zip/confirm`,
        },
        correlationId: request.correlationId,
      };
    } catch (error) {
      throw translateZipUploadError(error);
    }
  }

  async upload(
    uploadId: string,
    request: Request,
    tenant: SessionAuthorizationContext,
  ) {
    const row = await this.requireUpload(uploadId, tenant);
    if (
      this.storage.createSignedWriteUrl ||
      !row.write_valid ||
      !row.upload_valid ||
      !['pending', 'uploaded'].includes(row.state)
    ) {
      throw cfdiHttpError(
        409,
        'UPLOAD_NOT_CONFIRMABLE',
        'La transferencia expiró o ya terminó.',
      );
    }
    const declaredLength = request.headers['content-length'];
    if (declaredLength && declaredLength !== row.expected_size_bytes)
      throw mismatch();
    if (
      request.headers['content-type']?.split(';')[0] !== row.declared_mime_type
    )
      throw mismatch();
    const abort = new AbortController();
    const onAborted = () => abort.abort();
    request.once('aborted', onAborted);
    let received = 0;
    let exceeded = false;
    const bounded = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        done: TransformCallback,
      ) {
        received += chunk.length;
        if (
          received > ZIP_MAX_BYTES ||
          received > Number(row.expected_size_bytes)
        ) {
          exceeded = true;
          done(mismatch());
          return;
        }
        done(null, chunk);
      },
    });
    const pump = pipeline(request, bounded, { signal: abort.signal });
    void pump.catch(() => undefined);
    try {
      // putStream enforces immutable keys, backpressure and the configured hard cap.
      const result = await this.storage.putStream({
        body: bounded,
        objectKey: row.object_key,
        expectedSizeBytes: Number(row.expected_size_bytes),
        contentType: row.declared_mime_type,
        signal: abort.signal,
      });
      await pump;
      if (
        result.sizeBytes !== Number(row.expected_size_bytes) ||
        result.sha256 !== row.expected_sha256
      )
        throw mismatch();
      return { uploadId, state: 'uploaded' };
    } catch (error) {
      throw exceeded ? mismatch() : translateZipUploadError(error);
    } finally {
      bounded.destroy();
      if (!request.readableEnded) request.destroy();
      await pump.catch(() => undefined);
      request.off('aborted', onAborted);
    }
  }

  async confirm(
    uploadId: string,
    key: string | undefined,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    assertZipIdempotencyKey(key);
    const row = await this.requireUpload(uploadId, tenant);
    const scope = {
      organizationId: tenant.organizationId!,
      membershipId: tenant.membershipId!,
      clientAccountId: row.client_account_id,
      legalEntityId: row.legal_entity_id,
    };
    const digest = fingerprint(
      'manual_zip_upload_confirm_v1',
      scope.organizationId,
      scope.legalEntityId,
      uploadId,
      row.object_id,
      row.expected_size_bytes,
      row.expected_sha256,
    );
    try {
      if (row.state !== 'confirmed') {
        if (!row.upload_valid)
          throw cfdiHttpError(410, 'UPLOAD_EXPIRED', 'La carga expiró.');
        const head = await this.storage.head(row.object_key);
        if (!head)
          throw cfdiHttpError(
            409,
            'UPLOAD_NOT_CONFIRMABLE',
            'El archivo todavía no está disponible.',
          );
        if (
          head.sizeBytes > ZIP_MAX_BYTES ||
          head.sizeBytes !== Number(row.expected_size_bytes)
        )
          throw mismatch();
        const stream = await this.storage.openReadStream(row.object_key);
        const hash = createHash('sha256');
        let size = 0;
        for await (const chunk of stream) {
          const bytes = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as Uint8Array);
          size += bytes.length;
          if (size > ZIP_MAX_BYTES || size > Number(row.expected_size_bytes)) {
            stream.destroy();
            throw mismatch();
          }
          hash.update(bytes);
        }
        if (
          size !== Number(row.expected_size_bytes) ||
          hash.digest('hex') !== row.expected_sha256
        )
          throw mismatch();
      }
      await this.idempotency.confirmUpload({
        scope,
        uploadId,
        idempotencyKey: key,
        requestFingerprint: digest,
        idempotencyExpiresAt: tomorrow(),
        correlationId: request.correlationId,
        actualSizeBytes: row.expected_size_bytes,
        actualSha256: row.expected_sha256,
        detectedMimeType: 'application/zip',
      });
      // Canonical upload-derived reservation key, plus a unique partial index,
      // prevent two confirm keys from ever creating different initial jobs.
      const job = await this.idempotency.createJob({
        scope,
        sourceType: 'manual_zip',
        idempotencyKey: `zip-confirm:${uploadId}`,
        requestFingerprint: digest,
        idempotencyExpiresAt: tomorrow(),
        correlationId: request.correlationId,
        status: 'queued',
        uploadId,
        rootObjectId: row.object_id,
        requestedByMembershipId: scope.membershipId,
      });
      return {
        uploadId,
        objectId: row.object_id,
        jobId: job.value.jobId,
        status: job.value.status,
        links: {
          ingestion: `${this.prefix}/ingestions/${job.value.jobId}`,
          items: `${this.prefix}/ingestions/${job.value.jobId}/items`,
        },
        correlationId: request.correlationId,
      };
    } catch (error) {
      throw translateZipUploadError(error);
    }
  }

  private requireUpload(id: string, tenant: SessionAuthorizationContext) {
    return this.run(tenant, async (manager) => {
      const rows = await manager.query<ZipUploadRow[]>(
        `SELECT upload.id, upload.object_id, upload.client_account_id, upload.legal_entity_id,
        upload.state, upload.expected_size_bytes, upload.expected_sha256, object.object_key, object.declared_mime_type,
        upload.write_expires_at > clock_timestamp() AS write_valid, upload.upload_expires_at > clock_timestamp() AS upload_valid
        FROM ingestion_uploads upload JOIN stored_objects object ON object.id=upload.object_id
        AND object.organization_id=upload.organization_id AND object.client_account_id=upload.client_account_id AND object.legal_entity_id=upload.legal_entity_id
        JOIN legal_entities entity ON entity.id=upload.legal_entity_id AND entity.organization_id=upload.organization_id AND entity.status='active'
        WHERE upload.id=$1 AND upload.organization_id=$2 AND upload.upload_type='manual_zip'`,
        [id, tenant.organizationId],
      );
      if (!rows[0]) throw missing();
      await this.accounts.requireAccessibleAccountWithManager(
        manager,
        rows[0].client_account_id,
        tenant,
      );
      return rows[0];
    });
  }

  private run<T>(
    tenant: SessionAuthorizationContext,
    work: (manager: EntityManager) => Promise<T>,
  ) {
    if (!tenant.organizationId || !tenant.membershipId) throw missing();
    return this.transactions.run(
      {
        organizationId: tenant.organizationId,
        membershipId: tenant.membershipId,
      },
      work,
    );
  }
}

export function assertZipIdempotencyKey(
  key: string | undefined,
): asserts key is string {
  if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
    throw cfdiHttpError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key es obligatorio.',
    );
}
export function fingerprint(...values: (string | number)[]) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
function tomorrow() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}
function missing() {
  return cfdiHttpError(
    404,
    'RESOURCE_NOT_FOUND',
    'El recurso no existe o ya no tienes acceso.',
  );
}
function mismatch() {
  return cfdiHttpError(
    422,
    'UPLOAD_PAYLOAD_MISMATCH',
    'El archivo no coincide con la carga autorizada.',
  );
}
export function translateZipUploadError(error: unknown) {
  if (error instanceof HttpException) return error;
  const code =
    typeof error === 'object' && error && 'code' in error ? error.code : '';
  if (code === 'INGESTION_ACTIVE_JOB_LIMIT')
    return cfdiHttpError(429, code, 'Alcanzaste el límite de cargas activas.');
  if (code === 'IDEMPOTENCY_KEY_EXPIRED')
    return cfdiHttpError(410, code, 'La intención de carga expiró.');
  if (
    [
      'IDEMPOTENCY_CONFLICT',
      'UPLOAD_ALREADY_CONFIRMED',
      'UPLOAD_NOT_CONFIRMABLE',
      'JOB_STATE_CONFLICT',
    ].includes(String(code))
  )
    return cfdiHttpError(
      409,
      String(code),
      'La carga cambió; recupera su estado.',
    );
  if (code === 'OBJECT_STORAGE_CONFLICT')
    return cfdiHttpError(
      409,
      'UPLOAD_ALREADY_CONFIRMED',
      'El archivo ya fue transferido; confirma la carga.',
    );
  if (
    [
      'UPLOAD_PAYLOAD_MISMATCH',
      'OBJECT_STORAGE_SIZE_MISMATCH',
      'OBJECT_STORAGE_LIMIT_EXCEEDED',
    ].includes(String(code))
  )
    return mismatch();
  return cfdiHttpError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'OBJECT_STORAGE_UNAVAILABLE',
    'No se pudo completar la carga. Intenta de nuevo.',
  );
}
