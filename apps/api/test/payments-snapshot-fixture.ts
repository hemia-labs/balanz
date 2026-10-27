import { randomUUID } from 'node:crypto';
import type { PaymentSnapshot } from '@hemia/payments';
import type { LocalPaymentsRow } from '../src/modules/billing/payments-local-access';
export function paymentSnapshot(
  organizationId = randomUUID(),
): PaymentSnapshot {
  const subscriptionId = randomUUID();
  const end = new Date(Date.now() + 30 * 86400000).toISOString();
  return {
    organizationId,
    productCode: 'balanz_cfdi',
    revision: '1',
    confirmedAt: new Date().toISOString(),
    license: {
      active: true,
      productCode: 'balanz_cfdi',
      planCode: 'basic',
      licenseStatus: 'active',
      validUntil: end,
      seatsLimit: 2,
      usageLimit: 100,
      subscriptionId,
      features: { upload: true },
      entitlements: { includedUsers: 2 },
    },
    subscription: {
      id: subscriptionId,
      organizationId,
      productCode: 'balanz_cfdi',
      planCode: 'basic',
      planPriceCode: 'basic-monthly',
      status: 'active',
      currentPeriodEnd: end,
      nextBillingTime: end,
      cancelAtPeriodEnd: false,
      cancellation: null,
      pendingPlanChange: null,
    },
  };
}
export function localRow(snapshot?: PaymentSnapshot): LocalPaymentsRow {
  return {
    revision: snapshot?.revision ?? null,
    license: snapshot?.license ?? null,
    subscription: snapshot?.subscription ?? null,
    snapshot_version: snapshot ? 1 : null,
    confirmed_at: snapshot?.confirmedAt ?? null,
    trial_status: null,
    trial_ends_at: null,
  };
}
