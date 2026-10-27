import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  currentPlanName,
  currentPlanStatus,
  planActionLabel,
  type CurrentAccess,
} from "./current-plan";

const access: CurrentAccess = {
  active: true,
  source: "trial",
  planCode: "old_plan",
  licenseStatus: "revoked",
  validUntil: null,
  reason: "trial_active",
};
test("a local trial takes precedence over an old revoked plan", () => {
  assert.equal(currentPlanName(access), "Prueba gratuita");
});
test("a paid plan uses its catalog name and falls back to its code", () => {
  const paid = { ...access, source: "billing" as const };
  assert.equal(
    currentPlanName(paid, [{ code: "old_plan", name: "Profesional" }]),
    "Profesional",
  );
  assert.equal(currentPlanName(paid, []), "old_plan");
});
test("distinguishes an expired trial from no contracted plan", () => {
  assert.equal(
    currentPlanName({
      ...access,
      source: null,
      planCode: null,
      reason: "trial_expired",
    }),
    "Prueba gratuita finalizada",
  );
  assert.equal(
    currentPlanName({
      ...access,
      source: null,
      planCode: null,
      reason: "not_confirmed",
    }),
    "Sin plan contratado",
  );
});

test("an old plan does not mask a trial that ended or a missing subscription", () => {
  assert.equal(
    currentPlanName({
      ...access,
      active: false,
      source: null,
      reason: "trial_expired",
    }),
    "Prueba gratuita finalizada",
  );
  assert.equal(
    currentPlanName({
      ...access,
      active: false,
      source: null,
      reason: "not_confirmed",
    }),
    "Sin plan contratado",
  );
});
test("subscription status distinguishes trial, paid, expired and missing access", () => {
  assert.equal(currentPlanStatus(access), "Período de prueba");
  assert.equal(
    currentPlanStatus({ ...access, source: "billing" }),
    "Suscripción activa",
  );
  assert.equal(
    currentPlanStatus({ ...access, active: false }),
    "Prueba finalizada",
  );
  assert.equal(
    currentPlanStatus({
      ...access,
      active: false,
      source: null,
      reason: "trial_expired",
    }),
    "Prueba finalizada",
  );
  assert.equal(
    currentPlanStatus({
      ...access,
      active: false,
      source: null,
      reason: "not_confirmed",
    }),
    "Sin suscripción vigente",
  );
  assert.equal(
    currentPlanStatus({ ...access, active: false, source: "billing" }),
    "Sin suscripción vigente",
  );
});

test("plan actions distinguish trial upgrade, starting and existing paid subscriptions", () => {
  assert.equal(planActionLabel(access, "new_plan", false), "Actualizar plan");
  assert.equal(planActionLabel(access, "new_plan", true), "Plan seleccionado");
  assert.equal(
    planActionLabel(
      { ...access, source: null, active: false },
      "new_plan",
      false,
    ),
    "Comenzar",
  );
  assert.equal(planActionLabel(undefined, "new_plan", false), "Comenzar");
  const paid = { ...access, source: "billing" as const };
  assert.equal(planActionLabel(paid, "old_plan", false), "Plan actual");
  assert.equal(planActionLabel(paid, "new_plan", true), "Plan seleccionado");
});

test("a paid subscription offers a plan change without preselecting it", () => {
  const paid = { ...access, source: "billing" as const };
  assert.equal(planActionLabel(paid, "new_plan", false), "Cambiar plan");
});

