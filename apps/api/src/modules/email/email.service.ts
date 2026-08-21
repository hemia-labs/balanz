import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { EmailVerificationToken } from '../auth/entities/email-verification-token.entity';
import { EmailOutbox, EmailOutboxStatus } from './entities/email-outbox.entity';
import { EMAIL_DELIVERY_PORT } from './ports/email-delivery.port';
import type { EmailDeliveryPort } from './ports/email-delivery.port';

export const EMAIL_OUTBOX_CHANNEL = 'email_outbox_ready';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectRepository(EmailOutbox)
    private readonly outboxRepository: Repository<EmailOutbox>,
    @Inject(EMAIL_DELIVERY_PORT)
    private readonly delivery: EmailDeliveryPort,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  enqueueVerification(
    manager: EntityManager,
    input: {
      userId: string;
      tokenId: string;
      email: string;
      firstName?: string;
    },
  ): Promise<EmailOutbox> {
    const repository = manager.getRepository(EmailOutbox);
    return repository.save(
      repository.create({
        userId: input.userId,
        tokenId: input.tokenId,
        kind: 'email_verification',
        payload: { email: input.email, firstName: input.firstName },
        status: EmailOutboxStatus.PENDING,
        attempts: 0,
        availableAt: new Date(Date.now() + this.recoveryDelayMs()),
        sentAt: null,
      }),
    );
  }

  async deliverVerification(input: {
    outboxId: string;
    email: string;
    firstName?: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    let claimed = false;
    let attempt = 0;
    try {
      const result = await this.outboxRepository.update(
        { id: input.outboxId, status: EmailOutboxStatus.PENDING },
        {
          status: EmailOutboxStatus.PROCESSING,
          attempts: () => 'attempts + 1',
        },
      );
      if (result.affected !== 1) return;
      claimed = true;
      attempt = 1;

      await this.delivery.sendVerification({
        email: input.email,
        firstName: input.firstName,
        token: input.token,
        expiresAt: input.expiresAt,
      });
      await this.outboxRepository.update(input.outboxId, {
        status: EmailOutboxStatus.SENT,
        sentAt: new Date(),
      });
    } catch (error) {
      this.logDeliveryError(input.outboxId, attempt, error);
      if (claimed) {
        try {
          await this.reschedule(input.outboxId, 0);
        } catch (rescheduleError) {
          this.logger.error(
            `Email outbox reschedule failed: outboxId=${input.outboxId}`,
            this.errorSummary(rescheduleError),
          );
        }
      }
    }
  }

  async recoverVerification(outboxId: string): Promise<void> {
    if (!outboxId) {
      this.logger.error('Email outbox recovery skipped: missing outboxId');
      return;
    }

    let attempts = 1;

    try {
      const pendingDelivery = await this.dataSource.transaction(
        async (manager) => {
          const outboxRepository = manager.getRepository(EmailOutbox);
          const outbox = await outboxRepository.findOne({
            where: {
              id: outboxId,
              kind: 'email_verification',
              status: EmailOutboxStatus.PROCESSING,
            },
            lock: { mode: 'pessimistic_write' },
          });
          if (!outbox) return null;

          const email = outbox.payload.email;
          if (typeof email !== 'string') {
            throw new Error('Email outbox payload has no email');
          }
          const firstName =
            typeof outbox.payload.firstName === 'string'
              ? outbox.payload.firstName
              : undefined;

          attempts = outbox.attempts;
          const now = new Date();
          const expiresAt = new Date(
            now.getTime() + this.verificationTtlMinutes() * 60_000,
          );
          const token = randomBytes(32).toString('hex');
          const tokenRepository = manager.getRepository(EmailVerificationToken);

          await tokenRepository.update(
            { id: outbox.tokenId, usedAt: IsNull() },
            { usedAt: now },
          );
          const verificationToken = await tokenRepository.save(
            tokenRepository.create({
              userId: outbox.userId,
              tokenHash: createHash('sha256').update(token).digest('hex'),
              expiresAt,
              usedAt: null,
            }),
          );
          await outboxRepository.update(outbox.id, {
            tokenId: verificationToken.id,
          });

          return { email, firstName, token, expiresAt };
        },
      );
      if (!pendingDelivery) return;

      await this.delivery.sendVerification(pendingDelivery);
      await this.outboxRepository.update(outboxId, {
        status: EmailOutboxStatus.SENT,
        sentAt: new Date(),
      });
    } catch (error) {
      this.logDeliveryError(outboxId, attempts, error);
      try {
        await this.reschedule(outboxId, attempts);
      } catch (rescheduleError) {
        this.logger.error(
          `Email outbox reschedule failed: outboxId=${outboxId}`,
          this.errorSummary(rescheduleError),
        );
      }
    }
  }

  private async reschedule(outboxId: string, attempts: number): Promise<void> {
    const retryBaseMs = this.config.get<number>('email.retryBaseMs', 60_000);
    const maxAttempts = this.maxAttempts();
    const terminalFailure = attempts >= maxAttempts;
    const delay = terminalFailure
      ? 0
      : attempts === 0
        ? 0
        : Math.min(retryBaseMs * 2 ** Math.max(0, attempts - 1), 3_600_000);

    const result = await this.outboxRepository.update(outboxId, {
      status: EmailOutboxStatus.FAILED,
      availableAt: new Date(Date.now() + delay),
    });
    if (result.affected !== undefined && result.affected !== 1) {
      throw new Error(`Email outbox row was not updated: ${outboxId}`);
    }

    if (delay === 0 && !terminalFailure) {
      await this.dataSource.query(
        `SELECT pg_notify('${EMAIL_OUTBOX_CHANNEL}', $1)`,
        [outboxId],
      );
    }

    if (terminalFailure) {
      this.logger.error(
        `Email delivery permanently failed: outboxId=${outboxId}, attempts=${attempts}`,
      );
    }
  }

  private logDeliveryError(
    outboxId: string,
    attempt: number,
    error: unknown,
  ): void {
    this.logger.error(
      `Email verification delivery failed: outboxId=${outboxId}, attempt=${attempt}`,
      this.errorSummary(error),
    );
  }

  private errorSummary(error: unknown): string {
    if (!(error instanceof Error)) return 'Unknown email delivery error';
    const details = error as Error & {
      code?: string;
      responseCode?: number;
      command?: string;
    };
    return JSON.stringify({
      name: details.name,
      message: details.message,
      code: details.code,
      responseCode: details.responseCode,
      command: details.command,
    });
  }

  private recoveryDelayMs(): number {
    return this.config.get<number>('email.recoveryDelayMs', 30_000);
  }

  private verificationTtlMinutes(): number {
    return this.config.get<number>('auth.emailVerificationTtlMinutes', 30);
  }

  private maxAttempts(): number {
    return this.config.get<number>('email.maxAttempts', 5);
  }
}
