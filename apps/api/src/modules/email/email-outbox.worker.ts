import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Notification, PoolClient } from 'pg';
import { DataSource, QueryRunner } from 'typeorm';
import { EMAIL_OUTBOX_CHANNEL, EmailService } from './email.service';

interface ClaimedOutbox {
  id: string;
}

type RowRecord = Record<string, unknown>;

@Injectable()
export class EmailOutboxWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(EmailOutboxWorker.name);
  private listenerRunner?: QueryRunner;
  private listenerClient?: PoolClient;
  private sweepTimer?: NodeJS.Timeout;
  private draining = false;
  private rerun = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.startListener();
    this.sweepTimer = setInterval(
      () => void this.drain(),
      this.config.get<number>('email.workerSweepMs', 60_000),
    );
    await this.drain();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (!this.listenerRunner) return;

    this.listenerClient?.removeListener('notification', this.onNotification);
    this.listenerClient?.removeListener('error', this.onListenerError);
    await this.listenerRunner.query(`UNLISTEN ${EMAIL_OUTBOX_CHANNEL}`);
    await this.listenerRunner.release();
  }

  private async startListener(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    try {
      const client = (await runner.connect()) as PoolClient;
      client.on('notification', this.onNotification);
      client.on('error', this.onListenerError);
      await runner.query(`LISTEN ${EMAIL_OUTBOX_CHANNEL}`);
      this.listenerRunner = runner;
      this.listenerClient = client;
    } catch {
      await runner.release().catch(() => undefined);
      this.logger.warn(
        'PostgreSQL LISTEN unavailable; periodic outbox sweep remains active',
      );
    }
  }

  private readonly onNotification = (notification: Notification): void => {
    if (notification.channel === EMAIL_OUTBOX_CHANNEL) void this.drain();
  };

  private readonly onListenerError = (): void => {
    this.logger.warn(
      'PostgreSQL outbox listener disconnected; periodic sweep remains active',
    );
  };

  private async drain(): Promise<void> {
    if (this.draining) {
      this.rerun = true;
      return;
    }

    this.draining = true;
    try {
      do {
        this.rerun = false;
        await this.recoverStaleClaims();

        let claimed: ClaimedOutbox[];
        do {
          claimed = await this.claimBatch();
          for (const outbox of claimed) {
            await this.email.recoverVerification(outbox.id);
          }
        } while (claimed.length === this.batchSize());
      } while (this.rerun);
    } catch (error) {
      this.logger.error(
        'Email outbox sweep failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.draining = false;
    }
  }

  private recoverStaleClaims(): Promise<unknown> {
    return this.dataSource.query(
      `UPDATE email_outbox
       SET status = 'failed', available_at = now(), updated_at = now()
       WHERE kind = 'email_verification'
         AND status = 'processing'
         AND updated_at < now() - ($1 * interval '1 millisecond')`,
      [300_000],
    );
  }

  private async claimBatch(): Promise<ClaimedOutbox[]> {
    const result = await this.dataSource.transaction((manager) =>
      manager.query<unknown>(
        `WITH candidates AS (
           SELECT id
           FROM email_outbox
           WHERE kind = 'email_verification'
             AND status IN ('pending', 'failed')
             AND available_at <= now()
             AND attempts < $2
           ORDER BY available_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE email_outbox AS outbox
         SET status = 'processing',
             attempts = outbox.attempts + 1,
             updated_at = now()
         FROM candidates
         WHERE outbox.id = candidates.id
         RETURNING outbox.id AS "outboxId"`,
        [this.batchSize(), this.maxAttempts()],
      ),
    );
    const rows = this.unwrapRows(result);

    return rows.map((row, index) => {
      const record = this.asRowRecord(row);
      const id = this.extractOutboxId(record);
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          `Email outbox claim returned no id at row ${index}; columns=${Object.keys(record).join(',')}`,
        );
      }
      return { id };
    });
  }

  private unwrapRows(result: unknown): unknown[] {
    if (Array.isArray(result)) {
      if (result.length > 0 && Array.isArray(result[0])) {
        return result[0];
      }
      return result;
    }

    if (result && typeof result === 'object' && 'rows' in result) {
      const rows = (result as { rows?: unknown }).rows;
      if (Array.isArray(rows)) return rows;
    }

    throw new Error('Email outbox claim returned an invalid result shape');
  }

  private asRowRecord(row: unknown): RowRecord {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      return row as RowRecord;
    }
    return {};
  }

  private extractOutboxId(row: RowRecord): unknown {
    const claimedId =
      row.outboxId ??
      row.outboxid ??
      row.outbox_id ??
      row.id ??
      row['outbox.id'];
    if (claimedId !== undefined && claimedId !== null) return claimedId;

    const values = Object.values(row);
    return values.length === 1 ? values[0] : undefined;
  }

  private batchSize(): number {
    return this.config.get<number>('email.workerBatchSize', 20);
  }

  private maxAttempts(): number {
    return this.config.get<number>('email.maxAttempts', 5);
  }
}
