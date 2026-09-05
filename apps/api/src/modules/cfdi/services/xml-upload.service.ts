import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import busboy, { type FileInfo } from 'busboy';
import { createHash, timingSafeEqual, type Hash } from 'node:crypto';
import { Transform, Writable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import type { FiscalPlatformConfig } from '../../../config/fiscal-platform.config';
import { ClientAccountScopeService } from '../../client-accounts/client-account-scope.service';
import {
  LegalEntity,
  LegalEntityStatus,
} from '../../client-accounts/entities/legal-entity.entity';
import {
  IdempotencyConflictError,
  IdempotencyExpiredError,
  IngestionAdmissionLimitError,
  IngestionIdempotencyRepository,
  JobInputConflictError,
  IngestionStateConflictError,
  type FiscalIngestionScope,
  type UploadIntentRecord,
} from '../../ingestion/services/ingestion-idempotency.repository';
import { ObjectStorageError } from '../../object-storage/object-storage.errors';
import { OBJECT_STORAGE_PORT } from '../../object-storage/object-storage.tokens';
import type { ObjectStoragePort } from '../../object-storage/ports/object-storage.port';
import { OpaqueObjectKeyFactory } from '../../object-storage/services/opaque-object-key.factory';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import { cfdiHttpError } from '../cfdi-http.errors';

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;
const ACCEPTED_XML_MIME_TYPES = new Set([
  'application/xml',
  'text/xml',
  'application/octet-stream',
]);
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1_000;

class UploadRequestAbortedError extends Error {
  readonly code = 'INGESTION_UPLOAD_ABORTED';

  constructor() {
    super('The multipart upload request was aborted');
    this.name = 'UploadRequestAbortedError';
  }
}

class UploadReceiverLeaseLostError extends Error {
  readonly code = 'JOB_STATE_CONFLICT';

  constructor(options?: ErrorOptions) {
    super('The durable upload receiver fence was lost', options);
    this.name = 'UploadReceiverLeaseLostError';
  }
}

export interface XmlUploadAcceptedResponse {
  uploadId: string;
  objectId: string;
  jobId: string;
  status: string;
  links: {
    ingestion: string;
    items: string;
  };
  correlationId: string;
}

interface StoredMultipartFile {
  uploadId: string;
  objectId: string;
  safeFilename: string;
  declaredMimeType: string;
  detectedMimeType: 'application/xml';
  sizeBytes: number;
  sha256: string;
  storageEtag?: string;
  storageVersionId?: string;
  /** Internal cleanup metadata; never exposed by the controller. */
  objectKey: string;
  newlyStored: boolean;
  receiverVersion?: number;
  receiverLease?: UploadReceiverHeartbeat;
}

@Injectable()
export class XmlUploadService {
  private readonly fiscal: FiscalPlatformConfig;
  private readonly apiPrefix: string;

  constructor(
    @InjectRepository(LegalEntity)
    private readonly legalEntities: Repository<LegalEntity>,
    private readonly accountScope: ClientAccountScopeService,
    private readonly idempotency: IngestionIdempotencyRepository,
    private readonly objectKeys: OpaqueObjectKeyFactory,
    @Inject(OBJECT_STORAGE_PORT)
    private readonly storage: ObjectStoragePort,
    config: ConfigService,
  ) {
    this.fiscal = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
    const configuredPrefix = config.get<string>('app.globalPrefix') ?? 'api/v1';
    const normalizedPrefix =
      configuredPrefix.trim().replace(/^\/+|\/+$/g, '') || 'api/v1';
    this.apiPrefix = `/${normalizedPrefix}`;
  }

  async upload(
    legalEntityId: string,
    idempotencyKey: string | undefined,
    request: Request,
    tenant: SessionAuthorizationContext,
    requestContext: RequestContext,
  ): Promise<XmlUploadAcceptedResponse> {
    this.assertIdempotencyKey(idempotencyKey);
    const entity = await this.requireAccessibleEntity(legalEntityId, tenant);
    const scope: FiscalIngestionScope = {
      organizationId: entity.organizationId,
      clientAccountId: entity.clientAccountId,
      legalEntityId: entity.id,
      membershipId: tenant.membershipId!,
    };

    const file = await this.receiveOneXml(
      request,
      scope,
      idempotencyKey,
      requestContext.correlationId,
    ).catch((error: unknown) => {
      throw this.translateError(error);
    });
    const fingerprint = canonicalFingerprint({
      contract: 'manual_xml_upload_v1',
      organizationId: scope.organizationId,
      clientAccountId: scope.clientAccountId,
      legalEntityId: scope.legalEntityId,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      declaredMimeType: file.declaredMimeType,
      detectedMimeType: file.detectedMimeType,
    });
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_WINDOW_MS);

    try {
      await this.idempotency.confirmUpload({
        scope,
        uploadId: file.uploadId,
        idempotencyKey,
        requestFingerprint: fingerprint,
        idempotencyExpiresAt: expiresAt,
        correlationId: requestContext.correlationId,
        actualSizeBytes: String(file.sizeBytes),
        actualSha256: file.sha256,
        storageEtag: file.storageEtag,
        storageVersionId: file.storageVersionId,
        detectedMimeType: file.detectedMimeType,
        receiverVersion: file.receiverVersion,
      });
      const job = await this.idempotency.createJob({
        scope,
        sourceType: 'manual_xml',
        idempotencyKey,
        requestFingerprint: fingerprint,
        idempotencyExpiresAt: expiresAt,
        correlationId: requestContext.correlationId,
        status: 'queued',
        uploadId: file.uploadId,
        rootObjectId: file.objectId,
        requestedByMembershipId: scope.membershipId,
        initialItem: {
          objectId: file.objectId,
          safeFilename: file.safeFilename,
          sha256: file.sha256,
        },
      });
      return {
        uploadId: file.uploadId,
        objectId: file.objectId,
        jobId: job.value.jobId,
        status: job.value.status,
        links: {
          ingestion: `${this.apiPrefix}/ingestions/${job.value.jobId}`,
          items: `${this.apiPrefix}/ingestions/${job.value.jobId}/items`,
        },
        correlationId: requestContext.correlationId,
      };
    } catch (error) {
      throw this.translateError(error);
    }
  }

  private async requireAccessibleEntity(
    legalEntityId: string,
    tenant: SessionAuthorizationContext,
  ): Promise<LegalEntity> {
    if (!tenant.organizationId || !tenant.membershipId) throw this.notFound();
    const entity = await this.legalEntities.findOne({
      where: {
        id: legalEntityId,
        organizationId: tenant.organizationId,
        status: LegalEntityStatus.ACTIVE,
      },
    });
    if (!entity) throw this.notFound();
    try {
      await this.accountScope.requireAccessibleAccount(
        entity.clientAccountId,
        tenant,
      );
    } catch {
      throw this.notFound();
    }
    return entity;
  }

  private async receiveOneXml(
    request: Request,
    scope: FiscalIngestionScope,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<StoredMultipartFile> {
    const contentType = request.headers['content-type'];
    const mediaType =
      typeof contentType === 'string'
        ? contentType.split(';', 1)[0]?.trim().toLowerCase()
        : undefined;
    if (mediaType !== 'multipart/form-data') {
      throw cfdiHttpError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'INGESTION_UNSUPPORTED_MEDIA_TYPE',
        'Se requiere multipart/form-data.',
      );
    }

    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: request.headers,
        limits: {
          // Observe one extra part so a second file is rejected explicitly;
          // Busboy otherwise stops before emitting that file.
          files: this.fiscal.limits.directUploadXmlCount + 1,
          fileSize: this.fiscal.limits.xmlBytes,
          fields: 0,
          parts: this.fiscal.limits.directUploadXmlCount + 1,
        },
      });
    } catch {
      throw cfdiHttpError(
        HttpStatus.BAD_REQUEST,
        'INGESTION_FILE_REQUIRED',
        'La carga multipart no es válida.',
      );
    }

    let count = 0;
    let fileTask:
      | Promise<
          | { ok: true; value: StoredMultipartFile }
          | { ok: false; error: unknown }
        >
      | undefined;
    let parserFailure: Error | undefined;
    let requestTerminated = false;
    let rejectFinished: (error: Error) => void = () => undefined;
    const onRequestAborted = () => {
      if (requestTerminated) return;
      requestTerminated = true;
      const error = new UploadRequestAbortedError();
      request.unpipe(parser);
      parser.destroy(error);
      rejectFinished(error);
    };
    const onRequestError = () => onRequestAborted();
    const finished = new Promise<void>((resolve, reject) => {
      rejectFinished = reject;
      parser.on('file', (fieldName, stream, info) => {
        count += 1;
        if (fieldName !== 'file' || count !== 1) {
          parserFailure = cfdiHttpError(
            HttpStatus.BAD_REQUEST,
            'INGESTION_TOO_MANY_FILES',
            'Envía exactamente un archivo XML en el campo file.',
          );
          stream.resume();
          return;
        }
        fileTask = this.storeFile(
          stream,
          info,
          request,
          scope,
          idempotencyKey,
          correlationId,
        ).then(
          (value) => ({ ok: true, value }) as const,
          (error: unknown) => {
            stream.resume();
            return { ok: false, error } as const;
          },
        );
      });
      parser.once('filesLimit', () => {
        parserFailure = cfdiHttpError(
          HttpStatus.BAD_REQUEST,
          'INGESTION_TOO_MANY_FILES',
          'Sólo se permite un archivo XML.',
        );
      });
      parser.once('fieldsLimit', () => {
        parserFailure = cfdiHttpError(
          HttpStatus.BAD_REQUEST,
          'INGESTION_UNSUPPORTED_MEDIA_TYPE',
          'La carga no acepta campos adicionales.',
        );
      });
      parser.once('error', reject);
      parser.once('finish', resolve);
    });

    request.once('aborted', onRequestAborted);
    request.once('error', onRequestError);
    if (request.aborted) onRequestAborted();
    else request.pipe(parser);
    let finishError: Error | undefined;
    try {
      await finished;
    } catch (error) {
      finishError =
        error instanceof Error
          ? error
          : new Error('The multipart stream could not be processed');
    } finally {
      request.off('aborted', onRequestAborted);
      request.off('error', onRequestError);
    }
    if (!fileTask) {
      const failure = parserFailure ?? finishError;
      if (failure) throw this.translateError(failure);
      throw cfdiHttpError(
        HttpStatus.BAD_REQUEST,
        'INGESTION_FILE_REQUIRED',
        'Selecciona un archivo XML.',
      );
    }
    const fileOutcome = await fileTask;
    if (!fileOutcome.ok) {
      throw this.translateError(fileOutcome.error);
    }
    const file = fileOutcome.value;
    if (count !== 1 && !parserFailure) {
      parserFailure = cfdiHttpError(
        HttpStatus.BAD_REQUEST,
        'INGESTION_TOO_MANY_FILES',
        'Envía exactamente un archivo XML en el campo file.',
      );
    }
    const multipartFailure = parserFailure ?? finishError;
    if (multipartFailure) {
      let receiverVersion = file.receiverVersion;
      if (file.receiverLease) {
        try {
          receiverVersion = await file.receiverLease.stop();
        } catch (error) {
          throw this.translateError(error);
        }
      }
      if (receiverVersion !== undefined) {
        await this.failOwnedUpload(
          scope,
          file.uploadId,
          file.objectKey,
          this.safeFailureCode(multipartFailure),
          correlationId,
          receiverVersion,
        );
      }
      throw this.translateError(multipartFailure);
    }
    if (file.receiverLease) {
      file.receiverVersion = await file.receiverLease.stop();
      file.receiverLease = undefined;
    }
    return file;
  }

  private async storeFile(
    stream: NodeJS.ReadableStream & {
      truncated?: boolean;
      once(event: 'limit', listener: () => void): unknown;
    },
    info: FileInfo,
    request: Request,
    scope: FiscalIngestionScope,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<StoredMultipartFile> {
    const safeFilename = this.safeFilename(info.filename);
    const declaredMimeType = info.mimeType.toLowerCase();
    if (!ACCEPTED_XML_MIME_TYPES.has(declaredMimeType)) {
      throw cfdiHttpError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'INGESTION_UNSUPPORTED_MEDIA_TYPE',
        'El tipo de archivo declarado no es XML.',
      );
    }
    const proposedObjectKey = this.objectKeys.create();
    const initFingerprint = canonicalFingerprint({
      contract: 'manual_xml_upload_init_v1',
      organizationId: scope.organizationId,
      clientAccountId: scope.clientAccountId,
      legalEntityId: scope.legalEntityId,
      declaredMimeType,
    });
    const intent = await this.idempotency.createUploadIntent({
      scope,
      workflow: 'direct',
      uploadType: 'manual_xml',
      idempotencyKey,
      requestFingerprint: initFingerprint,
      idempotencyExpiresAt: new Date(Date.now() + IDEMPOTENCY_WINDOW_MS),
      correlationId,
      object: {
        kind: 'manual_xml',
        storageProvider: this.fiscal.storage.driver,
        storageContainer:
          this.fiscal.storage.driver === 's3'
            ? this.fiscal.storage.s3.bucket!
            : 'local-private',
        objectKey: proposedObjectKey,
        encryptionClass: 'fiscal',
        originalFilename: safeFilename,
        declaredMimeType,
      },
    });

    let durableIntent = intent.value;
    let receiverVersion = durableIntent.receiverVersion ?? undefined;
    if (!receiverVersion && durableIntent.state !== 'confirmed') {
      durableIntent = await this.waitForUploadReceiver(
        request,
        scope,
        durableIntent,
      );
      receiverVersion = durableIntent.receiverVersion ?? undefined;
    }

    const objectKey = durableIntent.objectKey;
    const durableFilename = durableIntent.originalFilename ?? safeFilename;
    const durableDeclaredMimeType =
      durableIntent.declaredMimeType ?? declaredMimeType;

    let exceeded = false;
    stream.once('limit', () => {
      exceeded = true;
    });
    const sniff = new XmlSniffingLimitTransform(this.fiscal.limits.xmlBytes);
    let sizeBytes: number;
    let sha256: string;
    let storageEtag: string | undefined;
    let storageVersionId: string | undefined;
    let newlyStored = false;

    if (!receiverVersion) {
      if (
        durableIntent.state !== 'confirmed' ||
        durableIntent.actualSizeBytes === null ||
        durableIntent.actualSha256 === null
      ) {
        throw new IngestionStateConflictError('UPLOAD_NOT_CONFIRMABLE');
      }
      const incoming = await consumeIncoming(stream, sniff);
      this.assertIncomingFile(stream, sniff, exceeded, incoming.sizeBytes);
      this.assertSamePayload(durableIntent.uploadId, incoming, {
        sizeBytes: Number(durableIntent.actualSizeBytes),
        sha256: durableIntent.actualSha256,
      });
      return {
        uploadId: durableIntent.uploadId,
        objectId: durableIntent.objectId,
        safeFilename: durableFilename,
        declaredMimeType: durableDeclaredMimeType,
        detectedMimeType: 'application/xml',
        sizeBytes: incoming.sizeBytes,
        sha256: incoming.sha256,
        storageEtag: durableIntent.storageEtag ?? undefined,
        storageVersionId: durableIntent.storageVersionId ?? undefined,
        objectKey,
        newlyStored: false,
      };
    }

    const receiverLease = new UploadReceiverHeartbeat(
      receiverVersion,
      Math.max(1_000, this.fiscal.worker.heartbeatSeconds * 1_000),
      (currentVersion) =>
        this.idempotency.renewUploadReceiver(
          scope,
          durableIntent.uploadId,
          currentVersion,
        ),
    );
    receiverLease.start();
    try {
      const existing = await this.storage.head(objectKey);
      if (existing) {
        const incoming = await consumeIncoming(stream, sniff);
        const stored = await readStoredIntegrity(
          this.storage,
          objectKey,
          this.fiscal.limits.xmlBytes,
        );
        this.assertSamePayload(durableIntent.uploadId, incoming, stored);
        sizeBytes = incoming.sizeBytes;
        sha256 = incoming.sha256;
        storageEtag = existing.etag;
        storageVersionId = existing.versionId;
      } else {
        const forwardSourceError = (error: Error) => sniff.destroy(error);
        stream.once('error', forwardSourceError);
        try {
          const stored = await this.storage.putStream({
            body: stream.pipe(
              sniff,
            ) as NodeJS.ReadableStream as import('node:stream').Readable,
            objectKey,
            contentType: 'application/xml',
            signal: receiverLease.signal,
          });
          newlyStored = true;
          const incoming = sniff.integrity();
          if (
            stored.objectKey !== objectKey ||
            stored.sizeBytes !== incoming.sizeBytes ||
            !sameSha256(stored.sha256, incoming.sha256)
          ) {
            throw new ObjectStorageError(
              'OBJECT_STORAGE_SIZE_MISMATCH',
              'The storage result did not match the streamed bytes',
            );
          }
          sizeBytes = incoming.sizeBytes;
          sha256 = incoming.sha256;
          storageEtag = stored.etag;
          storageVersionId = stored.versionId;
        } catch (error) {
          if (
            error instanceof ObjectStorageError &&
            error.code === 'OBJECT_STORAGE_CONFLICT' &&
            sniff.complete
          ) {
            const incoming = sniff.integrity();
            const stored = await readStoredIntegrity(
              this.storage,
              objectKey,
              this.fiscal.limits.xmlBytes,
            );
            this.assertSamePayload(durableIntent.uploadId, incoming, stored);
            const metadata = await this.storage.head(objectKey);
            if (!metadata) {
              throw new IngestionStateConflictError('UPLOAD_NOT_CONFIRMABLE');
            }
            sizeBytes = incoming.sizeBytes;
            sha256 = incoming.sha256;
            storageEtag = metadata.etag;
            storageVersionId = metadata.versionId;
          } else {
            throw error;
          }
        } finally {
          stream.off('error', forwardSourceError);
        }
      }

      this.assertIncomingFile(stream, sniff, exceeded, sizeBytes);

      return {
        uploadId: durableIntent.uploadId,
        objectId: durableIntent.objectId,
        safeFilename: durableFilename,
        declaredMimeType: durableDeclaredMimeType,
        detectedMimeType: 'application/xml',
        sizeBytes,
        sha256,
        storageEtag,
        storageVersionId,
        objectKey,
        newlyStored,
        receiverVersion,
        receiverLease,
      };
    } catch (error) {
      let fencedVersion: number | undefined;
      try {
        fencedVersion = await receiverLease.stop();
      } catch (leaseError) {
        throw this.translateError(leaseError);
      }
      // A replay with different bytes is a conflict against the idempotent
      // intent, not a failure of the original upload. Keep its stored bytes
      // recoverable so the matching request can reclaim this receiver later.
      if (!(error instanceof IdempotencyConflictError)) {
        await this.failOwnedUpload(
          scope,
          durableIntent.uploadId,
          objectKey,
          this.safeFailureCode(error),
          correlationId,
          fencedVersion,
        );
      }
      throw this.translateError(error);
    }
  }

  private async waitForUploadReceiver(
    request: Request,
    scope: FiscalIngestionScope,
    initial: UploadIntentRecord,
  ): Promise<UploadIntentRecord> {
    const deadline =
      Date.now() + Math.max(30_000, this.fiscal.worker.leaseSeconds * 2_000);
    let current = initial;
    while (true) {
      if (request.aborted || request.destroyed) {
        throw new UploadRequestAbortedError();
      }
      const claim = await this.idempotency.claimUploadReceiver(
        scope,
        current.uploadId,
      );
      current = claim.value;
      if (claim.outcome === 'claimed' || current.state === 'confirmed') {
        return current;
      }
      if (current.state === 'failed') {
        // Unlike a lost response or an active receiver lease, this durable
        // terminal state proves that the old key cannot produce an accepted job.
        throw cfdiHttpError(
          HttpStatus.CONFLICT,
          'INGESTION_UPLOAD_FAILED',
          'La recepción anterior falló; vuelve a cargar el archivo.',
        );
      }
      if (!['pending', 'receiving'].includes(current.state)) {
        throw new IngestionStateConflictError('UPLOAD_NOT_CONFIRMABLE');
      }
      if (Date.now() >= deadline) {
        throw new UploadReceiverLeaseLostError();
      }
      await delay(100);
    }
  }

  private assertIncomingFile(
    stream: { truncated?: boolean },
    sniff: XmlSniffingLimitTransform,
    exceeded: boolean,
    sizeBytes: number,
  ): void {
    if (exceeded || stream.truncated) {
      throw cfdiHttpError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'INGESTION_FILE_TOO_LARGE',
        'El XML supera el máximo de 5 MiB.',
      );
    }
    if (sizeBytes === 0 || !sniff.isXml()) {
      throw cfdiHttpError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'INGESTION_UNSUPPORTED_MEDIA_TYPE',
        'El contenido detectado no es XML.',
      );
    }
  }

  private assertSamePayload(
    uploadId: string,
    incoming: PayloadIntegrity,
    stored: PayloadIntegrity,
  ): void {
    if (
      incoming.sizeBytes !== stored.sizeBytes ||
      !sameSha256(incoming.sha256, stored.sha256)
    ) {
      throw new IdempotencyConflictError('upload_confirm', uploadId);
    }
  }

  private async failOwnedUpload(
    scope: FiscalIngestionScope,
    uploadId: string,
    objectKey: string,
    errorCode: string,
    correlationId: string,
    receiverVersion: number,
  ): Promise<void> {
    const fenced = await this.idempotency
      .failUpload(scope, uploadId, errorCode, correlationId, receiverVersion)
      .catch(() => false);
    if (fenced) {
      await this.storage.delete(objectKey).catch(() => undefined);
    }
  }

  private safeFilename(value: string): string {
    const normalized = value.normalize('NFC').trim();
    if (
      normalized.length < 1 ||
      normalized.length > 255 ||
      !/\.xml$/i.test(normalized) ||
      hasUnsafeFilenameCharacter(normalized)
    ) {
      throw cfdiHttpError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'INGESTION_UNSUPPORTED_MEDIA_TYPE',
        'Selecciona un archivo con extensión .xml válida.',
      );
    }
    return normalized;
  }

  private assertIdempotencyKey(
    value: string | undefined,
  ): asserts value is string {
    if (!value) {
      throw cfdiHttpError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key es obligatorio.',
      );
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(value) || value.trim() !== value) {
      throw cfdiHttpError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key no es válido.',
      );
    }
  }

  private translateError(error: unknown): Error {
    if (error instanceof UploadRequestAbortedError) {
      return cfdiHttpError(
        HttpStatus.REQUEST_TIMEOUT,
        error.code,
        'La transferencia del XML fue cancelada.',
      );
    }
    if (error instanceof UploadReceiverLeaseLostError) {
      return cfdiHttpError(
        HttpStatus.CONFLICT,
        error.code,
        'La carga cambió de estado; actualiza e intenta de nuevo.',
      );
    }
    if (error instanceof IngestionAdmissionLimitError) {
      return cfdiHttpError(
        HttpStatus.TOO_MANY_REQUESTS,
        error.code,
        'Alcanzaste el límite de procesos de carga activos.',
      );
    }
    if (error instanceof IdempotencyConflictError) {
      return cfdiHttpError(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_CONFLICT',
        'La clave de idempotencia ya se usó con otro archivo.',
      );
    }
    if (error instanceof IdempotencyExpiredError) {
      return cfdiHttpError(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_KEY_EXPIRED',
        'La ventana de idempotencia expiró.',
      );
    }
    if (error instanceof IngestionStateConflictError) {
      return cfdiHttpError(
        HttpStatus.CONFLICT,
        error.code,
        'La carga ya no está en un estado compatible.',
      );
    }
    if (error instanceof JobInputConflictError) {
      return cfdiHttpError(
        HttpStatus.CONFLICT,
        error.code,
        'La carga cambió de estado; actualiza e intenta de nuevo.',
      );
    }
    if (error instanceof ObjectStorageError) {
      switch (error.code) {
        case 'OBJECT_STORAGE_LIMIT_EXCEEDED':
          return cfdiHttpError(
            HttpStatus.PAYLOAD_TOO_LARGE,
            'INGESTION_FILE_TOO_LARGE',
            'El XML supera el máximo de 5 MiB.',
          );
        case 'OBJECT_STORAGE_SIZE_MISMATCH':
          return cfdiHttpError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'OBJECT_HASH_MISMATCH',
            'No se pudo verificar la integridad del XML.',
          );
        case 'OBJECT_STORAGE_CONFLICT':
          return cfdiHttpError(
            HttpStatus.CONFLICT,
            'JOB_STATE_CONFLICT',
            'La carga cambió de estado; actualiza e intenta de nuevo.',
          );
        case 'OBJECT_STORAGE_INVALID_CONFIGURATION':
        case 'OBJECT_STORAGE_INVALID_KEY':
        case 'OBJECT_STORAGE_NOT_FOUND':
        case 'OBJECT_STORAGE_UNSUPPORTED_OPERATION':
          return cfdiHttpError(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'CONFIGURATION_INVALID',
            'La carga no está disponible por una configuración interna.',
          );
        case 'OBJECT_STORAGE_UNAVAILABLE':
          return cfdiHttpError(
            HttpStatus.SERVICE_UNAVAILABLE,
            'OBJECT_STORAGE_UNAVAILABLE',
            'El almacenamiento privado no está disponible.',
          );
      }
    }
    return error instanceof Error
      ? error
      : new Error('The XML upload failed unexpectedly');
  }

  private safeFailureCode(error: unknown): string {
    if (error instanceof UploadRequestAbortedError) return error.code;
    if (error instanceof ObjectStorageError) return error.code;
    if (
      error &&
      typeof error === 'object' &&
      'getResponse' in error &&
      typeof (error as { getResponse?: unknown }).getResponse === 'function'
    ) {
      const response = (error as { getResponse(): unknown }).getResponse();
      if (response && typeof response === 'object') {
        const code = (response as { code?: unknown }).code;
        if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(code)) {
          return code;
        }
      }
    }
    return 'OBJECT_STORAGE_UNAVAILABLE';
  }

  private notFound() {
    return cfdiHttpError(
      HttpStatus.NOT_FOUND,
      'RESOURCE_NOT_FOUND',
      'El recurso no existe o ya no tienes acceso.',
    );
  }
}

