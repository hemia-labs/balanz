import { apiClient, ApiError } from "../../lib/api-client";
import type { CurrentAccess } from "./current-plan";
export interface BillingPlanPrice {
  code: string;
  amount: string;
  currency: string;
  billingInterval: "month" | "year";
  billingIntervalCount: number;
}
export interface BillingPlan {
  code: string;
  name: string;
  description: string | null;
  version: number;
  prices: BillingPlanPrice[];
  features: {
    code: string;
    name: string;
    unit: string | null;
    value: unknown;
  }[];
}
let plansPreview: { scope: string; plans: BillingPlan[]; expiresAt: number } | undefined;

export async function getBillingPlans(signal: AbortSignal, previewScope?: string) {
  const plans = await apiClient<BillingPlan[]>("/payments/plans", { signal });
  if (previewScope && !signal.aborted)
    plansPreview = { scope: previewScope, plans, expiresAt: Date.now() + 60_000 };
  return plans;
}

export function getBillingPlanPreview(scope: string, planCode: string, priceCode: string) {
  if (plansPreview?.scope !== scope || plansPreview.expiresAt <= Date.now()) return;
  return plansPreview.plans.find(
    (plan) => plan.code === planCode && plan.prices.some((price) => price.code === priceCode),
  );
}

export type LegalDocuments = {
  requestId: string;
  identitySourceId: string;
  productCode: string;
  expiresAt: string;
  documents: {
    documentId: string;
    documentVersionId: string;
    contentHash: string;
    title: string;
    version: string;
    kind: string;
    artifacts: Record<string, { url: string }>;
  }[];
};
export type LegalAcceptance = {
  requestId: string;
  legalAcceptanceId: string;
  identitySourceId: string;
  productCode: string;
  accepted: true;
};
export function prepareLegalAcceptance(
  idempotencyKey: string,
  signal: AbortSignal,
) {
  return apiClient<LegalDocuments>("/payments/legal/prepare", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey }),
    signal,
  });
}
export function startLegalPreparation(signal: AbortSignal) {
  const key = crypto.randomUUID();
  const startedAt = globalThis.performance?.now();
  const result = prepareLegalAcceptance(key, signal).then(
    (documents) => {
      if (startedAt !== undefined)
        globalThis.performance?.measure("balanz.checkout.legal-prepare", { start: startedAt });
      return { documents };
    },
    (error: unknown) => ({ error }),
  );
  return { key, result };
}

export function acceptLegalDocuments(
  documents: LegalDocuments,
  idempotencyKey: string,
  signal: AbortSignal,
) {
  return apiClient<LegalAcceptance>("/payments/legal/accept", {
    method: "POST",
    body: JSON.stringify({
      requestId: documents.requestId,
      idempotencyKey,
      confirmations: documents.documents.map((d) => ({
        documentVersionId: d.documentVersionId,
        contentHash: d.contentHash,
        accepted: true,
      })),
    }),
    signal,
  });
}

export type PlanChangeQuote = {
  kind: "upgrade" | "downgrade";
  amountDueNow: string;
  currency: string;
  effectiveAt: string;
  nextBillingAt: string;
  recurringAmount: string;
};

export function getPlanChangeQuote(
  targetPlanCode: string,
  targetPlanPriceCode: string,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ targetPlanCode, targetPlanPriceCode });
  return apiClient<PlanChangeQuote>(`/payments/subscription/plan-change-quote?${query}`, { signal });
}

export function confirmCheckoutAttempt(id: string, signal: AbortSignal) {
  return apiClient<CheckoutAttempt>(
    `/payments/checkout-attempts/${encodeURIComponent(id)}/confirm`,
    { method: "POST", signal },
  );
}

export type RenewalResume = {
  state: "preparing" | "awaiting_approval" | "scheduled" | "effective" | "failed";
  sourceSubscriptionId: string;
  effectiveAt: string;
  amountDueNow: string;
  recurringAmount: string;
  currency: string;
  planCode?: string;
  planPriceCode?: string;
};

export type RenewalPlanChange = {
  state: "preparing" | "awaiting_approval" | "scheduled" | "effective" | "failed";
  sourceSubscriptionId: string;
  renewalSubscriptionId: string;
  targetPlanCode: string;
  targetPlanPriceCode: string;
  effectiveAt: string;
  amountDueNow: string;
  recurringAmount: string;
  currency: string;
  cancellationRequested: boolean;
  action: "approve_subscription" | "none";
  checkoutUrl: string | null;
};

