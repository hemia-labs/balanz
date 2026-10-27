import { snapshotAccess, type PaymentSnapshot } from '@hemia/payments';
import type { LicenseAccess } from '@hemia/payments/nestjs';

export type LocalPaymentsRow = {
  revision: string | null;
  license: unknown;
  subscription: unknown;
  snapshot_version: number | null;
  confirmed_at: Date | string | null;
  trial_status: string | null;
  trial_ends_at: Date | string | null;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inactive = (): LicenseAccess => ({
  ...snapshotAccess(null),
  reason: 'billing_inactive',
});

export function localPaidAccess(
  row: LocalPaymentsRow,
  organizationId: string,
  productCode: string,
): LicenseAccess {
  if (!row.revision || !row.confirmed_at) return snapshotAccess(null);
  const timestamp = new Date(row.confirmed_at).getTime();
  if (!Number.isFinite(timestamp)) return inactive();
  const confirmedAt = new Date(timestamp).toISOString();
  if (row.snapshot_version === 1) {
    try {
      return snapshotAccess({
        organizationId,
        productCode,
        revision: row.revision,
        confirmedAt,
        license: row.license as PaymentSnapshot['license'],
        subscription: row.subscription as PaymentSnapshot['subscription'],
      });
    } catch {
      return inactive();
    }
  }
  // Only pre-migration, authenticated license copies lack a contractual subscription snapshot.
  // Never use this path for a newer malformed or revoked snapshot.
  if (
    row.snapshot_version !== 0 ||
    !record(row.license) ||
    !/^[1-9][0-9]*$/.test(row.revision)
  )
    return inactive();
  const license = row.license;
  const confirmation = Date.parse(confirmedAt);
  const endDate = license.validUntil;
  if (
    license.productCode !== productCode ||
    typeof license.active !== 'boolean' ||
    !['active', 'grace', 'suspended', 'revoked', 'expired'].includes(
      String(license.licenseStatus),
    ) ||
    (license.planCode !== null &&
      (typeof license.planCode !== 'string' ||
        !license.planCode ||
        license.planCode.length > 100)) ||
    (license.subscriptionId !== null &&
      (typeof license.subscriptionId !== 'string' ||
        !uuid.test(license.subscriptionId))) ||
    (endDate !== null &&
      (typeof endDate !== 'string' || !Number.isFinite(Date.parse(endDate)))) ||
    !Number.isSafeInteger(license.seatsLimit) ||
    Number(license.seatsLimit) < 0 ||
    (license.usageLimit !== null &&
      (!Number.isSafeInteger(license.usageLimit) ||
        Number(license.usageLimit) < 0)) ||
    !record(license.features) ||
    (license.entitlements !== undefined && !record(license.entitlements)) ||
    !Number.isFinite(confirmation) ||
    confirmation > Date.now() + 300000 ||
    (license.active && (!license.subscriptionId || !license.planCode))
  )
    return inactive();
  const end = Math.min(
    confirmation + 86400000,
    endDate === null ? Infinity : Date.parse(endDate),
  );
  const active =
    license.active &&
    ['active', 'grace'].includes(String(license.licenseStatus)) &&
    end > Date.now();
  return {
    active,
    source: active ? 'billing' : null,
    validUntil: active ? new Date(end).toISOString() : null,
    confirmedAt,
    subscriptionId: license.subscriptionId,
    planCode: license.planCode,
    licenseStatus: String(license.licenseStatus),
    reason: active
      ? 'active'
      : license.active && end <= Date.now()
        ? 'confirmation_expired'
        : 'billing_inactive',
    entitlements: active
      ? { ...(license.entitlements ?? {}), features: license.features }
      : {},
  };
}

export function localRenewalAt(
  row: LocalPaymentsRow,
  paid: LicenseAccess,
): string | null {
  if (!paid.active || row.snapshot_version !== 1 || !record(row.subscription))
    return null;
  const sub = row.subscription;
  if (
    sub.id !== paid.subscriptionId ||
    sub.planCode !== paid.planCode ||
    sub.status !== 'active' ||
    sub.cancelAtPeriodEnd !== false ||
    sub.cancellation
  )
    return null;
  const next = sub.nextBillingTime;
  return typeof next === 'string' &&
    Number.isFinite(Date.parse(next)) &&
    Date.parse(next) > Date.now()
    ? next
    : null;
}