class XmlSniffingLimitTransform extends Transform {
  private readonly prefixChunks: Buffer[] = [];
  private readonly hash: Hash = createHash('sha256');
  private prefixBytes = 0;
  private totalBytes = 0;
  private completed = false;
  private digest?: string;

  constructor(private readonly maxBytes: number) {
    super();
  }

  isXml(): boolean {
    const prefix = Buffer.concat(this.prefixChunks, this.prefixBytes);
    if (prefix.includes(0)) return false;
    const text = prefix
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimStart();
    return text.startsWith('<');
  }

  get complete(): boolean {
    return this.completed;
  }

  integrity(): PayloadIntegrity {
    if (!this.completed) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_UNAVAILABLE',
        'The incoming object stream did not complete',
      );
    }
    this.digest ??= this.hash.digest('hex');
    return { sizeBytes: this.totalBytes, sha256: this.digest };
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.totalBytes += bytes.length;
    if (this.totalBytes > this.maxBytes) {
      callback(
        cfdiHttpError(
          HttpStatus.PAYLOAD_TOO_LARGE,
          'INGESTION_FILE_TOO_LARGE',
          'El XML supera el máximo de 5 MiB.',
        ),
      );
      return;
    }
    if (this.prefixBytes < 1_024) {
      const remaining = 1_024 - this.prefixBytes;
      const captured = bytes.subarray(0, remaining);
      this.prefixChunks.push(captured);
      this.prefixBytes += captured.length;
    }
    this.hash.update(bytes);
    callback(null, bytes);
  }

  override _flush(callback: TransformCallback): void {
    this.completed = true;
    callback();
  }
}

