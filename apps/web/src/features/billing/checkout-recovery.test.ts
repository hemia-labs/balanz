import assert from "node:assert/strict";
import test from "node:test";
import {
  canStartNewCheckout,
  createCheckoutDraft,
  readCheckoutDraft,
  checkoutFailureMessage,
  isCheckoutTerminal,
  isPlanChangeCancelled,
  isCheckoutAccessActive,
  pendingCheckoutId,
  pendingCheckoutKey,
} from "./checkout-recovery";

test("permite otro intento sólo después de confirmar un estado terminal en Billing", () => {
  for (const checkoutStatus of ["cancelled", "expired", "failed"]) {
    assert.equal(isCheckoutTerminal({ checkoutStatus }), true);
    assert.equal(
      canStartNewCheckout({ checkoutStatus, statusFresh: false }),
      false,
    );
    assert.equal(
      canStartNewCheckout({ checkoutStatus, statusFresh: true }),
      true,
    );
  }
  for (const checkoutStatus of ["created", "pending", "approved"]) {
    assert.equal(
      canStartNewCheckout({ checkoutStatus, statusFresh: true }),
      false,
    );
  }
  assert.equal(
    canStartNewCheckout({
      subscriptionStatus: "active",
      checkoutStatus: "cancelled",
      statusFresh: true,
    }),
    false,
  );
  assert.equal(
    canStartNewCheckout({ subscriptionStatus: "expired", statusFresh: true }),
    true,
  );
});

test("un nuevo intento para la misma aceptación cambia la clave y descarta el checkout anterior", () => {
  const original = {
    ...createCheckoutDraft("acceptance"),
    attemptId: "previous",
  };
  const replacement = createCheckoutDraft(original.legalAcceptanceId);
  assert.notEqual(replacement.idempotencyKey, original.idempotencyKey);
  assert.equal(replacement.legalAcceptanceId, original.legalAcceptanceId);
  assert.equal("attemptId" in replacement, false);
  assert.match(replacement.idempotencyKey, /^[0-9a-f-]{36}$/);
});

test("confirma la compra sólo cuando Balanz recibió la licencia de esa suscripción y plan", () => {
  const attempt = {
    subscriptionStatus: "active",
    subscriptionId: "new-subscription",
    planCode: "professional",
  };
  const access = {
    active: true,
    source: "billing",
    subscriptionId: "new-subscription",
    planCode: "professional",
  };
  assert.equal(isCheckoutAccessActive(attempt, access), true);
  assert.equal(isCheckoutAccessActive(attempt, undefined), false);
  assert.equal(
    isCheckoutAccessActive(attempt, { ...access, source: "trial" }),
    false,
  );
  assert.equal(
    isCheckoutAccessActive(attempt, { ...access, active: false }),
    false,
  );
  assert.equal(
    isCheckoutAccessActive(attempt, {
      ...access,
      subscriptionId: "old-subscription",
    }),
    false,
  );
  assert.equal(
    isCheckoutAccessActive(attempt, { ...access, planCode: "other-plan" }),
    false,
  );
  assert.equal(
    isCheckoutAccessActive(
      { ...attempt, subscriptionStatus: "pending" },
      access,
    ),
    false,
  );
  assert.equal(
    isCheckoutAccessActive({ subscriptionStatus: "active" }, access),
    false,
  );
});

test("pending checkout tracking validates IDs and isolates organization and account", () => {
  const id = "7a8065b2-e4eb-4e83-88c6-58c2c75bbca7";
  assert.equal(pendingCheckoutId(id), id);
  for (const invalid of [null, "", "other", "https://example.com", `../${id}`])
    assert.equal(pendingCheckoutId(invalid), undefined);
  assert.notEqual(
    pendingCheckoutKey("org-a", "user-a"),
    pendingCheckoutKey("org-b", "user-a"),
  );
  assert.notEqual(
    pendingCheckoutKey("org-a", "user-a"),
    pendingCheckoutKey("org-a", "user-b"),
  );
});

