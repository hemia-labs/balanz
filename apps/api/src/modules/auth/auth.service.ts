import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, IsNull, QueryFailedError } from 'typeorm';
import { PasswordService } from '../../common/auth/password.service';
import { RegisterDto } from './dtos/register.dto';
import { LoginDto } from './dtos/login.dto';
import { DisableMfaDto } from './dtos/disable-mfa.dto';
import { RegisterResponseDto } from './dtos/register-response.dto';
import { EmailService } from '../email/email.service';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { AuthFactor, AuthFactorStatus } from './entities/auth-factor.entity';
import {
  Membership,
  MembershipStatus,
} from '../memberships/entities/membership.entity';
import { RoleKey } from '../permissions/entities/role.entity';
import { MembershipsService } from '../memberships/memberships.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UsersService } from '../users/users.service';
import { RegistrationResult } from './auth.types';
import { AuthMapper } from './mappers/auth.mapper';
import type { EmailVerificationResult } from './auth.types';
import { AuditService } from '../audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../audit/entities/audit-event.entity';
import { User, UserStatus } from '../users/entities/user.entity';
import {
  Organization,
  OrganizationStatus,
} from '../organizations/entities/organization.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { SessionsService } from '../sessions/sessions.service';
import { AuthorizationService } from '../sessions/authorization.service';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { AuthRateLimitService } from './rate-limit.service';
import { TotpService } from './totp.service';
import { MfaEncryptionService } from './mfa-encryption.service';
import {
  AuthSession,
  AuthSessionStatus,
} from '../sessions/entities/auth-session.entity';

type NormalizedRegistrationInput = Omit<
  RegisterDto,
  'locale' | 'timezone' | 'organizationTimezone'
> & {
  locale: string;
  timezone: string;
  organizationTimezone: string;
};

type SessionDetails = SessionAuthorizationContext & {
  account: { id: string; name: string; email: string };
};