interface PayloadIntegrity {
  sizeBytes: number;
  sha256: string;
}

async function consumeIncoming(
  stream: NodeJS.ReadableStream,
  sniff: XmlSniffingLimitTransform,
): Promise<PayloadIntegrity> {
  await pipeline(
    stream as import('node:stream').Readable,
    sniff,
    new Writable({
      write(_chunk: Buffer, _encoding, callback) {
        callback();
      },
    }),
  );
  return sniff.integrity();
}

async function readStoredIntegrity(
  storage: ObjectStoragePort,
  objectKey: string,
  maxBytes: number,
): Promise<PayloadIntegrity> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const body = await storage.openReadStream(objectKey);
  await pipeline(
    body,
    new Writable({
      write(chunk: Buffer | string, encoding, callback) {
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, encoding);
        sizeBytes += bytes.length;
        if (sizeBytes > maxBytes) {
          callback(
            new ObjectStorageError(
              'OBJECT_STORAGE_LIMIT_EXCEEDED',
              'The stored XML exceeds the configured byte limit',
            ),
          );
          return;
        }
        hash.update(bytes);
        callback();
      },
    }),
  );
  return { sizeBytes, sha256: hash.digest('hex') };
}

function sameSha256(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

class UploadReceiverHeartbeat {
  private readonly controller = new AbortController();
  private timer?: NodeJS.Timeout;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private failure?: Error;

  constructor(
    private currentVersion: number,
    private readonly intervalMs: number,
    private readonly renew: (version: number) => Promise<number | null>,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(): void {
    this.schedule();
  }

  async stop(): Promise<number> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
    if (this.failure) throw this.failure;
    return this.currentVersion;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.pending = this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const next = await this.renew(this.currentVersion);
      if (next === null) throw new UploadReceiverLeaseLostError();
      this.currentVersion = next;
    } catch (error) {
      this.failure =
        error instanceof UploadReceiverLeaseLostError
          ? error
          : new UploadReceiverLeaseLostError(
              error instanceof Error ? { cause: error } : undefined,
            );
      this.controller.abort(this.failure);
      this.stopped = true;
      return;
    }
    this.schedule();
  }
}

function canonicalFingerprint(value: Record<string, string | number>): string {
  const canonical = Object.keys(value)
    .sort()
    .map((key) => `${key}:${String(value[key])}`)
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function hasUnsafeFilenameCharacter(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return true;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
