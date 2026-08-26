import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { SecretsModule } from '../secrets/secrets.module';
import { TotpService } from './totp.service';
import { MfaEncryptionService } from './mfa-encryption.service';

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
    SecretsModule,
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    AuthRateLimitService,
    TotpService,
    MfaEncryptionService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
