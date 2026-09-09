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

export interface SignedObjectWriteInput {
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  ttlSeconds: number;
}

export interface SignedObjectWriteUrl extends SignedObjectReadUrl {
  headers: Record<string, string>;
}

export interface ObjectStorageHealthDiagnostic {
  operation: string;
  code: string;
  httpStatusCode?: number;
}

export type ObjectStorageHealth =
  | { status: 'up'; provider: ObjectStorageProvider; durationMs: number }
  | {
      status: 'down';
      provider: ObjectStorageProvider;
      durationMs: number;
      errorCode: string;
      diagnostics?: ObjectStorageHealthDiagnostic[];
    };

/**
 * Byte-storage boundary. Tenant authorization and stored_objects lifecycle live
 * above this port; adapters only accept opaque, server-generated object keys.
 */
export interface ObjectStoragePort {
  /** Bounded random reads for archive inspection; endExclusive is not inclusive. */
  openReadRange?(
    objectKey: string,
    start: number,
    endExclusive: number,
    signal?: AbortSignal,
  ): Promise<Readable>;
  /** Optional provider capability. Keys and integrity expectations are server-owned. */
  createSignedWriteUrl?(
    input: SignedObjectWriteInput,
  ): Promise<SignedObjectWriteUrl>;
  putStream(input: ObjectStorageWriteInput): Promise<ObjectStorageWriteResult>;
  openReadStream(objectKey: string, signal?: AbortSignal): Promise<Readable>;
  head(objectKey: string): Promise<ObjectStorageObjectMetadata | null>;
  delete(objectKey: string): Promise<void>;
  /** Caller must first fence out active uploads/jobs with a durable cleanup claim. */
  cleanupAbandonedWrite?(objectKey: string): Promise<void>;
  createSignedReadUrl(
    objectKey: string,
    ttlSeconds?: number,
  ): Promise<SignedObjectReadUrl>;
  health(signal?: AbortSignal): Promise<ObjectStorageHealth>;
}
