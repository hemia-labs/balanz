import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { CorrelationIdService } from '../../../common/correlation/correlation-id.service';
import { FiscalEventLogger } from '../../../common/observability/fiscal-event-logger.service';
import { FiscalMetricsService } from '../../../common/observability/fiscal-metrics.service';
import type { FiscalPlatformConfig } from '../../../config/fiscal-platform.config';
import { RedisWakeupService } from '../../redis/redis-wakeup.service';
import type { IngestionJobSourceType } from '../entities/ingestion-job.entity';
import {
  type ClaimResult,
  IngestionJobRepository,
} from '../services/ingestion-job.repository';
import { IngestionJobRegistry } from './ingestion-job.registry';
import { DurableWorkerError, safeWorkerErrorCode } from './worker-error';

interface ActiveExecution {
  abort: AbortController;
  cancelRequested: boolean;
  claim: ClaimResult;
  lostLease: boolean;
  promise: Promise<void>;
}

export interface WorkerRuntimeStatus {
  acceptingClaims: boolean;
  activeJobs: number;
  concurrency: number;
  cycles: {
    poll: WorkerCycleStatus;
    reconciliation: WorkerCycleStatus;
  };
  supervisor: {
    state: 'not_started' | 'running' | 'stopping' | 'stopped';
    startedAt?: string;
    lastActivityAt?: string;
  };
  supportedSources: readonly IngestionJobSourceType[];
  workerId: string;
}

export interface WorkerCycleStatus {
  state: 'never' | 'running' | 'succeeded' | 'failed';
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastErrorCode?: string;
}

