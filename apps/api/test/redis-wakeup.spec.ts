import { ConfigService } from '@nestjs/config';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import type { FiscalPlatformConfig } from '../src/config/fiscal-platform.config';
import type { RedisClient } from '../src/modules/redis/redis.module';
import { shutdownRedisClient } from '../src/modules/redis/redis-client-shutdown';
import { RedisWakeupService } from '../src/modules/redis/redis-wakeup.service';

describe('RedisWakeupService', () => {
  function config(enabled = true): ConfigService {
    return {
      getOrThrow: jest.fn().mockReturnValue({
        redisWakeup: {
          enabled,
          channel: 'balanz:ingestion:wakeup:test',
          timeoutMs: 50,
        },
      } satisfies Pick<FiscalPlatformConfig, 'redisWakeup'>),
    } as unknown as ConfigService;
  }

  it('publishes a constant non-fiscal signal and dispatches valid wakeups', async () => {
    let subscription: ((message: string) => void) | undefined;
    const subscriber = {
      isReady: true,
      isOpen: true,
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest
        .fn()
        .mockImplementation(
          (_channel: string, listener: (message: string) => void) => {
            subscription = listener;
            return Promise.resolve();
          },
        ),
      close: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
    };
    const publisher = {
      isReady: true,
      publish: jest.fn().mockResolvedValue(1),
      withAbortSignal: jest.fn().mockReturnThis(),
      duplicate: jest.fn().mockReturnValue(subscriber),
    } as unknown as RedisClient;
    const service = new RedisWakeupService(
      publisher,
      config(),
      new FiscalMetricsService(),
    );
    const listener = jest.fn();
    service.subscribe(listener);
    await Promise.resolve();
    await Promise.resolve();

    await expect(service.publishJobsAvailable()).resolves.toBe(true);
    expect((publisher.publish as jest.Mock).mock.calls[0]).toEqual([
      'balanz:ingestion:wakeup:test',
      '1',
    ]);
    subscription?.('not-a-wakeup');
    subscription?.('1');
    expect(listener).toHaveBeenCalledTimes(1);
    await service.onApplicationShutdown();
    expect(subscriber.close).toHaveBeenCalled();
  });

  it('destroys a half-open subscriber instead of blocking shutdown', async () => {
    const subscriber = {
      isReady: false,
      isOpen: true,
      on: jest.fn(),
      connect: jest.fn().mockReturnValue(new Promise(() => undefined)),
      subscribe: jest.fn(),
      close: jest.fn(),
      destroy: jest.fn(),
    };
    const publisher = {
      isReady: false,
      duplicate: jest.fn().mockReturnValue(subscriber),
    } as unknown as RedisClient;
    const service = new RedisWakeupService(
      publisher,
      config(),
      new FiscalMetricsService(),
    );
    service.subscribe(jest.fn());

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(subscriber.close).not.toHaveBeenCalled();
    expect(subscriber.destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds graceful close when a ready client has pending commands', async () => {
    const client = {
      isOpen: true,
      isReady: true,
      close: jest.fn().mockReturnValue(new Promise(() => undefined)),
      destroy: jest.fn(),
    } as unknown as RedisClient;

    const startedAt = Date.now();
    await expect(shutdownRedisClient(client, 50)).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds a half-open publish and leaves polling available', async () => {
    const metrics = new FiscalMetricsService();
    const publisher = {
      isReady: true,
      duplicate: jest.fn(),
      withAbortSignal: jest.fn().mockImplementation((signal: AbortSignal) => ({
        publish: jest.fn().mockImplementation(
          () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new Error('aborted')),
                { once: true },
              );
            }),
        ),
      })),
    } as unknown as RedisClient;
    const service = new RedisWakeupService(publisher, config(), metrics);

    const startedAt = Date.now();
    await expect(service.publishJobsAvailable()).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(metrics.render()).toContain(
      'redis_wakeup_failures_total{stage="publish"} 1',
    );
  });

  it('fails open when Redis is absent and records the acceleration failure', async () => {
    const metrics = new FiscalMetricsService();
    const service = new RedisWakeupService(null, config(), metrics);

    await expect(service.publishJobsAvailable()).resolves.toBe(false);
    expect(service.status()).toMatchObject({
      configured: true,
      publisherReady: false,
      subscriberReady: false,
    });
    expect(metrics.render()).toContain(
      'redis_wakeup_failures_total{stage="publish"} 1',
    );
  });

  it('does not report ready when Redis connects but SUBSCRIBE is denied', async () => {
    const subscriber = {
      isReady: true,
      isOpen: true,
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockRejectedValue(new Error('ACL denied')),
      close: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
    };
    const publisher = {
      isReady: true,
      duplicate: jest.fn().mockReturnValue(subscriber),
    } as unknown as RedisClient;
    const service = new RedisWakeupService(
      publisher,
      config(),
      new FiscalMetricsService(),
    );

    service.subscribe(jest.fn());
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.status()).toMatchObject({ subscriberReady: false });
    expect(subscriber.close).toHaveBeenCalledTimes(1);
    await service.onApplicationShutdown();
  });
});
