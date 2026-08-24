import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SecretsService } from '@hemia/secrets/nestjs';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsModule } from '../secrets/secrets.module';
import { SesEmailDeliveryAdapter } from './adapters/ses-email-delivery.adapter';
import { EmailService } from './email.service';
import { EMAIL_DELIVERY_PORT } from './ports/email-delivery.port';
import {
  isAwsEmailSecret,
  type AwsEmailSecret,
} from './types/aws-email-secret.types';

@Module({
  imports: [ConfigModule, SecretsModule],
  providers: [
    {
      provide: SESv2Client,
      inject: [ConfigService, SecretsService],
      useFactory: async (config: ConfigService, secrets: SecretsService) => {
        const secretsEnabled = config.get<boolean>('secrets.enabled', false);
        if (!secretsEnabled) {
          return new SESv2Client({
            region: config.get<string>('AWS_REGION', 'us-east-2'),
          });
        }

        const credentials =
          await secrets.getRequired<AwsEmailSecret>('email/ses');
        if (!isAwsEmailSecret(credentials)) {
          throw new Error(
            'Secret email/ses must contain aws_access_key, aws_secret_key and aws_region',
          );
        }

        return new SESv2Client({
          region: credentials.aws_region,
          credentials: {
            accessKeyId: credentials.aws_access_key,
            secretAccessKey: credentials.aws_secret_key,
            sessionToken: credentials.aws_session_token,
          },
        });
      },
    },
    EmailService,
    SesEmailDeliveryAdapter,
    {
      provide: EMAIL_DELIVERY_PORT,
      useExisting: SesEmailDeliveryAdapter,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
