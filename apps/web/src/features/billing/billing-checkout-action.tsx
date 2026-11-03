"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  canStartNewCheckout,
  canReplaceAbandonedCheckout,
  createCheckoutDraft,
  isCheckoutTerminal,
  pendingCheckoutKey,
  checkoutActionUrl,
  checkoutPollDelay,
  isCheckoutApprovalConfirmed,
  readCheckoutDraft,
  checkoutFailureMessage,
  type CheckoutDraft as Draft,
} from "./checkout-recovery";
import {
  createCheckoutAttempt,
  createPlanChangeAttempt,
  getCheckoutAttempt,
  getPlanChangeQuote,
  retryCheckoutAttempt,
  type CheckoutAttempt,
  type PlanChangeQuote,
} from "./api";

function storageKey(
  organizationId: string,
  userId: string,
  planCode: string,
  priceCode: string,
) {
  return `balanz:billing-checkout:v1:${organizationId}:${userId}:${planCode}:${priceCode}`;
}

function readDraft(key: string, legalAcceptanceId: string): Draft | undefined {
  try { return readCheckoutDraft(sessionStorage.getItem(key), legalAcceptanceId); }
  catch { return; }
}

function message(error: unknown) {
  return checkoutFailureMessage(error instanceof ApiError ? error.status : undefined);
}

