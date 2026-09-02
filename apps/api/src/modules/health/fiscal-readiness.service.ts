import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import type { FiscalPlatformConfig } from '../../config/fiscal-platform.config';
import {
  MALWARE_SCANNER_PORT,
  type MalwareScannerHealth,
  type MalwareScannerPort,
} from '../malware-scanner';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStorageHealth,
  type ObjectStoragePort,
} from '../object-storage';
import { RedisWakeupService } from '../redis/redis-wakeup.service';
import type { IngestionWorkerRunner } from '../ingestion/workers/ingestion-worker.runner';

export type FiscalProcessName = 'api' | 'worker';
export const FISCAL_WORKER_RUNTIME = Symbol('FISCAL_WORKER_RUNTIME');
export type FiscalWorkerRuntime = Pick<IngestionWorkerRunner, 'status'>;

interface DependencyHealth {
  status: 'up' | 'down';
  durationMs: number;
  errorCode?: string;
}

export interface FiscalReadinessResult {
  status: 'up' | 'degraded' | 'down';
  process: FiscalProcessName;
  dependencies: {
    postgres: DependencyHealth;
    storage: ObjectStorageHealth;
    scanner: MalwareScannerHealth;
    redisWakeup: {
      status: 'up' | 'down' | 'disabled';
      required: false;
    };
    workerSupervisor?: WorkerSupervisorHealth;
  };
}

export interface FiscalLivenessResult {
  status: 'up' | 'down';
  process: FiscalProcessName;
  workerSupervisor?: WorkerSupervisorHealth;
}

export interface WorkerSupervisorHealth {
  status: 'up' | 'down';
  required: true;
  state: 'not_started' | 'running' | 'stopping' | 'stopped' | 'unavailable';
  acceptingClaims: boolean;
  lastActivityAt?: string;
  staleAfterMs: number;
  errorCode?:
    | 'WORKER_SUPERVISOR_UNAVAILABLE'
    | 'WORKER_SUPERVISOR_NOT_RUNNING'
    | 'WORKER_SUPERVISOR_STALE';
}