import { isPlanChangeScheduled } from "./checkout-recovery";
test("a scheduled change requires a fresh confirmation and a valid effective date", () => {
  const change = {
    subscriptionStatus: "pending",
    statusFresh: true,
    planChange: { state: "scheduled", effectiveAt: "2026-11-22T10:00:00Z" },
  };
  assert.equal(isPlanChangeScheduled(change), true);
  assert.equal(isPlanChangeScheduled({ ...change, statusFresh: false }), false);
  assert.equal(
    isPlanChangeScheduled({
      ...change,
      planChange: { ...change.planChange, state: "awaiting_approval" },
    }),
    false,
  );
  assert.equal(
    isPlanChangeScheduled({
      ...change,
      planChange: { ...change.planChange, effectiveAt: "invalid" },
    }),
    false,
  );
});

import { isCheckoutUrl } from "./checkout-recovery";
test("approval recovery validates HTTPS safety without selecting a payment provider", () => {
  assert.equal(
    isCheckoutUrl(
      "https://www.paypal.com/webapps/billing/subscriptions?ba_token=test",
    ),
    true,
  );
  assert.equal(
    isCheckoutUrl(
      "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=test",
    ),
    true,
  );
  assert.equal(isCheckoutUrl("https://payments.example.test/approve?session=provider-defined"), true);
  assert.equal(isCheckoutUrl("https://checkout.other-provider.example:443/session#continue"), true);
  for (const url of [
    undefined,
    "javascript:alert(1)",
    "http://www.paypal.com",
    "/checkout?url=https://payments.example.test",
    "//payments.example.test/approve",
    "https:payments.example.test/approve",
    "https:///payments.example.test/approve",
    " https://payments.example.test/approve",
    "https://payments.example.test/approve\n",
    "https://payments.example.test\\@evil.test/approve",
    "https://www.paypal.com@evil.test",
    "https://user:pass@www.paypal.com",
    "https://www.paypal.com:8080",
  ])
    assert.equal(isCheckoutUrl(url), false);
});

import { isCheckoutApprovalConfirmed } from "./checkout-recovery";
test("an existing active contract cannot confirm approval of a new plan", () => {
  const awaiting = {
    subscriptionStatus: "active",
    planChange: {
      state: "awaiting_approval",
      effectiveAt: "2026-11-22T10:00:00Z",
    },
  };
  assert.equal(isCheckoutApprovalConfirmed(awaiting, true), false);
  assert.equal(isCheckoutApprovalConfirmed(awaiting, false), true);
  assert.equal(
    isCheckoutApprovalConfirmed(
      {
        ...awaiting,
        planChange: { ...awaiting.planChange, state: "scheduled" },
      },
      true,
    ),
    true,
  );
  assert.equal(
    isCheckoutTerminal({
      ...awaiting,
      planChange: { ...awaiting.planChange, state: "failed" },
    }),
    true,
  );
});

test("same-plan price changes cannot activate from the old license before their effective cycle", () => {
  const attempt = {
    subscriptionStatus: "active",
    subscriptionId: "sub",
    planCode: "professional",
    planChange: { state: "scheduled", effectiveAt: "2026-11-22T10:00:00Z" },
  };
  const access = {
    active: true,
    source: "billing",
    subscriptionId: "sub",
    planCode: "professional",
  };
  assert.equal(isCheckoutAccessActive(attempt, access), false);
  assert.equal(
    isCheckoutAccessActive(
      { ...attempt, planChange: { ...attempt.planChange, state: "effective" } },
      access,
    ),
    true,
  );
});


