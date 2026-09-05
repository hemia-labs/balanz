export type ObjectStorageErrorCode =
  | 'OBJECT_STORAGE_INVALID_CONFIGURATION'
  | 'OBJECT_STORAGE_INVALID_KEY'
  | 'OBJECT_STORAGE_LIMIT_EXCEEDED'
  | 'OBJECT_STORAGE_SIZE_MISMATCH'
  | 'OBJECT_STORAGE_CONFLICT'
  | 'OBJECT_STORAGE_NOT_FOUND'
  | 'OBJECT_STORAGE_UNAVAILABLE'
  | 'OBJECT_STORAGE_UNSUPPORTED_OPERATION';

export class ObjectStorageError extends Error {
  constructor(
    readonly code: ObjectStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ObjectStorageError';
  }
}

export function asObjectStorageError(
  error: unknown,
  fallbackCode: ObjectStorageErrorCode = 'OBJECT_STORAGE_UNAVAILABLE',
): ObjectStorageError {
  if (error instanceof ObjectStorageError) return error;

  return new ObjectStorageError(
    fallbackCode,
    'The private object storage operation failed',
    error instanceof Error ? { cause: error } : undefined,
  );
}
