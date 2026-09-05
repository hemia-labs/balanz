import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CorrelationIdService } from '../src/common/correlation/correlation-id.service';
import { FiscalEventLogger } from '../src/common/observability/fiscal-event-logger.service';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import type { FiscalPlatformConfig } from '../src/config/fiscal-platform.config';
import { IngestionJobSourceType } from '../src/modules/ingestion/entities/ingestion-job.entity';
import type {
  ClaimResult,
  FoundationReconciliationResult,
  IngestionJobRepository,
} from '../src/modules/ingestion/services/ingestion-job.repository';
import {
  IngestionJobRegistry,
  type IngestionJobHandler,
} from '../src/modules/ingestion/workers/ingestion-job.registry';
import { IngestionWorkerRunner } from '../src/modules/ingestion/workers/ingestion-worker.runner';
import { DurableWorkerError } from '../src/modules/ingestion/workers/worker-error';
import type { RedisWakeupService } from '../src/modules/redis/redis-wakeup.service';

const claim: ClaimResult = {
  jobId: 'f9e1c10c-f45f-42e4-8f2d-d9a32a850a62',
  organizationId: 'b0cbfba0-7f1f-4145-8cb4-d9cf70639f81',
  clientAccountId: '13ff115d-13e5-4cc4-b4be-380666a04b9f',
  legalEntityId: 'd9549965-f168-4076-9654-17cc18ad28c9',
  sourceType: IngestionJobSourceType.MANUAL_XML,
  uploadId: '5b733ad2-2725-4618-87bb-0a00490e5c6d',
  rootObjectId: 'fbbfe537-f8eb-4e6d-a91d-0729e939aef0',
  requestedByMembershipId: 'af698435-8908-45cb-aa98-0e734606cd6e',
  correlationId: '67d6df7a-08f0-4df4-a488-40cba383c9dd',
  attemptCount: 1,
  queueAgeSeconds: 2,
  version: 2,
  recovered: false,
  workerId: 'ignored-by-runner',
  leaseToken: 'b465d36e-15dd-443f-89c6-f8c4c070243d',
};

const emptyReconciliation: FoundationReconciliationResult = {
  leaseRetryableCount: 0,
  leaseFinalCount: 0,
  leaseCancelledCount: 0,
  expiredUploadCount: 0,
  rejectedOrphanObjectCount: 0,
  confirmedObjectWithoutJobCount: 0,
  orphanJobCount: 0,
  repairedCounterCount: 0,
  retentionEligibleObjectCount: 0,
  redundantObjectCount: 0,
};

