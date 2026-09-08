import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlatformConfigModule } from './config/platform-config.module';
import { AuthModule as CommonAuthModule } from './common/auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './modules/users/users.module';
import { SecretsModule } from './modules/secrets/secrets.module';
import { AuthModule as FeatureAuthModule } from './modules/auth/auth.module';
import { CsrfGuard } from './common/guards/csrf.guard';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { ClientAccountsModule } from './modules/client-accounts/client-accounts.module';
import { CorrelationModule } from './common/correlation/correlation.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { FiscalHealthModule } from './modules/health/fiscal-health.module';
import { FiscalOperationsModule } from './modules/fiscal-operations/fiscal-operations.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { CfdiApiModule } from './modules/cfdi/cfdi-api.module';

@Module({
  imports: [
    PlatformConfigModule.forRuntime('api'),
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
    ObservabilityModule,
    FiscalHealthModule.register('api'),
    SecretsModule,
    DatabaseModule.forRuntime('api'),
    UsersModule,
    FeatureAuthModule,
    ClientAccountsModule,
    FiscalOperationsModule,
    PermissionsModule,
    InvitationsModule,
    CfdiApiModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: CsrfGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
