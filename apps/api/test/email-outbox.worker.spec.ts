import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { DataSource, QueryRunner } from 'typeorm';
import { EmailOutboxWorker } from '../src/modules/email/email-outbox.worker';
import { EmailService } from '../src/modules/email/email.service';

describe('EmailOutboxWorker', () => {
  it('claims due rows with SKIP LOCKED and delegates token rotation', async () => {
    const client = {
      on: jest.fn(),
      removeListener: jest.fn(),
    } as unknown as PoolClient;
    const runner = {
      connect: jest.fn().mockResolvedValue(client),
      query: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;
    const query = jest.fn().mockResolvedValue(undefined);
    const manager = {
      query: jest.fn().mockResolvedValue([[{ 'outbox.id': 'outbox-1' }]]),
    };
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(runner),
      query,
      transaction: jest.fn(
        async (callback: (value: typeof manager) => unknown) =>
          await callback(manager),
      ),
    } as unknown as DataSource;
    const email = {
      recoverVerification: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailService;
    const config = {
      get: jest.fn((key: string, fallback: number) =>
        key === 'email.workerBatchSize' ? 20 : fallback,
      ),
    } as unknown as ConfigService;
    const worker = new EmailOutboxWorker(dataSource, email, config);

    await worker.onApplicationBootstrap();
    await worker.onApplicationShutdown();

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('RETURNING outbox.id AS "outboxId"'),
      [20, 5],
    );
    expect(email.recoverVerification).toHaveBeenCalledWith('outbox-1');
    expect(runner.query).toHaveBeenCalledWith('LISTEN email_outbox_ready');
    expect(runner.query).toHaveBeenCalledWith('UNLISTEN email_outbox_ready');
  });
});