describe('IngestionWorkerRunner durable semantics', () => {
  afterEach(() => jest.restoreAllMocks());

  function createRunner(
    handler?: IngestionJobHandler,
    heartbeat = 'renewed',
    eventLogger?: FiscalEventLogger,
  ) {
    const jobs = {
      claimNext: jest.fn().mockResolvedValueOnce(claim).mockResolvedValue(null),
      queueAges: jest
        .fn()
        .mockResolvedValue([
          { sourceType: claim.sourceType, queueAgeSeconds: 0 },
        ]),
      heartbeat: jest.fn().mockResolvedValue(heartbeat),
      complete: jest.fn().mockResolvedValue(true),
      failFinal: jest.fn().mockResolvedValue(true),
      scheduleRetry: jest.fn().mockResolvedValue({
        status: 'failed_retryable',
        nextAttemptAt: new Date(),
        automaticRetryCount: 1,
        version: 3,
      }),
      releaseForShutdown: jest.fn().mockResolvedValue(true),
      reconcile: jest.fn().mockResolvedValue(emptyReconciliation),
    };
    const wakeups = {
      subscribe: jest
        .fn<
          ReturnType<RedisWakeupService['subscribe']>,
          Parameters<RedisWakeupService['subscribe']>
        >()
        .mockReturnValue(jest.fn()),
    };
    const events = eventLogger ?? { write: jest.fn() };
    const metrics = new FiscalMetricsService();
    const worker = {
      concurrency: 1,
      leaseSeconds: 90,
      heartbeatSeconds: 0.01,
      maxAttempts: 4,
      maxRetries: 3,
      backoffSeconds: [10, 30, 120],
      backoffJitterPercent: 20,
      pollIntervalMs: 60_000,
      queueMetricsIntervalMs: 30_000,
      reconcileIntervalMs: 60_000,
      shutdownGraceMs: 1_000,
      healthHost: '127.0.0.1',
      healthPort: 3002,
    } satisfies FiscalPlatformConfig['worker'];
    const config = {
      getOrThrow: jest.fn().mockReturnValue({ worker }),
    } as unknown as ConfigService;
    const registry = new IngestionJobRegistry(handler ? [handler] : []);
    if (!handler) {
      jest
        .spyOn(registry, 'supportedSources')
        .mockReturnValue([IngestionJobSourceType.MANUAL_XML]);
    }
    const runner = new IngestionWorkerRunner(
      config,
      jobs as unknown as IngestionJobRepository,
      registry,
      wakeups as unknown as RedisWakeupService,
      new CorrelationIdService(),
      metrics,
      events as unknown as FiscalEventLogger,
    );
    return { runner, jobs, wakeups, events, metrics };
  }

  it.each([false, true])(
    'samples queue ages across wakeups, including failed attempts=%s',
    async (failFirst) => {
      jest.useFakeTimers();
      const { runner, jobs, wakeups, metrics } = createRunner();
      jobs.claimNext.mockReset().mockResolvedValue(null);
      if (failFirst)
        jobs.queueAges.mockRejectedValueOnce(new Error('query unavailable'));
      try {
        runner.onApplicationBootstrap();
        await jest.advanceTimersByTimeAsync(0);
        const wakeup = wakeups.subscribe.mock.calls[0][0];
        expect(jobs.queueAges).toHaveBeenCalledTimes(1);
        for (let tick = 0; tick < 5; tick += 1) {
          await jest.advanceTimersByTimeAsync(5_000);
          wakeup();
          await jest.advanceTimersByTimeAsync(0);
        }
        expect(jobs.queueAges).toHaveBeenCalledTimes(1);
        expect(jobs.claimNext.mock.calls.length).toBeGreaterThan(5);
        await jest.advanceTimersByTimeAsync(5_000);
        wakeup();
        await jest.advanceTimersByTimeAsync(0);
        expect(jobs.queueAges).toHaveBeenCalledTimes(2);
        expect(metrics.render()).toContain(
          'ingestion_queue_refresh_duration_seconds_count{outcome="success"}',
        );
        if (failFirst)
          expect(metrics.render()).toContain(
            'ingestion_queue_refresh_duration_seconds_count{outcome="failed"} 1',
          );
      } finally {
        await runner.onApplicationShutdown();
        jest.useRealTimers();
      }
    },
  );

  it('shares a slow queue query between reconciliation and claim cycles', async () => {
    jest.useFakeTimers();
    const { runner, jobs, wakeups } = createRunner();
    jobs.claimNext.mockReset().mockResolvedValue(null);
    let finish = () => {};
    jobs.queueAges.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([]);
        }),
    );
    try {
      runner.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(30_001);
      const wakeup = wakeups.subscribe.mock.calls[0][0];
      wakeup();
      await jest.advanceTimersByTimeAsync(0);
      expect(jobs.queueAges).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await jest.advanceTimersByTimeAsync(0);
      await runner.onApplicationShutdown();
      jest.useRealTimers();
    }
  });

  it('claims through PostgreSQL polling even when no Redis event arrives', async () => {
    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: jest.fn().mockResolvedValue('completed'),
    };
    const { runner, jobs, wakeups } = createRunner(handler);
    runner.onApplicationBootstrap();
    await eventually(() => jobs.complete.mock.calls.length === 1);

    expect(wakeups.subscribe).toHaveBeenCalled();
    expect(jobs.claimNext).toHaveBeenCalled();
    expect(jobs.complete).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: claim.jobId }),
      'completed',
    );
    await runner.onApplicationShutdown();
  });

  it('persists a typed non-retryable failure directly as failed_final', async () => {
    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: jest
        .fn()
        .mockRejectedValue(
          new DurableWorkerError('MALWARE_DETECTED', { retryable: false }),
        ),
    };
    const { runner, jobs } = createRunner(handler);
    runner.onApplicationBootstrap();
    await eventually(() => jobs.failFinal.mock.calls.length === 1);

    expect(jobs.scheduleRetry).not.toHaveBeenCalled();
    expect(jobs.failFinal).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: claim.jobId }),
      'MALWARE_DETECTED',
      undefined,
    );
    await runner.onApplicationShutdown();
  });

  it('logs a canonical handler code without reclassifying the durable transition as infrastructure failure', async () => {
    const emitted: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      emitted.push(String(message));
    });
    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: jest
        .fn()
        .mockRejectedValue(
          new DurableWorkerError('MALWARE_DETECTED', { retryable: false }),
        ),
    };
    const { runner, jobs } = createRunner(
      handler,
      'renewed',
      new FiscalEventLogger(),
    );

    runner.onApplicationBootstrap();
    await eventually(() =>
      emitted.some((line) => line.includes('MALWARE_DETECTED')),
    );

    expect(jobs.failFinal).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(1);
    expect(JSON.parse(emitted[0])).toMatchObject({
      event: 'ingestion_job_finished',
      result: 'failed_final',
      error_code: 'MALWARE_DETECTED',
    });
    expect(emitted[0]).not.toContain('WORKER_STATE_TRANSITION_FAILED');
    await runner.onApplicationShutdown();
  });

  it('schedules a durable retry for a retryable execution failure', async () => {
    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: jest
        .fn()
        .mockRejectedValue(new Error('synthetic transient fault')),
    };
    const { runner, jobs } = createRunner(handler);
    runner.onApplicationBootstrap();
    await eventually(() => jobs.scheduleRetry.mock.calls.length === 1);

    expect(jobs.scheduleRetry).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: claim.jobId }),
      'UNEXPECTED_WORKER_ERROR',
      undefined,
    );
    expect(jobs.failFinal).not.toHaveBeenCalled();
    expect(jobs.releaseForShutdown).not.toHaveBeenCalled();
    await runner.onApplicationShutdown();
  });

  it('records complete telemetry when a claimed source has no registered handler', async () => {
    const { runner, jobs, events, metrics } = createRunner();
    runner.onApplicationBootstrap();
    await eventually(() => jobs.failFinal.mock.calls.length === 1);

    expect(jobs.failFinal).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: claim.jobId }),
      'HANDLER_NOT_REGISTERED',
      undefined,
    );
    expect(events.write).toHaveBeenCalledWith(
      'info',
      expect.objectContaining({ event: 'ingestion_job_started' }),
    );
    expect(events.write).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        event: 'ingestion_job_finished',
        errorCode: 'HANDLER_NOT_REGISTERED',
        result: 'failed_final',
      }),
    );
    expect(metrics.render()).toContain(
      'ingestion_jobs_failed_total{result="failed_final",source="manual_xml"} 1',
    );
    await runner.onApplicationShutdown();
  });

  it('aborts cooperatively and acknowledges a durable cancellation', async () => {
    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: jest.fn().mockImplementation(
        (_job, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('Worker aborted'),
                ),
              { once: true },
            );
          }),
      ),
    };
    const { runner, jobs, metrics } = createRunner(handler, 'cancel_requested');
    runner.onApplicationBootstrap();
    await eventually(() =>
      jobs.complete.mock.calls.some(([, status]) => status === 'cancelled'),
    );

    expect(handler.handle).toHaveBeenCalled();
    expect(jobs.complete).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: claim.jobId }),
      'cancelled',
    );
    expect(jobs.scheduleRetry).not.toHaveBeenCalled();
    expect(metrics.render()).toContain(
      'worker_heartbeats_total{outcome="cancel_requested",source="manual_xml"} 1',
    );
    await runner.onApplicationShutdown();
  });

  it('releases ownership on shutdown after aborting active work', async () => {
    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: jest.fn().mockImplementation(
        (_job, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('Worker aborted'),
                ),
              { once: true },
            );
          }),
      ),
    };
    const { runner, jobs } = createRunner(handler);
    runner.onApplicationBootstrap();
    await eventually(
      () => (handler.handle as jest.Mock).mock.calls.length === 1,
    );
    await runner.onApplicationShutdown();

    expect(jobs.releaseForShutdown).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: claim.jobId }),
    );
    expect(jobs.scheduleRetry).not.toHaveBeenCalled();
    expect(jobs.failFinal).not.toHaveBeenCalled();
    expect(runner.status().activeJobs).toBe(0);
  });

  it('serializes slow heartbeats and waits for the in-flight heartbeat before shutdown release', async () => {
    let resolveHeartbeat: (outcome: 'renewed') => void = () => undefined;
    let heartbeatInFlight = 0;
    let maxHeartbeatInFlight = 0;
    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: jest.fn().mockImplementation(
        (_job, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new Error('Worker aborted')),
              { once: true },
            );
          }),
      ),
    };
    const { runner, jobs } = createRunner(handler);
    jobs.heartbeat.mockImplementation(
      () =>
        new Promise<'renewed'>((resolve) => {
          heartbeatInFlight += 1;
          maxHeartbeatInFlight = Math.max(
            maxHeartbeatInFlight,
            heartbeatInFlight,
          );
          resolveHeartbeat = (outcome) => {
            heartbeatInFlight -= 1;
            resolve(outcome);
          };
        }),
    );

    runner.onApplicationBootstrap();
    await eventually(() => jobs.heartbeat.mock.calls.length === 1);
    await delay(35);
    expect(jobs.heartbeat).toHaveBeenCalledTimes(1);
    expect(maxHeartbeatInFlight).toBe(1);

    let shutdownSettled = false;
    const shutdown = runner.onApplicationShutdown().then(() => {
      shutdownSettled = true;
    });
    await delay(20);
    expect(shutdownSettled).toBe(false);
    expect(jobs.releaseForShutdown).not.toHaveBeenCalled();

    resolveHeartbeat('renewed');
    await shutdown;
    expect(jobs.releaseForShutdown).toHaveBeenCalledWith(
      expect.objectContaining({ leaseToken: claim.leaseToken }),
    );
    expect(maxHeartbeatInFlight).toBe(1);
  });

  it('releases a claim that resolves while shutdown is already in progress', async () => {
    let resolveClaim: (value: ClaimResult | null) => void = () => undefined;
    const deferredClaim = new Promise<ClaimResult | null>((resolve) => {
      resolveClaim = resolve;
    });
    const handler: IngestionJobHandler = {
      source: IngestionJobSourceType.MANUAL_XML,
      handle: jest.fn().mockResolvedValue('completed'),
    };
    const { runner, jobs } = createRunner(handler);
    jobs.claimNext.mockReset().mockReturnValueOnce(deferredClaim);

    runner.onApplicationBootstrap();
    await eventually(() => jobs.claimNext.mock.calls.length === 1);
    const shutdown = runner.onApplicationShutdown();
    const stoppingStatus = runner.status();
    expect(stoppingStatus.acceptingClaims).toBe(false);
    expect(stoppingStatus.supervisor.state).toBe('stopping');
    expect(stoppingStatus.cycles.poll.state).toBe('running');
    resolveClaim(claim);
    await shutdown;

    expect(handler.handle).not.toHaveBeenCalled();
    expect(jobs.releaseForShutdown).toHaveBeenCalledWith(claim);
    expect(runner.status().activeJobs).toBe(0);
    expect(runner.status().supervisor.state).toBe('stopped');
    expect(runner.status().cycles.poll.state).toBe('succeeded');
  });

  it('waits for an in-flight PostgreSQL reconciliation during shutdown', async () => {
    let resolveReconciliation: (
      result: FoundationReconciliationResult,
    ) => void = () => undefined;
    const deferredReconciliation = new Promise<FoundationReconciliationResult>(
      (resolve) => {
        resolveReconciliation = resolve;
      },
    );
    const { runner, jobs } = createRunner();
    jobs.claimNext.mockReset().mockResolvedValue(null);
    jobs.reconcile.mockReset().mockReturnValueOnce(deferredReconciliation);

    runner.onApplicationBootstrap();
    await eventually(() => jobs.reconcile.mock.calls.length === 1);
    expect(runner.status().cycles.reconciliation.state).toBe('running');

    let shutdownSettled = false;
    const shutdown = runner.onApplicationShutdown().then(() => {
      shutdownSettled = true;
    });
    await delay(20);
    expect(shutdownSettled).toBe(false);

    resolveReconciliation(emptyReconciliation);
    await shutdown;
    expect(runner.status().cycles.reconciliation.state).toBe('succeeded');
    expect(runner.status().supervisor.state).toBe('stopped');
  });
});

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for worker transition');
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
