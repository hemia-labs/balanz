import type { RenewalResume, RenewalPlanChange } from "./api";
type CheckoutState = {
  renewalResume?: RenewalResume;
  renewalPlanChange?: RenewalPlanChange;
  status?: string;
  abandoned?: boolean;
  errorCode?: string;
  operation?: string;
  subscriptionId?: string | null;
  planCode?: string | null;
  planPriceCode?: string;
  attemptId?: string;
  checkoutId?: string | null;
  checkoutStatus?: string | null;
  subscriptionStatus?: string | null;
  statusFresh?: boolean;
  checkoutUrl?: string;
  planChange?: {
    cancellationRequested?: boolean;
    state: string;
    effectiveAt: string;
    action?: "approve_subscription" | "approve_payment" | "none";
    checkoutUrl?: string | null;
  };
};

export function isCheckoutTerminal(attempt?: CheckoutState): boolean {
  if (attempt?.abandoned || attempt?.planChange?.state === "failed" || attempt?.renewalResume?.state === "failed" || attempt?.renewalPlanChange?.state === "failed") return true;
  return Boolean(
    attempt &&
    attempt.subscriptionStatus !== "active" &&
    (attempt.subscriptionStatus === "cancelled" ||
      attempt.subscriptionStatus === "expired" ||
      ["cancelled", "expired", "failed"].includes(
        attempt.checkoutStatus ?? "",
      )),
  );
}

export function isRenewalPlanChangeScheduled(attempt?: CheckoutState): boolean {
  return Boolean(attempt?.statusFresh === true && attempt.renewalPlanChange &&
    !attempt.renewalPlanChange.cancellationRequested && ["scheduled", "effective"].includes(attempt.renewalPlanChange.state));
}

export function isRenewalResumeScheduled(attempt?: CheckoutState): boolean {
  return Boolean(attempt?.statusFresh === true && attempt.renewalResume &&
    ["scheduled", "effective"].includes(attempt.renewalResume.state));
}

export function isPlanChangeCancelled(attempt?: CheckoutState): boolean {
  return Boolean(attempt?.statusFresh === true &&
    attempt.planChange?.state === "failed" && attempt.planChange.cancellationRequested);
}

export function canStartNewCheckout(attempt?: CheckoutState): boolean {
  return attempt?.status === "rejected" || (attempt?.statusFresh === true && isCheckoutTerminal(attempt));
}

export function canReplaceAbandonedCheckout(
  attempt: CheckoutState | undefined,
  expected: { attemptId: string; planCode: string; planPriceCode: string; operation: string },
): boolean {
  return Boolean(attempt?.abandoned === true && attempt.statusFresh === true &&
    attempt.attemptId === expected.attemptId && attempt.operation === expected.operation &&
    attempt.planCode === expected.planCode && attempt.planPriceCode === expected.planPriceCode &&
    attempt.checkoutStatus === "cancelled" && attempt.subscriptionStatus === "cancelled");
}

export function canReplaceRenewalResume(attempt: CheckoutState | undefined, attemptId: string, sourceSubscriptionId: string): boolean {
  return Boolean(attempt?.attemptId === attemptId && attempt.operation === "resume_renewal" &&
    attempt.statusFresh === true && attempt.renewalResume?.sourceSubscriptionId === sourceSubscriptionId &&
    attempt.renewalResume.state === "failed" && attempt.checkoutStatus === "cancelled" &&
    ["cancelled", "expired"].includes(attempt.subscriptionStatus ?? ""));
}

