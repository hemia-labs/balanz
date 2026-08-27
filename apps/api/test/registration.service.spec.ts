import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { PasswordService } from '../src/common/auth/password.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { EmailVerificationToken } from '../src/modules/auth/entities/email-verification-token.entity';
import { EmailService } from '../src/modules/email/email.service';
import {
  MembershipRole,
  MembershipStatus,
} from '../src/modules/memberships/entities/membership.entity';
import { MembershipsService } from '../src/modules/memberships/memberships.service';
import { OrganizationsService } from '../src/modules/organizations/organizations.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { UsersService } from '../src/modules/users/users.service';
import {
  AuditService,
  type AuditEventInput,
} from '../src/modules/audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../src/modules/audit/entities/audit-event.entity';

describe('AuthService', () => {
  it('creates the pending owner registration atomically without a session', async () => {
    const user = { id: 'user-1' };
    const organization = { id: 'organization-1' };
    const membership = { id: 'membership-1' };
    const tokenRepository = {
      create: jest.fn((value: Partial<EmailVerificationToken>) => value),
      save: jest.fn((value: Partial<EmailVerificationToken>) =>
        Promise.resolve({ ...value, id: 'token-1' }),
      ),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(tokenRepository),
    };
    const dataSource = {
      transaction: jest.fn(
        async (callback: (value: typeof manager) => unknown) =>
          await callback(manager),
      ),
    } as unknown as DataSource;
    const passwords = {
      hash: jest.fn().mockResolvedValue('password-hash'),
    } as unknown as PasswordService;
    const users = {
      createForRegistration: jest.fn().mockResolvedValue(user),
    } as unknown as UsersService;
    const organizations = {
      createForRegistration: jest.fn().mockResolvedValue(organization),
    } as unknown as OrganizationsService;
    const memberships = {
      createOwner: jest.fn().mockResolvedValue(membership),
    } as unknown as MembershipsService;
    const subscriptions = {
      createPending: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
    } as unknown as SubscriptionsService;
    let deliveryInput: { token: string } | undefined;
    const sendVerification = jest.fn((input: { token: string }) => {
      deliveryInput = input;
      return Promise.resolve();
    });
    const email = {
      sendVerification,
    } as unknown as EmailService;
    let auditInput: AuditEventInput | undefined;
    const audit = {
      record: jest.fn(
        (_manager: unknown, input: NonNullable<typeof auditInput>) => {
          auditInput = input;
          return Promise.resolve({ id: 'audit-1' });
        },
      ),
    } as unknown as AuditService;
    const rateLimits = {
      consume: jest.fn().mockResolvedValue(true),
      registerLimit: jest.fn().mockReturnValue(3),
      registerWindowSeconds: jest.fn().mockReturnValue(900),
    };
    const service = new AuthService(
      dataSource,
      passwords,
      { get: jest.fn().mockReturnValue(30) } as never,
      users,
      organizations,
      memberships,
      subscriptions,
      email,
      audit,
      {} as never,
      {} as never,
      rateLimits as never,
      {} as never,
      {} as never,
    );

    const result = await service.register({
      firstName: ' Ana ',
      lastName: ' López ',
      email: ' ANA@EXAMPLE.TEST ',
      password: 'secret123',
      organizationName: ' Despacho Demo ',
      slug: ' Despacho-Demo ',
      subscriptionType: 'trial',
    });

    expect(result).toEqual({
      userId: 'user-1',
      organizationId: 'organization-1',
      membershipId: 'membership-1',
      role: MembershipRole.ADMIN,
      organizationStatus: 'active',
      membershipStatus: MembershipStatus.PENDING,
      subscriptionType: 'trial',
      subscriptionStatus: 'pending',
      nextStep: 'verify_email',
      mfaRequired: false,
      tenantActive: false,
    });
    expect(users.createForRegistration).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        email: 'ana@example.test',
        passwordHash: 'password-hash',
      }),
    );
    expect(organizations.createForRegistration).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        slug: 'despacho-demo',
        ownerUserId: 'user-1',
      }),
    );
    expect(memberships.createOwner).toHaveBeenCalledWith(
      manager,
      'organization-1',
      'user-1',
    );
    expect(subscriptions.createPending).toHaveBeenCalledWith(
      manager,
      'organization-1',
      'trial',
    );
    const token = tokenRepository.create.mock
      .calls[0][0] as EmailVerificationToken;
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    if (!deliveryInput) throw new Error('Verification email was not delivered');
    expect(token.tokenHash).toBe(
      createHash('sha256').update(deliveryInput.token).digest('hex'),
    );
    expect(result).not.toHaveProperty('verificationToken');
    expect(email.sendVerification).toHaveBeenCalledWith({
      email: 'ana@example.test',
      firstName: 'Ana',
      token: deliveryInput.token,
    });
    if (!auditInput) throw new Error('Registration audit was not recorded');
    expect(auditInput).toMatchObject({
      organizationId: 'organization-1',
      actorType: AuditActorType.USER,
      actorUserId: 'user-1',
      actorMembershipId: 'membership-1',
      action: 'auth.register.created',
      decision: AuditDecision.ALLOW,
      objectType: 'organization',
      objectId: 'organization-1',
      metadata: { schemaVersion: 1, subscriptionType: 'trial' },
    });
    expect(auditInput.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('maps concurrent unique violations to conflict', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    const dataSource = {
      transaction: jest
        .fn()
        .mockRejectedValue(new QueryFailedError('INSERT', [], duplicate)),
    } as unknown as DataSource;
    const rateLimits = {
      consume: jest.fn().mockResolvedValue(true),
      registerLimit: jest.fn().mockReturnValue(3),
      registerWindowSeconds: jest.fn().mockReturnValue(900),
    };
    const service = new AuthService(
      dataSource,
      {
        hash: jest.fn().mockResolvedValue('hash'),
      } as unknown as PasswordService,
      { get: jest.fn().mockReturnValue(30) } as never,
      {} as UsersService,
      {} as OrganizationsService,
      {} as MembershipsService,
      {} as SubscriptionsService,
      {} as EmailService,
      {} as AuditService,
      {} as never,
      {} as never,
      rateLimits as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.register({
        firstName: 'Ana',
        lastName: 'López',
        email: 'ana@example.test',
        password: 'secret123',
        organizationName: 'Demo',
        slug: 'demo',
        subscriptionType: 'trial',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