import { checkoutActionUrl } from "./checkout-recovery";
test("proration approval keeps old license inactive and exposes only the current payment action", () => {
  const subscriptionUrl = "https://www.sandbox.paypal.com/subscriptions/approve?ba_token=old";
  const paymentUrl = "https://www.sandbox.paypal.com/checkoutnow?token=order";
  const attempt = {
    subscriptionStatus: "active",
    subscriptionId: "sub",
    planCode: "pro",
    checkoutUrl: subscriptionUrl,
    planChange: {
      state: "awaiting_approval",
      effectiveAt: "2026-10-23T00:00:00Z",
      action: "approve_payment" as const,
      checkoutUrl: paymentUrl,
    },
  };
  assert.equal(checkoutActionUrl(attempt), paymentUrl);
  assert.equal(isCheckoutApprovalConfirmed(attempt, true), false);
  assert.equal(isCheckoutAccessActive(attempt, {
    active: true, source: "billing", subscriptionId: "sub", planCode: "pro",
  }), false);
  assert.equal(checkoutActionUrl({ ...attempt, planChange: {
    ...attempt.planChange, checkoutUrl: null,
  } }), undefined);
  assert.equal(checkoutActionUrl({ ...attempt, planChange: {
    ...attempt.planChange, action: "none",
  } }), undefined);
  for (const state of ["effective", "scheduled", "failed"]) {
    assert.equal(checkoutActionUrl({ ...attempt, planChange: {
      ...attempt.planChange, state,
    } }), undefined);
  }
  assert.equal(checkoutActionUrl({ ...attempt, planChange: {
    ...attempt.planChange, checkoutUrl: "https://checkout.provider.test:8080/pay",
  } }), undefined);
});


test("authoritative rejection permits reviewing a new quote; ambiguous outcomes keep the same attempt", () => {
  assert.equal(canStartNewCheckout({ status: "rejected" }), true);
  // An existing paid contract is compatible with a rejected change request.
  assert.equal(canStartNewCheckout({ status: "rejected", subscriptionStatus: "active" }), true);
  for (const status of ["pending", "processing", "ready"]) {
    assert.equal(canStartNewCheckout({ status, statusFresh: false }), false);
    assert.equal(canStartNewCheckout({ status, subscriptionStatus: "active", statusFresh: true }), false);
  }
});


import { shouldMonitorBillingAccess } from "./checkout-recovery";
test("plans own their access read while the global notice preserves pending-checkout recovery", () => {
  for (const path of ["/es/organizations/punto-fiscal/settings/billing-plan", "/es/organizations/otro/settings/billing-plan/"]) {
    assert.equal(shouldMonitorBillingAccess(path), false);
    assert.equal(shouldMonitorBillingAccess(path, "00000000-0000-4000-8000-000000000001"), true);
  }
  assert.equal(shouldMonitorBillingAccess("/es/organizations/punto-fiscal/home"), true);
  assert.equal(shouldMonitorBillingAccess("/es/organizations/punto-fiscal/checkout/success"), true);
});


import { shouldReadCheckoutAccess, shouldPollCheckout } from "./checkout-recovery";
test("return reads access only when the target contract can be active", () => {
  assert.equal(shouldReadCheckoutAccess({ subscriptionStatus: "pending" }), false);
  assert.equal(shouldReadCheckoutAccess({ subscriptionStatus: "active" }), true);
  for (const state of ["preparing", "awaiting_approval", "scheduled", "failed", "effective"]) {
    assert.equal(shouldReadCheckoutAccess({ subscriptionStatus: "active", planChange: {
      state, effectiveAt: "2026-11-01T00:00:00Z",
    } }), state === "effective");
  }
});
test("return polls only unfinished automatic work, never failures or pending user actions", () => {
  assert.equal(shouldPollCheckout(undefined, false), false);
  assert.equal(shouldPollCheckout({ status: "pending" }, false), true);
  assert.equal(shouldPollCheckout({ status: "processing" }, false, true), true);
  assert.equal(shouldPollCheckout({ status: "ready", subscriptionStatus: "pending" }, false, true), false);
  assert.equal(shouldPollCheckout({ status: "ready", subscriptionStatus: "active" }, false), true);
  assert.equal(shouldPollCheckout({ status: "ready", subscriptionStatus: "active" }, true), false);
  for (const subscriptionStatus of ["past_due", "suspended", "cancelled", "expired"]) {
    assert.equal(shouldPollCheckout({ subscriptionStatus }, false), false);
  }
  assert.equal(shouldPollCheckout({ status: "rejected" }, false), false);
  for (const state of ["awaiting_approval", "scheduled", "failed"]) {
    assert.equal(shouldPollCheckout({ subscriptionStatus: "active", statusFresh: true, planChange: {
      state, effectiveAt: "2026-11-01T00:00:00Z",
    } }, false), false);
  }
});


