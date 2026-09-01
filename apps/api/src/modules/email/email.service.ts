import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_DELIVERY_PORT } from './ports/email-delivery.port';
import type { EmailDeliveryPort } from './ports/email-delivery.port';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_DELIVERY_PORT)
    private readonly delivery: EmailDeliveryPort,
  ) {}

  async sendVerification(input: {
    email: string;
    firstName?: string;
    token: string;
  }): Promise<void> {
    try {
      await this.delivery.sendVerification(input);
    } catch (error) {
      this.logger.error(
        'Email verification delivery failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async sendPasswordReset(input: {
    email: string;
    firstName?: string;
    token: string;
    locale?: string;
  }): Promise<void> {
    try {
      await this.delivery.sendPasswordReset(input);
    } catch (error) {
      this.logger.error(
        'Password reset email delivery failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async sendWelcome(input: {
    email: string;
    firstName?: string;
    organizationName: string;
    locale?: string;
    timezone?: string;
    trialEndsAt: Date;
  }): Promise<void> {
    try {
      await this.delivery.sendWelcome(input);
    } catch (error) {
      this.logger.error(
        'Welcome email delivery failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async sendMfaEnabled(input: {
    email: string;
    firstName?: string;
    mfaStatus: string;
    mfaMethod: string;
    activatedAt: Date;
    deviceName: string;
    locale?: string;
    timezone?: string;
  }): Promise<void> {
    try {
      await this.delivery.sendMfaEnabled(input);
    } catch (error) {
      this.logger.error(
        'MFA enabled email delivery failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async sendMfaDisabled(input: {
    email: string;
    firstName?: string;
    mfaStatus: string;
    mfaMethod: string;
    activatedAt: Date;
    deviceName: string;
    locale?: string;
    timezone?: string;
  }): Promise<void> {
    try {
      await this.delivery.sendMfaDisabled(input);
    } catch (error) {
      this.logger.error(
        'MFA disabled email delivery failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
