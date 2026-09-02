/** Real Redis integration; opt-in and excluded from the default Jest pattern. */
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { FiscalMetricsService } from '../../src/common/observability/fiscal-metrics.service';
import type { FiscalPlatformConfig } from '../../src/config/fiscal-platform.config';
import type { RedisClient } from '../../src/modules/redis/redis.module';
import { RedisLifecycle } from '../../src/modules/redis/redis.module';
import { RedisWakeupService } from '../../src/modules/redis/redis-wakeup.service';

describe('Redis wakeup against real development infrastructure', () => {
  it('wakes a subscriber without fiscal payload', async () => {
    requireOptIn();
    const publisher = createClient({ url: requiredEnvironment('REDIS_URL') });
    await publisher.connect();
    const service = new RedisWakeupService(
      publisher,
      config(),
      new FiscalMetricsService(),
    );
    const awakened = new Promise<void>((resolve) => service.subscribe(resolve));

    try {
      await eventually(() => service.status().subscriberReady);
      await expect(service.publishJobsAvailable()).resolves.toBe(true);
      await expect(withTimeout(awakened, 2_000)).resolves.toBeUndefined();
    } finally {
      await service.onApplicationShutdown();
      if (publisher.isOpen) await publisher.quit();
    }
  });

  it('keeps wakeup best-effort when Redis is completely unavailable', async () => {
    requireOptIn();
    const unavailable = createClient({
      socket: {
        host: '127.0.0.1',
        port: Number(process.env.REDIS_OFFLINE_PORT ?? 56380),
        connectTimeout: 250,
        reconnectStrategy: false,
      },
    });
    await unavailable.connect().catch(() => undefined);
    const metrics = new FiscalMetricsService();
    const service = new RedisWakeupService(unavailable, config(), metrics);
    await expect(service.publishJobsAvailable()).resolves.toBe(false);
    expect(metrics.render()).toContain('redis_wakeup_failures_total');
    if (unavailable.isOpen) unavailable.destroy();
  });

  it('bounds both lifecycle hooks while real clients reconnect to an offline port', async () => {
    requireOptIn();
    const port = Number(process.env.REDIS_OFFLINE_PORT ?? 56380);
    const lifecycleClient = offlineClient(port);
    const subscriber = offlineClient(port);
    const lifecycleConnection = lifecycleClient
      .connect()
      .catch(() => undefined);
    const service = new RedisWakeupService(
      {
        isReady: false,
        duplicate: () => subscriber,
      } as unknown as RedisClient,
      config(),
      new FiscalMetricsService(),
    );
    service.subscribe(() => undefined);
    await eventually(() => lifecycleClient.isOpen && subscriber.isOpen);
    expect(lifecycleClient.isReady).toBe(false);
    expect(subscriber.isReady).toBe(false);

    const lifecycle = new RedisLifecycle(lifecycleClient, config());
    await expect(
      withTimeout(
        Promise.all([
          lifecycle.onApplicationShutdown(),
          service.onApplicationShutdown(),
        ]).then(() => undefined),
        1_000,
      ),
    ).resolves.toBeUndefined();
    await lifecycleConnection;
    expect(lifecycleClient.isOpen).toBe(false);
    expect(subscriber.isOpen).toBe(false);
  });
});

function config(): ConfigService {
  return {
    getOrThrow: jest.fn().mockReturnValue({
      redisWakeup: {
        enabled: true,
        channel: `balanz:ingestion:wakeup:external-${process.pid}`,
        timeoutMs: 500,
      },
    } satisfies Pick<FiscalPlatformConfig, 'redisWakeup'>),
  } as unknown as ConfigService;
}

function offlineClient(port: number) {
  return createClient({
    socket: {
      host: '127.0.0.1',
      port,
      connectTimeout: 100,
      reconnectStrategy: () => 50,
    },
  });
}

function requireOptIn(): void {
  if (process.env.RUN_REDIS_INTEGRATION !== 'true') {
    throw new Error('RUN_REDIS_INTEGRATION=true is required');
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for real Redis integration`);
  return value;
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for Redis subscriber');
}

async function withTimeout<T>(
  work: Promise<T>,
  milliseconds: number,
): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error('Redis wakeup timeout')), milliseconds),
    ),
  ]);
}
