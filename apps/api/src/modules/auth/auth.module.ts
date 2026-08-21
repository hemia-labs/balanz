import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { AuthFactor } from './entities/auth-factor.entity';
import { AuthRateLimit } from './entities/auth-rate-limit.entity';
import { AuthService } from './auth.service';
import { AuditModule } from '../audit/audit.module';
import { AuthRateLimitService } from './rate-limit.service';
import { StubMfaProvider } from './stub-mfa.provider';
import { MFA_PROVIDER } from './ports/mfa-provider.port';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmailVerificationToken,
      AuthFactor,
      AuthRateLimit,
    ]),
    AuditModule,
    UsersModule,
    OrganizationsModule,
    MembershipsModule,
    SubscriptionsModule,
    SessionsModule,
    EmailModule,
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    AuthRateLimitService,
    {
      provide: MFA_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('auth.mfaProvider', 'stub');
        if (provider !== 'stub') {
          throw new Error(`Unsupported MFA provider: ${provider}`);
        }
        return new StubMfaProvider(config);
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
