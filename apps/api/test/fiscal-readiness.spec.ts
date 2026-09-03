import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import {
  applyReadinessStatus,
  type FiscalWorkerRuntime,
  FiscalReadinessService,
} from '../src/modules/health/fiscal-readiness.service';
import type { MalwareScannerPort } from '../src/modules/malware-scanner';
import type { ObjectStoragePort } from '../src/modules/object-storage';
import type { RedisWakeupService } from '../src/modules/redis/redis-wakeup.service';

describe('FiscalReadinessService', () => {
  function service(
    options: {
      postgres?: 'up' | 'down';
      foundationReady?: boolean;
      storage?: 'up' | 'down';
      scanner?: 'up' | 'down' | 'bypassed';
      publisherReady?: boolean;
      subscriberReady?: boolean;
      redisConfigured?: boolean;
      workerState?: 'running' | 'stopping' | 'stopped';
      workerLastActivityAt?: string;
      healthTimeoutMs?: number;
      postgresFoundationProbe?: () => Promise<
        Array<{ foundation_ready: boolean }>
      >;
      postgresConnect?: () => Promise<void>;
      postgresRunnerCreated?: () => void;
      storageHealth?: (
        signal?: AbortSignal,
      ) => ReturnType<ObjectStoragePort['health']>;
      scannerHealth?: (
        signal?: AbortSignal,
      ) => ReturnType<MalwareScannerPort['health']>;
    } = {},
  ) {
    const queryRunner = {
      isTransactionActive: false,
      connect: jest
        .fn()
        .mockImplementation(
          options.postgresConnect ?? (() => Promise.resolve()),
        ),
      startTransaction: jest.fn().mockImplementation(function (this: {
        isTransactionActive: boolean;
      }) {
        this.isTransactionActive = true;
        return Promise.resolve();
      }),
      query: jest
        .fn()
        .mockImplementation((query: string) =>
          query.includes('set_config')
            ? Promise.resolve([])
            : options.postgresFoundationProbe
              ? options.postgresFoundationProbe()
              : options.postgres === 'down'
                ? Promise.reject(new Error('offline'))
                : Promise.resolve([
                    { foundation_ready: options.foundationReady ?? true },
                  ]),
        ),
      rollbackTransaction: jest.fn().mockImplementation(function (this: {
        isTransactionActive: boolean;
      }) {
        this.isTransactionActive = false;
        return Promise.resolve();
      }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      isInitialized: options.postgres !== 'down',
      createQueryRunner: jest.fn().mockImplementation(() => {
        options.postgresRunnerCreated?.();
        return queryRunner;
      }),
    } as unknown as DataSource;
    const storage = {
      health: jest.fn().mockImplementation(
        options.storageHealth ??
          (() =>
            Promise.resolve(
              options.storage === 'down'
                ? {
                    status: 'down',
                    provider: 's3',
                    durationMs: 1,
                    errorCode: 'OBJECT_STORAGE_UNAVAILABLE',
                  }
                : { status: 'up', provider: 's3', durationMs: 1 },
            )),
      ),
    } as unknown as ObjectStoragePort;
    const scannerStatus = options.scanner ?? 'up';
    const scanner = {
      health: jest.fn().mockImplementation(
        options.scannerHealth ??
          (() =>
            Promise.resolve(
              scannerStatus === 'down'
                ? {
                    status: 'down',
                    scanner: 'clamav',
                    durationMs: 1,
                    errorCode: 'MALWARE_SCANNER_UNAVAILABLE',
                  }
                : scannerStatus === 'bypassed'
                  ? {
                      status: 'bypassed',
                      scanner: 'development-bypass',
                      durationMs: 0,
                    }
                  : { status: 'up', scanner: 'clamav', durationMs: 1 },
            )),
      ),
    } as unknown as MalwareScannerPort;
    const redis = {
      status: jest.fn().mockReturnValue({
        configured: options.redisConfigured ?? true,
        publisherReady: options.publisherReady ?? true,
        subscriberReady: options.subscriberReady ?? true,
        publishFailures: 0,
        subscriptionFailures: 0,
      }),
    } as unknown as RedisWakeupService;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        health: { timeoutMs: options.healthTimeoutMs ?? 100 },
        storage: { driver: 's3' },
        worker: { pollIntervalMs: 1_000 },
      }),
    } as unknown as ConfigService;
    const workerRuntime = {
      status: jest.fn().mockReturnValue({
        acceptingClaims: (options.workerState ?? 'running') === 'running',
        supervisor: {
          state: options.workerState ?? 'running',
          lastActivityAt:
            options.workerLastActivityAt ?? new Date().toISOString(),
        },
      }),
    } as unknown as FiscalWorkerRuntime;
    return new FiscalReadinessService(
      dataSource,
      storage,
      scanner,
      redis,
      config,
      workerRuntime,
    );
  }

  it('keeps API ready but degraded when optional Redis is down', async () => {
    await expect(
      service({ publisherReady: false }).check('api'),
    ).resolves.toMatchObject({
      status: 'degraded',
      dependencies: {
        redisWakeup: { status: 'down', required: false },
      },
    });
  });

  it('requires both publisher and subscriber for worker Redis acceleration', async () => {
    await expect(
      service({ subscriberReady: false }).check('worker'),
    ).resolves.toMatchObject({ status: 'degraded' });
  });

  it.each(['stopping', 'stopped'] as const)(
    'fails worker health while supervisor is %s',
    async (workerState) => {
      const readiness = service({ workerState });
      expect(readiness.liveness('worker')).toMatchObject({
        status: 'down',
        workerSupervisor: {
          state: workerState,
          errorCode: 'WORKER_SUPERVISOR_NOT_RUNNING',
        },
      });
      await expect(readiness.check('worker')).resolves.toMatchObject({
        status: 'down',
      });
    },
  );

  it('fails worker health when the supervisor activity is stale', () => {
    const readiness = service({
      workerLastActivityAt: new Date(Date.now() - 5_001).toISOString(),
    });
    expect(readiness.liveness('worker')).toMatchObject({
      status: 'down',
      workerSupervisor: { errorCode: 'WORKER_SUPERVISOR_STALE' },
    });
  });

  it.each([
    ['PostgreSQL', { postgres: 'down' as const }],
    ['object storage', { storage: 'down' as const }],
    ['malware scanner', { scanner: 'down' as const }],
  ])(
    'fails readiness when required dependency %s is down',
    async (_name, state) => {
      const result = await service(state).check('api');
      expect(result.status).toBe('down');
      const response = { status: jest.fn() } as unknown as Response;
      applyReadinessStatus(response, result);
      expect(response.status).toHaveBeenCalledWith(503);
    },
  );

  it('allows an explicit development scanner bypass without hiding it', async () => {
    await expect(
      service({ scanner: 'bypassed' }).check('api'),
    ).resolves.toMatchObject({
      status: 'up',
      dependencies: { scanner: { status: 'bypassed' } },
    });
  });

  it('fails readiness when PostgreSQL is reachable before the fiscal migrations', async () => {
    await expect(
      service({ foundationReady: false }).check('worker'),
    ).resolves.toMatchObject({
      status: 'down',
      dependencies: {
        postgres: { errorCode: 'POSTGRES_FISCAL_SCHEMA_NOT_READY' },
      },
    });
  });

  it('aborts storage and scanner probes when the readiness deadline expires', async () => {
    const storageAborted = jest.fn();
    const scannerAborted = jest.fn();
    const waitForAbort = <T>(
      signal: AbortSignal | undefined,
      aborted: jest.Mock,
      result: T,
    ) =>
      new Promise<T>((resolve) => {
        signal?.addEventListener(
          'abort',
          () => {
            aborted();
            resolve(result);
          },
          { once: true },
        );
      });

    const result = await service({
      healthTimeoutMs: 10,
      storageHealth: (signal) =>
        waitForAbort(signal, storageAborted, {
          status: 'down',
          provider: 's3',
          durationMs: 10,
          errorCode: 'OBJECT_STORAGE_UNAVAILABLE',
        }),
      scannerHealth: (signal) =>
        waitForAbort(signal, scannerAborted, {
          status: 'down',
          scanner: 'clamav',
          durationMs: 10,
          errorCode: 'MALWARE_SCANNER_ABORTED',
        }),
    }).check('api');

    expect(result.status).toBe('down');
    expect(storageAborted).toHaveBeenCalledTimes(1);
    expect(scannerAborted).toHaveBeenCalledTimes(1);
  });

  it('shares one PostgreSQL, storage and scanner probe across concurrent requests', async () => {
    const postgresFoundationProbe = jest
      .fn()
      .mockResolvedValue([{ foundation_ready: true }]);
    const storageHealth = jest.fn().mockResolvedValue({
      status: 'up',
      provider: 's3',
      durationMs: 1,
    });
    const scannerHealth = jest.fn().mockResolvedValue({
      status: 'up',
      scanner: 'clamav',
      durationMs: 1,
    });
    const readiness = service({
      postgresFoundationProbe,
      storageHealth,
      scannerHealth,
    });

    const results = await Promise.all([
      readiness.check('api'),
      readiness.check('api'),
      readiness.check('worker'),
    ]);

    expect(results.map(({ status }) => status)).toEqual(['up', 'up', 'up']);
    expect(postgresFoundationProbe).toHaveBeenCalledTimes(1);
    expect(storageHealth).toHaveBeenCalledTimes(1);
    expect(scannerHealth).toHaveBeenCalledTimes(1);
  });

  it('reuses the short health cache and observes degradation after its TTL', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    let storageAvailable = true;
    const postgresFoundationProbe = jest
      .fn()
      .mockResolvedValue([{ foundation_ready: true }]);
    const storageHealth = jest.fn().mockImplementation(() =>
      Promise.resolve(
        storageAvailable
          ? { status: 'up', provider: 's3', durationMs: 1 }
          : {
              status: 'down',
              provider: 's3',
              durationMs: 1,
              errorCode: 'OBJECT_STORAGE_UNAVAILABLE',
            },
      ),
    );
    const scannerHealth = jest.fn().mockResolvedValue({
      status: 'up',
      scanner: 'clamav',
      durationMs: 1,
    });

    try {
      const readiness = service({
        healthTimeoutMs: 100,
        postgresFoundationProbe,
        storageHealth,
        scannerHealth,
      });
      await expect(readiness.check('api')).resolves.toMatchObject({
        status: 'up',
      });

      storageAvailable = false;
      await expect(readiness.check('api')).resolves.toMatchObject({
        status: 'up',
      });
      expect(storageHealth).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(101);
      await expect(readiness.check('api')).resolves.toMatchObject({
        status: 'down',
        dependencies: {
          storage: { errorCode: 'OBJECT_STORAGE_UNAVAILABLE' },
        },
      });
      expect(postgresFoundationProbe).toHaveBeenCalledTimes(2);
      expect(storageHealth).toHaveBeenCalledTimes(2);
      expect(scannerHealth).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps one physical PostgreSQL gate after timeout until its runner settles', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    let releaseConnect: (() => void) | undefined;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const postgresRunnerCreated = jest.fn();

    try {
      const readiness = service({
        healthTimeoutMs: 10,
        postgresConnect: () => connectGate,
        postgresRunnerCreated,
      });
      const first = readiness.check('api');
      await jest.advanceTimersByTimeAsync(10);
      await expect(first).resolves.toMatchObject({
        status: 'down',
        dependencies: {
          postgres: { errorCode: 'POSTGRES_UNAVAILABLE' },
        },
      });
      expect(postgresRunnerCreated).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(11);
      const second = readiness.check('api');
      await Promise.resolve();
      expect(postgresRunnerCreated).toHaveBeenCalledTimes(1);

      releaseConnect?.();
      await expect(second).resolves.toMatchObject({ status: 'up' });
      expect(postgresRunnerCreated).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['storage', 'scanner'] as const)(
    'keeps one physical %s gate after timeout until adapter cleanup settles',
    async (dependency) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
      type PendingHealth =
        | { status: 'up'; provider: 's3'; durationMs: number }
        | { status: 'up'; scanner: 'clamav'; durationMs: number };
      let releasePhysical: (() => void) | undefined;
      let physicalSignal: AbortSignal | undefined;
      const physicalResult: PendingHealth =
        dependency === 'storage'
          ? { status: 'up', provider: 's3', durationMs: 1 }
          : { status: 'up', scanner: 'clamav', durationMs: 1 };
      const pendingHealth = new Promise<PendingHealth>((resolve) => {
        releasePhysical = () => resolve(physicalResult);
      });
      const storageHealth = jest.fn((signal?: AbortSignal) => {
        physicalSignal = signal;
        return pendingHealth as ReturnType<ObjectStoragePort['health']>;
      });
      const scannerHealth = jest.fn((signal?: AbortSignal) => {
        physicalSignal = signal;
        return pendingHealth as ReturnType<MalwareScannerPort['health']>;
      });

      try {
        const readiness = service({
          healthTimeoutMs: 10,
          ...(dependency === 'storage' ? { storageHealth } : { scannerHealth }),
        });
        const first = readiness.check('api');
        await jest.advanceTimersByTimeAsync(10);
        const firstResult = await first;
        expect(firstResult.status).toBe('down');
        expect(firstResult.dependencies[dependency]).toMatchObject({
          status: 'down',
          errorCode:
            dependency === 'storage'
              ? 'OBJECT_STORAGE_HEALTH_TIMEOUT'
              : 'MALWARE_SCANNER_HEALTH_TIMEOUT',
        });
        expect(physicalSignal?.aborted).toBe(true);

        await jest.advanceTimersByTimeAsync(11);
        const second = readiness.check('api');
        await Promise.resolve();
        expect(
          dependency === 'storage' ? storageHealth : scannerHealth,
        ).toHaveBeenCalledTimes(1);

        releasePhysical?.();
        await expect(second).resolves.toMatchObject({ status: 'up' });
        expect(
          dependency === 'storage' ? storageHealth : scannerHealth,
        ).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    },
  );
});