@Injectable()
export class FiscalReadinessService {
  private readonly timeoutMs: number;
  private readonly supervisorStaleAfterMs: number;
  private readonly storageProvider: 'local' | 's3';

  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT) private readonly scanner: MalwareScannerPort,
    private readonly redisWakeup: RedisWakeupService,
    config: ConfigService,
    @Inject(FISCAL_WORKER_RUNTIME)
    private readonly workerRuntime: FiscalWorkerRuntime | null,
  ) {
    const fiscal = config.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
    this.timeoutMs = fiscal.health.timeoutMs;
    this.storageProvider = fiscal.storage.driver;
    this.supervisorStaleAfterMs = Math.max(
      fiscal.worker.pollIntervalMs * 3,
      5_000,
    );
  }

  liveness(process: FiscalProcessName): FiscalLivenessResult {
    if (process === 'api') return { status: 'up', process };
    const workerSupervisor = this.workerSupervisorHealth();
    return {
      status: workerSupervisor.status,
      process,
      workerSupervisor,
    };
  }

  async check(process: FiscalProcessName): Promise<FiscalReadinessResult> {
    const [postgres, storage, scanner] = await Promise.all([
      this.postgresHealth(),
      this.withAbortTimeout((signal) => this.storage.health(signal), {
        status: 'down',
        provider: this.storageProvider,
        durationMs: this.timeoutMs,
        errorCode: 'OBJECT_STORAGE_HEALTH_TIMEOUT',
      }),
      this.withAbortTimeout((signal) => this.scanner.health(signal), {
        status: 'down',
        scanner: 'clamav',
        durationMs: this.timeoutMs,
        errorCode: 'MALWARE_SCANNER_HEALTH_TIMEOUT',
      }),
    ]);
    const redis = this.redisWakeup.status();
    const redisReady =
      process === 'api'
        ? redis.publisherReady
        : redis.publisherReady && redis.subscriberReady;
    const redisStatus = !redis.configured
      ? 'disabled'
      : redisReady
        ? 'up'
        : 'down';
    const workerSupervisor =
      process === 'worker' ? this.workerSupervisorHealth() : undefined;
    const requiredReady =
      postgres.status === 'up' &&
      storage.status === 'up' &&
      scanner.status !== 'down' &&
      (workerSupervisor?.status ?? 'up') === 'up';

    return {
      status: !requiredReady
        ? 'down'
        : redisStatus === 'down'
          ? 'degraded'
          : 'up',
      process,
      dependencies: {
        postgres,
        storage,
        scanner,
        redisWakeup: { status: redisStatus, required: false },
        ...(workerSupervisor ? { workerSupervisor } : {}),
      },
    };
  }

  private workerSupervisorHealth(): WorkerSupervisorHealth {
    if (!this.workerRuntime) {
      return {
        status: 'down',
        required: true,
        state: 'unavailable',
        acceptingClaims: false,
        staleAfterMs: this.supervisorStaleAfterMs,
        errorCode: 'WORKER_SUPERVISOR_UNAVAILABLE',
      };
    }

    const runtime = this.workerRuntime.status();
    const lastActivityAt = runtime.supervisor.lastActivityAt;
    const lastActivityMilliseconds = lastActivityAt
      ? Date.parse(lastActivityAt)
      : Number.NaN;
    const stale =
      !Number.isFinite(lastActivityMilliseconds) ||
      Date.now() - lastActivityMilliseconds > this.supervisorStaleAfterMs;
    const running =
      runtime.supervisor.state === 'running' && runtime.acceptingClaims;
    const errorCode = !running
      ? 'WORKER_SUPERVISOR_NOT_RUNNING'
      : stale
        ? 'WORKER_SUPERVISOR_STALE'
        : undefined;

    return {
      status: errorCode ? 'down' : 'up',
      required: true,
      state: runtime.supervisor.state,
      acceptingClaims: runtime.acceptingClaims,
      ...(lastActivityAt ? { lastActivityAt } : {}),
      staleAfterMs: this.supervisorStaleAfterMs,
      ...(errorCode ? { errorCode } : {}),
    };
  }

  private async postgresHealth(): Promise<DependencyHealth> {
    const startedAt = Date.now();
    try {
      if (!this.dataSource.isInitialized) throw new Error('not initialized');
      const deadlineAt = Date.now() + this.timeoutMs;
      const rows = await this.withTimeout(
        this.postgresFoundationProbe(deadlineAt),
        null,
      );
      if (!rows?.[0]?.foundation_ready) {
        return {
          status: 'down',
          durationMs: Date.now() - startedAt,
          errorCode: 'POSTGRES_FISCAL_SCHEMA_NOT_READY',
        };
      }
      return { status: 'up', durationMs: Date.now() - startedAt };
    } catch {
      return {
        status: 'down',
        durationMs: Date.now() - startedAt,
        errorCode: 'POSTGRES_UNAVAILABLE',
      };
    }
  }

  /**
   * The server-side timeout bounds a query even after the HTTP probe has
   * returned. SET LOCAL prevents timeout state from leaking into the pool.
   */
  private async postgresFoundationProbe(
    deadlineAt: number,
  ): Promise<Array<{ foundation_ready: boolean }>> {
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      const remainingMs = Math.max(1, deadlineAt - Date.now());
      await runner.query(`SELECT set_config('statement_timeout', $1, true)`, [
        `${remainingMs}ms`,
      ]);
      return (await runner.query(
        `SELECT
           to_regclass('public.stored_objects') IS NOT NULL
           AND to_regclass('public.ingestion_uploads') IS NOT NULL
           AND to_regclass('public.ingestion_jobs') IS NOT NULL
           AND to_regclass('public.ingestion_items') IS NOT NULL
           AND to_regprocedure(
             'public.claim_ingestion_job(text,text,text[],integer,integer,integer)'
           ) IS NOT NULL
           AND to_regprocedure(
             'public.reconcile_fiscal_ingestion_foundation(integer,integer,integer,integer,integer[],integer,integer)'
           ) IS NOT NULL AS foundation_ready`,
      )) as Array<{ foundation_ready: boolean }>;
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction().catch(() => undefined);
      }
      await runner.release().catch(() => undefined);
    }
  }

  private async withTimeout<T>(work: Promise<T>, timeoutValue: T): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const expired = new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(timeoutValue), this.timeoutMs);
      timeout.unref();
    });
    try {
      return await Promise.race([work, expired]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async withAbortTimeout<T>(
    work: (signal: AbortSignal) => Promise<T>,
    timeoutValue: T,
  ): Promise<T> {
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const expired = new Promise<T>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve(timeoutValue);
      }, this.timeoutMs);
      timeout.unref();
    });
    try {
      return await Promise.race([work(controller.signal), expired]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

/** Shared helper for the controller; kept here to avoid reflecting internals. */
export function applyReadinessStatus(
  response: Response,
  result: FiscalReadinessResult,
): void {
  response.status(result.status === 'down' ? 503 : 200);
}
