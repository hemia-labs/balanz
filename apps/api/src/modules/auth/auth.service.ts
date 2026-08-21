import {
  BadRequestException,
  ConflictException,
  Inject,
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
import { RegisterResponseDto } from './dtos/register-response.dto';
import { EmailService } from '../email/email.service';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { AuthFactor, AuthFactorStatus } from './entities/auth-factor.entity';
import {
  MembershipRole,
  Membership,
  MembershipStatus,
} from '../memberships/entities/membership.entity';
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
import { MFA_PROVIDER, type MfaProviderPort } from './ports/mfa-provider.port';
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
    @Inject(MFA_PROVIDER) private readonly mfa: MfaProviderPort,
  ) {}

  async register(input: RegisterDto): Promise<RegisterResponseDto> {
    const normalized = this.normalize(input);
    const passwordHash = await this.passwords.hash(normalized.password);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const correlationId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.verificationTtlMinutes() * 60_000,
    );

    const { result, outboxId } = await this.dataSource
      .transaction(
        async (
          manager,
        ): Promise<{ result: RegistrationResult; outboxId: string }> => {
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
          const verificationToken = await tokenRepository.save(
            tokenRepository.create({
              userId: user.id,
              tokenHash,
              expiresAt,
              usedAt: null,
            }),
          );

          const outbox = await this.email.enqueueVerification(manager, {
            userId: user.id,
            tokenId: verificationToken.id,
            email: normalized.email,
            firstName: normalized.firstName,
          });

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
            result: {
              userId: user.id,
              organizationId: organization.id,
              membershipId: membership.id,
              role: MembershipRole.OWNER,
              organizationStatus: 'active',
              membershipStatus: MembershipStatus.PENDING,
              subscriptionType: normalized.subscriptionType,
              subscriptionStatus: SubscriptionStatus.PENDING,
              nextStep: 'verify_email',
              mfaRequired: true,
              tenantActive: false,
            },
            outboxId: outbox.id,
          };
        },
      )
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

    await this.email.deliverVerification({
      outboxId,
      email: normalized.email,
      firstName: normalized.firstName,
      token: rawToken,
      expiresAt,
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

    const { outboxId, firstName } = await this.dataSource.transaction(
      async (manager) => {
        const tokenRepository = manager.getRepository(EmailVerificationToken);
        await tokenRepository.update(
          { userId: user.id, usedAt: IsNull() },
          { usedAt: now },
        );
        const token = await tokenRepository.save(
          tokenRepository.create({
            userId: user.id,
            tokenHash,
            expiresAt,
            usedAt: null,
          }),
        );
        const outbox = await this.email.enqueueVerification(manager, {
          userId: user.id,
          tokenId: token.id,
          email: user.email,
          firstName: user.firstName,
        });
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
        return { outboxId: outbox.id, firstName: user.firstName };
      },
    );

    await this.email.deliverVerification({
      outboxId,
      email: user.email,
      firstName,
      token: rawToken,
      expiresAt,
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
            nextStep: 'complete_mfa' as const,
          },
          rawSessionToken: session.rawToken,
          session: session.session,
        };
      },
    );

    const context = await this.authorization.resolve(transactionResult.session);
    await this.sessions.cacheSession(
      transactionResult.session,
      context,
      transactionResult.rawSessionToken,
    );
    return {
      result: transactionResult.result,
      rawSessionToken: transactionResult.rawSessionToken,
    };
  }

  async onboarding(
    session: AuthSession,
    cachedContext?: SessionAuthorizationContext,
  ): Promise<Record<string, unknown>> {
    const context =
      cachedContext ?? (await this.authorization.resolve(session));
    if (!context.organizationId) {
      throw new UnauthorizedException('Onboarding session required');
    }
    const [user, subscription, membership] = await Promise.all([
      this.dataSource
        .getRepository(User)
        .findOne({ where: { id: session.userId } }),
      this.dataSource.getRepository(Subscription).findOne({
        where: { organizationId: context.organizationId },
      }),
      this.dataSource.getRepository(Membership).findOne({
        where: { id: session.membershipId!, userId: session.userId },
      }),
    ]);
    if (!user || !subscription || !membership) {
      throw new UnauthorizedException('Onboarding session required');
    }

    const nextStep = !user.emailVerifiedAt
      ? 'verify_email'
      : !session.mfaVerifiedAt
        ? 'complete_mfa'
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
    };
  }

  async setupMfa(
    session: AuthSession,
    cachedContext?: SessionAuthorizationContext,
  ): Promise<{
    factorId: string;
    factorType: string;
    status: AuthFactorStatus;
    nextStep: 'complete_mfa';
  }> {
    const context =
      cachedContext ?? (await this.authorization.resolve(session));
    if (
      !context.organizationId ||
      !context.membershipId ||
      session.mfaVerifiedAt
    ) {
      throw new UnauthorizedException('MFA setup requires onboarding');
    }

    const existing = await this.dataSource.getRepository(AuthFactor).findOne({
      where: { userId: session.userId, status: AuthFactorStatus.PENDING },
    });
    if (existing) {
      return {
        factorId: existing.id,
        factorType: existing.factorType,
        status: existing.status,
        nextStep: 'complete_mfa',
      };
    }

    const setup = await this.mfa.setup(session.userId);
    const factor = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(AuthFactor).save(
        manager.getRepository(AuthFactor).create({
          userId: session.userId,
          provider: this.mfaProviderName(),
          providerFactorRef: setup.providerReference,
          factorType: setup.factorType,
          status: AuthFactorStatus.PENDING,
          verifiedAt: null,
          lastUsedAt: null,
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
        metadata: { schemaVersion: 1 },
      });
      return saved;
    });

    return {
      factorId: factor.id,
      factorType: factor.factorType,
      status: factor.status,
      nextStep: 'complete_mfa',
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
    const allowed = await this.rateLimits.consume(
      'mfa-session-ip',
      `${session.id}:${ipAddress}`,
      this.rateLimits.mfaVerifyLimit(),
      this.rateLimits.mfaVerifyWindowSeconds(),
    );
    if (!allowed) {
      throw new HttpException(
        'Too many MFA attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const factor = await this.dataSource.getRepository(AuthFactor).findOne({
      where: { userId: session.userId, status: AuthFactorStatus.PENDING },
    });
    if (!factor || !(await this.mfa.verify(factor.providerFactorRef, code))) {
      throw new BadRequestException('Invalid MFA code');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const sessionRepository = manager.getRepository(AuthSession);
      const lockedSession = await sessionRepository.findOne({
        where: { id: session.id, userId: session.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedSession || lockedSession.status !== AuthSessionStatus.ACTIVE) {
        throw new UnauthorizedException('Invalid session');
      }
      const membership = await manager.getRepository(Membership).findOne({
        where: {
          id: lockedSession.membershipId!,
          organizationId: lockedSession.organizationId!,
          userId: lockedSession.userId,
          status: MembershipStatus.PENDING,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership) throw new UnauthorizedException('MFA setup required');

      const now = new Date();
      factor.status = AuthFactorStatus.ACTIVE;
      factor.verifiedAt = now;
      factor.lastUsedAt = now;
      await manager.getRepository(AuthFactor).save(factor);
      membership.status = MembershipStatus.ACTIVE;
      membership.mfaCompletedAt = now;
      membership.joinedAt = membership.joinedAt ?? now;
      await manager.getRepository(Membership).save(membership);
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
        actorMembershipId: membership.id,
        action: 'auth.mfa.verified',
        decision: AuditDecision.ALLOW,
        objectType: 'auth_session',
        objectId: lockedSession.id,
        correlationId: randomUUID(),
        metadata: { schemaVersion: 1 },
      });
      return { rotation, session: lockedSession };
    });

    result.session.sessionTokenHash = this.sessions.hashToken(
      result.rotation.rawToken,
    );
    const context = await this.authorization.resolve(result.session);
    await this.sessions.cacheRotated(
      result.session,
      result.rotation.rawToken,
      result.rotation.previousTokenHash,
      context,
    );
    return {
      rawSessionToken: result.rotation.rawToken,
      context,
    };
  }

  sessionDetails(
    context: SessionAuthorizationContext,
  ): SessionAuthorizationContext {
    return context;
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
    await this.sessions.cacheSession(result.session, context, undefined, {
      organizationId: result.previousOrganizationId,
      membershipId: result.previousMembershipId,
    });
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

  private verificationTtlMinutes(): number {
    return this.config.get<number>('auth.emailVerificationTtlMinutes') ?? 30;
  }

  private trialDurationDays(): number {
    return this.config.get<number>('auth.trialDurationDays') ?? 30;
  }

  private mfaProviderName(): string {
    return this.config.get<string>('auth.mfaProvider', 'stub');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