import {
  billingDate,
  canChangeSubscription,
  hasPendingPlanChange,
  subscriptionEnd,
  subscriptionRefreshDelay,
  pendingPlanChangeHref,
  pendingSubscriptionHref,
  type BillingSubscription,
} from "./subscription-management";
const subscription: BillingSubscription = {
  id: "subscription",
  organizationId: "org",
  productCode: "balanz_cfdi",
  planCode: "professional",
  planPriceCode: "monthly",
  status: "active",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "2026-11-22T10:00:00.000Z",
  nextBillingTime: "2026-11-22T10:00:00.000Z",
  cancellation: null,
  pendingPlanChange: null,
};
test("allows plan changes only for an active renewing subscription", () => {
  assert.equal(canChangeSubscription(subscription), true);
  assert.equal(canChangeSubscription(null), false);
  assert.equal(
    canChangeSubscription({ ...subscription, status: "past_due" }),
    false,
  );
  assert.equal(
    canChangeSubscription({ ...subscription, cancelAtPeriodEnd: true }),
    false,
  );
  assert.equal(
    canChangeSubscription({
      ...subscription,
      cancellation: { state: "pending", requestedAt: "now", effectiveAt: null },
    }),
    false,
  );
});
test("a pending change blocks another transition until failed or effective", () => {
  const pending = {
    ...subscription,
    pendingPlanChange: {
      state: "scheduled" as const,
      effectiveAt: subscription.currentPeriodEnd!,
      targetPlanCode: "business",
      targetPlanPriceCode: "monthly",
      checkoutId: "checkout",
      newSubscriptionId: "subscription",
    },
  };
  assert.equal(hasPendingPlanChange(pending), true);
  assert.equal(canChangeSubscription(pending), false);
  assert.equal(
    canChangeSubscription({
      ...pending,
      pendingPlanChange: { ...pending.pendingPlanChange, state: "failed" },
    }),
    true,
  );
});
test("paid-through cancellation dates take precedence and malformed dates are honest", () => {
  assert.equal(
    subscriptionEnd({
      ...subscription,
      cancellation: {
        state: "scheduled",
        requestedAt: "now",
        effectiveAt: "2026-12-01T10:00:00Z",
      },
    }),
    "2026-12-01T10:00:00Z",
  );
  assert.equal(billingDate("bad"), "fecha pendiente de confirmar");
  assert.equal(billingDate(null), "fecha pendiente de confirmar");
  assert.equal(
    billingDate(subscriptionEnd(subscription)),
    "22 de noviembre de 2026",
  );
});

test("refreshes only while a plan change or cancellation awaits completion", () => {
  assert.equal(subscriptionRefreshDelay(undefined), undefined);
  assert.equal(subscriptionRefreshDelay(null), undefined);
  assert.equal(subscriptionRefreshDelay(subscription), undefined);
  for (const state of ["pending", "scheduled"] as const) {
    assert.equal(
      subscriptionRefreshDelay({
        ...subscription,
        cancelAtPeriodEnd: true,
        cancellation: { state, requestedAt: "now", effectiveAt: null },
      }),
      state === "pending" ? 5_000 : undefined,
    );
  }
  for (const state of [
    "preparing",
    "awaiting_approval",
    "scheduled",
    "effective",
    "failed",
  ] as const) {
    assert.equal(
      subscriptionRefreshDelay({
        ...subscription,
        pendingPlanChange: {
          state,
          targetPlanCode: "business",
          targetPlanPriceCode: "monthly",
          effectiveAt: subscription.currentPeriodEnd!,
          checkoutId: null,
          newSubscriptionId: null,
        },
      }, Date.parse(subscription.currentPeriodEnd!) + 1),
      state === "awaiting_approval" || state === "effective" || state === "failed" ? undefined : 5_000,
    );
  }
});

