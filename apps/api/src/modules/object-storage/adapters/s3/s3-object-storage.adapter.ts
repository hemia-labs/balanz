import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { OnApplicationShutdown } from '@nestjs/common';
import {
  asObjectStorageError,
  ObjectStorageError,
} from '../../object-storage.errors';
import type {
  ObjectStorageHealth,
  ObjectStorageObjectMetadata,
  ObjectStoragePort,
  ObjectStorageWriteInput,
  ObjectStorageWriteResult,
  SignedObjectReadUrl,
} from '../../ports/object-storage.port';
import { OpaqueObjectKeyFactory } from '../../services/opaque-object-key.factory';
import {
  assertExpectedObjectSize,
  StreamIntegrityTransform,
} from '../../services/stream-integrity';

const MAX_SIGNED_URL_TTL_SECONDS = 300;
const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

export interface S3ObjectStorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface S3ObjectStorageOptions {
  driver: 's3';
  region: string;
  bucket: string;
  maxBytes: number;
  keyPrefix?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  allowInsecureEndpoint?: boolean;
  credentials?: S3ObjectStorageCredentials;
  serverSideEncryption?: 'none' | 'AES256' | 'aws:kms';
  kmsKeyId?: string;
  signedUrlTtlSeconds?: number;
  connectionTimeoutMs?: number;
  requestTimeoutMs: number;
  multipartQueueSize?: number;
  multipartPartSizeBytes?: number;
}

