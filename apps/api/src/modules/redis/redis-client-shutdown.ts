import type { RedisClient } from './redis.module';

/**
 * Redis is optional for the fiscal worker, so its own reconnect loop must
 * never keep process shutdown open. Ready clients get a short graceful close;
 * half-open clients and timed-out closes are destroyed immediately.
 */
export async function shutdownRedisClient(
  client: RedisClient,
  timeoutMs: number,
): Promise<void> {
  if (!client.isOpen) return;
  if (!client.isReady) {
    client.destroy();
    return;
  }

  let timeout: NodeJS.Timeout | undefined;
  const graceful = client.close().then(
    () => true,
    () => false,
  );
  const expired = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
    timeout.unref();
  });

  try {
    const closed = await Promise.race([graceful, expired]);
    if (!closed && client.isOpen) client.destroy();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
