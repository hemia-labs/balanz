import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import emailConfig from './config/email.config';
import { envVarsSchema } from './config/env.validation';
import secretsConfig from './config/secrets.config';
import { DatabaseModule } from './database/database.module';
import { EmailOutboxWorker } from './modules/email/email-outbox.worker';
import { EmailModule } from './modules/email/email.module';
import { SecretsModule } from './modules/secrets/secrets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      load: [databaseConfig, authConfig, emailConfig, secretsConfig],
      validationSchema: envVarsSchema,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),
    SecretsModule,
    DatabaseModule,
    EmailModule,
  ],
  providers: [EmailOutboxWorker],
})
export class EmailWorkerModule {}
