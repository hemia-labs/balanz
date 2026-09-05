import { ConfigService } from '@nestjs/config';
import type { FiscalPlatformConfig } from '../src/config/fiscal-platform.config';
import type { RedisClient } from '../src/modules/redis/redis.module';
import { RedisLifecycle } from '../src/modules/redis/redis.module';

describe('RedisLifecycle', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      redisWakeup: {
        enabled: true,
        channel: 'balanz:ingestion:wakeup:test',
        timeoutMs: 50,
      },
    } satisfies Pick<FiscalPlatformConfig, 'redisWakeup'>),
  } as unknown as ConfigService;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries a failed optional connection with a bounded five-second backoff', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const client = {
      isOpen: false,
      isReady: false,
      on: jest.fn(),
      off: jest.fn(),
      connect: jest.fn().mockRejectedValue(new Error('unavailable')),
      destroy: jest.fn(),
    } as unknown as RedisClient;
    const lifecycle = new RedisLifecycle(client, config);

    lifecycle.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(client.connect).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(4_999);
    expect(client.connect).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(client.connect).toHaveBeenCalledTimes(2);

    await lifecycle.onApplicationShutdown();
  });

  it('cancels pending reconnect work during shutdown', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const client = {
      isOpen: false,
      isReady: false,
      on: jest.fn(),
      off: jest.fn(),
      connect: jest.fn().mockRejectedValue(new Error('unavailable')),
      destroy: jest.fn(),
    } as unknown as RedisClient;
    const lifecycle = new RedisLifecycle(client, config);

    lifecycle.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    await lifecycle.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.off).toHaveBeenCalledTimes(2);
  });

  it('recovers the publisher after a connected socket emits an error', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    let isOpen = false;
    let errorListener: (() => void) | undefined;
    const client = {
      get isOpen() {
        return isOpen;
      },
      isReady: false,
      on: jest
        .fn()
        .mockImplementation((event: string, listener: () => void) => {
          if (event === 'error') errorListener = listener;
        }),
      off: jest.fn(),
      connect: jest.fn().mockImplementation(() => {
        isOpen = true;
        return Promise.resolve();
      }),
      destroy: jest.fn(),
    } as unknown as RedisClient;
    const lifecycle = new RedisLifecycle(client, config);

    lifecycle.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(client.connect).toHaveBeenCalledTimes(1);

    isOpen = false;
    errorListener?.();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(client.connect).toHaveBeenCalledTimes(2);

    isOpen = false;
    await lifecycle.onApplicationShutdown();
  });
});