export function canReplaceRenewalPlanChange(attempt: CheckoutState | undefined, expected: {
  attemptId: string; sourceSubscriptionId: string; renewalSubscriptionId: string; targetPlanCode: string; targetPlanPriceCode: string;
}) {
  const change = attempt?.renewalPlanChange;
  // Only Billing can prove that a rejected request created no durable checkout.
  if (attempt?.attemptId === expected.attemptId && attempt.operation === "change_renewal_plan" &&
      attempt.planCode === expected.targetPlanCode && attempt.planPriceCode === expected.targetPlanPriceCode &&
      attempt.status === "rejected" && attempt.statusFresh === true &&
      attempt.errorCode === "BILLING_CHECKOUT_REJECTED_BEFORE_PREPARATION" &&
      !attempt.checkoutId && !attempt.subscriptionId && !attempt.checkoutUrl && !change) return true;
  return Boolean(attempt?.attemptId === expected.attemptId && attempt.operation === "change_renewal_plan" &&
    attempt.statusFresh === true && attempt.subscriptionId === expected.renewalSubscriptionId &&
    attempt.planCode === expected.targetPlanCode && attempt.planPriceCode === expected.targetPlanPriceCode && change?.state === "failed" &&
    change.sourceSubscriptionId === expected.sourceSubscriptionId && change.renewalSubscriptionId === expected.renewalSubscriptionId &&
    change.targetPlanCode === expected.targetPlanCode && change.targetPlanPriceCode === expected.targetPlanPriceCode);
}

export function createCheckoutDraft(legalAcceptanceId: string) {
  return { idempotencyKey: crypto.randomUUID(), legalAcceptanceId };
}

export function isCheckoutAccessActive(
  attempt: CheckoutState | undefined,
  access:
    | {
        active: boolean;
        source: string | null;
        subscriptionId?: string | null;
        planCode?: string | null;
      }
    | undefined,
): boolean {
  return Boolean(
    !attempt?.abandoned &&
    (!attempt?.renewalResume || attempt.renewalResume.state === "effective") &&
    (!attempt?.renewalPlanChange || (attempt.renewalPlanChange.state === "effective" && !attempt.renewalPlanChange.cancellationRequested)) &&
    (!attempt?.planChange || attempt.planChange.state === "effective") &&
    attempt?.subscriptionStatus === "active" &&
    attempt.subscriptionId &&
    attempt.planCode &&
    access?.active &&
    access.source === "billing" &&
    access.subscriptionId === attempt.subscriptionId &&
    access.planCode === attempt.planCode,
  );
}

export function pendingCheckoutKey(organizationId: string, userId: string) {
  return `balanz:pending-checkout:v1:${organizationId}:${userId}`;
}

export function pendingCheckoutId(value: string | null): string | undefined {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : undefined;
}

export function isPlanChangeScheduled(attempt?: CheckoutState): boolean {
  return Boolean(
    attempt?.statusFresh === true &&
    attempt.planChange?.state === "scheduled" &&
    !attempt.planChange.cancellationRequested &&
    Number.isFinite(Date.parse(attempt.planChange.effectiveAt)),
  );
}