const invalidMfaCode = () =>
  new BadRequestException({
    code: 'MFA_INVALID_CODE',
    message: 'El código MFA no es válido o ha expirado.',
  });

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly organizations: OrganizationsService,
    private readonly memberships: MembershipsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly authorization: AuthorizationService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly totp: TotpService,
    private readonly mfaEncryption: MfaEncryptionService,
  ) {}

  async register(
    input: RegisterDto,
    ipAddress = 'unknown',
  ): Promise<RegisterResponseDto> {
    const normalized = this.normalize(input);
    await this.assertRateLimit(
      [
        ['verification-register-email', normalized.email],
        ['verification-register-ip', ipAddress],
      ],
      this.rateLimits.registerLimit(),
      this.rateLimits.registerWindowSeconds(),
    );
    const passwordHash = await this.passwords.hash(normalized.password);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const correlationId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.verificationTtlMinutes() * 60_000,
    );

    const result = await this.dataSource
      .transaction(async (manager): Promise<RegistrationResult> => {
        const user = await this.users.createForRegistration(manager, {
          firstName: normalized.firstName,
          lastName: normalized.lastName,
          email: normalized.email,
          passwordHash,
          phoneE164: normalized.phoneE164,
          locale: normalized.locale,
          timezone: normalized.timezone,
        });

        const organization = await this.organizations.createForRegistration(
          manager,
          {
            name: normalized.organizationName,
            legalName: normalized.legalName,
            slug: normalized.slug,
            billingEmail: normalized.billingEmail,
            timezone: normalized.organizationTimezone,
            ownerUserId: user.id,
          },
        );

        const membership = await this.memberships.createOwner(
          manager,
          organization.id,
          user.id,
        );

        await this.subscriptions.createPending(
          manager,
          organization.id,
          normalized.subscriptionType,
        );

        const tokenRepository = manager.getRepository(EmailVerificationToken);
        await tokenRepository.save(
          tokenRepository.create({
            userId: user.id,
            tokenHash,
            expiresAt,
            usedAt: null,
          }),
        );

        await this.audit.record(manager, {
          organizationId: organization.id,
          actorType: AuditActorType.USER,
          actorUserId: user.id,
          actorMembershipId: membership.id,
          action: 'auth.register.created',
          decision: AuditDecision.ALLOW,
          objectType: 'organization',
          objectId: organization.id,
          correlationId,
          metadata: {
            schemaVersion: 1,
            subscriptionType: normalized.subscriptionType,
          },
        });

        return {
          userId: user.id,
          organizationId: organization.id,
          membershipId: membership.id,
          role: RoleKey.OWNER,
          organizationStatus: 'active',
          membershipStatus: MembershipStatus.PENDING,
          subscriptionType: normalized.subscriptionType,
          subscriptionStatus: SubscriptionStatus.PENDING,
          nextStep: 'verify_email',
          mfaRequired: false,
          tenantActive: false,
        };
      })
      .catch((error: unknown) => {
        if (
          error instanceof QueryFailedError &&
          (error.driverError as Error & { code?: string }).code === '23505'
        ) {
          throw new ConflictException(
            'Registration conflicts with existing data',
          );
        }
        throw error;
      });

    await this.email.sendVerification({
      email: normalized.email,
      firstName: normalized.firstName,
      token: rawToken,
    });

    return AuthMapper.toRegisterResponse(result);
  }

  async resendVerification(input: {
    email: string;
    ipAddress: string;
  }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const [emailAllowed, ipAllowed] = await Promise.all([
      this.rateLimits.consume(
        'verification-email',
        email,
        this.rateLimits.resendLimit(),
        this.rateLimits.resendWindowSeconds(),
      ),
      this.rateLimits.consume(
        'verification-ip',
        input.ipAddress,
        this.rateLimits.resendLimit(),
        this.rateLimits.resendWindowSeconds(),
      ),
    ]);
    if (!emailAllowed || !ipAllowed) {
      throw new HttpException(
        'Too many verification requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.dataSource.getRepository(User).findOne({
      where: { email },
    });
    if (!user || user.emailVerifiedAt) return;

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.verificationTtlMinutes() * 60_000,
    );
    const correlationId = randomUUID();

    await this.dataSource.transaction(async (manager) => {
      const tokenRepository = manager.getRepository(EmailVerificationToken);
      await tokenRepository.update(
        { userId: user.id, usedAt: IsNull() },
        { usedAt: now },
      );
      await tokenRepository.save(
        tokenRepository.create({
          userId: user.id,
          tokenHash,
          expiresAt,
          usedAt: null,
        }),
      );
      await this.audit.record(manager, {
        organizationId: null,
        actorType: AuditActorType.USER,
        actorUserId: user.id,
        actorMembershipId: null,
        action: 'auth.email.verification.resent',
        decision: AuditDecision.ALLOW,
        objectType: 'user',
        objectId: user.id,
        correlationId,
        metadata: { schemaVersion: 1 },
      });
    });

    await this.email.sendVerification({
      email: user.email,
      firstName: user.firstName,
      token: rawToken,
    });
  }

  async requestPasswordReset(input: {
    email: string;
    ipAddress: string;
  }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const [emailAllowed, ipAllowed] = await Promise.all([
      this.rateLimits.consume(
        'password-reset-request-email',
        email,
        this.rateLimits.passwordResetRequestLimit(),
        this.rateLimits.passwordResetRequestWindowSeconds(),
      ),
      this.rateLimits.consume(
        'password-reset-request-ip',
        input.ipAddress,
        this.rateLimits.passwordResetRequestLimit(),
        this.rateLimits.passwordResetRequestWindowSeconds(),
      ),
    ]);
    if (!emailAllowed || !ipAllowed) {
      throw new HttpException(
        'Too many password reset requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.dataSource.getRepository(User).findOne({
      where: { email },
    });
    if (!user) return;

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const correlationId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.passwordResetTtlMinutes() * 60_000,
    );

    const shouldSend = await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const lockedUser = await userRepository.findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !lockedUser ||
        lockedUser.status !== UserStatus.ACTIVE ||
        !lockedUser.emailVerifiedAt
      ) {
        return false;
      }

      const tokenRepository = manager.getRepository(PasswordResetToken);
      await tokenRepository.update(
        { userId: lockedUser.id, usedAt: IsNull() },
        { usedAt: now },
      );
      await tokenRepository.save(
        tokenRepository.create({
          userId: lockedUser.id,
          tokenHash,
          expiresAt,
          usedAt: null,
        }),
      );
      await this.audit.record(manager, {
        organizationId: null,
        actorType: AuditActorType.SYSTEM,
        actorUserId: lockedUser.id,
        actorMembershipId: null,
        action: 'auth.password.reset.requested',
        decision: AuditDecision.ALLOW,
        objectType: 'user',
        objectId: lockedUser.id,
        correlationId,
        ipAddress: input.ipAddress,
        metadata: { schemaVersion: 1 },
      });
      return true;
    });

    if (!shouldSend) return;
    await this.email.sendPasswordReset({
      email: user.email,
      firstName: user.firstName,
      token: rawToken,
      locale: user.locale,
    });
  }

  async confirmPasswordReset(input: {
    token: string;
    newPassword: string;
    ipAddress: string;
  }): Promise<void> {
    const token = input.token.trim();
    if (!token) throw new BadRequestException('Invalid password reset token');
    const tokenHash = this.hashToken(token);
    const [tokenAllowed, ipAllowed] = await Promise.all([
      this.rateLimits.consume(
        'password-reset-confirm-token',
        tokenHash,
        this.rateLimits.passwordResetConfirmLimit(),
        this.rateLimits.passwordResetConfirmWindowSeconds(),
      ),
      this.rateLimits.consume(
        'password-reset-confirm-ip',
        input.ipAddress,
        this.rateLimits.passwordResetConfirmLimit(),
        this.rateLimits.passwordResetConfirmWindowSeconds(),
      ),
    ]);
    if (!tokenAllowed || !ipAllowed) {
      throw new HttpException(
        'Too many password reset attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    const correlationId = randomUUID();

    await this.dataSource.transaction(async (manager) => {
      const tokenRepository = manager.getRepository(PasswordResetToken);
      const resetToken = await tokenRepository.findOne({
        where: { tokenHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !resetToken ||
        resetToken.usedAt ||
        resetToken.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException('Invalid password reset token');
      }

      const userRepository = manager.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: resetToken.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerifiedAt) {
        throw new BadRequestException('Invalid password reset token');
      }

      const now = new Date();
      user.passwordHash = passwordHash;
      await userRepository.save(user);
      resetToken.usedAt = now;
      await tokenRepository.save(resetToken);
      await this.sessions.revokeUserSessionsForManager(
        manager,
        user.id,
        'password_reset',
      );
      await this.audit.record(manager, {
        organizationId: null,
        actorType: AuditActorType.SYSTEM,
        actorUserId: user.id,
        actorMembershipId: null,
        action: 'auth.password.reset.completed',
        decision: AuditDecision.ALLOW,
        objectType: 'user',
        objectId: user.id,
        correlationId,
        ipAddress: input.ipAddress,
        metadata: { schemaVersion: 1 },
      });
    });
  }

  async confirmEmail(
    token: string,
    input: { ipAddress: string; userAgent?: string },
  ): Promise<{
    result: EmailVerificationResult;
    rawSessionToken: string;
  }> {
    if (!token.trim())
      throw new BadRequestException('Invalid verification token');
    const tokenHash = this.hashToken(token.trim());
    await this.assertRateLimit(
      [
        ['verification-confirm-ip', input.ipAddress],
        ['verification-confirm-token', tokenHash],
      ],
      this.rateLimits.confirmLimit(),
      this.rateLimits.confirmWindowSeconds(),
    );
    const correlationId = randomUUID();

    const transactionResult = await this.dataSource.transaction(
      async (manager) => {
        const tokenRepository = manager.getRepository(EmailVerificationToken);
        const verificationToken = await tokenRepository.findOne({
          where: { tokenHash },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !verificationToken ||
          verificationToken.usedAt ||
          verificationToken.expiresAt.getTime() <= Date.now()
        ) {
          throw new BadRequestException('Invalid verification token');
        }

        const userRepository = manager.getRepository(User);
        const user = await userRepository.findOne({
          where: { id: verificationToken.userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user || user.status !== UserStatus.ACTIVE) {
          throw new BadRequestException('Invalid verification token');
        }

        const organization = await manager.getRepository(Organization).findOne({
          where: {
            ownerUserId: user.id,
            status: OrganizationStatus.ACTIVE,
          },
        });
        if (!organization)
          throw new BadRequestException('Invalid verification token');

        const membership = await manager.getRepository(Membership).findOne({
          where: {
            organizationId: organization.id,
            userId: user.id,
            status: MembershipStatus.PENDING,
          },
          lock: { mode: 'pessimistic_write' },
        });
        const subscription = await manager
          .getRepository(Subscription)
          .findOne({ where: { organizationId: organization.id } });
        if (!membership || !subscription) {
          throw new BadRequestException('Invalid verification token');
        }

        const now = new Date();
        user.emailVerifiedAt = now;
        await userRepository.save(user);
        verificationToken.usedAt = now;
        await tokenRepository.save(verificationToken);
        membership.status = MembershipStatus.ACTIVE;
        membership.joinedAt = membership.joinedAt ?? now;
        await manager.getRepository(Membership).save(membership);

        let trialStartedAt = subscription.trialStartedAt ?? now;
        let trialEndsAt = subscription.trialEndsAt;
        if (subscription.status === SubscriptionStatus.PENDING) {
          trialStartedAt = now;
          trialEndsAt = new Date(
            now.getTime() + this.trialDurationDays() * 86_400_000,
          );
          subscription.status = SubscriptionStatus.TRIALING;
          subscription.trialStartedAt = trialStartedAt;
          subscription.trialEndsAt = trialEndsAt;
          await manager.getRepository(Subscription).save(subscription);
          await this.audit.record(manager, {
            organizationId: organization.id,
            actorType: AuditActorType.USER,
            actorUserId: user.id,
            actorMembershipId: membership.id,
            action: 'auth.subscription.trial_started',
            decision: AuditDecision.ALLOW,
            objectType: 'subscription',
            objectId: subscription.id,
            correlationId,
            metadata: { schemaVersion: 1 },
          });
        }

        const session = await this.sessions.createForManager(manager, {
          userId: user.id,
          organizationId: organization.id,
          membershipId: membership.id,
          mfaVerifiedAt: null,
          requiresMfa: false,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });
        await this.audit.record(manager, {
          organizationId: organization.id,
          actorType: AuditActorType.USER,
          actorUserId: user.id,
          actorMembershipId: membership.id,
          action: 'auth.email.verification.confirmed',
          decision: AuditDecision.ALLOW,
          objectType: 'user',
          objectId: user.id,
          correlationId,
          metadata: { schemaVersion: 1 },
        });

        return {
          result: {
            emailVerified: true as const,
            subscriptionType: subscription.subscriptionType,
            trial: {
              status: SubscriptionStatus.TRIALING as const,
              startedAt: trialStartedAt,
              endsAt: trialEndsAt!,
            },
            nextStep: 'ready' as const,
            mfaStatus: 'disabled' as const,
          },
          rawSessionToken: session.rawToken,
          session: session.session,
          welcome: {
            email: user.email,
            firstName: user.firstName,
            organizationName: organization.name,
            locale: user.locale,
            timezone: user.timezone,
            trialEndsAt: trialEndsAt!,
          },
        };
      },
    );

    const context = await this.authorization.resolve(transactionResult.session);
    await this.sessions.cacheSession(transactionResult.session, context);
    void this.email.sendWelcome(transactionResult.welcome);
    return {
      result: transactionResult.result,
      rawSessionToken: transactionResult.rawSessionToken,
    };
  }

  async login(
    input: LoginDto,
    ipAddress: string,
    userAgent?: string,
  ): Promise<{
    rawSessionToken: string;
    requiresMfa: boolean;
    context: SessionAuthorizationContext;
  }> {
    const email = input.email.trim().toLowerCase();
    const allowed = await this.rateLimits.consume(
      'login-ip',
      `${email}:${ipAddress}`,
      10,
      300,
    );
    if (!allowed)
      throw new HttpException(
        'Too many login attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const user = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
    if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerifiedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await this.passwords.verify(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const factor = await this.dataSource.getRepository(AuthFactor).findOne({
      where: { userId: user.id, status: AuthFactorStatus.ACTIVE },
    });
    const requiresMfa = Boolean(factor);
    const pair = await this.sessions.create({
      userId: user.id,
      organizationId: null,
      membershipId: null,
      requiresMfa,
      mfaVerifiedAt: null,
      ipAddress,
      userAgent,
    });
    await this.audit.recordDirect({
      organizationId: null,
      actorType: AuditActorType.USER,
      actorUserId: user.id,
      actorMembershipId: null,
      action: 'auth.session.created',
      decision: AuditDecision.ALLOW,
      objectType: 'auth_session',
      objectId: pair.session.id,
      correlationId: randomUUID(),
      metadata: { schemaVersion: 2, requiresMfa },
    });
    return {
      rawSessionToken: pair.rawToken,
      requiresMfa,
      context: await this.authorization.resolve(pair.session),
    };
  }

  async onboarding(
    session: AuthSession,
    cachedContext?: SessionAuthorizationContext,
  ): Promise<Record<string, unknown>> {
    const context =
      cachedContext ?? (await this.authorization.resolve(session));
    if (!context.organizationId)
      throw new UnauthorizedException('Onboarding session required');
    const [user, subscription, membership] = await Promise.all([
      this.dataSource
        .getRepository(User)
        .findOne({ where: { id: session.userId } }),
      this.dataSource
        .getRepository(Subscription)
        .findOne({ where: { organizationId: context.organizationId } }),
      this.dataSource.getRepository(Membership).findOne({
        where: { id: session.membershipId!, userId: session.userId },
      }),
    ]);
    if (!user || !subscription || !membership)
      throw new UnauthorizedException('Onboarding session required');
    const nextStep = !user.emailVerifiedAt
      ? 'verify_email'
      : membership.status !== MembershipStatus.ACTIVE
        ? 'activate_membership'
        : 'ready';
    return {
      subscriptionType: subscription.subscriptionType,
      trial: subscription.trialStartedAt
        ? {
            status: subscription.status,
            startedAt: subscription.trialStartedAt,
            endsAt: subscription.trialEndsAt,
          }
        : { status: subscription.status },
      nextStep,
      mfaStatus: context.mfaStatus,
    };
  }

  async setupMfa(
    session: AuthSession,
    cachedContext?: SessionAuthorizationContext,
  ): Promise<{
    factorId: string;
    secret: string;
    otpauthUri: string;
    status: AuthFactorStatus;
  }> {
    const context =
      cachedContext ?? (await this.authorization.resolve(session));
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: session.userId } });
    if (!user?.emailVerifiedAt)
      throw new UnauthorizedException('Verified email required');
    const setup = await this.totp.setup(user.email);
    const result = await this.dataSource.transaction(async (manager) => {
      const lockedUser = await manager.getRepository(User).findOne({
        where: { id: session.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedUser?.emailVerifiedAt) {
        throw new UnauthorizedException('Verified email required');
      }

      const factors = manager.getRepository(AuthFactor);
      const current = await factors.findOne({
        where: [
          { userId: session.userId, status: AuthFactorStatus.ACTIVE },
          { userId: session.userId, status: AuthFactorStatus.PENDING },
        ],
        order: { createdAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (current?.status === AuthFactorStatus.ACTIVE) {
        throw new ConflictException('MFA is already active');
      }

      if (current) {
        const secret = await this.mfaEncryption.decrypt(
          current.secretEncrypted,
        );
        return {
          factor: current,
          secret,
          otpauthUri: setup.otpauthUri.replace(
            /secret=[^&]+/,
            `secret=${secret}`,
          ),
        };
      }

      const secretEncrypted = await this.mfaEncryption.encrypt(setup.secret);
      const saved = await factors.save(
        factors.create({
          userId: session.userId,
          secretEncrypted,
          status: AuthFactorStatus.PENDING,
          verifiedAt: null,
          lastUsedAt: null,
          lastUsedCounter: null,
          revokedAt: null,
        }),
      );
      await this.audit.record(manager, {
        organizationId: context.organizationId,
        actorType: AuditActorType.USER,
        actorUserId: session.userId,
        actorMembershipId: context.membershipId,
        action: 'auth.mfa.started',
        decision: AuditDecision.ALLOW,
        objectType: 'auth_factor',
        objectId: saved.id,
        correlationId: randomUUID(),
        metadata: { schemaVersion: 2, factorType: 'totp' },
      });
      return {
        factor: saved,
        secret: setup.secret,
        otpauthUri: setup.otpauthUri,
      };
    });
    return {
      factorId: result.factor.id,
      secret: result.secret,
      otpauthUri: result.otpauthUri,
      status: result.factor.status,
    };
  }

  async verifyMfa(
    session: AuthSession,
    code: string,
    ipAddress: string,
  ): Promise<{
    rawSessionToken: string;
    context: SessionAuthorizationContext;
  }> {
    return this.completeMfa(session, code, ipAddress, true);
  }

  async completeLoginMfa(
    session: AuthSession,
    code: string,
    ipAddress: string,
  ): Promise<{
    rawSessionToken: string;
    context: SessionAuthorizationContext;
  }> {
    return this.completeMfa(session, code, ipAddress, false);
  }

  private async completeMfa(
    session: AuthSession,
    code: string,
    ipAddress: string,
    enrolling: boolean,
  ): Promise<{
    rawSessionToken: string;
    context: SessionAuthorizationContext;
  }> {
    const allowed = await this.rateLimits.consume(
      'mfa-session-ip',
      `${session.id}:${ipAddress}`,
      this.rateLimits.mfaVerifyLimit(),
      this.rateLimits.mfaVerifyWindowSeconds(),
    );
    if (!allowed)
      throw new HttpException(
        'Too many MFA attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const result = await this.dataSource.transaction(async (manager) => {
      const factorRepository = manager.getRepository(AuthFactor);
      const factor = await factorRepository.findOne({
        where: {
          userId: session.userId,
          status: enrolling
            ? AuthFactorStatus.PENDING
            : AuthFactorStatus.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!factor) throw invalidMfaCode();
      const secret = await this.mfaEncryption.decrypt(factor.secretEncrypted);
      const verified = await this.totp.verify(
        secret,
        code,
        factor.lastUsedCounter,
      );
      if (!verified.valid || verified.timeStep === undefined)
        throw invalidMfaCode();

      const sessionRepository = manager.getRepository(AuthSession);
      const lockedSession = await sessionRepository.findOne({
        where: { id: session.id, userId: session.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedSession || lockedSession.status !== AuthSessionStatus.ACTIVE)
        throw new UnauthorizedException('Invalid session');
      if (
        !enrolling &&
        (!lockedSession.requiresMfa || lockedSession.mfaVerifiedAt)
      )
        throw new UnauthorizedException('MFA is not pending');
      const now = new Date();
      factor.status = enrolling ? AuthFactorStatus.ACTIVE : factor.status;
      factor.verifiedAt = factor.verifiedAt ?? now;
      factor.lastUsedAt = now;
      factor.lastUsedCounter = String(verified.timeStep);
      await factorRepository.save(factor);
      lockedSession.requiresMfa = true;
      lockedSession.mfaVerifiedAt = now;
      lockedSession.lastActivityAt = now;
      await sessionRepository.save(lockedSession);
      const rotation = await this.sessions.rotateForManager(
        manager,
        lockedSession.id,
      );
      await this.audit.record(manager, {
        organizationId: lockedSession.organizationId,
        actorType: AuditActorType.USER,
        actorUserId: lockedSession.userId,
        actorMembershipId: lockedSession.membershipId,
        action: 'auth.mfa.verified',
        decision: AuditDecision.ALLOW,
        objectType: 'auth_session',
        objectId: lockedSession.id,
        correlationId: randomUUID(),
        metadata: { schemaVersion: 2, enrolling },
      });
      return { rotation, session: lockedSession, activatedAt: now };
    });
    await this.sessions.revokeOtherSessions(
      session.userId,
      session.id,
      'mfa_verified_elsewhere',
    );
    result.session.sessionTokenHash = this.sessions.hashToken(
      result.rotation.rawToken,
    );
    const context = await this.authorization.resolve(result.session);
    await this.sessions.cacheRotated(
      result.session,
      result.rotation.previousTokenHash,
      context,
    );
    if (enrolling) {
      const user = await this.dataSource.getRepository(User).findOne({
        where: { id: session.userId },
      });
      if (user) {
        await this.email.sendMfaEnabled({
          email: user.email,
          firstName: user.firstName,
          mfaStatus: 'active',
          mfaMethod: 'TOTP',
          activatedAt: result.activatedAt,
          deviceName: 'Aplicación autenticadora',
          locale: user.locale,
          timezone: user.timezone,
        });
      }
    }
    return { rawSessionToken: result.rotation.rawToken, context };
  }

  async disableMfa(
    session: AuthSession,
    input: DisableMfaDto,
    ipAddress = 'unknown',
  ): Promise<{
    rawSessionToken: string;
    context: SessionAuthorizationContext;
  }> {
    const allowed = await this.rateLimits.consume(
      'mfa-disable-session-ip',
      `${session.id}:${ipAddress}`,
      this.rateLimits.mfaVerifyLimit(),
      this.rateLimits.mfaVerifyWindowSeconds(),
    );
    if (!allowed)
      throw new HttpException(
        'Too many MFA attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const user = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: session.userId })
      .getOne();
    if (
      !user ||
      !(await this.passwords.verify(input.password, user.passwordHash))
    )
      throw new UnauthorizedException('Invalid credentials');
    const result = await this.dataSource.transaction(async (manager) => {
      const factorRepository = manager.getRepository(AuthFactor);
      const factor = await factorRepository.findOne({
        where: { userId: session.userId, status: AuthFactorStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
      });
      if (!factor) throw new BadRequestException('MFA is not active');
      const secret = await this.mfaEncryption.decrypt(factor.secretEncrypted);
      const verified = await this.totp.verify(
        secret,
        input.code,
        factor.lastUsedCounter,
      );
      if (!verified.valid || verified.timeStep === undefined)
        throw invalidMfaCode();
      const now = new Date();
      factor.status = AuthFactorStatus.REVOKED;
      factor.revokedAt = now;
      factor.lastUsedAt = now;
      factor.lastUsedCounter = String(verified.timeStep);
      await factorRepository.save(factor);
      const sessionRepository = manager.getRepository(AuthSession);
      const lockedSession = await sessionRepository.findOne({
        where: { id: session.id, userId: session.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedSession) throw new UnauthorizedException('Invalid session');
      lockedSession.requiresMfa = false;
      lockedSession.mfaVerifiedAt = null;
      lockedSession.lastActivityAt = now;
      await sessionRepository.save(lockedSession);
      const rotation = await this.sessions.rotateForManager(
        manager,
        lockedSession.id,
      );
      await this.audit.record(manager, {
        organizationId: lockedSession.organizationId,
        actorType: AuditActorType.USER,
        actorUserId: lockedSession.userId,
        actorMembershipId: lockedSession.membershipId,
        action: 'auth.mfa.revoked',
        decision: AuditDecision.ALLOW,
        objectType: 'auth_factor',
        objectId: factor.id,
        correlationId: randomUUID(),
        metadata: { schemaVersion: 2 },
      });
      return { rotation, session: lockedSession, changedAt: now };
    });
    await this.sessions.revokeOtherSessions(
      session.userId,
      session.id,
      'mfa_disabled_elsewhere',
    );
    result.session.sessionTokenHash = this.sessions.hashToken(
      result.rotation.rawToken,
    );
    const context = await this.authorization.resolve(result.session);
    await this.sessions.cacheRotated(
      result.session,
      result.rotation.previousTokenHash,
      context,
    );
    await this.email.sendMfaDisabled({
      email: user.email,
      firstName: user.firstName,
      mfaStatus: 'disabled',
      mfaMethod: 'TOTP',
      activatedAt: result.changedAt,
      deviceName: 'Aplicación autenticadora',
      locale: user.locale,
      timezone: user.timezone,
    });
    return { rawSessionToken: result.rotation.rawToken, context };
  }

  sessionDetails(
    context: SessionAuthorizationContext,
  ): Promise<SessionDetails> {
    return this.dataSource
      .getRepository(User)
      .findOne({ where: { id: context.userId } })
      .then((user) => {
        if (!user) throw new UnauthorizedException('Session user not found');
        return {
          ...context,
          account: {
            id: user.id,
            name: `${user.firstName} ${user.lastName}`.trim(),
            email: user.email,
          },
        };
      });
  }

  async authorizationDetails(
    session: AuthSession,
  ): Promise<SessionAuthorizationContext> {
    return this.authorization.requireTenant(session);
  }

  async listOrganizations(userId: string) {
    return this.authorization.listOrganizations(userId);
  }

  async changeOrganization(
    session: AuthSession,
    organizationId: string,
  ): Promise<SessionAuthorizationContext> {
    const result = await this.authorization.changeOrganization(
      session.id,
      session.userId,
      organizationId,
    );
    await this.audit.recordDirect({
      organizationId,
      actorType: AuditActorType.USER,
      actorUserId: session.userId,
      actorMembershipId: result.session.membershipId,
      action: 'auth.tenant.changed',
      decision: AuditDecision.ALLOW,
      objectType: 'organization',
      objectId: organizationId,
      correlationId: randomUUID(),
      metadata: {
        schemaVersion: 1,
        previousOrganizationId: result.previousOrganizationId,
      },
    });
    const context = await this.authorization.resolve(result.session);
    await this.sessions.cacheSession(result.session, context);
    return context;
  }

  async logout(session: AuthSession): Promise<void> {
    await this.sessions.revoke(session.id, 'user_logout');
    await this.audit.recordDirect({
      organizationId: session.organizationId ?? null,
      actorType: AuditActorType.USER,
      actorUserId: session.userId,
      actorMembershipId: session.membershipId ?? null,
      action: 'auth.session.revoked',
      decision: AuditDecision.ALLOW,
      objectType: 'auth_session',
      objectId: session.id,
      correlationId: randomUUID(),
      metadata: { schemaVersion: 1, reason: 'user_logout' },
    });
  }

  private normalize(input: RegisterDto): NormalizedRegistrationInput {
    const normalized = {
      ...input,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim().toLowerCase(),
      organizationName: input.organizationName.trim(),
      legalName: input.legalName?.trim() || undefined,
      slug: input.slug.trim().toLowerCase(),
      billingEmail: input.billingEmail?.trim().toLowerCase() || undefined,
      locale: input.locale?.trim() || 'es-MX',
      timezone: input.timezone?.trim() || 'America/Mexico_City',
      organizationTimezone:
        input.organizationTimezone?.trim() || 'America/Mexico_City',
      subscriptionType: input.subscriptionType.trim(),
    };

    if (
      !normalized.firstName ||
      !normalized.lastName ||
      !normalized.email ||
      !normalized.password ||
      !normalized.organizationName ||
      !normalized.slug ||
      !normalized.subscriptionType
    ) {
      throw new BadRequestException('Registration data is incomplete');
    }

    if (normalized.subscriptionType.length > 100) {
      throw new BadRequestException('subscriptionType is too long');
    }

    return normalized;
  }

  private async assertRateLimit(
    entries: Array<[scope: string, key: string]>,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const allowed = await Promise.all(
      entries.map(([scope, key]) =>
        this.rateLimits.consume(scope, key, limit, windowSeconds),
      ),
    );
    if (allowed.some((value) => !value)) {
      throw new HttpException(
        'Too many verification requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private verificationTtlMinutes(): number {
    return this.config.get<number>('auth.emailVerificationTtlMinutes') ?? 30;
  }

  private passwordResetTtlMinutes(): number {
    return this.config.get<number>('auth.passwordResetTtlMinutes') ?? 30;
  }

  private trialDurationDays(): number {
    return this.config.get<number>('auth.trialDurationDays') ?? 30;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