export class S3ObjectStorageAdapter
  implements ObjectStoragePort, OnApplicationShutdown
{
  private readonly client: S3Client;
  private readonly options: ValidatedS3ObjectStorageOptions;
  private readonly keyFactory: OpaqueObjectKeyFactory;

  constructor(
    options: S3ObjectStorageOptions,
    keyFactory = new OpaqueObjectKeyFactory(options.keyPrefix),
    client?: S3Client,
  ) {
    this.options = validateS3ObjectStorageOptions(options);
    this.keyFactory = keyFactory;
    this.client =
      client ??
      new S3Client({
        region: this.options.region,
        endpoint: this.options.endpoint,
        forcePathStyle: this.options.forcePathStyle,
        credentials: this.options.credentials,
        requestHandler: new NodeHttpHandler({
          connectionTimeout: this.options.connectionTimeoutMs,
          requestTimeout: this.options.requestTimeoutMs,
        }),
      });
  }

  async putStream(
    input: ObjectStorageWriteInput,
  ): Promise<ObjectStorageWriteResult> {
    assertExpectedObjectSize(input.expectedSizeBytes, this.options.maxBytes);
    assertSafeContentType(input.contentType);
    const objectKey = this.keyFactory.assertValid(
      input.objectKey ?? this.keyFactory.create(),
    );
    const integrity = new StreamIntegrityTransform(this.options.maxBytes);
    const body = input.body.pipe(integrity);
    const upload = new Upload({
      client: this.client,
      params: buildS3PutObjectInput(this.options, objectKey, body, input),
      queueSize: this.options.multipartQueueSize,
      partSize: this.options.multipartPartSizeBytes,
      leavePartsOnError: false,
    });
    const abort = () => {
      const abortError = new Error('The private object upload was aborted');
      abortError.name = 'AbortError';
      input.body.destroy(abortError);
      integrity.destroy(abortError);
      void upload.abort().catch(() => undefined);
    };

    if (input.signal?.aborted) abort();
    input.signal?.addEventListener('abort', abort, { once: true });

    try {
      const result = await upload.done();
      if (
        input.expectedSizeBytes !== undefined &&
        integrity.sizeBytes !== input.expectedSizeBytes
      ) {
        await this.delete(objectKey).catch(() => undefined);
        throw new ObjectStorageError(
          'OBJECT_STORAGE_SIZE_MISMATCH',
          'The streamed object size does not match the expected size',
        );
      }

      return {
        provider: 's3',
        objectKey,
        sizeBytes: integrity.sizeBytes,
        sha256: integrity.digestHex(),
        ...(result.ETag ? { etag: normalizeEtag(result.ETag) } : {}),
        ...(result.VersionId ? { versionId: result.VersionId } : {}),
      };
    } catch (error) {
      input.body.unpipe(integrity);
      integrity.destroy();
      await upload.abort().catch(() => undefined);
      if (isS3ConditionalWriteConflict(error)) {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_CONFLICT',
          'The immutable private object key already exists',
          error instanceof Error ? { cause: error } : undefined,
        );
      }
      throw asObjectStorageError(error);
    } finally {
      input.signal?.removeEventListener('abort', abort);
    }
  }

  async openReadStream(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<Readable> {
    const validKey = this.keyFactory.assertValid(objectKey);
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: validKey,
        }),
        signal ? { abortSignal: signal } : undefined,
      );
      if (
        !result.Body ||
        typeof (result.Body as Readable).pipe !== 'function'
      ) {
        throw new ObjectStorageError(
          'OBJECT_STORAGE_UNAVAILABLE',
          'The object provider did not return a Node.js readable stream',
        );
      }
      return result.Body as Readable;
    } catch (error) {
      if (isS3NotFound(error)) throw this.notFound(error);
      throw asObjectStorageError(error);
    }
  }

  async head(objectKey: string): Promise<ObjectStorageObjectMetadata | null> {
    const validKey = this.keyFactory.assertValid(objectKey);
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: validKey,
        }),
      );
      return {
        provider: 's3',
        objectKey: validKey,
        sizeBytes: result.ContentLength ?? 0,
        ...(result.LastModified ? { lastModifiedAt: result.LastModified } : {}),
        ...(result.ContentType ? { contentType: result.ContentType } : {}),
        ...(result.ETag ? { etag: normalizeEtag(result.ETag) } : {}),
        ...(result.VersionId ? { versionId: result.VersionId } : {}),
        ...(result.ChecksumSHA256
          ? { checksumSha256: result.ChecksumSHA256 }
          : {}),
      };
    } catch (error) {
      if (isS3NotFound(error)) return null;
      throw asObjectStorageError(error);
    }
  }

  async delete(objectKey: string): Promise<void> {
    const validKey = this.keyFactory.assertValid(objectKey);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.options.bucket,
          Key: validKey,
        }),
      );
    } catch (error) {
      throw asObjectStorageError(error);
    }
  }

  async createSignedReadUrl(
    objectKey: string,
    ttlSeconds = this.options.signedUrlTtlSeconds,
  ): Promise<SignedObjectReadUrl> {
    const validKey = this.keyFactory.assertValid(objectKey);
    if (
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > this.options.signedUrlTtlSeconds ||
      ttlSeconds > MAX_SIGNED_URL_TTL_SECONDS
    ) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'The signed object URL TTL is outside the configured short-lived limit',
      );
    }

    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: validKey,
        }),
        { expiresIn: ttlSeconds },
      );
      return {
        url,
        expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
      };
    } catch (error) {
      throw asObjectStorageError(error);
    }
  }

  async health(signal?: AbortSignal): Promise<ObjectStorageHealth> {
    const startedAt = Date.now();
    const objectKey = this.keyFactory.create();
    const payload = Buffer.from('health', 'ascii');
    let available = true;
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.options.bucket }),
        { abortSignal: signal },
      );
      await this.client.send(
        new PutObjectCommand(
          buildS3PutObjectInput(
            this.options,
            objectKey,
            Readable.from([payload]),
            {
              expectedSizeBytes: payload.length,
              contentType: 'application/octet-stream',
            },
          ),
        ),
        { abortSignal: signal },
      );
      const head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
        }),
        { abortSignal: signal },
      );
      if (
        head.ContentLength !== payload.length ||
        (this.options.serverSideEncryption !== 'none' &&
          head.ServerSideEncryption !== this.options.serverSideEncryption) ||
        (this.options.serverSideEncryption === 'aws:kms' && !head.SSEKMSKeyId)
      ) {
        throw new Error('S3 health object metadata is incomplete');
      }
      const fetched = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
        }),
        { abortSignal: signal },
      );
      const bytes = await fetched.Body?.transformToByteArray();
      if (!bytes || !Buffer.from(bytes).equals(payload)) {
        throw new Error('S3 health object could not be read back');
      }
    } catch {
      available = false;
    }

    // Cleanup is attempted even after an ambiguous/aborted PUT response. It is
    // intentionally bounded by the S3 client's configured request timeout.
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
        }),
      );
    } catch {
      available = false;
    }

    return available
      ? {
          status: 'up',
          provider: 's3',
          durationMs: Date.now() - startedAt,
        }
      : {
          status: 'down',
          provider: 's3',
          durationMs: Date.now() - startedAt,
          errorCode: 'OBJECT_STORAGE_UNAVAILABLE',
        };
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }

  private notFound(cause: unknown): ObjectStorageError {
    return new ObjectStorageError(
      'OBJECT_STORAGE_NOT_FOUND',
      'The private object was not found',
      cause instanceof Error ? { cause } : undefined,
    );
  }
}

interface ValidatedS3ObjectStorageOptions extends S3ObjectStorageOptions {
  signedUrlTtlSeconds: number;
  multipartQueueSize: number;
  multipartPartSizeBytes: number;
  forcePathStyle: boolean;
  serverSideEncryption: 'none' | 'AES256' | 'aws:kms';
  connectionTimeoutMs: number;
}

