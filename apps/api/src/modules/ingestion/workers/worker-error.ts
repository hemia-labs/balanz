const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export class DurableWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly safeDetail?: string;

  constructor(
    code: string,
    options: { retryable?: boolean; safeDetail?: string } = {},
  ) {
    if (!SAFE_ERROR_CODE.test(code)) {
      throw new Error(
        'Worker error code must be canonical and safe to persist',
      );
    }
    if (
      options.safeDetail !== undefined &&
      (options.safeDetail.length > 500 ||
        containsUnsafeControl(options.safeDetail))
    ) {
      throw new Error('Worker safe detail is invalid');
    }
    super(code);
    this.name = 'DurableWorkerError';
    this.code = code;
    this.retryable = options.retryable ?? true;
    this.safeDetail = options.safeDetail;
  }
}

function containsUnsafeControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

export function safeWorkerErrorCode(error: unknown): string {
  return error instanceof DurableWorkerError
    ? error.code
    : 'UNEXPECTED_WORKER_ERROR';
}