@Injectable()
export class IngestionWorkerRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly active = new Map<string, ActiveExecution>();
  private readonly worker: FiscalPlatformConfig['worker'];
  private stopping = false;
  private draining = false;
  private drainRequested = false;
  private drainPromise?: Promise<void>;
  private reconciliationPromise?: Promise<void>;
  private queueMetricsPromise?: Promise<void>;
  private queueMetricsLastAttemptAt = Number.NEGATIVE_INFINITY;
  private pollingTimer?: NodeJS.Timeout;
  private reconciliationTimer?: NodeJS.Timeout;
  private unsubscribeWakeup?: () => void;
  private readonly pollCycle: WorkerCycleStatus = { state: 'never' };
  private readonly reconciliationCycle: WorkerCycleStatus = {
    state: 'never',
  };
  private supervisorState: WorkerRuntimeStatus['supervisor']['state'] =
    'not_started';
  private supervisorStartedAt?: string;
  private supervisorLastActivityAt?: string;

  constructor(
    config: ConfigService,
    private readonly jobs: IngestionJobRepository,
    private readonly registry: IngestionJobRegistry,
    private readonly wakeups: RedisWakeupService,
    private readonly correlation: CorrelationIdService,
    private readonly metrics: FiscalMetricsService,
    private readonly events: FiscalEventLogger,
  ) {
    this.worker =
      config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform').worker;
  }

  onApplicationBootstrap(): void {
    const startedAt = new Date().toISOString();
    this.supervisorState = 'running';
    this.supervisorStartedAt = startedAt;
    this.supervisorLastActivityAt = startedAt;
    this.unsubscribeWakeup = this.wakeups.subscribe(() => {
      this.requestDrain();
    });
    this.pollingTimer = setInterval(
      () => this.requestDrain(),
      this.worker.pollIntervalMs,
    );
    this.pollingTimer.unref();
    this.reconciliationTimer = setInterval(
      () => this.requestReconciliation(),
      this.worker.reconcileIntervalMs,
    );
    this.reconciliationTimer.unref();
    this.requestReconciliation();
    this.requestDrain();
  }

  status(): WorkerRuntimeStatus {
    return {
      acceptingClaims: this.supervisorState === 'running' && !this.stopping,
      activeJobs: this.active.size,
      concurrency: this.worker.concurrency,
      cycles: {
        poll: { ...this.pollCycle },
        reconciliation: { ...this.reconciliationCycle },
      },
      supervisor: {
        state: this.supervisorState,
        startedAt: this.supervisorStartedAt,
        lastActivityAt: this.supervisorLastActivityAt,
      },
      supportedSources: this.registry.supportedSources(),
      workerId: this.workerId,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.supervisorState = 'stopping';
    this.touchSupervisor();
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.unsubscribeWakeup?.();
    for (const execution of this.active.values()) {
      execution.abort.abort(new Error('WORKER_SHUTDOWN'));
    }

    const executions = [...this.active.values()].map(({ promise }) => promise);
    if (this.drainPromise) executions.push(this.drainPromise);
    if (this.reconciliationPromise) {
      executions.push(this.reconciliationPromise);
    }
    if (executions.length === 0) {
      this.metrics.increment('worker_shutdown_total', {
        outcome: 'clean',
      });
      this.supervisorState = 'stopped';
      this.touchSupervisor();
      return;
    }

    let graceTimer: NodeJS.Timeout | undefined;
    const graceElapsed = new Promise<'timeout'>((resolve) => {
      graceTimer = setTimeout(
        () => resolve('timeout'),
        this.worker.shutdownGraceMs,
      );
      graceTimer.unref();
    });
    const outcome = await Promise.race([
      Promise.allSettled(executions).then(() => 'clean' as const),
      graceElapsed,
    ]);
    if (graceTimer) clearTimeout(graceTimer);
    this.metrics.increment('worker_shutdown_total', { outcome });
    this.supervisorState = 'stopped';
    this.touchSupervisor();
  }

  private requestDrain(): void {
    if (this.stopping) return;
    this.drainRequested = true;
    if (!this.drainPromise) {
      const cycle = this.drain()
        .catch(() => {
          this.events.write('error', {
            event: 'ingestion_claim_cycle_failed',
            service: 'worker',
            stage: 'claim',
            result: 'failed',
            errorCode: 'JOB_CLAIM_FAILED',
          });
        })
        .finally(() => {
          if (this.drainPromise === cycle) this.drainPromise = undefined;
        });
      this.drainPromise = cycle;
    }
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopping) return;
    this.draining = true;
    this.beginCycle(this.pollCycle);
    let cycleSucceeded = false;
    try {
      do {
        this.drainRequested = false;
        const supportedSources = this.registry.supportedSources();
        if (supportedSources.length === 0) {
          cycleSucceeded = true;
          return;
        }

        while (!this.stopping && this.active.size < this.worker.concurrency) {
          const claim = await this.jobs.claimNext(
            this.workerId,
            supportedSources,
          );
          if (!claim) break;
          if (this.stopping) {
            const released = await this.jobs.releaseForShutdown(claim);
            this.events.write(released ? 'info' : 'error', {
              event: 'ingestion_claim_released_during_shutdown',
              service: 'worker',
              correlationId: claim.correlationId,
              organizationId: claim.organizationId,
              jobId: claim.jobId,
              objectId: claim.rootObjectId ?? undefined,
              stage: 'claim',
              result: released ? 'released' : 'lease_lost',
              errorCode: released ? undefined : 'JOB_LEASE_LOST',
            });
            break;
          }
          if (claim.recovered) {
            this.metrics.increment('ingestion_jobs_recovered_total', {
              source: claim.sourceType,
              outcome: 'claimed',
            });
          }
          this.startExecution(claim);
        }
        await this.refreshQueueAges(supportedSources);
      } while (this.drainRequested && !this.stopping);
      cycleSucceeded = true;
    } finally {
      this.finishCycle(
        this.pollCycle,
        cycleSucceeded,
        cycleSucceeded ? undefined : 'JOB_CLAIM_FAILED',
      );
      this.draining = false;
    }
  }

  private startExecution(claim: ClaimResult): void {
    const abort = new AbortController();
    const execution: ActiveExecution = {
      abort,
      cancelRequested: false,
      claim,
      lostLease: false,
      promise: Promise.resolve(),
    };
    const rawPromise = this.correlation.run(claim.correlationId, () =>
      this.execute(execution),
    );
    const promise = rawPromise
      .catch(() => {
        this.events.write('error', {
          event: 'ingestion_job_infrastructure_failure',
          service: 'worker',
          correlationId: claim.correlationId,
          organizationId: claim.organizationId,
          jobId: claim.jobId,
          objectId: claim.rootObjectId ?? undefined,
          stage: 'worker',
          result: 'failed',
          errorCode: 'WORKER_STATE_TRANSITION_FAILED',
        });
      })
      .finally(() => {
        this.active.delete(claim.leaseToken);
        this.updateActiveJobsMetric(claim.sourceType);
        this.requestDrain();
      });
    execution.promise = promise;
    this.active.set(claim.leaseToken, execution);
    this.updateActiveJobsMetric(claim.sourceType);
  }

  private async execute(execution: ActiveExecution): Promise<void> {
    const { claim, abort } = execution;
    const handler = this.registry.get(claim.sourceType);
    const startedAt = Date.now();
    let result = 'failed';
    let errorCode: string | undefined;

    let heartbeatStopped = false;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let heartbeatInFlight: Promise<void> | undefined;
    const scheduleHeartbeat = (): void => {
      if (heartbeatStopped) return;
      heartbeatTimer = setTimeout(
        runHeartbeat,
        this.worker.heartbeatSeconds * 1_000,
      );
      heartbeatTimer.unref();
    };
    const runHeartbeat = (): void => {
      if (heartbeatStopped || heartbeatInFlight) return;
      const heartbeatStartedAt = Date.now();
      const cycle = this.jobs
        .heartbeat(claim)
        .then((outcome) => {
          this.metrics.increment('worker_heartbeats_total', {
            source: claim.sourceType,
            outcome,
          });
          this.metrics.setGauge(
            'worker_heartbeat_lag_seconds',
            { source: claim.sourceType },
            (Date.now() - heartbeatStartedAt) / 1_000,
          );
          if (outcome === 'renewed') return;
          if (outcome === 'cancel_requested') {
            execution.cancelRequested = true;
            abort.abort(new Error('CANCEL_REQUESTED'));
            return;
          }
          execution.lostLease = true;
          abort.abort(new Error('LEASE_LOST'));
        })
        .catch(() => {
          this.metrics.increment('worker_heartbeats_total', {
            source: claim.sourceType,
            outcome: 'failed',
          });
          execution.lostLease = true;
          abort.abort(new Error('LEASE_HEARTBEAT_FAILED'));
        })
        .finally(() => {
          heartbeatInFlight = undefined;
          scheduleHeartbeat();
        });
      heartbeatInFlight = cycle;
    };
    const stopHeartbeat = async (): Promise<void> => {
      heartbeatStopped = true;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      await heartbeatInFlight;
    };
    scheduleHeartbeat();

    this.events.write('info', {
      event: 'ingestion_job_started',
      service: 'worker',
      correlationId: claim.correlationId,
      organizationId: claim.organizationId,
      jobId: claim.jobId,
      objectId: claim.rootObjectId ?? undefined,
      stage: 'claim',
      result: claim.recovered ? 'recovered' : 'claimed',
    });

    try {
      if (!handler) {
        throw new DurableWorkerError('HANDLER_NOT_REGISTERED', {
          retryable: false,
        });
      }
      const completion = await handler.handle(claim, abort.signal);
      if (
        completion !== 'completed' &&
        completion !== 'completed_with_issues'
      ) {
        throw new DurableWorkerError('INVALID_HANDLER_RESULT', {
          retryable: false,
        });
      }
      await stopHeartbeat();
      if (execution.lostLease) return;
      if (execution.cancelRequested) {
        const cancelled = await this.jobs.complete(claim, 'cancelled');
        result = cancelled ? 'cancelled' : 'lease_lost';
      } else if (this.stopping) {
        const released = await this.jobs.releaseForShutdown(claim);
        result = released ? 'released' : 'lease_lost';
      } else {
        const completed = await this.jobs.complete(claim, completion);
        result = completed ? completion : 'lease_lost';
      }
    } catch (error) {
      await stopHeartbeat();
      if (execution.lostLease) {
        result = 'lease_lost';
        errorCode = 'JOB_LEASE_LOST';
      } else if (execution.cancelRequested) {
        const cancelled = await this.jobs.complete(claim, 'cancelled');
        result = cancelled ? 'cancelled' : 'lease_lost';
      } else if (this.stopping) {
        const released = await this.jobs.releaseForShutdown(claim);
        result = released ? 'released' : 'lease_lost';
      } else if (error instanceof DurableWorkerError && !error.retryable) {
        errorCode = error.code;
        const failed = await this.jobs.failFinal(
          claim,
          error.code,
          error.safeDetail,
        );
        result = failed ? 'failed_final' : 'lease_lost';
      } else {
        errorCode = safeWorkerErrorCode(error);
        const retry = await this.jobs.scheduleRetry(
          claim,
          errorCode,
          error instanceof DurableWorkerError ? error.safeDetail : undefined,
        );
        result = retry?.status ?? 'lease_lost';
        if (!retry) errorCode = 'JOB_LEASE_LOST';
      }
    } finally {
      await stopHeartbeat();
      if (result === 'lease_lost') errorCode ??= 'JOB_LEASE_LOST';
      const durationSeconds = (Date.now() - startedAt) / 1_000;
      this.metrics.observe(
        'ingestion_duration_seconds',
        { source: claim.sourceType, result },
        durationSeconds,
      );
      if (result === 'completed' || result === 'completed_with_issues') {
        this.metrics.increment('ingestion_jobs_completed_total', {
          source: claim.sourceType,
          result,
        });
      } else if (
        result === 'failed_retryable' ||
        result === 'failed_final' ||
        result === 'lease_lost'
      ) {
        this.metrics.increment('ingestion_jobs_failed_total', {
          source: claim.sourceType,
          result,
        });
      }
      const failedResult =
        result === 'failed' ||
        result === 'failed_retryable' ||
        result === 'failed_final' ||
        result === 'lease_lost';
      this.events.write(failedResult ? 'error' : 'info', {
        event: 'ingestion_job_finished',
        service: 'worker',
        correlationId: claim.correlationId,
        organizationId: claim.organizationId,
        jobId: claim.jobId,
        objectId: claim.rootObjectId ?? undefined,
        stage: 'handler',
        durationMs: Date.now() - startedAt,
        result,
        errorCode,
      });
    }
  }

  private requestReconciliation(): void {
    if (this.stopping || this.reconciliationPromise) return;
    const cycle = this.reconcile().finally(() => {
      if (this.reconciliationPromise === cycle) {
        this.reconciliationPromise = undefined;
      }
    });
    this.reconciliationPromise = cycle;
  }

  private async reconcile(): Promise<void> {
    if (this.stopping) return;
    this.beginCycle(this.reconciliationCycle);
    const startedAt = Date.now();
    let cycleSucceeded = false;
    try {
      const reconciliation = await this.jobs.reconcile(100);
      this.incrementIfPositive(
        'worker_lease_reclaims_total',
        { outcome: 'retryable' },
        reconciliation.leaseRetryableCount,
      );
      this.incrementIfPositive(
        'worker_lease_reclaims_total',
        { outcome: 'final' },
        reconciliation.leaseFinalCount,
      );
      this.incrementIfPositive(
        'worker_lease_reclaims_total',
        { outcome: 'cancelled' },
        reconciliation.leaseCancelledCount,
      );
      const reconciledStages: Array<[string, number]> = [
        ['expired_upload', reconciliation.expiredUploadCount],
        ['orphan_object', reconciliation.rejectedOrphanObjectCount],
        [
          'confirmed_without_job',
          reconciliation.confirmedObjectWithoutJobCount,
        ],
        ['orphan_job', reconciliation.orphanJobCount],
        ['job_counters', reconciliation.repairedCounterCount],
        ['redundant_object', reconciliation.redundantObjectCount],
        ['retention', reconciliation.retentionEligibleObjectCount],
      ];
      for (const [stage, count] of reconciledStages) {
        this.incrementIfPositive(
          'ingestion_reconciliations_total',
          { stage, outcome: 'observed' },
          count,
        );
      }
      this.metrics.increment('ingestion_reconciliations_total', {
        stage: 'leases',
        outcome: 'success',
      });
      this.events.write('info', {
        event: 'ingestion_reconciliation_finished',
        service: 'worker',
        stage: 'leases',
        durationMs: Date.now() - startedAt,
        result: 'success',
      });
      const supportedSources = this.registry.supportedSources();
      if (supportedSources.length > 0) {
        await this.refreshQueueAges(supportedSources);
      }
      this.requestDrain();
      cycleSucceeded = true;
    } catch {
      this.metrics.increment('ingestion_reconciliations_total', {
        stage: 'leases',
        outcome: 'failed',
      });
      this.events.write('error', {
        event: 'ingestion_reconciliation_finished',
        service: 'worker',
        stage: 'leases',
        durationMs: Date.now() - startedAt,
        result: 'failed',
        errorCode: 'RECONCILIATION_FAILED',
      });
    } finally {
      this.finishCycle(
        this.reconciliationCycle,
        cycleSucceeded,
        cycleSucceeded ? undefined : 'RECONCILIATION_FAILED',
      );
    }
  }

  private updateActiveJobsMetric(source: IngestionJobSourceType): void {
    const count = [...this.active.values()].filter(
      ({ claim }) => claim.sourceType === source,
    ).length;
    this.metrics.setGauge('worker_active_jobs', { source }, count);
  }

  private refreshQueueAges(
    supportedSources: readonly IngestionJobSourceType[],
  ): Promise<void> {
    if (this.queueMetricsPromise) return this.queueMetricsPromise;
    const startedAt = Date.now();
    if (
      startedAt - this.queueMetricsLastAttemptAt <
      this.worker.queueMetricsIntervalMs
    ) {
      return Promise.resolve();
    }
    // Throttle failed attempts too, so a backlog or outage cannot turn wakeups
    // and job completions into a metrics-query retry loop.
    this.queueMetricsLastAttemptAt = startedAt;
    let outcome = 'failed';
    const refresh = this.jobs
      .queueAges(supportedSources)
      .then((ages) => {
        for (const age of ages) {
          this.metrics.setGauge(
            'ingestion_queue_age_seconds',
            { source: age.sourceType },
            age.queueAgeSeconds,
          );
        }
        outcome = 'success';
      })
      .finally(() => {
        this.metrics.observe(
          'ingestion_queue_refresh_duration_seconds',
          { outcome },
          (Date.now() - startedAt) / 1_000,
        );
        if (this.queueMetricsPromise === refresh)
          this.queueMetricsPromise = undefined;
      });
    this.queueMetricsPromise = refresh;
    return refresh;
  }

  private incrementIfPositive(
    metric: 'worker_lease_reclaims_total' | 'ingestion_reconciliations_total',
    labels: Record<string, string>,
    amount: number,
  ): void {
    if (amount > 0) this.metrics.increment(metric, labels, amount);
  }

  private beginCycle(cycle: WorkerCycleStatus): void {
    cycle.state = 'running';
    cycle.lastStartedAt = new Date().toISOString();
    cycle.lastErrorCode = undefined;
    this.touchSupervisor();
  }

  private finishCycle(
    cycle: WorkerCycleStatus,
    succeeded: boolean,
    errorCode?: string,
  ): void {
    cycle.state = succeeded ? 'succeeded' : 'failed';
    cycle.lastCompletedAt = new Date().toISOString();
    cycle.lastErrorCode = errorCode;
    this.touchSupervisor();
  }

  private touchSupervisor(): void {
    this.supervisorLastActivityAt = new Date().toISOString();
  }
}