test("an upstream checkout failure preserves consent and never authorizes another attempt", () => {
  const acceptanceId = "11111111-1111-4111-8111-111111111111";
  const key = "22222222-2222-4222-8222-222222222222";
  const raw = JSON.stringify({ legalAcceptanceId: acceptanceId, idempotencyKey: key });
  assert.deepEqual(readCheckoutDraft(raw, acceptanceId), { legalAcceptanceId: acceptanceId, idempotencyKey: key });
  assert.equal(readCheckoutDraft(raw, "other-acceptance"), undefined);
  assert.equal(readCheckoutDraft("not-json", acceptanceId), undefined);
  assert.equal(readCheckoutDraft(JSON.stringify({ legalAcceptanceId: acceptanceId, idempotencyKey: "invalid" }), acceptanceId), undefined);
  assert.equal(canStartNewCheckout(undefined), false);
  assert.match(checkoutFailureMessage(404), /aceptación legal sigue registrada/);
  assert.match(checkoutFailureMessage(404), /misma solicitud/);
  assert.match(checkoutFailureMessage(422), /no necesitas volver a aceptar/);
  assert.match(checkoutFailureMessage(), /sin iniciar otra contratación/);
});


test("provider-neutral payment continuation uses only the current authenticated response action", () => {
  const url = "https://checkout.provider.example/session/approved-by-billing";
  const attempt = { status: "ready", checkoutUrl: url };
  assert.equal(checkoutActionUrl(attempt), url);
  assert.equal(checkoutActionUrl({ ...attempt, planChange: { state: "awaiting_approval", effectiveAt: "2026-11-01", action: "approve_payment", checkoutUrl: url } }), url);
  assert.equal(checkoutActionUrl({ ...attempt, planChange: { state: "awaiting_approval", effectiveAt: "2026-11-01", action: "approve_payment", checkoutUrl: null } }), undefined);
  assert.equal(checkoutActionUrl({ ...attempt, planChange: { state: "awaiting_approval", effectiveAt: "2026-11-01", action: "none", checkoutUrl: url } }), undefined);
  assert.equal(checkoutActionUrl({ ...attempt, checkoutStatus: "failed" }), undefined);
});


test("payment return keeps reading status while capture is pending, without polling abandoned approvals", () => {
  const attempt = {
    status: "ready",
    subscriptionStatus: "pending",
    planChange: { state: "awaiting_approval", effectiveAt: "2030-01-01T00:00:00Z", action: "approve_payment" as const },
  };
  assert.equal(shouldPollCheckout(attempt, false), false);
  assert.equal(shouldPollCheckout(attempt, false, false, true), true);
  assert.equal(shouldPollCheckout(attempt, false, true, true), false);
  assert.equal(shouldPollCheckout(attempt, true, false, true), false);
  assert.equal(shouldPollCheckout({ ...attempt, planChange: { ...attempt.planChange, state: "failed" } }, false, false, true), false);
  assert.equal(shouldPollCheckout({ ...attempt, planChange: { ...attempt.planChange, action: "approve_subscription" } }, false, false, true), false);
});

test("resuming an unpaid purchase waits for user approval without polling as if it had been paid", () => {
  const attempt = { status: "ready", subscriptionStatus: "pending", checkoutUrl: "https://www.sandbox.paypal.com/approve?token=pending" };
  assert.equal(checkoutActionUrl(attempt), attempt.checkoutUrl);
  assert.equal(shouldPollCheckout(attempt, false), false);
  assert.equal(shouldPollCheckout(attempt, false, true), false);
  assert.equal(shouldPollCheckout(attempt, false, false, true), true);
});