export function BillingCheckoutAction({
  organizationId,
  userId,
  planCode,
  planPriceCode,
  legalAcceptanceId,
  startImmediately,
  continueStartedAt,
  changePlan = false,
  expectedSubscriptionId,
  expectedAmountDueNow,
  onReviewQuote,
}: {
  organizationId: string;
  userId: string;
  planCode: string;
  planPriceCode: string;
  legalAcceptanceId: string;
  startImmediately: boolean;
  continueStartedAt?: number;
  changePlan?: boolean;
  expectedSubscriptionId?: string;
  expectedAmountDueNow?: string;
  onReviewQuote: (quote?: PlanChangeQuote) => void;
}) {
  const key = `${storageKey(organizationId, userId, planCode, planPriceCode)}:${changePlan ? "change" : "new"}`;
  const [draft, setDraft] = useState<Draft>();
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [attempt, setAttempt] = useState<CheckoutAttempt>();
  const [error, setError] = useState("");
  const [quoteNotice, setQuoteNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [openingPayment, setOpeningPayment] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);
  const preparationStartedAt = useRef<number | undefined>(undefined);
  const openPayment = useCallback((value: CheckoutAttempt) => {
    const url = checkoutActionUrl(value);
    if (value.status === "ready" && url) {
      if (preparationStartedAt.current !== undefined) {
        globalThis.performance?.measure("balanz.checkout.payment-link", { start: preparationStartedAt.current });
        if (continueStartedAt !== undefined)
          globalThis.performance?.measure("balanz.checkout.continue-to-paypal", { start: continueStartedAt });
        preparationStartedAt.current = undefined;
      }
      if (changePlan) window.location.assign(url);
      else {
        window.location.replace(url);
        setOpeningPayment(true);
      }
      return true;
    }
    return false;
  }, [changePlan, continueStartedAt]);

  const save = useCallback(
    (value: Draft): boolean => {
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
      } catch {
        setError(
          "El navegador no pudo guardar la solicitud de pago. Habilita el almacenamiento para poder recuperarlo si se interrumpe la conexión.",
        );
        return false;
      }
      setDraft(value);
      return true;
    },
    [key],
  );

  useEffect(() => {
    let active = true;
    const value = readDraft(key, legalAcceptanceId);
    queueMicrotask(() => {
      if (!active) return;
      setDraft(value);
      setAttempt(undefined);
      setError("");
      setBusy(false);
      setOpeningPayment(false);
      setDraftLoaded(true);
    });
    return () => {
      active = false;
      pending.current?.abort();
      pending.current = null;
    };
  }, [key, legalAcceptanceId]);

  useEffect(() => {
    const attemptId = draft?.attemptId ?? (!changePlan ? draft?.idempotencyKey : undefined);
    if (!attemptId || attempt?.attemptId === attemptId) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted || pending.current) return;
      getCheckoutAttempt(attemptId, controller.signal)
        .then((value) => {
          const stored = readDraft(key, legalAcceptanceId);
          if (controller.signal.aborted || pending.current || !stored ||
              (stored.attemptId ?? stored.idempotencyKey) !== attemptId) return;
          if (!stored.attemptId) {
            if (value.attemptId !== attemptId || value.planCode !== planCode ||
                value.planPriceCode !== planPriceCode || value.operation !== "checkout") return;
          }
          if (canReplaceAbandonedCheckout(value, { attemptId, planCode, planPriceCode,
            operation: changePlan ? "change_plan" : "checkout" })) {
            if (save(createCheckoutDraft(legalAcceptanceId))) {
              setAttempt(undefined);
              setQuoteNotice("El intento anterior fue descartado. Puedes iniciar un pago nuevo.");
            }
          } else {
            if (!stored.attemptId && !save({ ...stored, attemptId })) return;
            if (changePlan || !openPayment(value)) setAttempt(value);
          }
        })
        .catch(() => undefined);
    });
    return () => controller.abort();
  }, [key, draft?.attemptId, draft?.idempotencyKey, attempt?.attemptId, planCode, planPriceCode, changePlan, legalAcceptanceId, save, openPayment]);

  const waitingForLink = !changePlan && !attempt?.abandoned &&
    (attempt?.status === "processing" || (attempt?.status === "pending" && !attempt.errorCode));
  const pollingId = waitingForLink ? attempt?.attemptId : undefined;
  useEffect(() => {
    if (!pollingId) return;
    const controller = new AbortController();
    let timer: number;
    const startedAt = Date.now();
    const check = async () => {
      try {
        const latest = await getCheckoutAttempt(pollingId, controller.signal);
        if (controller.signal.aborted) return;
        if (!pending.current) {
          if (openPayment(latest)) return;
          setAttempt(latest);
          if (latest.status !== "pending" && latest.status !== "processing") return;
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          setError(message(cause));
          return;
        }
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed < 60_000) timer = window.setTimeout(() => void check(), checkoutPollDelay(elapsed));
      else setError("Tu solicitud está guardada. Puedes volver a consultar el pago desde aquí.");
    };
    timer = window.setTimeout(() => void check(), checkoutPollDelay(0));
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [pollingId, key, openPayment]);

  const submit = useCallback(async () => {
    if (!draftLoaded || busy || openingPayment || pending.current) return;
    preparationStartedAt.current = globalThis.performance?.now();
    setBusy(true);
    setError("");
    setQuoteNotice("");
    let current: Draft = draft ?? createCheckoutDraft(legalAcceptanceId);
    const controller = new AbortController();
    pending.current = controller;
    try {
      if (!save(current)) return;
      if (current.attemptId) {
        const latest = await getCheckoutAttempt(current.attemptId, controller.signal);
        if (controller.signal.aborted || pending.current !== controller) return;
        if (canReplaceAbandonedCheckout(latest, {
          attemptId: current.attemptId, planCode, planPriceCode,
          operation: changePlan ? "change_plan" : "checkout",
        })) {
          current = createCheckoutDraft(legalAcceptanceId);
          if (!save(current)) return;
          setAttempt(undefined);
        } else if (latest.abandoned) {
          setAttempt(latest);
          setError("No se pudo confirmar que el intento descartado corresponde a esta contratación. Recarga la página antes de continuar.");
          return;
        }
      }
      if (changePlan && !current.attemptId) {
        const quote = await getPlanChangeQuote(
          planCode,
          planPriceCode,
          controller.signal,
        );
        if (quote.amountDueNow !== expectedAmountDueNow) {
          setQuoteNotice(
            "El prorrateo cambió. Actualizamos el monto; revísalo antes de continuar.",
          );
          onReviewQuote(quote);
          return;
        }
      }
      const value = current.attemptId
        ? await retryCheckoutAttempt(current.attemptId, controller.signal, { planCode, planPriceCode })
        : await (changePlan ? createPlanChangeAttempt : createCheckoutAttempt)(
            {
              idempotencyKey: current.idempotencyKey,
              planCode,
              planPriceCode,
              legalAcceptanceId,
              ...(changePlan ? { expectedSubscriptionId, expectedAmountDueNow } : {}),
            },
            controller.signal,
          );
      if (controller.signal.aborted || pending.current !== controller) return;
      const updated = { ...current, attemptId: value.attemptId };
      save(updated);
      setAttempt(value);
      if (!isCheckoutTerminal(value) && value.status !== "rejected") {
        try {
          sessionStorage.setItem(
            pendingCheckoutKey(organizationId, userId),
            value.attemptId,
          );
        } catch {
          /* The checkout remains usable without background tracking. */
        }
      }
      openPayment(value);
    } catch (cause) {
      if (!controller.signal.aborted && pending.current === controller)
        setError(message(cause));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }, [
    busy,
    openingPayment,
    openPayment,
    changePlan,
    expectedSubscriptionId,
    expectedAmountDueNow,
    draft,
    draftLoaded,
    legalAcceptanceId,
    planCode,
    planPriceCode,
    save,
    onReviewQuote,
    organizationId,
    userId,
  ]);

  useEffect(() => {
    if (!startImmediately || !draftLoaded || autoStarted.current) return;
    autoStarted.current = true;
    void submit();
  }, [startImmediately, draftLoaded, submit]);

  async function startNewAttempt() {
    if (!draft?.attemptId || busy || pending.current) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      const latest = await getCheckoutAttempt(
        draft.attemptId,
        controller.signal,
      );
      if (controller.signal.aborted || pending.current !== controller) return;
      setAttempt(latest);
      if (latest.abandoned && !canReplaceAbandonedCheckout(latest, {
        attemptId: draft.attemptId, planCode, planPriceCode,
        operation: changePlan ? "change_plan" : "checkout",
      })) {
        setError("No se pudo confirmar que el intento descartado corresponde a esta contratación. Recarga la página antes de continuar.");
        return;
      }
      if (!canStartNewCheckout(latest)) {
        setError(
          "El pago anterior todavía no tiene un resultado confirmado. Actualiza su estado antes de iniciar uno nuevo.",
        );
        return;
      }
      if (save(createCheckoutDraft(legalAcceptanceId))) {
        setAttempt(undefined);
        if (latest.abandoned) {
          setQuoteNotice("El intento anterior fue descartado. Puedes iniciar un pago nuevo.");
        } else if (latest.status === "rejected" && changePlan) {
          const quote = await getPlanChangeQuote(
            planCode,
            planPriceCode,
            controller.signal,
          );
          if (controller.signal.aborted || pending.current !== controller)
            return;
          setQuoteNotice(
            "La solicitud anterior no inició el pago. Revisa el monto actualizado antes de continuar.",
          );
          onReviewQuote(quote);
        } else if (latest.status === "rejected") {
          onReviewQuote();
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && pending.current === controller)
        setError(message(cause));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  const terminal = isCheckoutTerminal(attempt);
  const confirmed = isCheckoutApprovalConfirmed(attempt, changePlan);
  const checkoutUrl = checkoutActionUrl(attempt);
  const startingAutomatically = startImmediately && !attempt && !error && !quoteNotice;
  const preparing = openingPayment || startingAutomatically || (!changePlan && (busy || (waitingForLink && !error)));
  const statusMessage = changePlan && attempt?.status === "processing"
      ? `Estamos preparando el cambio de plan. Puedes reintentar en ${attempt.retryAfterSeconds ?? 5} segundos.`
      : attempt?.status === "pending"
        ? attempt.errorCode === "BILLING_TEMPORARILY_UNAVAILABLE"
          ? changePlan
            ? `No pudimos completar el cambio de plan. Tu solicitud quedó guardada; reintenta en ${attempt.retryAfterSeconds ?? 5} segundos y retomaremos esta misma solicitud.`
            : `No pudimos preparar el pago. Tu solicitud quedó guardada; reintenta en ${attempt.retryAfterSeconds ?? 5} segundos y retomaremos esta misma solicitud.`
          : [
              "BILLING_SERVICE_UNAUTHORIZED",
              "BILLING_SERVICE_FORBIDDEN",
            ].includes(attempt.errorCode ?? "")
            ? "El servicio de pagos no está disponible. Tu solicitud está guardada; puedes reintentar cuando se restablezca la conexión."
            : changePlan
              ? "Tu cambio de plan está guardado. Puedes retomarlo desde aquí."
              : "Tu solicitud de pago está guardada. Puedes continuar sin crear una nueva contratación."
        : undefined;

  return (
    <div className="space-y-3">
      {quoteNotice ? (
        <p role="status" className="text-body-sm text-muted-foreground">
          {quoteNotice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      {statusMessage && !preparing ? (
        <p role="status" className="text-body-sm text-muted-foreground">
          {statusMessage}
        </p>
      ) : null}
      {preparing ? (
        <Button className="min-h-11 w-full" disabled aria-busy="true">
          {changePlan ? "Preparando cambio de plan…" : "Abriendo PayPal…"}
        </Button>
      ) : confirmed ? (
        <p role="status" className="text-body-sm">
          {changePlan ? (attempt?.planChange?.state === "effective" ? "El cambio de plan está aplicado. Estamos confirmando sus beneficios en Balanz." : "El cambio de plan está confirmado para la próxima renovación. Consulta su fecha en Planes y suscripción.") : "La suscripción está activa."}
        </p>
      ) : terminal || attempt?.status === "rejected" ? (
        <div className="space-y-3">
          <p role="status" className="text-body-sm">
            {attempt?.abandoned
              ? "El intento anterior fue descartado. Puedes iniciar un pago nuevo para este plan."
              : attempt?.status === "rejected"
              ? "La solicitud de pago fue rechazada. Revisa la cotización vigente antes de continuar."
              : "El pago anterior finalizó sin activar la suscripción. Puedes volver a contratar el mismo plan."}
          </p>
          <Button
            className="min-h-11 w-full"
            disabled={busy}
            onClick={() => void startNewAttempt()}
          >
            {busy ? "Confirmando estado…" : attempt?.abandoned ? "Preparar un pago nuevo" : attempt?.status === "rejected" ? "Revisar cotización vigente" : "Volver a contratar"}
          </Button>
        </div>
      ) : checkoutUrl ? (
        <a
          href={checkoutUrl}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Continuar al pago
        </a>
      ) : (
        <Button
          className="min-h-11 w-full"
          disabled={busy || !draftLoaded}
          onClick={() => void submit()}
        >
          {busy
            ? changePlan ? "Retomando cambio de plan…" : "Preparando pago…"
            : attempt?.status === "pending"
              ? changePlan ? "Reintentar cambio de plan" : "Reintentar pago"
              : "Continuar al pago"}
        </Button>
      )}
    </div>
  );
}