export type CheckoutAttempt = {
  attemptId: string;
  abandoned?: boolean;
  renewalResume?: RenewalResume;
  renewalPlanChange?: RenewalPlanChange;
  operation?: string;
  status: "pending" | "processing" | "ready" | "rejected";
  planCode?: string;
  planPriceCode?: string;
  checkoutId?: string;
  subscriptionId?: string;
  checkoutUrl?: string;
  checkoutStatus?:
    | "created"
    | "pending"
    | "approved"
    | "cancelled"
    | "expired"
    | "failed";
  subscriptionStatus?:
    | "pending"
    | "active"
    | "past_due"
    | "suspended"
    | "cancelled"
    | "expired";
  statusCheckedAt?: string | null;
  statusFresh?: boolean;
  retryAfterSeconds?: number;
  errorCode?: string;
  planChange?: Partial<PlanChangeQuote> & {
    cancellationRequested?: boolean;
    action?: "approve_subscription" | "approve_payment" | "none";
    checkoutUrl?: string | null;
    state:
      | "preparing"
      | "awaiting_approval"
      | "scheduled"
      | "effective"
      | "failed";
    effectiveAt: string;
  };
};

export function createCheckoutAttempt(
  input: {
    idempotencyKey: string;
    planCode: string;
    planPriceCode: string;
    legalAcceptanceId: string;
    expectedSubscriptionId?: string;
    expectedAmountDueNow?: string;
  },
  signal: AbortSignal,
) {
  return recoverRejectedAttempt(input.idempotencyKey, input, signal, () => apiClient<CheckoutAttempt>("/payments/checkout-attempts", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  }), true);
}

export function getCheckoutAttempt(id: string, signal: AbortSignal) {
  return apiClient<CheckoutAttempt>(
    `/payments/checkout-attempts/${encodeURIComponent(id)}`,
    { signal },
  );
}

export function retryCheckoutAttempt(
  id: string, signal: AbortSignal, expected: { planCode: string; planPriceCode: string },
) {
  return recoverRejectedAttempt(id, expected, signal, () => apiClient<CheckoutAttempt>(
    `/payments/checkout-attempts/${encodeURIComponent(id)}/retry`,
    {
      method: "POST",
      signal,
    },
  ));
}

import type { BillingSubscription } from "./subscription-management";
export type { BillingSubscription } from "./subscription-management";
export function getBillingSubscription(signal: AbortSignal) {
  return apiClient<BillingSubscription | null>("/payments/subscription", {
    signal,
  });
}
export function cancelBillingSubscription(
  idempotencyKey: string,
  expectedSubscriptionId: string,
  signal: AbortSignal,
) {
  return apiClient<BillingSubscription>("/payments/subscription/cancel", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey, expectedSubscriptionId }),
    signal,
  });
}
export function createPlanChangeAttempt(
  input: Parameters<typeof createCheckoutAttempt>[0],
  signal: AbortSignal,
) {
  return recoverRejectedAttempt(input.idempotencyKey, input, signal, () => apiClient<CheckoutAttempt>("/payments/subscription/change-plan", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  }));
}

// Recover only a receipt for the exact attempt. A new purchase can be
// committed even if the POST response is lost, so look it up without posting again.
async function recoverRejectedAttempt(
  id: string,
  expected: { planCode: string; planPriceCode: string },
  signal: AbortSignal,
  submit: () => Promise<CheckoutAttempt>,
  recoverUnconfirmed = false,
): Promise<CheckoutAttempt> {
  try { return await submit(); }
  catch (error) {
    if (!(error instanceof ApiError) || signal.aborted) throw error;
    const unconfirmed = recoverUnconfirmed &&
      (error.status === 0 || error.status === 408 || error.status >= 500);
    if (error.status !== 422 && !unconfirmed) throw error;
    try {
      const receipt = await getCheckoutAttempt(id, signal);
      if (receipt?.attemptId === id &&
          (receipt.status === "rejected" || (unconfirmed && receipt.operation === "checkout" &&
            ["pending", "processing", "ready"].includes(receipt.status))) &&
          receipt.planCode === expected.planCode && receipt.planPriceCode === expected.planPriceCode)
        return receipt;
    } catch { /* Preserve the original error if recovery is unavailable. */ }
    throw error;
  }
}

export function syncBillingAccess(signal: AbortSignal) {
  return apiClient<CurrentAccess>("/payments/sync", { method: "POST", signal });
}


export function cancelCheckoutAttempt(attemptId: string, signal: AbortSignal) {
  return apiClient<{ cancelled: boolean; abandoned?: boolean; approvalUrl?: string }>(
    `/payments/checkout-attempts/${encodeURIComponent(attemptId)}/cancel`,
    { method: "POST", signal },
  );
}

export function resumeBillingRenewal(
  idempotencyKey: string,
  expectedSubscriptionId: string,
  signal: AbortSignal,
) {
  return apiClient<CheckoutAttempt>("/payments/subscription/resume-renewal", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey, expectedSubscriptionId }),
    signal,
  });
}

export function changeRenewalPlan(input: {
  idempotencyKey: string;
  expectedSubscriptionId: string;
  expectedRenewalSubscriptionId: string;
  targetPlanCode: string;
  targetPlanPriceCode: string;
}, signal: AbortSignal) {
  return apiClient<CheckoutAttempt>("/payments/subscription/change-renewal-plan", {
    method: "POST", body: JSON.stringify(input), signal,
  });
}
