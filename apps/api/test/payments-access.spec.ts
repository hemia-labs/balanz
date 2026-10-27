import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { snapshotAccess, type PaymentSnapshot } from '@hemia/payments';
import type { PaymentsContext, LicenseAccess } from '@hemia/payments/nestjs';
import {
  PaymentsAccessService,
  BillingAccessGuard,
  withTrial,
} from '../src/modules/billing/payments-access.service';
import {
  localPaidAccess,
  type LocalPaymentsRow,
} from '../src/modules/billing/payments-local-access';
import { paymentSnapshot, localRow } from './payments-snapshot-fixture';

function fixture(row = localRow()) {
  const context: PaymentsContext = {
    organizationId: randomUUID(),
    subjectId: randomUUID(),
    membershipId: randomUUID(),
  };
  const query = jest
    .fn<Promise<LocalPaymentsRow[]>, unknown[]>()
    .mockResolvedValue([row]);
  const run = jest.fn(
    (_scope: unknown, work: (manager: EntityManager) => Promise<unknown>) =>
      work({ query } as unknown as EntityManager),
  );
  const payments = {
    options: { connection: { productCode: 'balanz_cfdi' } },
    getLicense: jest
      .fn()
      .mockRejectedValue(new ServiceUnavailableException('Billing offline')),
    getSnapshot: jest
      .fn<Promise<PaymentSnapshot>, unknown[]>()
      .mockRejectedValue(new ServiceUnavailableException('Billing offline')),
  };
  const apply = jest.fn().mockResolvedValue({ applied: true });
  const service = new PaymentsAccessService(
    payments as never,
    { run } as never,
    { apply } as never,
  );
  return { context, row, query, run, payments, apply, service };
}
function paidFixture() {
  const f = fixture();
  const snapshot = paymentSnapshot(f.context.organizationId);
  Object.assign(f.row, localRow(snapshot));
  return { ...f, snapshot };
}

