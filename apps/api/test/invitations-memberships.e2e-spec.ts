import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { API_VALIDATION_PIPE_OPTIONS } from '../src/common/validation/validation-exception.factory';
import { EmailService } from '../src/modules/email/email.service';
import { MembershipStatus } from '../src/modules/memberships/entities/membership.entity';
import { OrganizationStatus } from '../src/modules/organizations/entities/organization.entity';
import { RoleKey } from '../src/modules/permissions/entities/role.entity';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { SubscriptionStatus } from '../src/modules/subscriptions/entities/subscription.entity';
import { UserStatus } from '../src/modules/users/entities/user.entity';

jest.setTimeout(60_000);

type Actor = {
  userId: string;
  organizationId: string;
  membershipId: string;
  cookie: string;
};

type InvitationResponse = { id: string; organizationId: string };
type AcceptanceResponse = {
  userId: string;
  membershipId: string;
  invitationStatus: string;
  membershipStatus: string;
  nextStep: string;
};
type InvitationListResponse = { items: Array<{ id: string; status: string }> };

describe('Invitations and memberships (e2e)', () => {
  const apiPrefix = '/api/v1';
  const fixture = randomUUID();
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const clientAccountIds: string[] = [];
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let sessions: SessionsService;
  let ownerA: Actor;
  let ownerB: Actor;
  let cookieName: string;
  let allowedOrigin: string;
  const invitationTokens = new Map<string, string>();
  const verificationTokens = new Map<string, string>();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix(apiPrefix.slice(1));
    app.useGlobalPipes(new ValidationPipe(API_VALIDATION_PIPE_OPTIONS));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    dataSource = app.get(DataSource);
    sessions = app.get(SessionsService);
    const config = app.get(ConfigService);
    cookieName = config.get<string>('cookies.sessionName', 'balanz_session');
    allowedOrigin =
      config
        .get<string[]>('app.corsOrigins', [])
        .find((origin) => origin.startsWith('http')) ?? '';
    if (!allowedOrigin) throw new Error('APP_CORS_ORIGINS is required');
    jest
      .spyOn(app.get(EmailService), 'sendInvitation')
      .mockImplementation((input) => {
        invitationTokens.set(input.invitationId, input.token);
        return Promise.resolve();
      });
    jest
      .spyOn(app.get(EmailService), 'sendVerification')
      .mockImplementation((input) => {
        verificationTokens.set(input.email, input.token);
        return Promise.resolve();
      });
    ownerA = await createOrganization('a');
    ownerB = await createOrganization('b');
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await app.close();
    }
  });

  it('creates and lists an invitation only inside the active tenant', async () => {
    const response = await createInvitation(
      ownerA,
      `new-${fixture}@example.test`,
    );
    const invitation = responseBody<InvitationResponse>(response);
    expect(invitation).toMatchObject({
      organizationId: ownerA.organizationId,
      role: RoleKey.COLLABORATOR,
      status: 'pending',
    });
    expect(invitation).not.toHaveProperty('token');
    expect(invitation).not.toHaveProperty('tokenHash');

    await request(app.getHttpServer())
      .get(`${apiPrefix}/organizations/${ownerA.organizationId}/invitations`)
      .set('Cookie', ownerB.cookie)
      .expect(404);

    const list = await request(app.getHttpServer())
      .get(`${apiPrefix}/organizations/${ownerA.organizationId}/invitations`)
      .set('Cookie', ownerA.cookie)
      .expect(200);
    expect(responseBody<InvitationListResponse>(list).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: invitation.id, status: 'pending' }),
      ]),
    );
  });

  it('accepts once, scopes verification and keeps membership pending until MFA', async () => {
    const email = `pending-${fixture}@example.test`;
    const created = await createInvitation(ownerA, email);
    const createdBody = responseBody<InvitationResponse>(created);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const token = invitationTokens.get(createdBody.id);
    expect(token).toBeDefined();

    const accepted = await request(app.getHttpServer())
      .post(`${apiPrefix}/invitations/${createdBody.id}/accept`)
      .set('Origin', allowedOrigin)
      .send({
        token,
        email,
        firstName: 'Invitado',
        lastName: 'Pendiente',
        password: 'StrongPassword-123',
      })
      .expect(200);
    const acceptedBody = responseBody<AcceptanceResponse>(accepted);
    userIds.push(acceptedBody.userId);
    expect(acceptedBody).toMatchObject({
      invitationStatus: 'accepted',
      membershipStatus: 'pending',
      nextStep: 'verify_email',
    });
    const [counts] = await dataSource.query<
      Array<{ memberships: number; assignments: number; permissions: number }>
    >(
      `SELECT
        (SELECT count(*)::int FROM memberships WHERE id = $1 AND organization_id = $2) AS memberships,
        (SELECT count(*)::int FROM account_assignments WHERE membership_id = $1) AS assignments,
        (SELECT count(*)::int FROM membership_permissions WHERE membership_id = $1) AS permissions`,
      [acceptedBody.membershipId, ownerA.organizationId],
    );
    expect(counts).toEqual({ memberships: 1, assignments: 0, permissions: 0 });
    expect(verificationTokens.get(email)).toBeDefined();
    const [verificationScope] = await dataSource.query<
      Array<{ membershipId: string }>
    >(
      `SELECT membership_id AS "membershipId"
       FROM email_verification_tokens
       WHERE user_id = $1 AND used_at IS NULL`,
      [acceptedBody.userId],
    );
    expect(verificationScope.membershipId).toBe(acceptedBody.membershipId);

    await request(app.getHttpServer())
      .post(`${apiPrefix}/invitations/${createdBody.id}/accept`)
      .set('Origin', allowedOrigin)
      .send({ token, email })
      .expect(409);

    await request(app.getHttpServer())
      .post(`${apiPrefix}/auth/email/verification/confirm`)
      .set('Origin', allowedOrigin)
      .send({ token: verificationTokens.get(email) })
      .expect(201);

    const [verifiedIdentity] = await dataSource.query<
      Array<{
        emailVerified: boolean;
        membershipStatus: string;
        joined: boolean;
      }>
    >(
      `SELECT
        (app_user.email_verified_at IS NOT NULL) AS "emailVerified",
        membership.status AS "membershipStatus",
        (membership.joined_at IS NOT NULL) AS joined
       FROM memberships membership
       INNER JOIN users app_user ON app_user.id = membership.user_id
       WHERE membership.id = $1`,
      [acceptedBody.membershipId],
    );
    expect(verifiedIdentity).toEqual({
      emailVerified: true,
      membershipStatus: 'pending',
      joined: false,
    });
  });

  it('rejects an invalid token without changing the invitation or creating a membership', async () => {
    const email = `invalid-token-${fixture}@example.test`;
    const created = responseBody<InvitationResponse>(
      await createInvitation(ownerA, email),
    );

    await request(app.getHttpServer())
      .post(`${apiPrefix}/invitations/${created.id}/accept`)
      .set('Origin', allowedOrigin)
      .send({ token: '0'.repeat(64), email })
      .expect(401);

    const [state] = await dataSource.query<
      Array<{ status: string; memberships: number }>
    >(
      `SELECT invitation.status,
        (SELECT count(*)::int FROM memberships membership
          INNER JOIN users app_user ON app_user.id = membership.user_id
          WHERE membership.organization_id = invitation.organization_id
            AND app_user.email = $2) AS memberships
       FROM invitations invitation WHERE invitation.id = $1`,
      [created.id, email],
    );
    expect(state).toEqual({ status: 'pending', memberships: 0 });
  });

  it('expires an invitation atomically and rejects the expired token', async () => {
    const email = `expired-${fixture}@example.test`;
    const created = responseBody<InvitationResponse>(
      await createInvitation(ownerA, email),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const token = invitationTokens.get(created.id);
    expect(token).toBeDefined();
    await dataSource.query(
      `UPDATE invitations
       SET created_at = now() - interval '2 hours',
           expires_at = now() - interval '1 hour'
       WHERE id = $1`,
      [created.id],
    );

    await request(app.getHttpServer())
      .post(`${apiPrefix}/invitations/${created.id}/accept`)
      .set('Origin', allowedOrigin)
      .send({ token, email })
      .expect(401);

    const [invitation] = await dataSource.query<Array<{ status: string }>>(
      'SELECT status FROM invitations WHERE id = $1',
      [created.id],
    );
    expect(invitation.status).toBe('expired');
    const [audit] = await dataSource.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE object_id = $1 AND action = 'invitation.expire'`,
      [created.id],
    );
    expect(audit.count).toBe(1);
  });

  it('rejects a revoked invitation and keeps repeated revocation idempotent', async () => {
    const email = `revoked-invitation-${fixture}@example.test`;
    const created = responseBody<InvitationResponse>(
      await createInvitation(ownerA, email),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const token = invitationTokens.get(created.id);
    expect(token).toBeDefined();

    for (const expectedStatus of [204, 204]) {
      await request(app.getHttpServer())
        .post(`${apiPrefix}/invitations/${created.id}/revoke`)
        .set('Cookie', ownerA.cookie)
        .set('Origin', allowedOrigin)
        .expect(expectedStatus);
    }
    await request(app.getHttpServer())
      .post(`${apiPrefix}/invitations/${created.id}/accept`)
      .set('Origin', allowedOrigin)
      .send({ token, email })
      .expect(409);

    const [audit] = await dataSource.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE object_id = $1 AND action = 'invitation.revoke'`,
      [created.id],
    );
    expect(audit.count).toBe(1);
  });

  it('allows only one of two concurrent acceptances to create the membership', async () => {
    const email = `concurrent-${fixture}@example.test`;
    const created = responseBody<InvitationResponse>(
      await createInvitation(ownerA, email),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const token = invitationTokens.get(created.id);
    expect(token).toBeDefined();
    const payload = {
      token,
      email,
      firstName: 'Invitado',
      lastName: 'Concurrente',
      password: 'StrongPassword-123',
    };

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post(`${apiPrefix}/invitations/${created.id}/accept`)
        .set('Origin', allowedOrigin)
        .send(payload),
      request(app.getHttpServer())
        .post(`${apiPrefix}/invitations/${created.id}/accept`)
        .set('Origin', allowedOrigin)
        .send(payload),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const accepted = responses.find(({ status }) => status === 200);
    const acceptedBody = responseBody<AcceptanceResponse>(accepted!);
    userIds.push(acceptedBody.userId);
    const [counts] = await dataSource.query<
      Array<{ memberships: number; acceptanceEvents: number }>
    >(
      `SELECT
        (SELECT count(*)::int FROM memberships WHERE id = $1) AS memberships,
        (SELECT count(*)::int FROM audit_events
          WHERE object_id = $2 AND action = 'invitation.accept') AS "acceptanceEvents"`,
      [acceptedBody.membershipId, created.id],
    );
    expect(counts).toEqual({ memberships: 1, acceptanceEvents: 1 });
  });

  it('suspends an active membership and immediately revokes its session', async () => {
    const user = await createUser('suspended', true);
    const role = await dataSource.getRepository('roles').findOneByOrFail({
      key: RoleKey.COLLABORATOR,
    });
    const membership = await dataSource.getRepository('memberships').save({
      organizationId: ownerA.organizationId,
      userId: user.id,
      roleId: String(role.id),
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });
    const memberSession = await sessions.create({
      userId: user.id,
      organizationId: ownerA.organizationId,
      membershipId: String(membership.id),
      requiresMfa: false,
    });
    const memberCookie = `${cookieName}=${memberSession.rawToken}`;
    await request(app.getHttpServer())
      .get(`${apiPrefix}/auth/session`)
      .set('Cookie', memberCookie)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`${apiPrefix}/memberships/${String(membership.id)}/suspend`)
      .set('Cookie', ownerA.cookie)
      .set('Origin', allowedOrigin)
      .expect(204);
    await request(app.getHttpServer())
      .get(`${apiPrefix}/auth/session`)
      .set('Cookie', memberCookie)
      .expect(401);
  });

  it('blocks pending memberships and revokes access permanently with the previous session', async () => {
    const role = await dataSource.getRepository('roles').findOneByOrFail({
      key: RoleKey.COLLABORATOR,
    });
    const pendingUser = await createUser('pending-session', false);
    const pendingMembership = await dataSource
      .getRepository('memberships')
      .save({
        organizationId: ownerA.organizationId,
        userId: pendingUser.id,
        roleId: String(role.id),
        status: MembershipStatus.PENDING,
      });
    const pendingSession = await sessions.create({
      userId: pendingUser.id,
      organizationId: ownerA.organizationId,
      membershipId: String(pendingMembership.id),
      requiresMfa: false,
    });
    await request(app.getHttpServer())
      .get(`${apiPrefix}/organizations/${ownerA.organizationId}/memberships`)
      .set('Cookie', `${cookieName}=${pendingSession.rawToken}`)
      .expect(403);

    const revokedUser = await createUser('revoked-session', true);
    const revokedMembership = await dataSource
      .getRepository('memberships')
      .save({
        organizationId: ownerA.organizationId,
        userId: revokedUser.id,
        roleId: String(role.id),
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
    const revokedSession = await sessions.create({
      userId: revokedUser.id,
      organizationId: ownerA.organizationId,
      membershipId: String(revokedMembership.id),
      requiresMfa: false,
    });
    const revokedCookie = `${cookieName}=${revokedSession.rawToken}`;
    await request(app.getHttpServer())
      .post(`${apiPrefix}/memberships/${String(revokedMembership.id)}/revoke`)
      .set('Cookie', ownerA.cookie)
      .set('Origin', allowedOrigin)
      .expect(204);
    await request(app.getHttpServer())
      .get(`${apiPrefix}/auth/session`)
      .set('Cookie', revokedCookie)
      .expect(401);
    await request(app.getHttpServer())
      .patch(
        `${apiPrefix}/memberships/${String(revokedMembership.id)}/reactivate`,
      )
      .set('Cookie', ownerA.cookie)
      .set('Origin', allowedOrigin)
      .expect(422);
  });

  it('masks cross-tenant membership identifiers and unassigned client accounts', async () => {
    const role = await dataSource.getRepository('roles').findOneByOrFail({
      key: RoleKey.COLLABORATOR,
    });
    const foreignUser = await createUser('foreign-member', true);
    const foreignMembership = await dataSource
      .getRepository('memberships')
      .save({
        organizationId: ownerB.organizationId,
        userId: foreignUser.id,
        roleId: String(role.id),
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
    await request(app.getHttpServer())
      .patch(`${apiPrefix}/memberships/${String(foreignMembership.id)}/suspend`)
      .set('Cookie', ownerA.cookie)
      .set('Origin', allowedOrigin)
      .expect(404);
    const unchanged = await dataSource.getRepository('memberships').findOneBy({
      id: String(foreignMembership.id),
    });
    expect(unchanged?.status).toBe(MembershipStatus.ACTIVE);

    const accountId = randomUUID();
    clientAccountIds.push(accountId);
    await dataSource.getRepository('client_accounts').save({
      id: accountId,
      organizationId: ownerA.organizationId,
      name: 'Cuenta sin asignación',
      status: 'active',
    });
    const unassignedUser = await createUser('unassigned-member', true);
    const unassignedMembership = await dataSource
      .getRepository('memberships')
      .save({
        organizationId: ownerA.organizationId,
        userId: unassignedUser.id,
        roleId: String(role.id),
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
    const unassignedSession = await sessions.create({
      userId: unassignedUser.id,
      organizationId: ownerA.organizationId,
      membershipId: String(unassignedMembership.id),
      requiresMfa: false,
    });
    await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts/${accountId}`)
      .set('Cookie', `${cookieName}=${unassignedSession.rawToken}`)
      .expect(404);
  });

  it('audits lifecycle transitions without tokens, passwords or secrets', async () => {
    const events = await dataSource.query<
      Array<{ action: string; correlationId: string; metadata: unknown }>
    >(
      `SELECT action, correlation_id AS "correlationId", metadata
       FROM audit_events
       WHERE organization_id = $1
         AND action = ANY($2::text[])`,
      [
        ownerA.organizationId,
        [
          'invitation.accept',
          'invitation.expire',
          'invitation.revoke',
          'membership.suspend',
          'membership.revoke',
        ],
      ],
    );
    expect(new Set(events.map(({ action }) => action))).toEqual(
      new Set([
        'invitation.accept',
        'invitation.expire',
        'invitation.revoke',
        'membership.suspend',
        'membership.revoke',
      ]),
    );
    expect(events.every(({ correlationId }) => Boolean(correlationId))).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toMatch(
      /token|password|secret|mfa.?code/i,
    );
  });

  async function createInvitation(actor: Actor, email: string) {
    return request(app.getHttpServer())
      .post(`${apiPrefix}/organizations/${actor.organizationId}/invitations`)
      .set('Cookie', actor.cookie)
      .set('Origin', allowedOrigin)
      .send({
        email,
        role: RoleKey.COLLABORATOR,
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      })
      .expect(201);
  }

  async function createOrganization(label: string): Promise<Actor> {
    const user = await createUser(`${label}-owner`, true);
    const organization = await dataSource.getRepository('organizations').save({
      name: `Invitation E2E ${label}`,
      slug: `invitation-${label}-${fixture}`,
      timezone: 'America/Mexico_City',
      ownerUserId: user.id,
      status: OrganizationStatus.ACTIVE,
    });
    const organizationId = String(organization.id);
    organizationIds.push(organizationId);
    const trialStartedAt = new Date();
    await dataSource.getRepository('subscriptions').save({
      organizationId,
      subscriptionType: 'trial',
      status: SubscriptionStatus.TRIALING,
      trialStartedAt,
      trialEndsAt: new Date(trialStartedAt.getTime() + 30 * 86_400_000),
    });
    const role = await dataSource.getRepository('roles').findOneByOrFail({
      key: RoleKey.ADMIN,
    });
    const membership = await dataSource.getRepository('memberships').save({
      organizationId,
      userId: user.id,
      roleId: String(role.id),
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });
    const pair = await sessions.create({
      userId: user.id,
      organizationId,
      membershipId: String(membership.id),
      requiresMfa: true,
      mfaVerifiedAt: new Date(),
      reauthenticatedAt: new Date(),
    });
    return {
      userId: user.id,
      organizationId,
      membershipId: String(membership.id),
      cookie: `${cookieName}=${pair.rawToken}`,
    };
  }

  async function createUser(label: string, verified: boolean) {
    const user = await dataSource.getRepository('users').save({
      firstName: 'E2E',
      lastName: label,
      email: `${label}-${fixture}@example.test`,
      emailVerifiedAt: verified ? new Date() : null,
      locale: 'es-MX',
      timezone: 'America/Mexico_City',
      status: UserStatus.ACTIVE,
      passwordHash: 'not-used-by-invitation-e2e',
    });
    const userId = String(user.id);
    userIds.push(userId);
    return { id: userId };
  }

  function responseBody<T>(response: { body: unknown }): T {
    return response.body as T;
  }

  async function cleanup(): Promise<void> {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(
      'DELETE FROM invitations WHERE organization_id = ANY($1::uuid[])',
      [organizationIds],
    );
    await dataSource.query(
      'DELETE FROM audit_events WHERE organization_id = ANY($1::uuid[])',
      [organizationIds],
    );
    await dataSource.query(
      'DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])',
      [userIds],
    );
    await dataSource.query(
      'DELETE FROM email_verification_tokens WHERE user_id = ANY($1::uuid[])',
      [userIds],
    );
    await dataSource.query(
      'DELETE FROM client_accounts WHERE id = ANY($1::uuid[])',
      [clientAccountIds],
    );
    await dataSource.query(
      'DELETE FROM memberships WHERE organization_id = ANY($1::uuid[])',
      [organizationIds],
    );
    await dataSource.query(
      'DELETE FROM subscriptions WHERE organization_id = ANY($1::uuid[])',
      [organizationIds],
    );
    await dataSource.query(
      'DELETE FROM organizations WHERE id = ANY($1::uuid[])',
      [organizationIds],
    );
    await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      userIds,
    ]);
  }
});