test("an abandoned checkout cannot reactivate the current plan or reopen its old approval link", () => {
  const abandoned = { abandoned: true, status: "ready", statusFresh: true, checkoutStatus: "cancelled", subscriptionStatus: "cancelled",
    checkoutUrl: "https://www.sandbox.paypal.com/approve?token=old" };
  assert.equal(isCheckoutTerminal(abandoned), true);
  assert.equal(canStartNewCheckout(abandoned), true);
  assert.equal(checkoutActionUrl(abandoned), undefined);
  assert.equal(shouldPollCheckout(abandoned, false), false);
  const staleActive = { ...abandoned, subscriptionStatus: "active", subscriptionId: "old", planCode: "old" };
  assert.equal(shouldReadCheckoutAccess(staleActive), false);
  assert.equal(isCheckoutApprovalConfirmed(staleActive, false), false);
  assert.equal(isCheckoutAccessActive(staleActive, { active: true, source: "billing", subscriptionId: "old", planCode: "old" }), false);
});

import { canReplaceAbandonedCheckout } from "./checkout-recovery";
test("only a fresh abandonment of the exact saved purchase permits replacing its idempotency key", () => {
  const expected = { attemptId: "old", planCode: "professional", planPriceCode: "monthly", operation: "checkout" };
  const receipt = { ...expected, status: "rejected", abandoned: true, statusFresh: true,
    checkoutStatus: "cancelled", subscriptionStatus: "cancelled", errorCode: "PAYMENT_ATTEMPT_CANCELLED" };
  assert.equal(canReplaceAbandonedCheckout(receipt, expected), true);
  for (const changed of [
    { abandoned: false }, { statusFresh: false }, { attemptId: "other" }, { planCode: "other" },
    { planPriceCode: "yearly" }, { operation: "change_plan" }, { checkoutStatus: "approved" },
    { subscriptionStatus: "active" }, { status: "pending", abandoned: false },
  ]) assert.equal(canReplaceAbandonedCheckout({ ...receipt, ...changed }, expected), false);
  assert.equal(canReplaceAbandonedCheckout(undefined, expected), false);
});

test("cancelling a scheduled downgrade resumes restoration instead of reporting a confirmed scheduled change", () => {
  const restoreUrl = "https://www.sandbox.paypal.com/restore/current";
  const change = { status: "ready", statusFresh: true, subscriptionStatus: "pending", checkoutUrl: restoreUrl,
    planChange: { state: "scheduled", effectiveAt: "2026-11-26T10:00:00Z", cancellationRequested: true,
      action: "approve_subscription" as const, checkoutUrl: restoreUrl } };
  assert.equal(isPlanChangeScheduled(change), false);
  assert.equal(isCheckoutApprovalConfirmed(change, true), false);
  assert.equal(checkoutActionUrl(change), restoreUrl);
  assert.equal(shouldPollCheckout(change, false, false, false), false);
  assert.equal(shouldPollCheckout(change, false, false, true), true);
  const cancelled = { ...change, planChange: { ...change.planChange, state: "failed" } };
  assert.equal(isCheckoutTerminal(cancelled), true);
  assert.equal(checkoutActionUrl(cancelled), undefined);
  assert.equal(shouldPollCheckout(cancelled, false, false, true), false);
});