test('trial remains independent from Billing outages and never appears for an absent or expired trial', async () => {
  const f = fixture();
  f.row.trial_status = 'trialing';
  f.row.trial_ends_at = new Date(Date.now() + 60000);
  expect(await f.service.get(f.context)).toMatchObject({
    active: true,
    source: 'trial',
    reason: 'trial_active',
  });
  await expect(f.service.sync(f.context)).rejects.toThrow('Billing offline');
  expect(await f.service.get(f.context)).toMatchObject({
    active: true,
    source: 'trial',
  });
  expect(f.payments.getLicense).not.toHaveBeenCalled();
  f.row.trial_ends_at = new Date(0);
  expect(await f.service.get(f.context)).toMatchObject({
    active: false,
    reason: 'trial_expired',
  });
  f.row.trial_status = 'pending';
  f.row.trial_ends_at = new Date(Date.now() + 60000);
  expect((await f.service.get(f.context)).active).toBe(false);
});
test('local paid copy takes precedence, preserves exact access and renewal while Billing is unavailable', async () => {
  const f = paidFixture();
  f.row.trial_status = 'trialing';
  f.row.trial_ends_at = new Date(Date.now() + 60000);
  expect(await f.service.get(f.context)).toMatchObject({
    active: true,
    source: 'billing',
    planCode: 'basic',
    subscriptionId: f.snapshot.subscription!.id,
    renewalAt: f.snapshot.subscription!.nextBillingTime,
    entitlements: { includedUsers: 2, features: { upload: true } },
  });
  expect(f.payments.getLicense).not.toHaveBeenCalled();
  expect(f.payments.getSnapshot).not.toHaveBeenCalled();
});
test('copy and trial reads bind organization, active membership and authenticated buyer under RLS', async () => {
  const f = fixture();
  await f.service.get(f.context);
  expect(f.run).toHaveBeenCalledWith(
    {
      organizationId: f.context.organizationId,
      membershipId: f.context.membershipId,
    },
    expect.any(Function),
  );
  expect(f.query).toHaveBeenCalledWith(
    expect.stringContaining(
      "m.user_id=$3 AND m.status='active' AND o.status='active'",
    ),
    [
      f.context.organizationId,
      f.context.membershipId,
      f.context.subjectId,
      'balanz_cfdi',
    ],
  );
  await expect(
    f.service.get({ ...f.context, membershipId: undefined }),
  ).rejects.toThrow('Active membership required');
  f.query.mockResolvedValue([]);
  await expect(f.service.get(f.context)).rejects.toThrow(
    'Active membership required',
  );
});
test.each([
  ['old confirmation', -25 * 3600000, 86400000],
  ['expired license', 0, -1],
])(
  'paid confirmation fails closed at its real boundary: %s',
  async (_name, confirmedDelta, expiryDelta) => {
    const f = paidFixture();
    const license = {
      ...f.snapshot.license,
      validUntil: new Date(Date.now() + expiryDelta).toISOString(),
    };
    f.row.license = license;
    f.row.confirmed_at = new Date(Date.now() + confirmedDelta);
    expect(await f.service.get(f.context)).toMatchObject({
      active: false,
      reason: 'confirmation_expired',
    });
    f.row.trial_status = 'trialing';
    f.row.trial_ends_at = new Date(Date.now() + 60000);
    expect((await f.service.get(f.context)).source).toBe('trial');
  },
);
test('only marker-zero authenticated historical copies can use license-only access, within the same TTL', async () => {
  const f = paidFixture();
  f.row.snapshot_version = 0;
  f.row.subscription = null;
  expect((await f.service.get(f.context)).source).toBe('billing');
  expect((await f.service.get(f.context)).renewalAt).toBeNull();
  f.row.snapshot_version = 1;
  expect((await f.service.get(f.context)).active).toBe(false);
  f.row.snapshot_version = 0;
  f.row.confirmed_at = new Date(Date.now() - 25 * 3600000);
  expect((await f.service.get(f.context)).reason).toBe('confirmation_expired');
});
test('new revocations, corrupt copies and unknown formats never fall back to historical paid access', async () => {
  const f = paidFixture();
  f.row.license = {
    ...f.snapshot.license,
    active: false,
    licenseStatus: 'revoked',
  };
  f.row.subscription = null;
  expect((await f.service.get(f.context)).active).toBe(false);
  f.row.license = f.snapshot.license;
  f.row.snapshot_version = 2;
  expect((await f.service.get(f.context)).active).toBe(false);
  f.row.snapshot_version = 1;
  f.row.confirmed_at = 'corrupt';
  f.row.trial_status = 'trialing';
  f.row.trial_ends_at = new Date(Date.now() + 60000);
  expect((await f.service.get(f.context)).source).toBe('trial');
});
test('a pending upgrade preserves the current paid plan and cancellation removes renewal only', async () => {
  const f = paidFixture();
  f.row.subscription = {
    ...f.snapshot.subscription!,
    pendingPlanChange: {
      state: 'awaiting_approval',
      targetPlanCode: 'pro',
      targetPlanPriceCode: 'pro-monthly',
      checkoutId: randomUUID(),
      newSubscriptionId: f.snapshot.subscription!.id,
      effectiveAt: new Date().toISOString(),
    },
  };
  expect(await f.service.get(f.context)).toMatchObject({
    active: true,
    planCode: 'basic',
    source: 'billing',
  });
  f.row.subscription = {
    ...f.snapshot.subscription!,
    status: 'cancelled',
    cancelAtPeriodEnd: true,
  };
  expect(await f.service.get(f.context)).toMatchObject({
    active: true,
    renewalAt: null,
  });
});
test('explicit sync applies outside the read transaction, then rereads the winning local revision', async () => {
  const f = paidFixture();
  f.payments.getSnapshot.mockResolvedValue(f.snapshot);
  f.apply.mockImplementation(() => {
    f.row.license = {
      ...f.snapshot.license,
      active: false,
      licenseStatus: 'revoked',
    };
    f.row.subscription = null;
    return Promise.resolve({ applied: false });
  });
  expect((await f.service.sync(f.context)).active).toBe(false);
  expect(f.apply).toHaveBeenCalledWith(f.snapshot, f.context.organizationId);
  expect(f.run).toHaveBeenCalledTimes(2);
});
test('withTrial preserves paid priority and the SDK expiry reason after the local trial ends', () => {
  const inactive = snapshotAccess(null);
  const trial = {
    status: 'trialing',
    trial_ends_at: new Date(Date.now() + 60000),
  };
  const paid: LicenseAccess = {
    ...inactive,
    active: true,
    source: 'billing',
    reason: 'active',
  };
  expect(withTrial(paid, trial)).toBe(paid);
  expect(
    withTrial({ ...inactive, reason: 'confirmation_expired' }, trial).source,
  ).toBe('trial');
  expect(
    withTrial(
      { ...inactive, reason: 'confirmation_expired' },
      trial,
      Date.now() + 60001,
    ).reason,
  ).toBe('confirmation_expired');
  expect(
    localPaidAccess(
      {
        ...localRow(),
        revision: '0',
        license: {},
        confirmed_at: new Date(),
        snapshot_version: 0,
      },
      randomUUID(),
      'balanz_cfdi',
    ).active,
  ).toBe(false);
});
test('fiscal guard passes authenticated subject, membership and tenant to the local access gate', async () => {
  const session = {
    id: randomUUID(),
    userId: randomUUID(),
    organizationId: randomUUID(),
    membershipId: randomUUID(),
  };
  const assert = jest.fn();
  await new BillingAccessGuard({ assert } as never).canActivate({
    switchToHttp: () => ({ getRequest: () => ({ authSession: session }) }),
  } as never);
  expect(assert).toHaveBeenCalledWith({
    organizationId: session.organizationId,
    membershipId: session.membershipId,
    subjectId: session.userId,
    sessionId: session.id,
  });
});
