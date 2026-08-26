import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { createHmac, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../src/modules/email/email.service';
import { TotpService } from '../src/modules/auth/totp.service';

type Registration = {
  userId: string;
  organizationId: string;
  membershipId: string;
  email: string;
  token: string;
  ipAddress: string;
};

describe('Auth registration and MFA (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let cookieName: string;
  const apiPrefix = '/api/v1';
  const startedAt = new Date();
  const registrations: Registration[] = [];
  const verificationTokens = new Map<string, string>();

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TotpService)
      .useValue({
        setup: () => ({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri:
            'otpauth://totp/Balanz:e2e@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Balanz',
        }),
        verify: (
          secret: string,
          code: string,
          lastUsedCounter?: string | null,
        ) => {
          const timeStep = Math.floor(Date.now() / 1_000 / 30);
          const validCounter =
            !lastUsedCounter || timeStep > Number(lastUsedCounter);
          return {
            valid: validCounter && code === totpCode(secret),
            timeStep,
          };
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    const httpServer = app.getHttpAdapter().getInstance() as {
      set: (name: string, value: boolean) => void;
    };
    httpServer.set('trust proxy', true);
    app.setGlobalPrefix(apiPrefix.slice(1));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    dataSource = app.get(DataSource);
    const config = app.get(ConfigService);
    cookieName = config.get<string>('cookies.sessionName', 'balanz_session');

    const email = app.get(EmailService);
    jest.spyOn(email, 'sendVerification').mockImplementation((input) => {
      verificationTokens.set(input.email, input.token);
      return Promise.resolve();
    });
    jest.spyOn(email, 'sendWelcome').mockResolvedValue(undefined);
    jest.spyOn(email, 'sendMfaEnabled').mockResolvedValue(undefined);
    jest.spyOn(email, 'sendMfaDisabled').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await app.close();
    }
  });

  it('limits registration and invalid email confirmation attempts', async () => {
    const registration = await register('rate-limit');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app.getHttpServer())
        .post(`${apiPrefix}/auth/register`)
        .set('X-Forwarded-For', registration.ipAddress)
        .send(
          registrationPayload(registration.email, registration.organizationId),
        )
        .expect(409);
    }

    await request(app.getHttpServer())
      .post(`${apiPrefix}/auth/register`)
      .set('X-Forwarded-For', registration.ipAddress)
      .send(
        registrationPayload(registration.email, registration.organizationId),
      )
      .expect(429);

    const invalidToken = 'a'.repeat(64);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post(`${apiPrefix}/auth/email/verification/confirm`)
        .set('X-Forwarded-For', '198.51.100.200')
        .send({ token: invalidToken })
        .expect(400);
    }

    await request(app.getHttpServer())
      .post(`${apiPrefix}/auth/email/verification/confirm`)
      .set('X-Forwarded-For', '198.51.100.200')
      .send({ token: invalidToken })
      .expect(429);
  });

  it('throttles auth routes without throttling me routes', async () => {
    const ipAddress = '203.0.113.220';

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await request(app.getHttpServer())
        .get(`${apiPrefix}/auth/session`)
        .set('X-Forwarded-For', ipAddress)
        .expect(401);
    }

    await request(app.getHttpServer())
      .get(`${apiPrefix}/auth/session`)
      .set('X-Forwarded-For', ipAddress)
      .expect(429);

    await request(app.getHttpServer())
      .get(`${apiPrefix}/me/organizations`)
      .set('X-Forwarded-For', ipAddress)
      .expect(401);
  });

  it('confirms once, creates an owner tenant, completes MFA and revokes logout', async () => {
    const registration = await register('full-flow');
    const confirmations = await Promise.all([
      confirm(registration.token, registration.ipAddress),
      confirm(registration.token, registration.ipAddress),
    ]);
    const successfulConfirmation = confirmations.find(
      (response) => response.status === 201,
    );
    const rejectedConfirmation = confirmations.find(
      (response) => response.status === 400,
    );

    expect(successfulConfirmation).toBeDefined();
    expect(rejectedConfirmation).toBeDefined();
    expect(successfulConfirmation?.body).toEqual(
      expect.objectContaining({
        emailVerified: true,
        nextStep: 'ready',
        mfaStatus: 'disabled',
      }),
    );

    if (!successfulConfirmation)
      throw new Error('Confirmation did not succeed');
    const initialCookie = sessionCookie(successfulConfirmation);
    const initialSession = await request(app.getHttpServer())
      .get(`${apiPrefix}/auth/session`)
      .set('Cookie', initialCookie)
      .expect(200);

    expect(initialSession.body).toEqual(
      expect.objectContaining({
        userId: registration.userId,
        organizationId: registration.organizationId,
        membershipId: registration.membershipId,
        role: 'owner',
        tenantActive: true,
        mfaStatus: 'disabled',
      }),
    );

    const setup = await request(app.getHttpServer())
      .post(`${apiPrefix}/auth/mfa/totp/setup`)
      .set('Cookie', initialCookie)
      .send({});
    if (setup.status !== 201) {
      throw new Error(`MFA setup failed: ${JSON.stringify(setup.body)}`);
    }
    const setupBody = setup.body as { secret: string };
    const code = totpCode(setupBody.secret);
    const verified = await request(app.getHttpServer())
      .post(`${apiPrefix}/auth/mfa/totp/verify`)
      .set('Cookie', initialCookie)
      .send({ code })
      .expect(201);
    const verifiedCookie = sessionCookie(verified);

    const verifiedSession = await request(app.getHttpServer())
      .get(`${apiPrefix}/auth/session`)
      .set('Cookie', verifiedCookie)
      .expect(200);
    expect(verifiedSession.body).toEqual(
      expect.objectContaining({
        role: 'owner',
        tenantActive: true,
        requiresMfa: true,
        mfaStatus: 'active',
      }),
    );

    await request(app.getHttpServer())
      .delete(`${apiPrefix}/auth/session`)
      .set('Cookie', verifiedCookie)
      .expect(204);
    await request(app.getHttpServer())
      .get(`${apiPrefix}/auth/session`)
      .set('Cookie', verifiedCookie)
      .expect(401);
  });

  async function register(label: string): Promise<Registration> {
    const suffix = `${label}-${randomUUID()}`;
    const email = `${suffix}@example.test`;
    const ipAddress = `198.51.100.${10 + registrations.length}`;
    const response = await request(app.getHttpServer())
      .post(`${apiPrefix}/auth/register`)
      .set('X-Forwarded-For', ipAddress)
      .send(registrationPayload(email, suffix))
      .expect(201);
    const token = verificationTokens.get(email);
    if (!token)
      throw new Error(`Verification token was not captured for ${email}`);
    const registration = {
      userId: (response.body as { userId: string }).userId,
      organizationId: (response.body as { organizationId: string })
        .organizationId,
      membershipId: (response.body as { membershipId: string }).membershipId,
      email,
      token,
      ipAddress,
    };
    registrations.push(registration);
    return registration;
  }

  function registrationPayload(email: string, slug: string) {
    return {
      firstName: 'E2E',
      lastName: 'Test',
      email,
      password: 'secret123',
      organizationName: `E2E ${slug}`,
      slug,
      subscriptionType: 'trial',
    };
  }

  function confirm(token: string, ipAddress: string) {
    return request(app.getHttpServer())
      .post(`${apiPrefix}/auth/email/verification/confirm`)
      .set('X-Forwarded-For', ipAddress)
      .send({ token });
  }

  function totpCode(secret: string, now = Date.now()): string {
    const key = decodeBase32(secret);
    const counter = Math.floor(now / 1_000 / 30);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', key).update(counterBuffer).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return String(value).padStart(6, '0');
  }

  function decodeBase32(value: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const normalized = value.replace(/=+$/, '').toUpperCase();
    let bits = 0;
    let buffer = 0;
    const bytes: number[] = [];
    for (const character of normalized) {
      const digit = alphabet.indexOf(character);
      if (digit < 0) throw new Error('Invalid base32 secret');
      buffer = (buffer << 5) | digit;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return Buffer.from(bytes);
  }

  function sessionCookie(response: {
    headers: Record<string, string | string[]>;
  }): string {
    const cookies = response.headers['set-cookie'];
    const values = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const cookie = values.find((value) => value.startsWith(`${cookieName}=`));
    if (!cookie) throw new Error('Session cookie was not returned');
    return cookie.split(';', 1)[0];
  }

  async function cleanup(): Promise<void> {
    const userIds = [...new Set(registrations.map((item) => item.userId))];
    const organizationIds = [
      ...new Set(registrations.map((item) => item.organizationId)),
    ];
    if (userIds.length === 0) return;

    await dataSource.transaction(async (manager) => {
      await manager.query(
        'DELETE FROM "auth_sessions" WHERE "user_id" = ANY($1::uuid[])',
        [userIds],
      );
      await manager.query(
        'DELETE FROM "auth_factors" WHERE "user_id" = ANY($1::uuid[])',
        [userIds],
      );
      await manager.query(
        'DELETE FROM "email_verification_tokens" WHERE "user_id" = ANY($1::uuid[])',
        [userIds],
      );
      await manager.query(
        'DELETE FROM "audit_events" WHERE "actor_user_id" = ANY($1::uuid[]) OR "organization_id" = ANY($2::uuid[])',
        [userIds, organizationIds],
      );
      await manager.query(
        'DELETE FROM "auth_rate_limits" WHERE "created_at" >= $1 AND "scope" LIKE \'verification-%\'',
        [startedAt],
      );
      await manager.query(
        'DELETE FROM "subscriptions" WHERE "organization_id" = ANY($1::uuid[])',
        [organizationIds],
      );
      await manager.query(
        'DELETE FROM "memberships" WHERE "organization_id" = ANY($1::uuid[])',
        [organizationIds],
      );
      await manager.query(
        'DELETE FROM "organizations" WHERE "id" = ANY($1::uuid[])',
        [organizationIds],
      );
      await manager.query('DELETE FROM "users" WHERE "id" = ANY($1::uuid[])', [
        userIds,
      ]);
    });
  }
});