test("pending plan changes continue through their durable attempt after browser state is lost", () => {
  const attemptId = "11111111-1111-4111-8111-111111111111";
  const pending = { ...subscription, pendingPlanChange: {
    state: "awaiting_approval" as const, targetPlanCode: "business", targetPlanPriceCode: "monthly",
    effectiveAt: "2026-11-22T10:00:00Z", checkoutId: null, newSubscriptionId: null,
    attemptId, action: "approve_payment" as const, checkoutUrl: null,
  } };
  assert.equal(pendingPlanChangeHref(pending, "es", "despacho / uno"),
    `/es/organizations/despacho%20%2F%20uno/checkout/success?attemptId=${attemptId}`);
  assert.equal(pendingPlanChangeHref({ ...pending, pendingPlanChange: { ...pending.pendingPlanChange, state: "preparing" } }, "es", "org"),
    `/es/organizations/org/checkout/success?attemptId=${attemptId}`);
  const legacy = { ...pending, pendingPlanChange: { ...pending.pendingPlanChange, attemptId: undefined, checkoutUrl: "https://www.paypal.com/checkoutnow?token=test" } };
  assert.equal(pendingPlanChangeHref(legacy, "es", "org"), legacy.pendingPlanChange.checkoutUrl);
  const providerUrl = "https://checkout.provider.example/authorize";
  assert.equal(pendingPlanChangeHref({ ...legacy, pendingPlanChange: { ...legacy.pendingPlanChange, checkoutUrl: providerUrl } }, "es", "org"), providerUrl);
  for (const checkoutUrl of [null, "http://checkout.provider.test", "https://user:pass@checkout.provider.test"]) {
    assert.equal(pendingPlanChangeHref({ ...legacy, pendingPlanChange: { ...legacy.pendingPlanChange, checkoutUrl } }, "es", "org"), undefined);
  }
  assert.equal(pendingPlanChangeHref({ ...legacy, pendingPlanChange: { ...legacy.pendingPlanChange, action: "none" } }, "es", "org"), undefined);
  for (const state of ["scheduled", "effective", "failed"] as const) {
    assert.equal(pendingPlanChangeHref({ ...pending, pendingPlanChange: { ...pending.pendingPlanChange, state } }, "es", "org"), undefined);
  }
  assert.equal(pendingPlanChangeHref(subscription, "es", "org"), undefined);
});


test("future scheduled changes wait until their effective date instead of polling every five seconds", () => {
  const now = Date.parse("2026-10-23T00:00:00Z");
  const scheduled = { ...subscription, pendingPlanChange: {
    state: "scheduled" as const, targetPlanCode: "business", targetPlanPriceCode: "monthly",
    effectiveAt: "2026-10-24T00:00:00Z", checkoutId: null, newSubscriptionId: null,
  } };
  assert.equal(subscriptionRefreshDelay(scheduled, now), 86_401_000);
  assert.equal(subscriptionRefreshDelay(scheduled, now + 86_400_000), 5_000);
  assert.equal(subscriptionRefreshDelay({ ...scheduled, pendingPlanChange: {
    ...scheduled.pendingPlanChange, effectiveAt: "2099-01-01T00:00:00Z",
  } }, now), 2_147_483_647);
  assert.equal(subscriptionRefreshDelay({ ...scheduled, cancellation: {
    state: "pending", requestedAt: "2026-10-23T00:00:00Z", effectiveAt: null,
  } }, now), 5_000);
});

test("pending purchases remain recoverable after a PayPal return without allowing duplicate contracts", () => {
  const attemptId = "11111111-1111-4111-8111-111111111111";
  const pending = { ...subscription, status: "pending", pendingCheckoutAttemptId: attemptId };
  assert.equal(canChangeSubscription(pending), false);
  assert.equal(pendingSubscriptionHref(pending, "es", "despacho / uno"),
    `/es/organizations/despacho%20%2F%20uno/checkout/success?attemptId=${attemptId}`);
  for (const status of ["active", "cancelled", "expired", "past_due", "suspended"]) {
    assert.equal(pendingSubscriptionHref({ ...pending, status }, "es", "org"), undefined);
  }
  for (const pendingCheckoutAttemptId of [undefined, "", "https://evil.test", "../other"]) {
    assert.equal(pendingSubscriptionHref({ ...pending, pendingCheckoutAttemptId }, "es", "org"), undefined);
  }
});

test("pending purchase cannot resume while cancellation is being confirmed", () => {
  const pending = { ...subscription, status: "pending", pendingCheckoutAttemptId: "11111111-1111-4111-8111-111111111111" };
  assert.equal(pendingSubscriptionHref({ ...pending, cancelAtPeriodEnd: true }, "es", "org"), undefined);
  for (const state of ["pending", "scheduled"] as const) {
    assert.equal(pendingSubscriptionHref({ ...pending, cancellation: { state, requestedAt: "now", effectiveAt: null } }, "es", "org"), undefined);
  }
});

