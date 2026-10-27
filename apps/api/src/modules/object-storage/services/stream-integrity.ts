import { createHash, type Hash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { ObjectStorageError } from '../object-storage.errors';

export class StreamIntegrityTransform extends Transform {
  private readonly hash: Hash = createHash('sha256');
  private finalized = false;
  private byteCount = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  get sizeBytes(): number {
    return this.byteCount;
  }

  digestHex(): string {
    if (this.finalized) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_UNAVAILABLE',
        'The object stream integrity digest was already finalized',
      );
    }
    this.finalized = true;
    return this.hash.digest('hex');
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    const nextSize = this.byteCount + bytes.length;

    if (nextSize > this.maxBytes) {
      callback(
        new ObjectStorageError(
          'OBJECT_STORAGE_LIMIT_EXCEEDED',
          'The object exceeds the configured byte limit',
        ),
      );
      return;
    }

    this.byteCount = nextSize;
    this.hash.update(bytes);
    callback(null, bytes);
  }
}

export function assertExpectedObjectSize(
  expectedSizeBytes: number | undefined,
  maxBytes: number,
): void {
  if (expectedSizeBytes === undefined) return;
  if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 0) {
    throw new ObjectStorageError(
      'OBJECT_STORAGE_INVALID_CONFIGURATION',
      'The expected object size is invalid',
    );
  }
  if (expectedSizeBytes > maxBytes) {
    throw new ObjectStorageError(
      'OBJECT_STORAGE_LIMIT_EXCEEDED',
      'The expected object size exceeds the configured byte limit',
    );
  }
}
