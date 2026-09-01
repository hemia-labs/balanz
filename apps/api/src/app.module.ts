import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import cookiesConfig from './config/cookies.config';
import databaseConfig from './config/database.config';
import emailConfig from './config/email.config';
import redisConfig from './config/redis.config';
import secretsConfig from './config/secrets.config';
import { envVarsSchema } from './config/env.validation';
import { AuthModule as CommonAuthModule } from './common/auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './modules/users/users.module';
import { SecretsModule } from './modules/secrets/secrets.module';
import { AuthModule as FeatureAuthModule } from './modules/auth/auth.module';
import { CsrfGuard } from './common/guards/csrf.guard';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { ClientAccountsModule } from './modules/client-accounts/client-accounts.module';
import { CorrelationModule } from './common/correlation/correlation.module';
import { FiscalOperationsModule } from './modules/fiscal-operations/fiscal-operations.module';
import { PermissionsModule } from './modules/permissions/permissions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      load: [
        appConfig,
        databaseConfig,
        authConfig,
        cookiesConfig,
        emailConfig,
        redisConfig,
        secretsConfig,
      ],
      validationSchema: envVarsSchema,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'auth',
            limit: config.get<number>('auth.throttlerLimit', 60),
            ttl: config.get<number>('auth.throttlerTtlMs', 60_000),
            blockDuration: config.get<number>(
              'auth.throttlerBlockDurationMs',
              60_000,
            ),
          },
        ],
      }),
    }),
    CommonAuthModule,
    CorrelationModule,
    SecretsModule,
    DatabaseModule,
    UsersModule,
    FeatureAuthModule,
    ClientAccountsModule,
    FiscalOperationsModule,
    PermissionsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: CsrfGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
