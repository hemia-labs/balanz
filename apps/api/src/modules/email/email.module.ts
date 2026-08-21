import { EmailSenderService, TemplateManager } from '@hemia/email-sender';
import { SecretsService } from '@hemia/secrets/nestjs';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EmailConfig } from '../../config/email.config';
import { SecretsModule } from '../secrets/secrets.module';
import { HemiaEmailDeliveryAdapter } from './adapters/hemia-email-delivery.adapter';
import { EmailOutbox } from './entities/email-outbox.entity';
import { EmailService } from './email.service';
import { EmailTemplateRenderer } from './helpers/email-template-renderer';
import { EMAIL_DELIVERY_PORT } from './ports/email-delivery.port';
import { isEmailSecret, type EmailSecret } from './types/email-secret.types';

// ponytail: compatibility bridge until @hemia/email-sender awaits MJML 5.
TemplateManager.render = (template, data) =>
  EmailTemplateRenderer.render(template, data);

@Module({
  imports: [
    TypeOrmModule.forFeature([EmailOutbox]),
    ConfigModule,
    SecretsModule,
  ],
  providers: [
    {
      provide: EmailSenderService,
      inject: [ConfigService, SecretsService],
      useFactory: async (config: ConfigService, secrets: SecretsService) => {
        const email = config.getOrThrow<EmailConfig>('email');
        const secretsEnabled = config.get<boolean>('secrets.enabled', false);
        const source = secretsEnabled ? 'vault:email/smtp' : 'env:SMTP_*';
        const smtp = !secretsEnabled
          ? email.smtp
          : await (async () => {
              const secret =
                await secrets.getRequired<EmailSecret>('email/smtp');
              if (!isEmailSecret(secret)) {
                throw new Error(
                  'Secret email/smtp must contain smtp_host, smtp_port, smtp_secure, smtp_user and smtp_password',
                );
              }

              return {
                host: secret.smtp_host,
                port: secret.smtp_port,
                secure: secret.smtp_secure,
                auth: { user: secret.smtp_user, pass: secret.smtp_password },
              };
            })();

        const logger = new Logger('Email');
        logger.log(
          `SMTP configuration loaded: source=${source}, host=${smtp.host}, port=${smtp.port}, secure=${smtp.secure}, authConfigured=${Boolean(smtp.auth?.user && smtp.auth?.pass)}`,
        );

        return new EmailSenderService(smtp, TemplateManager);
      },
    },
    EmailService,
    HemiaEmailDeliveryAdapter,
    {
      provide: EMAIL_DELIVERY_PORT,
      useExisting: HemiaEmailDeliveryAdapter,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
