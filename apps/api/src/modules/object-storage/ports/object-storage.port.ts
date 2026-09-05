import type { Readable } from 'node:stream';

export type ObjectStorageProvider = 'local' | 's3';

export interface ObjectStorageWriteInput {
  body: Readable;
  objectKey?: string;
  contentType?: string;
  expectedSizeBytes?: number;
  signal?: AbortSignal;
}

export interface ObjectStorageWriteResult {
  provider: ObjectStorageProvider;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  etag?: string;
  versionId?: string;
}

export interface ObjectStorageObjectMetadata {
  provider: ObjectStorageProvider;
  objectKey: string;
  sizeBytes: number;
  lastModifiedAt?: Date;
  contentType?: string;
  etag?: string;
  versionId?: string;
  checksumSha256?: string;
}

export interface SignedObjectReadUrl {
  url: string;
  expiresAt: Date;
}

export type ObjectStorageHealth =
  | { status: 'up'; provider: ObjectStorageProvider; durationMs: number }
  | {
      status: 'down';
      provider: ObjectStorageProvider;
      durationMs: number;
      errorCode: string;
    };

/**
 * Byte-storage boundary. Tenant authorization and stored_objects lifecycle live
 * above this port; adapters only accept opaque, server-generated object keys.
 */
export interface ObjectStoragePort {
  putStream(input: ObjectStorageWriteInput): Promise<ObjectStorageWriteResult>;
  openReadStream(objectKey: string, signal?: AbortSignal): Promise<Readable>;
  head(objectKey: string): Promise<ObjectStorageObjectMetadata | null>;
  delete(objectKey: string): Promise<void>;
  createSignedReadUrl(
    objectKey: string,
    ttlSeconds?: number,
  ): Promise<SignedObjectReadUrl>;
  health(signal?: AbortSignal): Promise<ObjectStorageHealth>;
}
