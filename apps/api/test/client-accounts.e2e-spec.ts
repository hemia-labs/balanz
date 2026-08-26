import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { validationExceptionFactory } from '../src/common/validation/validation-exception.factory';
import {
  AuthFactor,
  AuthFactorStatus,
} from '../src/modules/auth/entities/auth-factor.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { MembershipStatus } from '../src/modules/memberships/entities/membership.entity';
import { OrganizationStatus } from '../src/modules/organizations/entities/organization.entity';
import { Role, RoleKey } from '../src/modules/permissions/entities/role.entity';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { UserStatus } from '../src/modules/users/entities/user.entity';

jest.setTimeout(60_000);

type Actor = {
  userId: string;
  membershipId: string;
  organizationId: string;
  cookie: string;
  sessionId: string;
};

type CreatedClient = {
  clientAccountId: string;
  legalEntityId: string;
  assignmentId: string;
  fiscalYearId: string;
};

type ErrorResponse = {
  code?: string;
  message: string | string[];
  fieldErrors?: Record<string, string[]>;
};

describe('Client accounts domain (e2e)', () => {
  const apiPrefix = '/api/v1';
  const fixtureTag = randomUUID();
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const sessionIds: string[] = [];
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let sessions: SessionsService;
  let cookieName: string;
  let allowedOrigin: string;
  let owner: Actor;
  let accountant: Actor;
  let collaborator: Actor;
  let foreignOwner: Actor;
  let ownerWithoutMfa: Actor;
  let ownerPendingMfa: Actor;
  let mainClient: CreatedClient;
  let concurrentClientId: string;
  let collaboratorAssignmentId: string;
  let rfcCounter = 0;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix(apiPrefix.slice(1));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
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
    if (!allowedOrigin) {
      throw new Error('An HTTP APP_CORS_ORIGINS value is required for E2E');
    }

    const organization = await createOrganization('primary');
    owner = organization.owner;
    accountant = await createMember(
      organization.organizationId,
      'accountant',
      RoleKey.ACCOUNTANT,
    );
    collaborator = await createMember(
      organization.organizationId,
      'collaborator',
      RoleKey.COLLABORATOR,
    );
    foreignOwner = (await createOrganization('foreign')).owner;
    ownerWithoutMfa = await createSessionActor(owner, false, null);
    ownerPendingMfa = await createSessionActor(owner, true, null);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await app?.close();
    }
  });

  it('enforces authentication, CSRF and the MFA policy', async () => {
    await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts`)
      .expect(401);

    await request(app.getHttpServer())
      .post(`${apiPrefix}/client-accounts`)
      .set('Cookie', owner.cookie)
      .send(validClientPayload(accountant.membershipId))
      .expect(403);

    await request(app.getHttpServer())
      .post(`${apiPrefix}/client-accounts`)
      .set('Cookie', owner.cookie)
      .set('Origin', 'https://attacker.example')
      .send(validClientPayload(accountant.membershipId))
      .expect(403);

    const setupRequired = await request(app.getHttpServer())
      .post(`${apiPrefix}/client-accounts`)
      .set('Cookie', ownerWithoutMfa.cookie)
      .set('Origin', allowedOrigin)
      .send(validClientPayload(accountant.membershipId))
      .expect(403);
    expect(responseBody<ErrorResponse>(setupRequired).message).toBe(
      'MFA_SETUP_REQUIRED',
    );

    const verificationRequired = await request(app.getHttpServer())
      .post(`${apiPrefix}/client-accounts`)
      .set('Cookie', ownerPendingMfa.cookie)
      .set('Origin', allowedOrigin)
      .send(validClientPayload(accountant.membershipId))
      .expect(401);
    expect(responseBody<ErrorResponse>(verificationRequired).message).toBe(
      'MFA_REQUIRED',
    );
  });

  it('returns friendly validation errors and rejects mass assignment', async () => {
    const response = await request(app.getHttpServer())
      .post(`${apiPrefix}/client-accounts`)
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .send({
        ...validClientPayload(accountant.membershipId),
        organizationId: foreignOwner.organizationId,
        legalEntity: { legalName: 'Entidad de prueba', rfc: 'RFC INVALIDO' },
      })
      .expect(422);

    const body = responseBody<ErrorResponse>(response);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'Revisa los campos señalados e intenta de nuevo.',
      }),
    );
    expect(body.fieldErrors?.organizationId).toContain(
      'Este campo no está permitido.',
    );
    expect(body.fieldErrors?.['legalEntity.rfc']).toContain(
      'Ingresa un RFC válido de 12 o 13 caracteres, sin espacios ni guiones.',
    );
  });

  it('creates the complete aggregate atomically with 12 periods and audit', async () => {
    const correlationId = randomUUID();
    const response = await request(app.getHttpServer())
      .post(`${apiPrefix}/client-accounts`)
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .set('x-correlation-id', correlationId)
      .send(validClientPayload(accountant.membershipId))
      .expect(201);
    mainClient = responseBody<CreatedClient>(response);
    expect(response.headers['x-correlation-id']).toBe(correlationId);

    const [counts] = (await dataSource.query(
      `SELECT
        (SELECT count(*)::int FROM client_accounts WHERE id = $1) AS accounts,
        (SELECT count(*)::int FROM legal_entities WHERE id = $2 AND client_account_id = $1) AS entities,
        (SELECT count(*)::int FROM account_assignments WHERE id = $3 AND client_account_id = $1 AND status = 'active') AS assignments,
        (SELECT count(*)::int FROM fiscal_years WHERE id = $4 AND client_account_id = $1) AS fiscal_years,
        (SELECT count(*)::int FROM periods WHERE fiscal_year_id = $4) AS periods,
        (SELECT count(*)::int FROM audit_events WHERE client_account_id = $1) AS audit_events,
        (SELECT count(*)::int FROM audit_events WHERE client_account_id = $1 AND correlation_id = $5) AS correlated_audit_events`,
      [
        mainClient.clientAccountId,
        mainClient.legalEntityId,
        mainClient.assignmentId,
        mainClient.fiscalYearId,
        correlationId,
      ],
    )) as unknown as Array<{
      accounts: number;
      entities: number;
      assignments: number;
      fiscal_years: number;
      periods: number;
      audit_events: number;
      correlated_audit_events: number;
    }>;
    expect(counts).toEqual({
      accounts: 1,
      entities: 1,
      assignments: 1,
      fiscal_years: 1,
      periods: 12,
      audit_events: 4,
      correlated_audit_events: 4,
    });
  });

  it('rolls back the complete aggregate when audit persistence fails', async () => {
    const rfc = nextRfc();
    const audit = app.get(AuditService);
    const record = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('forced audit persistence failure'));

    try {
      await request(app.getHttpServer())
        .post(`${apiPrefix}/client-accounts`)
        .set('Cookie', owner.cookie)
        .set('Origin', allowedOrigin)
        .send(validClientPayload(accountant.membershipId, rfc))
        .expect(500);
    } finally {
      record.mockRestore();
    }

    const [counts] = (await dataSource.query(
      `SELECT
        (SELECT count(*)::int FROM legal_entities WHERE organization_id = $1 AND rfc = $2) AS entities,
        (SELECT count(*)::int
           FROM client_accounts account
          WHERE account.organization_id = $1
            AND account.id IN (
              SELECT entity.client_account_id
                FROM legal_entities entity
               WHERE entity.organization_id = $1 AND entity.rfc = $2
            )) AS accounts`,
      [owner.organizationId, rfc],
    )) as unknown as Array<{ accounts: number; entities: number }>;
    expect(counts).toEqual({ accounts: 0, entities: 0 });
  });

  it('applies tenant scope, assignment scope and permissions', async () => {
    const ownerList = await listClients(owner.cookie);
    expect(clientIds(responseBody(ownerList))).toContain(
      mainClient.clientAccountId,
    );

    const accountantList = await listClients(accountant.cookie);
    expect(clientIds(responseBody(accountantList))).toEqual([
      mainClient.clientAccountId,
    ]);

    const collaboratorList = await listClients(collaborator.cookie);
    expect(clientIds(responseBody(collaboratorList))).toEqual([]);

    const crossTenant = await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts/${mainClient.clientAccountId}`)
      .set('Cookie', foreignOwner.cookie)
      .expect(404);
    expect(responseBody<ErrorResponse>(crossTenant).code).toBe(
      'CLIENT_ACCOUNT_NOT_FOUND',
    );

    await request(app.getHttpServer())
      .get(
        `${apiPrefix}/client-accounts/${mainClient.clientAccountId}/legal-entities`,
      )
      .set('Cookie', foreignOwner.cookie)
      .expect(404);
    await request(app.getHttpServer())
      .get(
        `${apiPrefix}/client-accounts/${mainClient.clientAccountId}/assignments`,
      )
      .set('Cookie', foreignOwner.cookie)
      .expect(404);
    await request(app.getHttpServer())
      .get(
        `${apiPrefix}/legal-entities/${mainClient.legalEntityId}/fiscal-years`,
      )
      .set('Cookie', foreignOwner.cookie)
      .expect(404);
    await request(app.getHttpServer())
      .get(`${apiPrefix}/fiscal-years/${mainClient.fiscalYearId}/periods`)
      .set('Cookie', foreignOwner.cookie)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`${apiPrefix}/client-accounts/${mainClient.clientAccountId}`)
      .set('Cookie', collaborator.cookie)
      .set('Origin', allowedOrigin)
      .send({ name: 'No autorizado', expectedVersion: 1 })
      .expect(403);

    const assignment = await request(app.getHttpServer())
      .post(
        `${apiPrefix}/client-accounts/${mainClient.clientAccountId}/assignments`,
      )
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .send({
        membershipId: collaborator.membershipId,
        responsibility: 'collaborator',
      })
      .expect(201);
    collaboratorAssignmentId = responseBody<{ id: string }>(assignment).id;

    const assignedCollaboratorList = await listClients(collaborator.cookie);
    expect(clientIds(responseBody(assignedCollaboratorList))).toEqual([
      mainClient.clientAccountId,
    ]);
  });

  it('removes assigned access immediately after revocation with a warm session cache', async () => {
    await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts/${mainClient.clientAccountId}`)
      .set('Cookie', collaborator.cookie)
      .expect(200);

    await request(app.getHttpServer())
      .delete(
        `${apiPrefix}/client-accounts/${mainClient.clientAccountId}/assignments/${collaboratorAssignmentId}`,
      )
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .expect(204);

    const revokedDetail = await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts/${mainClient.clientAccountId}`)
      .set('Cookie', collaborator.cookie)
      .expect(404);
    expect(responseBody<ErrorResponse>(revokedDetail).code).toBe(
      'CLIENT_ACCOUNT_NOT_FOUND',
    );
    expect(
      clientIds(responseBody(await listClients(collaborator.cookie))),
    ).toEqual([]);
  });

  it('protects the primary assignment and optimistic versions', async () => {
    const assignments = await request(app.getHttpServer())
      .get(
        `${apiPrefix}/client-accounts/${mainClient.clientAccountId}/assignments`,
      )
      .set('Cookie', owner.cookie)
      .expect(200);
    const primary = responseBody<Array<Record<string, unknown>>>(
      assignments,
    ).find((item) => item.responsibility === 'primary');
    expect(primary).toBeDefined();

    const primaryId = String(primary?.id);
    const revoke = await request(app.getHttpServer())
      .delete(
        `${apiPrefix}/client-accounts/${mainClient.clientAccountId}/assignments/${primaryId}`,
      )
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .expect(409);
    expect(responseBody<ErrorResponse>(revoke).code).toBe(
      'LAST_PRIMARY_ASSIGNMENT',
    );

    const updated = await request(app.getHttpServer())
      .patch(`${apiPrefix}/client-accounts/${mainClient.clientAccountId}`)
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .send({ name: `Cliente actualizado ${fixtureTag}`, expectedVersion: 1 })
      .expect(200);
    expect(responseBody<{ version: number }>(updated).version).toBe(2);

    const stale = await request(app.getHttpServer())
      .patch(`${apiPrefix}/client-accounts/${mainClient.clientAccountId}`)
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .send({ name: 'Actualización obsoleta', expectedVersion: 1 })
      .expect(409);
    expect(responseBody<ErrorResponse>(stale).code).toBe(
      'STALE_CLIENT_ACCOUNT',
    );
  });

  it('creates fiscal years with exactly 12 periods and rejects duplicates', async () => {
    const initialYear = new Date().getFullYear();
    const duplicate = await request(app.getHttpServer())
      .post(
        `${apiPrefix}/legal-entities/${mainClient.legalEntityId}/fiscal-years`,
      )
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .send({ year: initialYear })
      .expect(409);
    expect(responseBody<ErrorResponse>(duplicate).code).toBe(
      'FISCAL_YEAR_CONFLICT',
    );

    const created = await request(app.getHttpServer())
      .post(
        `${apiPrefix}/legal-entities/${mainClient.legalEntityId}/fiscal-years`,
      )
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .send({ year: initialYear - 1 })
      .expect(201);
    const createdBody = responseBody<{ id: string; periodIds: string[] }>(
      created,
    );
    expect(createdBody.periodIds).toHaveLength(12);

    const periods = await request(app.getHttpServer())
      .get(`${apiPrefix}/fiscal-years/${createdBody.id}/periods`)
      .set('Cookie', accountant.cookie)
      .expect(200);
    const periodBody = responseBody<{ periods: Array<{ month: number }> }>(
      periods,
    );
    expect(periodBody.periods).toHaveLength(12);
    expect(periodBody.periods.map((period) => period.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('keeps a duplicate RFC race to one committed aggregate', async () => {
    const duplicateRfc = nextRfc();
    const payload = validClientPayload(accountant.membershipId, duplicateRfc);
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post(`${apiPrefix}/client-accounts`)
        .set('Cookie', owner.cookie)
        .set('Origin', allowedOrigin)
        .send({ ...payload, accountName: `Carrera A ${fixtureTag}` }),
      request(app.getHttpServer())
        .post(`${apiPrefix}/client-accounts`)
        .set('Cookie', owner.cookie)
        .set('Origin', allowedOrigin)
        .send({ ...payload, accountName: `Carrera B ${fixtureTag}` }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const success = responses.find((response) => response.status === 201);
    const conflict = responses.find((response) => response.status === 409);
    if (!success || !conflict) throw new Error('Race result was incomplete');
    concurrentClientId = responseBody<CreatedClient>(success).clientAccountId;
    expect(responseBody<ErrorResponse>(conflict).code).toBe(
      'LEGAL_ENTITY_RFC_CONFLICT',
    );

    const [committed] = (await dataSource.query(
      `SELECT
        count(DISTINCT c.id)::int AS accounts,
        count(DISTINCT l.id)::int AS entities,
        count(DISTINCT a.id)::int AS assignments,
        count(DISTINCT f.id)::int AS fiscal_years,
        count(DISTINCT p.id)::int AS periods
      FROM legal_entities l
      JOIN client_accounts c ON c.organization_id = l.organization_id AND c.id = l.client_account_id
      LEFT JOIN account_assignments a ON a.organization_id = c.organization_id AND a.client_account_id = c.id
      LEFT JOIN fiscal_years f ON f.organization_id = c.organization_id AND f.client_account_id = c.id
      LEFT JOIN periods p ON p.organization_id = f.organization_id AND p.fiscal_year_id = f.id
      WHERE l.organization_id = $1 AND l.rfc = $2`,
      [owner.organizationId, duplicateRfc],
    )) as unknown as Array<{
      accounts: number;
      entities: number;
      assignments: number;
      fiscal_years: number;
      periods: number;
    }>;
    expect(committed).toEqual({
      accounts: 1,
      entities: 1,
      assignments: 1,
      fiscal_years: 1,
      periods: 12,
    });
  });

  it('enforces RFC uniqueness and archive visibility rules', async () => {
    const rfc = nextRfc();
    const additional = await request(app.getHttpServer())
      .post(
        `${apiPrefix}/client-accounts/${mainClient.clientAccountId}/legal-entities`,
      )
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .send({ legalName: `Entidad adicional ${fixtureTag}`, rfc })
      .expect(201);

    const duplicate = await request(app.getHttpServer())
      .post(`${apiPrefix}/client-accounts/${concurrentClientId}/legal-entities`)
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .send({ legalName: `RFC duplicado ${fixtureTag}`, rfc })
      .expect(409);
    expect(responseBody<ErrorResponse>(duplicate).code).toBe(
      'LEGAL_ENTITY_RFC_CONFLICT',
    );

    await request(app.getHttpServer())
      .delete(
        `${apiPrefix}/legal-entities/${responseBody<{ id: string }>(additional).id}`,
      )
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .expect(204);
    const lastEntity = await request(app.getHttpServer())
      .delete(`${apiPrefix}/legal-entities/${mainClient.legalEntityId}`)
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .expect(409);
    expect(responseBody<ErrorResponse>(lastEntity).code).toBe(
      'LAST_ACTIVE_LEGAL_ENTITY',
    );

    const invalidSort = await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts?sort=not-a-column`)
      .set('Cookie', owner.cookie)
      .expect(400);
    expect(responseBody<ErrorResponse>(invalidSort).code).toBe(
      'INVALID_CLIENT_SORT',
    );
    await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts?limit=101`)
      .set('Cookie', owner.cookie)
      .expect(422);
    const injectionSearch = await request(app.getHttpServer())
      .get(
        `${apiPrefix}/client-accounts?search=${encodeURIComponent("' OR 1=1 --")}`,
      )
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(clientIds(responseBody(injectionSearch))).toEqual([]);

    await request(app.getHttpServer())
      .delete(`${apiPrefix}/client-accounts/${mainClient.clientAccountId}`)
      .set('Cookie', owner.cookie)
      .set('Origin', allowedOrigin)
      .expect(204);

    const visible = await listClients(owner.cookie);
    expect(clientIds(responseBody(visible))).not.toContain(
      mainClient.clientAccountId,
    );

    const archived = await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts?includeArchived=true`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(clientIds(responseBody(archived))).toContain(
      mainClient.clientAccountId,
    );

    const assignedDetail = await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts/${mainClient.clientAccountId}`)
      .set('Cookie', accountant.cookie)
      .expect(404);
    expect(responseBody<ErrorResponse>(assignedDetail).code).toBe(
      'CLIENT_ACCOUNT_NOT_FOUND',
    );

    const assignedArchived = await request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts?includeArchived=true`)
      .set('Cookie', accountant.cookie)
      .expect(403);
    expect(responseBody<ErrorResponse>(assignedArchived).code).toBe(
      'ARCHIVED_ACCESS_FORBIDDEN',
    );
  });

  function validClientPayload(primaryMembershipId: string, rfc = nextRfc()) {
    return {
      accountName: `Cliente E2E ${fixtureTag} ${rfcCounter}`,
      legalEntity: {
        legalName: `Entidad E2E ${fixtureTag} ${rfcCounter}`,
        rfc,
      },
      primaryMembershipId,
      fiscalYear: new Date().getFullYear(),
    };
  }

  function nextRfc(): string {
    rfcCounter += 1;
    const token = randomUUID().replaceAll('-', '').toUpperCase();
    const prefix = token
      .slice(0, 3)
      .replace(/[0-9]/g, (digit) => String.fromCharCode(65 + Number(digit)));
    const date = new Date();
    const yymmdd = [
      String(date.getFullYear()).slice(-2),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('');
    return `${prefix}${yymmdd}${token.slice(3, 6)}`;
  }

  async function listClients(cookie: string) {
    return request(app.getHttpServer())
      .get(`${apiPrefix}/client-accounts?sort=name&direction=asc`)
      .set('Cookie', cookie)
      .expect(200);
  }

  function clientIds(body: unknown): string[] {
    const items = (body as { items?: Array<{ account?: { id?: string } }> })
      .items;
    return (items ?? []).flatMap((item) =>
      item.account?.id ? [item.account.id] : [],
    );
  }

  function responseBody<T = unknown>(response: { body: unknown }): T {
    return response.body as T;
  }

  async function createOrganization(label: string): Promise<{
    organizationId: string;
    owner: Actor;
  }> {
    const user = await createUser(`${label}-owner`);
    const organization = await dataSource.getRepository('organizations').save({
      name: `E2E ${label} ${fixtureTag}`,
      legalName: null,
      slug: `e2e-${label}-${fixtureTag}`,
      billingEmail: null,
      timezone: 'America/Mexico_City',
      ownerUserId: user.id,
      status: OrganizationStatus.ACTIVE,
      suspendedAt: null,
      cancelledAt: null,
    });
    organizationIds.push(String(organization.id));
    const actor = await createMembershipActor(
      String(organization.id),
      user.id,
      RoleKey.OWNER,
    );
    return { organizationId: String(organization.id), owner: actor };
  }

  async function createMember(
    organizationId: string,
    label: string,
    roleKey: RoleKey,
  ): Promise<Actor> {
    const user = await createUser(label);
    return createMembershipActor(organizationId, user.id, roleKey);
  }

  async function createUser(label: string): Promise<{ id: string }> {
    const user = await dataSource.getRepository('users').save({
      firstName: 'E2E',
      lastName: label,
      email: `${label}-${fixtureTag}@example.test`,
      emailVerifiedAt: new Date(),
      phoneE164: null,
      phoneVerifiedAt: null,
      locale: 'es-MX',
      timezone: 'America/Mexico_City',
      status: UserStatus.ACTIVE,
      lastLoginAt: null,
      passwordHash: 'not-used-by-client-e2e',
      deletedAt: null,
    });
    userIds.push(String(user.id));
    return { id: String(user.id) };
  }

  async function createMembershipActor(
    organizationId: string,
    userId: string,
    roleKey: RoleKey,
  ): Promise<Actor> {
    const role = await dataSource.getRepository(Role).findOneByOrFail({
      key: roleKey,
    });
    const membership = await dataSource.getRepository('memberships').save({
      organizationId,
      userId,
      roleId: role.id,
      status: MembershipStatus.ACTIVE,
      invitedAt: null,
      joinedAt: new Date(),
      suspendedAt: null,
      revokedAt: null,
    });
    await dataSource.getRepository(AuthFactor).save({
      userId,
      secretEncrypted: 'not-a-real-secret',
      status: AuthFactorStatus.ACTIVE,
      verifiedAt: new Date(),
      lastUsedAt: null,
      lastUsedCounter: null,
      revokedAt: null,
    });
    return createSessionActor(
      {
        userId,
        organizationId,
        membershipId: String(membership.id),
      },
      true,
      new Date(),
    );
  }

  async function createSessionActor(
    actor: Pick<Actor, 'userId' | 'organizationId' | 'membershipId'>,
    requiresMfa: boolean,
    mfaVerifiedAt: Date | null,
  ): Promise<Actor> {
    const pair = await sessions.create({
      userId: actor.userId,
      organizationId: actor.organizationId,
      membershipId: actor.membershipId,
      requiresMfa,
      mfaVerifiedAt,
      ipAddress: '127.0.0.1',
      userAgent: 'balanz-client-e2e',
    });
    sessionIds.push(pair.session.id);
    return {
      ...actor,
      cookie: `${cookieName}=${pair.rawToken}`,
      sessionId: pair.session.id,
    };
  }

  async function cleanup(): Promise<void> {
    await Promise.allSettled(
      sessionIds.map((sessionId) =>
        sessions.revoke(sessionId, 'client e2e cleanup'),
      ),
    );
    if (organizationIds.length === 0 && userIds.length === 0) return;

    await dataSource.transaction(async (manager) => {
      const organizations = organizationIds;
      const users = userIds;
      await manager.query(
        'DELETE FROM periods WHERE organization_id = ANY($1::uuid[])',
        [organizations],
      );
      await manager.query(
        'DELETE FROM fiscal_years WHERE organization_id = ANY($1::uuid[])',
        [organizations],
      );
      await manager.query(
        'DELETE FROM account_assignments WHERE organization_id = ANY($1::uuid[])',
        [organizations],
      );
      await manager.query(
        'DELETE FROM legal_entities WHERE organization_id = ANY($1::uuid[])',
        [organizations],
      );
      await manager.query(
        'DELETE FROM client_accounts WHERE organization_id = ANY($1::uuid[])',
        [organizations],
      );
      await manager.query(
        'DELETE FROM audit_events WHERE organization_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])',
        [organizations, users],
      );
      await manager.query(
        'DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])',
        [users],
      );
      await manager.query(
        'DELETE FROM auth_factors WHERE user_id = ANY($1::uuid[])',
        [users],
      );
      await manager.query(
        'DELETE FROM email_verification_tokens WHERE user_id = ANY($1::uuid[])',
        [users],
      );
      await manager.query(
        'DELETE FROM subscriptions WHERE organization_id = ANY($1::uuid[])',
        [organizations],
      );
      await manager.query(
        'DELETE FROM memberships WHERE organization_id = ANY($1::uuid[])',
        [organizations],
      );
      await manager.query(
        'DELETE FROM organizations WHERE id = ANY($1::uuid[])',
        [organizations],
      );
      await manager.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        users,
      ]);
    });
  }
});