export function validateS3ObjectStorageOptions(
  options: S3ObjectStorageOptions,
): ValidatedS3ObjectStorageOptions {
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.region?.trim() ?? '') ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket?.trim() ?? '')
  ) {
    throw invalidS3Configuration();
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw invalidS3Configuration();
  }

  const signedUrlTtlSeconds = options.signedUrlTtlSeconds ?? 60;
  if (
    !Number.isInteger(signedUrlTtlSeconds) ||
    signedUrlTtlSeconds < 1 ||
    signedUrlTtlSeconds > MAX_SIGNED_URL_TTL_SECONDS
  ) {
    throw invalidS3Configuration();
  }

  const multipartQueueSize = options.multipartQueueSize ?? 2;
  const multipartPartSizeBytes =
    options.multipartPartSizeBytes ?? MIN_MULTIPART_PART_SIZE_BYTES;
  if (
    !Number.isInteger(multipartQueueSize) ||
    multipartQueueSize < 1 ||
    multipartQueueSize > 8 ||
    !Number.isSafeInteger(multipartPartSizeBytes) ||
    multipartPartSizeBytes < MIN_MULTIPART_PART_SIZE_BYTES
  ) {
    throw invalidS3Configuration();
  }

  const connectionTimeoutMs =
    options.connectionTimeoutMs ?? Math.min(options.requestTimeoutMs, 5_000);
  if (
    !validS3Timeout(options.requestTimeoutMs) ||
    !validS3Timeout(connectionTimeoutMs) ||
    connectionTimeoutMs > options.requestTimeoutMs
  ) {
    throw invalidS3Configuration();
  }

  const serverSideEncryption = options.serverSideEncryption ?? 'aws:kms';
  if (serverSideEncryption === 'aws:kms' && !options.kmsKeyId?.trim()) {
    throw invalidS3Configuration();
  }
  if (options.kmsKeyId && /[\r\n\0]/.test(options.kmsKeyId)) {
    throw invalidS3Configuration();
  }
  if (serverSideEncryption !== 'aws:kms' && options.kmsKeyId) {
    throw invalidS3Configuration();
  }

  if (options.endpoint) {
    let endpoint: URL;
    try {
      endpoint = new URL(options.endpoint);
    } catch {
      throw invalidS3Configuration();
    }
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol === 'http:' && !options.allowInsecureEndpoint)
    ) {
      throw invalidS3Configuration();
    }
  }

  if (options.credentials) {
    if (
      !options.credentials.accessKeyId?.trim() ||
      !options.credentials.secretAccessKey?.trim() ||
      /[\r\n\0]/.test(options.credentials.accessKeyId) ||
      /[\r\n\0]/.test(options.credentials.secretAccessKey) ||
      (options.credentials.sessionToken !== undefined &&
        (!options.credentials.sessionToken.trim() ||
          /[\r\n\0]/.test(options.credentials.sessionToken)))
    ) {
      throw invalidS3Configuration();
    }
  }

  return {
    ...options,
    region: options.region.trim(),
    bucket: options.bucket.trim(),
    endpoint: options.endpoint?.replace(/\/$/, ''),
    forcePathStyle: options.forcePathStyle ?? false,
    serverSideEncryption,
    signedUrlTtlSeconds,
    multipartQueueSize,
    multipartPartSizeBytes,
    connectionTimeoutMs,
  };
}

function validS3Timeout(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 300_000;
}

function assertSafeContentType(contentType: string | undefined): void {
  if (
    contentType !== undefined &&
    (contentType.length < 1 ||
      contentType.length > 255 ||
      /[\r\n\0]/.test(contentType))
  ) {
    throw invalidS3Configuration();
  }
}

export function buildS3PutObjectInput(
  options: ValidatedS3ObjectStorageOptions,
  objectKey: string,
  body: Readable,
  input: Pick<ObjectStorageWriteInput, 'contentType' | 'expectedSizeBytes'>,
): PutObjectCommandInput {
  const encryption =
    options.serverSideEncryption === 'none'
      ? {}
      : {
          ServerSideEncryption:
            options.serverSideEncryption as ServerSideEncryption,
          ...(options.serverSideEncryption === 'aws:kms'
            ? { SSEKMSKeyId: options.kmsKeyId }
            : {}),
        };

  return {
    Bucket: options.bucket,
    Key: objectKey,
    // Applied by PutObject and CompleteMultipartUpload. S3 evaluates this
    // atomically, so racing writers cannot replace immutable fiscal bytes.
    IfNoneMatch: '*',
    Body: body,
    ...(input.contentType ? { ContentType: input.contentType } : {}),
    ...(input.expectedSizeBytes !== undefined
      ? { ContentLength: input.expectedSizeBytes }
      : {}),
    ...encryption,
    // Deliberately no ACL: bucket policy remains private and public ACLs are
    // never requested by the application.
  };
}

function invalidS3Configuration(): ObjectStorageError {
  return new ObjectStorageError(
    'OBJECT_STORAGE_INVALID_CONFIGURATION',
    'The S3-compatible private object storage configuration is invalid',
  );
}

function isS3NotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function isS3ConditionalWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === 'PreconditionFailed' ||
    candidate.name === 'ConditionalRequestConflict' ||
    candidate.Code === 'PreconditionFailed' ||
    candidate.Code === 'ConditionalRequestConflict' ||
    candidate.$metadata?.httpStatusCode === 409 ||
    candidate.$metadata?.httpStatusCode === 412
  );
}

function normalizeEtag(value: string): string {
  return value.replace(/^"|"$/g, '');
}