test("scheduled downgrade cancellation remains recoverable and keeps plan selection locked until restoration completes", () => {
  const pending = { ...subscription, pendingPlanChange: { state: "scheduled" as const,
    targetPlanCode: "professional", targetPlanPriceCode: "monthly", effectiveAt: "2026-11-26T10:00:00Z",
    checkoutId: "11111111-1111-4111-8111-111111111111", newSubscriptionId: null,
    attemptId: "11111111-1111-4111-8111-111111111111", cancellationRequested: true,
    action: "approve_subscription" as const, checkoutUrl: "https://www.sandbox.paypal.com/restore" } };
  assert.equal(canChangeSubscription(pending), false);
  assert.equal(pendingPlanChangeHref(pending, "es", "org"), "/es/organizations/org/checkout/success?attemptId=11111111-1111-4111-8111-111111111111");
  assert.equal(subscriptionRefreshDelay(pending), undefined);
  assert.equal(subscriptionRefreshDelay({ ...pending, pendingPlanChange: { ...pending.pendingPlanChange, checkoutUrl: null } }), 5_000);
  assert.equal(canChangeSubscription({ ...pending, pendingPlanChange: { ...pending.pendingPlanChange, state: "failed" } }), true);
});

import { canChangeRenewalPlan, hasPendingRenewalPlanChange } from "./subscription-management";
test("allows selecting the next renewal plan while preserving the cancelled paid source", () => {
  const source = { id: "source", organizationId: "org", productCode: "balanz", planCode: "despacho", planPriceCode: "monthly", status: "cancelled",
    cancelAtPeriodEnd: true, currentPeriodEnd: "2030-11-26T10:00:00Z", nextBillingTime: null,
    cancellation: { state: "scheduled" as const, requestedAt: "2030-10-26T10:00:00Z", effectiveAt: "2030-11-26T10:00:00Z" }, pendingPlanChange: null,
    pendingRenewal: { state: "scheduled" as const, sourceSubscriptionId: "source", subscriptionId: "future", effectiveAt: "2030-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "999.00", currency: "MXN" } };
  const now = Date.parse("2030-10-26T10:00:00Z");
  assert.equal(canChangeRenewalPlan(source, now), true);
  assert.equal(canChangeSubscription(source), false);
  assert.equal(canChangeRenewalPlan(source, Date.parse(source.currentPeriodEnd)), false);
  assert.equal(canChangeRenewalPlan({ ...source, pendingRenewal: { ...source.pendingRenewal, state: "awaiting_approval" } }, now), false);
  const change = { state: "awaiting_approval" as const, sourceSubscriptionId: "source", renewalSubscriptionId: "future", targetPlanCode: "professional", targetPlanPriceCode: "monthly", effectiveAt: source.currentPeriodEnd, amountDueNow: "0.00", recurringAmount: "499.00", currency: "MXN", cancellationRequested: false, action: "approve_subscription" as const, checkoutUrl: null, checkoutId: "checkout" };
  assert.equal(hasPendingRenewalPlanChange({ ...source, pendingRenewalPlanChange: change }), true);
  assert.equal(canChangeRenewalPlan({ ...source, pendingRenewalPlanChange: change }, now), false);
  assert.equal(subscriptionRefreshDelay({ ...source, pendingRenewalPlanChange: change }, now), 5000);
  const confirmed = { ...change, state: "scheduled" as const, action: "none" as const };
  assert.equal(canChangeRenewalPlan({ ...source, pendingRenewalPlanChange: confirmed }, now), true);
  assert.equal(canChangeRenewalPlan({ ...source, pendingRenewalPlanChange: { ...confirmed, cancellationRequested: true } }, now), false);
  assert.equal(source.planCode, "despacho");
});
