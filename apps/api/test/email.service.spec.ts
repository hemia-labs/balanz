import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { EmailVerificationToken } from '../src/modules/auth/entities/email-verification-token.entity';
import {
  EmailOutbox,
  EmailOutboxStatus,
} from '../src/modules/email/entities/email-outbox.entity';
import { EmailService } from '../src/modules/email/email.service';
import { EmailDeliveryPort } from '../src/modules/email/ports/email-delivery.port';

describe('EmailService', () => {
  const config = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  } as unknown as ConfigService;

  it('sends the in-memory token and marks the outbox as sent', async () => {
    const repository = {
      update: jest
        .fn()
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValue(undefined),
    } as unknown as Repository<EmailOutbox>;
    const delivery = {
      sendVerification: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailDeliveryPort;
    const dataSource = { query: jest.fn() } as unknown as DataSource;
    const service = new EmailService(repository, delivery, dataSource, config);
    const expiresAt = new Date();

    await service.deliverVerification({
      outboxId: 'outbox-1',
      email: 'ana@example.test',
      token: 'raw-token',
      expiresAt,
    });

    expect(delivery.sendVerification).toHaveBeenCalledWith({
      email: 'ana@example.test',
      token: 'raw-token',
      expiresAt,
    });
    expect(repository.update).toHaveBeenLastCalledWith(
      'outbox-1',
      expect.objectContaining({ status: EmailOutboxStatus.SENT }),
    );
  });

  it('marks the outbox as failed without leaking the delivery error', async () => {
    const repository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<EmailOutbox>;
    const delivery = {
      sendVerification: jest.fn().mockRejectedValue(new Error('provider down')),
    } as unknown as EmailDeliveryPort;
    const dataSource = {
      query: jest.fn().mockResolvedValue(undefined),
    } as unknown as DataSource;
    const service = new EmailService(repository, delivery, dataSource, config);

    await expect(
      service.deliverVerification({
        outboxId: 'outbox-1',
        email: 'ana@example.test',
        token: 'raw-token',
        expiresAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    expect(repository.update).toHaveBeenLastCalledWith(
      'outbox-1',
      expect.objectContaining({ status: EmailOutboxStatus.FAILED }),
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      "SELECT pg_notify('email_outbox_ready', $1)",
      ['outbox-1'],
    );
  });

  it('does not send when the worker already claimed the outbox row', async () => {
    const repository = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    } as unknown as Repository<EmailOutbox>;
    const delivery = {
      sendVerification: jest.fn(),
    } as unknown as EmailDeliveryPort;
    const service = new EmailService(
      repository,
      delivery,
      { query: jest.fn() } as unknown as DataSource,
      config,
    );

    await service.deliverVerification({
      outboxId: 'outbox-1',
      email: 'ana@example.test',
      token: 'raw-token',
      expiresAt: new Date(),
    });

    expect(delivery.sendVerification).not.toHaveBeenCalled();
  });

  it('rotates the persisted token before a worker retry', async () => {
    const outbox = {
      id: 'outbox-1',
      userId: 'user-1',
      tokenId: 'old-token-id',
      payload: { email: 'ana@example.test' },
      status: EmailOutboxStatus.PROCESSING,
      attempts: 2,
    } as EmailOutbox;
    const transactionOutboxRepository = {
      findOne: jest.fn().mockResolvedValue(outbox),
      update: jest.fn().mockResolvedValue(undefined),
    };
    let savedToken: Partial<EmailVerificationToken> | undefined;
    const invalidateToken = jest.fn(
      (criteria: unknown, changes: { usedAt: Date }) => {
        void criteria;
        void changes;
        return Promise.resolve();
      },
    );
    const tokenRepository = {
      update: invalidateToken,
      create: jest.fn((value: Partial<EmailVerificationToken>) => value),
      save: jest.fn((value: Partial<EmailVerificationToken>) => {
        savedToken = value;
        return Promise.resolve({ ...value, id: 'new-token-id' });
      }),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === EmailOutbox ? transactionOutboxRepository : tokenRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn(
        async (callback: (value: typeof manager) => unknown) =>
          await callback(manager),
      ),
      query: jest.fn(),
    } as unknown as DataSource;
    const repository = {
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<EmailOutbox>;
    let deliveredToken: string | undefined;
    const delivery = {
      sendVerification: jest.fn((input: { token: string }) => {
        deliveredToken = input.token;
        return Promise.resolve();
      }),
    } as unknown as EmailDeliveryPort;
    const service = new EmailService(repository, delivery, dataSource, config);

    await service.recoverVerification('outbox-1');

    expect(invalidateToken.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'old-token-id' }),
    );
    expect(invalidateToken.mock.calls[0][1].usedAt).toBeInstanceOf(Date);
    expect(transactionOutboxRepository.update).toHaveBeenCalledWith(
      'outbox-1',
      { tokenId: 'new-token-id' },
    );
    expect(savedToken).not.toHaveProperty('token');
    expect(deliveredToken).toMatch(/^[a-f0-9]{64}$/);
    if (!savedToken?.tokenHash || !deliveredToken) {
      throw new Error('Rotated token was not created');
    }
    expect(savedToken.tokenHash).toBe(
      createHash('sha256').update(deliveredToken).digest('hex'),
    );
    expect(repository.update).toHaveBeenLastCalledWith(
      'outbox-1',
      expect.objectContaining({ status: EmailOutboxStatus.SENT }),
    );
  });

  it('marks the fifth failed delivery as terminal and does not notify another retry', async () => {
    const outbox = {
      id: 'outbox-1',
      userId: 'user-1',
      tokenId: 'old-token-id',
      payload: { email: 'ana@example.test' },
      status: EmailOutboxStatus.PROCESSING,
      attempts: 5,
    } as EmailOutbox;
    const transactionOutboxRepository = {
      findOne: jest.fn().mockResolvedValue(outbox),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const tokenRepository = {
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((value: Partial<EmailVerificationToken>) => value),
      save: jest.fn((value: Partial<EmailVerificationToken>) =>
        Promise.resolve({ ...value, id: 'new-token-id' }),
      ),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === EmailOutbox ? transactionOutboxRepository : tokenRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn(
        async (callback: (value: typeof manager) => unknown) =>
          await callback(manager),
      ),
      query: jest.fn(),
    } as unknown as DataSource;
    const repository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<EmailOutbox>;
    const delivery = {
      sendVerification: jest.fn().mockRejectedValue(new Error('provider down')),
    } as unknown as EmailDeliveryPort;
    const service = new EmailService(repository, delivery, dataSource, config);

    await service.recoverVerification('outbox-1');

    expect(repository.update).toHaveBeenCalledWith(
      'outbox-1',
      expect.objectContaining({
        status: EmailOutboxStatus.FAILED,
      }),
    );
    const updateMock = repository.update as unknown as {
      mock: {
        calls: Array<
          [unknown, { status?: EmailOutboxStatus; availableAt?: unknown }]
        >;
      };
    };
    const failedUpdate = updateMock.mock.calls.find(
      (call: unknown[]) =>
        call[0] === 'outbox-1' &&
        (call[1] as { status?: EmailOutboxStatus }).status ===
          EmailOutboxStatus.FAILED,
    );
    expect(
      (failedUpdate?.[1] as { availableAt?: unknown }).availableAt,
    ).toBeInstanceOf(Date);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
