import { randomUUID } from 'node:crypto';
import { ObjectStorageError } from '../object-storage.errors';

const PREFIX_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class OpaqueObjectKeyFactory {
  readonly prefix: string;

  constructor(prefix = 'objects') {
    const normalized = prefix.trim();
    const segments = normalized.split('/');

    if (
      normalized !== prefix ||
      normalized.includes('\\') ||
      normalized.startsWith('/') ||
      normalized.endsWith('/') ||
      normalized.length === 0 ||
      normalized.length > 240 ||
      segments.length > 8 ||
      segments.some((segment) => !PREFIX_SEGMENT_PATTERN.test(segment))
    ) {
      throw new ObjectStorageError(
        'OBJECT_STORAGE_INVALID_CONFIGURATION',
        'The object storage key prefix is invalid',
      );
    }

    this.prefix = normalized;
  }

  create(): string {
    const id = randomUUID();
    return `${this.prefix}/${id.slice(0, 2)}/${id}`;
  }

  assertValid(value: string): string {
    if (
      value.length === 0 ||
      value.length > 320 ||
      value.includes('\\') ||
      value.includes('\0') ||
      value.startsWith('/')
    ) {
      throw this.invalidKey();
    }

    const expectedPrefix = `${this.prefix}/`;
    if (!value.startsWith(expectedPrefix)) throw this.invalidKey();

    const remainder = value.slice(expectedPrefix.length);
    const segments = remainder.split('/');
    if (segments.length !== 2) throw this.invalidKey();

    const [shard, id] = segments;
    if (
      shard.length !== 2 ||
      !/^[0-9a-f]{2}$/.test(shard) ||
      !UUID_V4_PATTERN.test(id) ||
      id.slice(0, 2) !== shard
    ) {
      throw this.invalidKey();
    }

    return value;
  }

  private invalidKey(): ObjectStorageError {
    return new ObjectStorageError(
      'OBJECT_STORAGE_INVALID_KEY',
      'The object key is not a valid opaque server-generated key',
    );
  }
}
