export const REDIS_RECONNECT_MIN_DELAY_MS = 5_000;
export const REDIS_RECONNECT_MAX_DELAY_MS = 30_000;
const REDIS_RECONNECT_JITTER_WINDOW_MS = 1_000;

/**
 * Redis is an optional accelerator. A bounded, jittered reconnect cadence keeps
 * an unavailable hostname from monopolizing DNS/connect resources needed by
 * PostgreSQL and the malware scanner.
 */
export function redisReconnectDelayMs(
  retries: number,
  random: () => number = Math.random,
): number {
  const safeRetries = Number.isFinite(retries)
    ? Math.max(0, Math.floor(retries))
    : 0;
  const exponentialDelay =
    REDIS_RECONNECT_MIN_DELAY_MS * 2 ** Math.min(safeRetries, 3);
  const baseDelay = Math.min(
    REDIS_RECONNECT_MAX_DELAY_MS - REDIS_RECONNECT_JITTER_WINDOW_MS,
    exponentialDelay,
  );
  const sample = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
  const jitter = Math.floor(sample * REDIS_RECONNECT_JITTER_WINDOW_MS);
  return baseDelay + jitter;
}