for (const state of ["awaiting_approval", "scheduled"]) {
  test(`restoration after PayPal return keeps polling until cancellation is confirmed (${state})`, () => {
    const attempt = { status: "ready", statusFresh: true, subscriptionStatus: "pending",
      planChange: { state, effectiveAt: "2026-11-26T10:00:00Z", cancellationRequested: true,
        action: "approve_subscription" as const, checkoutUrl: "https://www.sandbox.paypal.com/restore" } };
    assert.equal(shouldPollCheckout(attempt, false, false, false), false);
    assert.equal(shouldPollCheckout(attempt, false, false, true), true);
    assert.equal(shouldPollCheckout(attempt, false, true, true), false);
    assert.equal(isPlanChangeCancelled(attempt), false);
    const preparing = { ...attempt, planChange: { ...attempt.planChange, checkoutUrl: null } };
    assert.equal(shouldPollCheckout(preparing, false, false, false), true);
    assert.equal(checkoutActionUrl(preparing), undefined);
    const cancelled = { ...attempt, planChange: { ...attempt.planChange, state: "failed" } };
    assert.equal(isPlanChangeCancelled(cancelled), true);
    assert.equal(shouldPollCheckout(cancelled, false, false, true), false);
    assert.equal(isPlanChangeCancelled({ ...cancelled, statusFresh: false }), false);
    assert.equal(isPlanChangeCancelled({ ...cancelled, planChange: { ...cancelled.planChange, cancellationRequested: false } }), false);
  });
}

