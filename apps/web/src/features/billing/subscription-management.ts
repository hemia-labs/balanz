import type { RenewalResume, RenewalPlanChange } from "./api";
import { isCheckoutUrl, pendingCheckoutId } from "./checkout-recovery";

export type BillingSubscription = {
  id: string;
  organizationId: string;
  productCode: string;
  planCode: string;
  planPriceCode: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  nextBillingTime: string | null;
  cancellation: {
    state: "pending" | "scheduled";
    requestedAt: string;
    effectiveAt: string | null;
  } | null;
  pendingCheckoutAttemptId?: string;
  pendingRenewal?: RenewalResume & { attemptId?: string; subscriptionId: string; checkoutUrl?: string | null };
  pendingRenewalPlanChange?: RenewalPlanChange & { attemptId?: string; checkoutId: string };
  pendingPlanChange: {
    cancellationRequested?: boolean;
    kind?: "upgrade" | "downgrade";
    amountDueNow?: string;
    currency?: string;
    action?: "approve_subscription" | "approve_payment" | "none";
    state:
      "preparing" | "awaiting_approval" | "scheduled" | "effective" | "failed";
    targetPlanCode: string;
    targetPlanPriceCode: string;
    effectiveAt: string;
    checkoutId: string | null;
    newSubscriptionId: string | null;
    attemptId?: string;
    checkoutUrl?: string | null;
  } | null;
};

export function hasPendingPlanChange(
  subscription?: BillingSubscription | null,
) {
  const state = subscription?.pendingPlanChange?.state;
  return Boolean(state && state !== "effective" && state !== "failed");
}
export function subscriptionRefreshDelay(
  subscription?: BillingSubscription | null,
  now = Date.now(),
): number | undefined {
  if (subscription?.cancellation?.state === "pending") return 5_000;
  if (subscription?.pendingRenewal && ["preparing", "awaiting_approval"].includes(subscription.pendingRenewal.state)) return 5_000;
  if (hasPendingRenewalPlanChange(subscription)) return 5_000;
  if (!hasPendingPlanChange(subscription)) return undefined;
  const change = subscription!.pendingPlanChange!;
  if (change.cancellationRequested) {
    return change.action === "approve_subscription" && isCheckoutUrl(change.checkoutUrl ?? undefined) ? undefined : 5_000;
  }
  if (change.state === "awaiting_approval") return undefined;
  if (change.state !== "scheduled") return 5_000;
  const effectiveAt = Date.parse(change.effectiveAt);
  return Number.isFinite(effectiveAt)
    ? Math.min(2_147_483_647, Math.max(5_000, effectiveAt - now + 1_000))
    : 5_000;
}
export function hasPendingRenewalPlanChange(subscription?: BillingSubscription | null) {
  const change = subscription?.pendingRenewalPlanChange;
  return Boolean(change && !["failed", "effective"].includes(change.state) &&
    (change.cancellationRequested || ["preparing", "awaiting_approval"].includes(change.state)));
}

export function canChangeRenewalPlan(subscription?: BillingSubscription | null, now = Date.now()) {
  const renewal = subscription?.pendingRenewal;
  return Boolean(subscription && renewal?.state === "scheduled" &&
    subscription.cancelAtPeriodEnd && subscription.cancellation?.state === "scheduled" &&
    Date.parse(renewal.effectiveAt) > now && !hasPendingRenewalPlanChange(subscription));
}

export function canChangeSubscription(
  subscription?: BillingSubscription | null,
) {
  return Boolean(
    subscription &&
    subscription.status === "active" &&
    !subscription.cancelAtPeriodEnd &&
    !subscription.cancellation &&
    !hasPendingPlanChange(subscription),
  );
}
export function subscriptionEnd(subscription: BillingSubscription) {
  return (
    subscription.cancellation?.effectiveAt ??
    subscription.currentPeriodEnd ??
    subscription.nextBillingTime
  );
}
export function billingDate(value: string | null | undefined) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("es-MX", {
        dateStyle: "long",
        timeZone: "America/Mexico_City",
      }).format(new Date(value))
    : "fecha pendiente de confirmar";
}

export function pendingPlanChangeHref(
  subscription: BillingSubscription, locale: string, organizationSlug: string,
): string | undefined {
  const change = subscription.pendingPlanChange;
  if (!change || (!["preparing", "awaiting_approval"].includes(change.state) &&
      !(change.state === "scheduled" && change.cancellationRequested))) return;
  if (change.attemptId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(change.attemptId))
    return `/${encodeURIComponent(locale)}/organizations/${encodeURIComponent(organizationSlug)}/checkout/success?${new URLSearchParams({ attemptId: change.attemptId })}`;
  if ((change.state === "awaiting_approval" || change.cancellationRequested) && change.action !== "none" && isCheckoutUrl(change.checkoutUrl ?? undefined))
    return change.checkoutUrl ?? undefined;
}

export function pendingSubscriptionHref(
  subscription: BillingSubscription, locale: string, organizationSlug: string,
): string | undefined {
  const attemptId = pendingCheckoutId(subscription.pendingCheckoutAttemptId ?? null);
  if (subscription.status !== "pending" || subscription.cancellation || subscription.cancelAtPeriodEnd || !attemptId) return;
  return `/${encodeURIComponent(locale)}/organizations/${encodeURIComponent(organizationSlug)}/checkout/success?${new URLSearchParams({ attemptId })}`;
}
