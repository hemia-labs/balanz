import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PaymentsModule } from '@hemia/payments/nestjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Request } from 'express';
import type { Server } from 'node:http';
import { SessionGuard } from '../src/common/guards/session.guard';
import { TenantAccessGuard } from '../src/common/guards/tenant-access.guard';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';
import { PaymentsApplicationService } from '../src/modules/billing/payments-application.service';
import { paymentsConnection } from './payments-fixture';

describe('PaymentsModule with Balanz authorization', () => {
  let app: INestApplication;
  const session = {
    id: randomUUID(),
    userId: randomUUID(),
    organizationId: randomUUID(),
    membershipId: randomUUID(),
    requiresMfa: true,
    mfaVerifiedAt: new Date(),
  };
  let authority = { tenantActive: true, permissions: ['billing.manage'] };
  const upstream = jest.spyOn(global, 'fetch');
  beforeAll(async () => {
    const config = new ConfigService({
      app: { corsOrigins: ['https://balanz.test'] },
    });
    const sessions = new SessionGuard({
      resolve: jest.fn((req: Request) => {
        if (req.get('x-test-session') !== 'valid')
          throw new UnauthorizedException();
        return Promise.resolve({ session, context: authority });
      }),
    } as never);
    const application = new PaymentsApplicationService(
      config,
      {} as never,
      {} as never,
      sessions,
      new TenantAccessGuard(),
      new PermissionsGuard(new Reflector(), {
        recordDirect: jest.fn(),
      } as never),
    );
    const module = await Test.createTestingModule({
      imports: [
        PaymentsModule.forRootAsync({
          useFactory: () => ({
            connection: paymentsConnection,
            clientSecret: 'fixture-secret',
            onSnapshot: () => Promise.resolve({ applied: true }),
            authorize: (request, operation) =>
              application.authorize(request, operation),
          }),
        }),
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalGuards(new CsrfGuard(config));
    await app.init();
  });
  afterAll(async () => {
    upstream.mockRestore();
    await app.close();
  });
  test('real module resolves routes and authenticates before any upstream call', async () => {
    upstream.mockImplementation((_url, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? Response.json({
              access_token: 'fixture-token',
              token_type: 'Bearer',
              expires_in: 600,
              scope: 'billing.integration.catalog.read',
            })
          : Response.json([]),
      ),
    );
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/plans')
      .expect(401);
    expect(upstream).not.toHaveBeenCalled();
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/plans')
      .set('x-test-session', 'valid')
      .expect(200, []);
    expect(upstream).toHaveBeenCalledTimes(2);
    authority = { tenantActive: true, permissions: [] };
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/plans')
      .set('x-test-session', 'valid')
      .expect(403);
    authority = { tenantActive: false, permissions: ['billing.manage'] };
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/plans')
      .set('x-test-session', 'valid')
      .expect(403);
    authority = { tenantActive: true, permissions: ['billing.manage'] };
    session.mfaVerifiedAt = null as never;
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/plans')
      .set('x-test-session', 'valid')
      .expect(401);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  test('subscription management requires session, tenant, billing permission, MFA and CSRF before transport', async () => {
    upstream.mockClear();
    const endpoints = [
      '/api/v1/payments/subscription/cancel',
      '/api/v1/payments/subscription/change-plan',
      `/api/v1/payments/checkout-attempts/${randomUUID()}/cancel`,
    ];
    session.mfaVerifiedAt = new Date();
    authority = { tenantActive: true, permissions: ['billing.manage'] };
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/subscription')
      .expect(401);
    for (const endpoint of endpoints) {
      await request(app.getHttpServer() as Server)
        .post(endpoint)
        .set('origin', 'https://balanz.test')
        .send({})
        .expect(401);
      await request(app.getHttpServer() as Server)
        .post(endpoint)
        .set('x-test-session', 'valid')
        .send({})
        .expect(403);
      await request(app.getHttpServer() as Server)
        .post(endpoint)
        .set('x-test-session', 'valid')
        .set('origin', 'https://evil.test')
        .send({})
        .expect(403);
    }
    authority = { tenantActive: true, permissions: [] };
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/subscription')
      .set('x-test-session', 'valid')
      .expect(403);
    for (const endpoint of endpoints) {
      await request(app.getHttpServer() as Server)
        .post(endpoint)
        .set('x-test-session', 'valid')
        .set('origin', 'https://balanz.test')
        .send({})
        .expect(403);
    }
    authority = { tenantActive: false, permissions: ['billing.manage'] };
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/subscription')
      .set('x-test-session', 'valid')
      .expect(403);
    authority = { tenantActive: true, permissions: ['billing.manage'] };
    session.mfaVerifiedAt = null as never;
    for (const endpoint of endpoints) {
      await request(app.getHttpServer() as Server)
        .post(endpoint)
        .set('x-test-session', 'valid')
        .set('origin', 'https://balanz.test')
        .send({})
        .expect(401);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  test('management transport derives the tenant and buyer, preserves paid-through cancellation, and refuses stale confirmation', async () => {
    session.mfaVerifiedAt = new Date();
    authority = { tenantActive: true, permissions: ['billing.manage'] };
    const id = randomUUID();
    const idempotencyKey = randomUUID();
    const current = {
      id,
      organizationId: session.organizationId,
      productCode: paymentsConnection.productCode,
      planCode: 'professional',
      planPriceCode: 'professional_monthly',
      status: 'active',
      currentPeriodEnd: '2026-11-22T10:00:00.000Z',
      nextBillingTime: '2026-11-22T10:00:00.000Z',
      cancelAtPeriodEnd: false,
      cancellation: null,
      pendingPlanChange: null,
    };
    const scheduled = {
      ...current,
      status: 'cancelled',
      cancelAtPeriodEnd: true,
      nextBillingTime: null,
      cancellation: {
        state: 'scheduled',
        requestedAt: '2026-10-23T03:00:00.000Z',
        effectiveAt: current.currentPeriodEnd,
      },
    };
    let selected = current;
    const cancellations: unknown[] = [];
    upstream.mockImplementation((input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname.endsWith('/oauth/token'))
        return Promise.resolve(
          Response.json({
            access_token: 'fixture-management-token',
            token_type: 'Bearer',
            expires_in: 600,
            scope: 'billing.subscriptions.manage',
          }),
        );
      if (url.pathname.endsWith('/billing/subscriptions/current')) {
        expect(url.searchParams.get('organization_id')).toBe(
          session.organizationId,
        );
        expect(url.searchParams.get('product_code')).toBe(
          paymentsConnection.productCode,
        );
        return Promise.resolve(Response.json(selected));
      }
      if (url.pathname.endsWith(`/billing/subscriptions/${id}/cancel`)) {
        if (typeof init?.body !== 'string')
          throw new Error('Expected JSON fixture body');
        cancellations.push(JSON.parse(init.body) as unknown);
        return Promise.resolve(Response.json(scheduled));
      }
      throw new Error(`Unexpected fixture transport path ${url.pathname}`);
    });
    await request(app.getHttpServer() as Server)
      .get('/api/v1/payments/subscription')
      .set('x-test-session', 'valid')
      .expect(200, current);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/payments/subscription/cancel')
      .set('origin', 'https://balanz.test')
      .set('x-test-session', 'valid')
      .send({ idempotencyKey, expectedSubscriptionId: id })
      .expect(200, scheduled);
    expect(cancellations).toEqual([
      { idempotencyKey, actorUserId: session.userId },
    ]);
    selected = { ...current, id: randomUUID() };
    await request(app.getHttpServer() as Server)
      .post('/api/v1/payments/subscription/cancel')
      .set('origin', 'https://balanz.test')
      .set('x-test-session', 'valid')
      .send({ idempotencyKey, expectedSubscriptionId: id })
      .expect(409);
    expect(cancellations).toHaveLength(1);
  });
  test('checkout passes Billing provider receipts through and retries the same purchase without selecting a provider', async () => {
    session.mfaVerifiedAt = new Date();
    authority = { tenantActive: true, permissions: ['billing.manage'] };
    upstream.mockClear();
    const attemptId = randomUUID();
    const input = {
      idempotencyKey: attemptId,
      planCode: 'professional',
      planPriceCode: 'monthly',
    };
    const receipt = {
      attemptId,
      operation: 'checkout',
      status: 'ready',
      statusFresh: true,
      provider: 'stripe',
      checkoutId: randomUUID(),
      subscriptionId: randomUUID(),
      planCode: input.planCode,
      planPriceCode: input.planPriceCode,
      checkoutUrl: 'https://checkout.stripe.com/c/fixture',
      checkoutStatus: 'created',
      subscriptionStatus: 'pending',
    };
    const mutations: { path: string; body: Record<string, unknown> }[] = [];
    upstream.mockImplementation((raw, init) => {
      const url = new URL(
        typeof raw === 'string' ? raw : raw instanceof URL ? raw.href : raw.url,
      );
      const encodedBody =
        typeof init?.body === 'string'
          ? init.body
          : init?.body instanceof URLSearchParams
            ? init.body.toString()
            : '';
      if (url.pathname.endsWith('/oauth/token'))
        return Promise.resolve(
          Response.json({
            access_token: 'fixture-checkout-token',
            token_type: 'Bearer',
            expires_in: 600,
            scope: new URLSearchParams(encodedBody).get('scope') ?? '',
          }),
        );
      if (!url.pathname.includes('/payment-attempts'))
        throw new Error('Unexpected fixture path');
      if (init?.method === 'POST') {
        const body = JSON.parse(encodedBody) as Record<string, unknown>;
        mutations.push({ path: url.pathname, body });
        expect(body).not.toHaveProperty('provider');
        if (url.pathname.endsWith('/payment-attempts')) {
          expect(body.organizationId).toBe(session.organizationId);
          expect(body.userId).toBe(session.userId);
          expect(body.idempotencyKey).toBe(attemptId);
        } else {
          expect(url.searchParams.get('organizationId')).toBe(
            session.organizationId,
          );
          expect(url.searchParams.get('userId')).toBe(session.userId);
        }
      }
      return Promise.resolve(Response.json(receipt));
    });
    const server = app.getHttpServer() as Server;
    const first = await request(server)
      .post('/api/v1/payments/checkout-attempts')
      .set('x-test-session', 'valid')
      .set('origin', 'https://balanz.test')
      .send(input)
      .expect(200);
    expect(first.body).toMatchObject(receipt);
    const retried = await request(server)
      .post(`/api/v1/payments/checkout-attempts/${attemptId}/retry`)
      .set('x-test-session', 'valid')
      .set('origin', 'https://balanz.test')
      .send({})
      .expect(200);
    expect(retried.body).toMatchObject(receipt);
    expect(mutations.map(({ path }) => path)).toEqual([
      '/api/v1/billing/integrations/v1/payment-attempts',
      `/api/v1/billing/integrations/v1/payment-attempts/${attemptId}/retry`,
    ]);
    const calls = upstream.mock.calls.length;
    await request(server)
      .post('/api/v1/payments/checkout-attempts')
      .set('x-test-session', 'valid')
      .set('origin', 'https://balanz.test')
      .send({ ...input, provider: 'paypal' })
      .expect(400);
    expect(upstream).toHaveBeenCalledTimes(calls);
  });
  test('cookie mutation keeps CSRF protection and retired aliases are absent', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/payments/checkout-attempts')
      .set('x-test-session', 'valid')
      .send({})
      .expect(403);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/billing/plans')
      .expect(404);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/payments/webhooks/license')
      .send({})
      .expect(401);
  });
});
