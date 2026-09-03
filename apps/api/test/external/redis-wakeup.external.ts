/** Real Redis integration; opt-in and excluded from the default Jest pattern. */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import * as dotenv from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { createSecretsClient, isCategory, isEnvironment } from '@hemia/secrets';
import { createClient } from 'redis';
import { FiscalMetricsService } from '../../src/common/observability/fiscal-metrics.service';
import type { FiscalPlatformConfig } from '../../src/config/fiscal-platform.config';
import type { RedisClient } from '../../src/modules/redis/redis.module';
import { RedisLifecycle } from '../../src/modules/redis/redis.module';
import {
  isRedisSecret,
  type RedisSecret,
} from '../../src/modules/redis/redis.types';
import { RedisWakeupService } from '../../src/modules/redis/redis-wakeup.service';

dotenv.config({ path: resolve(__dirname, '..', '..', '.env'), quiet: true });
dotenv.config({
  path: resolve(__dirname, '..', '..', '.env.local'),
  quiet: true,
});

describe('Redis wakeup against real development infrastructure', () => {
  it('wakes a subscriber without fiscal payload', async () => {
    requireOptIn();
    const connectionOptions = await onlineConnectionOptions();
    const publisher = createClient(connectionOptions) as unknown as RedisClient;
    const payloadObserver = createClient(connectionOptions);
    await publisher.connect();
    await payloadObserver.connect();
    await expect(publisher.ping()).resolves.toBe('PONG');
    await expect(payloadObserver.ping()).resolves.toBe('PONG');
    const metrics = new FiscalMetricsService();
    const namespace = isolatedNamespace();
    const channel = `${namespace}:worker-wakeup`;
    const service = new RedisWakeupService(publisher, config(channel), metrics);
    let wakeupCount = 0;
    const unsubscribe = service.subscribe(() => {
      wakeupCount += 1;
    });
    const observedPayloads: string[] = [];
    await payloadObserver.subscribe(channel, (message) => {
      observedPayloads.push(message);
    });
    const cacheProbeKey = `${namespace}:session-cache-probe`;

    try {
      await eventually(() => service.status().subscriberReady);
      await publisher.set(cacheProbeKey, 'opaque-test-value', { EX: 30 });
      await expect(publisher.get(cacheProbeKey)).resolves.toBe(
        'opaque-test-value',
      );
      await expect(service.publishJobsAvailable()).resolves.toBe(true);
      await eventually(
        () => wakeupCount === 1 && observedPayloads.length === 1,
      );

      const subscriber = wakeupSubscriber(service);
      await subscriber.disconnect();
      await publisher.disconnect();
      expect(service.status()).toMatchObject({
        publisherReady: false,
        subscriberReady: false,
      });

      await publisher.connect();
      await eventually(
        () =>
          service.status().publisherReady && service.status().subscriberReady,
      );
      expect(wakeupSubscriber(service)).not.toBe(subscriber);

      await expect(service.publishJobsAvailable()).resolves.toBe(true);
      await eventually(
        () => wakeupCount === 2 && observedPayloads.length === 2,
      );

      expect(observedPayloads).toEqual(['1', '1']);
      expect(metrics.render()).toContain('redis_wakeup_published_total 2');
      expect(metrics.render()).toContain('redis_wakeup_received_total 2');
    } finally {
      unsubscribe();
      if (publisher.isReady) await publisher.del(cacheProbeKey);
      await service.onApplicationShutdown();
      if (publisher.isOpen) await publisher.quit();
      if (payloadObserver.isOpen) await payloadObserver.quit();
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
        isReady: true,
        options: {
          socket: {
            host: '127.0.0.1',
            port,
            connectTimeout: 100,
            reconnectStrategy: () => 50,
          },
        },
        on: () => undefined,
        off: () => undefined,
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

function config(
  channel = `${isolatedNamespace()}:worker-wakeup`,
): ConfigService {
  return {
    getOrThrow: jest.fn().mockReturnValue({
      redisWakeup: {
        enabled: true,
        channel,
        timeoutMs: 500,
      },
    } satisfies Pick<FiscalPlatformConfig, 'redisWakeup'>),
  } as unknown as ConfigService;
}

function wakeupSubscriber(service: RedisWakeupService): RedisClient {
  const subscriber = (service as unknown as { subscriber: RedisClient | null })
    .subscriber;
  if (!subscriber) throw new Error('Redis wakeup subscriber was not created');
  return subscriber;
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

const runId = `${process.pid}-${randomUUID()}`;

function isolatedNamespace(): string {
  const environment =
    process.env.SECRETS_ENVIRONMENT || process.env.NODE_ENV || 'development';
  return `balanz:cfdi:${environment}:${runId}`;
}

async function onlineConnectionOptions(): Promise<
  Parameters<typeof createClient>[0]
> {
  const url = process.env.REDIS_URL?.trim();
  if (url) return { url };

  if (process.env.SECRETS_ENABLED !== 'true') {
    throw new Error(
      'REDIS_URL or an explicitly enabled dev Vault scope is required',
    );
  }
  const environment = process.env.SECRETS_ENVIRONMENT || 'dev';
  const category = process.env.SECRETS_CATEGORY || 'internal';
  const owner = process.env.SECRETS_OWNER || 'balanz';
  const system = process.env.SECRETS_SYSTEM || 'api';
  if (
    environment !== 'dev' ||
    category !== 'internal' ||
    owner !== 'balanz' ||
    system !== 'api' ||
    !isEnvironment(environment) ||
    !isCategory(category)
  ) {
    throw new Error(
      'Shared Redis smoke is restricted to Vault dev/internal/balanz/api',
    );
  }

  let secret: RedisSecret;
  try {
    const secrets = createSecretsClient({
      scope: { environment, category, owner, system },
      provider: {
        type: 'hashicorp-vault',
        options: {
          baseUrl: requiredEnvironment('VAULT_BASE_URL'),
          roleId: requiredEnvironment('VAULT_ROLE_ID'),
          secretId: requiredEnvironment('VAULT_SECRET_ID'),
          authPath: process.env.VAULT_AUTH_PATH || 'approle',
          mountPrefix: process.env.VAULT_MOUNT_PREFIX || 'kv-',
          timeoutMs: Number(process.env.VAULT_TIMEOUT_MS) || 5_000,
        },
      },
      cache: { enabled: false, ttlMs: 1 },
    });
    const candidate = await secrets.getRequired<unknown>('cache/redis');
    if (!isRedisSecret(candidate)) {
      throw new Error('invalid shape');
    }
    secret = candidate;
  } catch {
    throw new Error('Vault Redis secret resolution failed safely');
  }

  return {
    socket: {
      host: secret.redis_host,
      port: secret.redis_port,
      connectTimeout: 1_000,
    },
    password: secret.redis_password,
    database: secret.redis_db,
  };
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