export function isCheckoutUrl(
  value: string | undefined,
): value is string {
  try {
    // Checkout destinations come only from the authenticated Billing response.
    // Billing's adapter validates the selected provider; the browser validates URL safety.
    if (!value || !/^https:\/\/[^/\\]/i.test(value) || /[\s\\]/.test(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isCheckoutApprovalConfirmed(
  attempt: CheckoutState | undefined,
  changePlan: boolean,
) {
  if (attempt?.abandoned || attempt?.planChange?.cancellationRequested) return false;
  if (attempt?.renewalPlanChange) return !attempt.renewalPlanChange.cancellationRequested && ["scheduled", "effective"].includes(attempt.renewalPlanChange.state);
  if (attempt?.renewalResume) return ["scheduled", "effective"].includes(attempt.renewalResume.state);
  return changePlan
    ? ["scheduled", "effective"].includes(attempt?.planChange?.state ?? "")
    : attempt?.subscriptionStatus === "active";
}

export function checkoutActionUrl(attempt?: CheckoutState): string | undefined {
  if (isCheckoutTerminal(attempt) || isCheckoutApprovalConfirmed(attempt, Boolean(attempt?.planChange))) return undefined;
  const value = attempt?.renewalPlanChange
    ? attempt.renewalPlanChange.action === "none" ? undefined : attempt.renewalPlanChange.checkoutUrl ?? undefined
    : attempt?.planChange?.action !== undefined
    ? attempt.planChange.action === "none" ? undefined : attempt.planChange.checkoutUrl ?? undefined
    : attempt?.checkoutUrl;
  return isCheckoutUrl(value) ? value : undefined;
}

export function isCheckoutRetryablePending(attempt?: CheckoutState): boolean {
  return Boolean(
    attempt?.status === "pending" &&
    !checkoutActionUrl(attempt) &&
    [
      "BILLING_TEMPORARILY_UNAVAILABLE",
      "BILLING_SERVICE_UNAUTHORIZED",
      "BILLING_SERVICE_FORBIDDEN",
    ].includes(attempt.errorCode ?? ""),
  );
}

export function isCheckoutPlanChange(attempt?: CheckoutState): boolean {
  return Boolean(attempt?.planChange || attempt?.operation === "change_plan");
}

export function shouldMonitorBillingAccess(pathname: string, pendingAttemptId?: string) {
  // The plans page already owns its access read; the global notice only needs pending checkouts there.
  return Boolean(pendingAttemptId) || !/\/organizations\/[^/]+\/settings\/billing-plan\/?$/.test(pathname);
}

export function shouldReadCheckoutAccess(attempt?: CheckoutState): boolean {
  return Boolean(!attempt?.abandoned && (!attempt?.renewalResume || attempt.renewalResume.state === "effective") &&
    (!attempt?.renewalPlanChange || (attempt.renewalPlanChange.state === "effective" && !attempt.renewalPlanChange.cancellationRequested)) && attempt?.subscriptionStatus === "active" &&
    (!attempt.planChange || attempt.planChange.state === "effective"));
}

export function shouldPollCheckout(
  attempt: CheckoutState | undefined,
  activated: boolean,
  cancelled = false,
  returnedFromPayment = false,
): boolean {
  return Boolean(attempt && !activated && (!checkoutActionUrl(attempt) || returnedFromPayment) && !isCheckoutRetryablePending(attempt) && !isCheckoutTerminal(attempt) &&
    !isPlanChangeScheduled(attempt) && !isRenewalResumeScheduled(attempt) && !isRenewalPlanChangeScheduled(attempt) && attempt.status !== "rejected" &&
    !["past_due", "suspended"].includes(attempt.subscriptionStatus ?? "") &&
    (attempt.planChange?.state !== "awaiting_approval" ||
      (!cancelled && (attempt.planChange.cancellationRequested ||
        (returnedFromPayment && attempt.planChange.action === "approve_payment")))) &&
    (!cancelled || attempt.status === "processing" || shouldReadCheckoutAccess(attempt)));
}

export type CheckoutDraft = {
  idempotencyKey: string;
  legalAcceptanceId: string;
  attemptId?: string;
};

export function readCheckoutDraft(raw: string | null, legalAcceptanceId: string): CheckoutDraft | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return;
    const draft = value as Partial<CheckoutDraft>;
    if (draft.legalAcceptanceId !== legalAcceptanceId || !pendingCheckoutId(draft.idempotencyKey ?? null)) return;
    return { idempotencyKey: draft.idempotencyKey!, legalAcceptanceId,
      ...(pendingCheckoutId(draft.attemptId ?? null) ? { attemptId: draft.attemptId } : {}) };
  } catch { return; }
}

export function checkoutFailureMessage(status?: number): string {
  if (status === 401) return "Inicia sesión nuevamente para continuar.";
  if (status === 403) return "Verifica que tengas permiso de facturación y MFA activo.";
  if (status === 404) return "No se pudo iniciar o recuperar el pago porque el servicio de pagos no está disponible. Tu aceptación legal sigue registrada. Reintenta la misma solicitud cuando se restablezca el servicio.";
  if (status === 409) return "El plan, el importe o la solicitud cambió. Recarga esta página para revisar la cotización vigente antes de continuar. Tu aceptación legal sigue registrada.";
  if (status === 422) return "La solicitud de pago fue rechazada, pero no se pudo recuperar su estado. Puedes reintentar la misma solicitud; no necesitas volver a aceptar los documentos.";
  if (status === 429) return "Espera un momento antes de reintentar la misma solicitud.";
  return "No se pudo confirmar el inicio del pago. Tu aceptación legal sigue registrada y puedes reintentar la misma solicitud sin iniciar otra contratación.";
}
