import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PaymentsApplicationService } from '../src/modules/billing/payments-application.service';
const subject = randomUUID(),
  org = randomUUID(),
  member = randomUUID(),
  sessionId = randomUUID();
function context(session: unknown, authorization: unknown) {
  const repo = { findOne: jest.fn().mockResolvedValue(session) };
  const db = { getRepository: () => repo };
  const auth = { resolve: jest.fn().mockResolvedValue(authorization) };
  return {
    service: new PaymentsApplicationService(
      new ConfigService({ auth: { sessionIdleTtlSeconds: 1800 } }),
      db as never,
      auth as never,
      {} as never,
      {} as never,
      {} as never,
    ),
    auth,
    repo,
  };
}

const activeSession = {
  id: sessionId,
  userId: subject,
  organizationId: org,
  status: 'active',
  requiresMfa: true,
  mfaVerifiedAt: new Date(),
  expiresAt: new Date(Date.now() + 60000),
  lastActivityAt: new Date(),
};

const authority = {
  membershipId: member,
  role: 'owner',
  tenantActive: true,
  permissions: ['billing.manage'],
  mfaStatus: 'active',
};

test.each([
  null,
  { ...activeSession, expiresAt: new Date(0) },
  { ...activeSession, mfaVerifiedAt: null },
  { ...activeSession, requiresMfa: false },
  { ...activeSession, lastActivityAt: new Date(0) },
])('refuses expired or unverified session %j', async (session) => {
  const c = context(session, authority);
  await expect(
    c.service.resolveLegalContext({
      subjectId: subject,
      organizationId: org,
      purpose: 'acceptance',
      sessionId,
    }),
  ).rejects.toThrow();
  expect(c.auth.resolve).not.toHaveBeenCalled();
});

test.each([
  { ...authority, tenantActive: false },
  { ...authority, permissions: [] },
  { ...authority, mfaStatus: 'disabled' },
])('current authorization revocation denies contracting %j', async (auth) => {
  const c = context(activeSession, auth);
  await expect(
    c.service.resolveLegalContext({
      subjectId: subject,
      organizationId: org,
      purpose: 'acceptance',
      sessionId,
    }),
  ).resolves.toMatchObject({ canContract: false });
});

test('checkout validation recomputes membership permissions without requiring historical session', async () => {
  const c = context({ id: member }, authority);
  await expect(
    c.service.resolveLegalContext({
      subjectId: subject,
      organizationId: org,
      purpose: 'checkout_validation',
    }),
  ).resolves.toMatchObject({
    subjectId: subject,
    organizationId: org,
    membershipId: member,
    roles: ['owner'],
    canContract: true,
  });
  expect(c.repo.findOne).toHaveBeenCalledWith({
    where: { userId: subject, organizationId: org, status: 'active' },
  });
});

test('checkout return URLs preserve the active organization and attempt', async () => {
  const repo = {
    findOne: jest.fn().mockResolvedValue({ slug: 'punto-fiscal' }),
  };
  const service = new PaymentsApplicationService(
    new ConfigService({
      payments: {
        connection: {
          successUrl: 'http://localhost:5181',
          cancelUrl: 'http://localhost:5181',
        },
      },
    }),
    { getRepository: () => repo } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const attemptId = randomUUID();
  await expect(
    service.returnUrls(
      { organizationId: org, subjectId: subject, membershipId: member },
      attemptId,
    ),
  ).resolves.toEqual({
    successUrl: `http://localhost:5181/es/organizations/punto-fiscal/checkout/success?attemptId=${attemptId}`,
    cancelUrl: `http://localhost:5181/es/organizations/punto-fiscal/checkout/cancel?attemptId=${attemptId}`,
  });
  expect(repo.findOne).toHaveBeenCalledWith({
    where: { id: org },
    select: { slug: true },
  });
});

test('missing return URLs stop checkout before it can create a purchase', async () => {
  const service = new PaymentsApplicationService(
    new ConfigService({ payments: { connection: {} } }),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    service.returnUrls(
      { organizationId: org, subjectId: subject },
      randomUUID(),
    ),
  ).rejects.toThrow('Configura las URLs de retorno de pagos.');
});