import { isRenewalResumeScheduled } from "./checkout-recovery";
test("future renewal authorization does not replace paid access or ask to pay again", () => {
  const renewalResume = { state: "awaiting_approval" as const, sourceSubscriptionId: "paid", effectiveAt: "2026-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "999.00", currency: "MXN" };
  const pending = { operation: "resume_renewal", status: "ready", statusFresh: true, subscriptionStatus: "pending", subscriptionId: "future", planCode: "despacho", checkoutUrl: "https://www.sandbox.paypal.com/approve", renewalResume };
  assert.equal(checkoutActionUrl(pending), pending.checkoutUrl);
  assert.equal(shouldPollCheckout(pending, false), false);
  assert.equal(shouldPollCheckout(pending, false, false, true), true);
  const scheduled = { ...pending, renewalResume: { ...renewalResume, state: "scheduled" as const } };
  assert.equal(isRenewalResumeScheduled(scheduled), true);
  assert.equal(checkoutActionUrl(scheduled), undefined);
  assert.equal(shouldPollCheckout(scheduled, false, false, true), false);
  assert.equal(shouldReadCheckoutAccess(scheduled), false);
  assert.equal(isCheckoutAccessActive(scheduled, { active: true, source: "billing", subscriptionId: "paid", planCode: "despacho" }), false);
  assert.equal(isRenewalResumeScheduled({ ...scheduled, statusFresh: false }), false);
  const abandoned = { ...pending, abandoned: true, checkoutStatus: "cancelled", subscriptionStatus: "cancelled", renewalResume: { ...renewalResume, state: "failed" as const } };
  assert.equal(isCheckoutTerminal(abandoned), true);
  assert.equal(checkoutActionUrl(abandoned), undefined);
});

import { canReplaceRenewalResume } from "./checkout-recovery";
test("only the confirmed cancelled renewal of the same source permits a new recovery key", () => {
  const saved = { attemptId: "key", operation: "resume_renewal", statusFresh: true, checkoutStatus: "cancelled", subscriptionStatus: "cancelled",
    renewalResume: { state: "failed" as const, sourceSubscriptionId: "paid", effectiveAt: "2026-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "999.00", currency: "MXN" } };
  assert.equal(canReplaceRenewalResume(saved, "key", "paid"), true);
  for (const changed of [{ statusFresh: false }, { attemptId: "other" }, { operation: "checkout" }, { checkoutStatus: "pending" }, { subscriptionStatus: "active" }, { renewalResume: { ...saved.renewalResume, state: "awaiting_approval" as const } }])
    assert.equal(canReplaceRenewalResume({ ...saved, ...changed }, "key", "paid"), false);
  assert.equal(canReplaceRenewalResume(saved, "key", "other"), false);
});

import { isRenewalPlanChangeScheduled, canReplaceRenewalPlanChange } from "./checkout-recovery";
test("next renewal change uses the current approval only and never mistakes authorization for paid access", () => {
  const expected = { attemptId: "key", sourceSubscriptionId: "paid", renewalSubscriptionId: "future", targetPlanCode: "professional", targetPlanPriceCode: "monthly" };
  const change = { state: "awaiting_approval" as const, sourceSubscriptionId: "paid", renewalSubscriptionId: "future", targetPlanCode: "professional", targetPlanPriceCode: "monthly", effectiveAt: "2030-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "499.00", currency: "MXN", cancellationRequested: false, action: "approve_subscription" as const, checkoutUrl: "https://www.sandbox.paypal.com/new-change" };
  const pending = { attemptId: "key", operation: "change_renewal_plan", statusFresh: true, status: "ready", subscriptionId: "future", planCode: "professional", planPriceCode: "monthly", subscriptionStatus: "pending", checkoutUrl: "https://www.sandbox.paypal.com/old", renewalPlanChange: change };
  assert.equal(checkoutActionUrl(pending), change.checkoutUrl);
  assert.equal(checkoutActionUrl({ ...pending, renewalPlanChange: { ...change, checkoutUrl: null } }), undefined);
  assert.equal(shouldPollCheckout(pending, false), false);
  assert.equal(shouldPollCheckout(pending, false, false, true), true);
  const scheduled = { ...pending, renewalPlanChange: { ...change, state: "scheduled" as const, action: "none" as const } };
  assert.equal(isRenewalPlanChangeScheduled(scheduled), true);
  assert.equal(checkoutActionUrl(scheduled), undefined);
  assert.equal(shouldPollCheckout(scheduled, false, false, true), false);
  assert.equal(isCheckoutAccessActive({ ...scheduled, subscriptionStatus: "active" }, { active: true, source: "billing", subscriptionId: "future", planCode: "professional" }), false);
  const restoring = { ...scheduled, renewalPlanChange: { ...change, state: "scheduled" as const, cancellationRequested: true, checkoutUrl: "https://www.sandbox.paypal.com/restore" } };
  assert.equal(isRenewalPlanChangeScheduled(restoring), false);
  assert.equal(checkoutActionUrl(restoring), restoring.renewalPlanChange.checkoutUrl);
  assert.equal(shouldPollCheckout(restoring, false, false, true), true);
  const failed = { ...pending, renewalPlanChange: { ...change, state: "failed" as const } };
  assert.equal(canReplaceRenewalPlanChange(failed, expected), true);
  for (const altered of [{ statusFresh: false }, { subscriptionId: "other" }, { planCode: "other" }, { attemptId: "other" }, { renewalPlanChange: change }]) assert.equal(canReplaceRenewalPlanChange({ ...failed, ...altered }, expected), false);
});


test("only a server-confirmed rejection before preparation permits replacing the renewal key", () => {
  const expected = { attemptId: "key", sourceSubscriptionId: "paid", renewalSubscriptionId: "future", targetPlanCode: "despacho", targetPlanPriceCode: "monthly" };
  const rejected = { attemptId: "key", operation: "change_renewal_plan", status: "rejected", statusFresh: true, errorCode: "BILLING_CHECKOUT_REJECTED_BEFORE_PREPARATION", planCode: "despacho", planPriceCode: "monthly" };
  assert.equal(canReplaceRenewalPlanChange(rejected, expected), true);
  assert.equal(canReplaceRenewalPlanChange(undefined, expected), false);
  for (const changed of [{ statusFresh: false }, { status: "pending" }, { status: "processing" }, { status: "ready" }, { errorCode: "BILLING_CHECKOUT_REJECTED" }, { errorCode: "NETWORK_ERROR" }, { attemptId: "other" }, { operation: "resume_renewal" }, { planCode: "other" }, { planPriceCode: "other" }, { checkoutId: "checkout" }, { subscriptionId: "future" }, { checkoutUrl: "https://www.sandbox.paypal.com/approve" }]) {
    assert.equal(canReplaceRenewalPlanChange({ ...rejected, ...changed }, expected), false);
  }
});
