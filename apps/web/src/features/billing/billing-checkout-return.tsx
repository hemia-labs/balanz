"use client";

import Link from "next/link";
import { BillingRenewalPlanChangeResult } from "./billing-renewal-plan-change";
import { BillingRenewalResumeResult } from "./billing-renewal-resume";
import { BillingDiscardCheckout } from "./billing-discard-checkout";
import {
  Check,
  Minus,
  CheckCircle2,
  CircleX,
  LoaderCircle,
  LockKeyhole,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/product-patterns";
import { useAccountingContext } from "@/components/accounting-context";
import { apiClient, ApiError } from "@/lib/api-client";
import {
  getCheckoutAttempt,
  confirmCheckoutAttempt,
  retryCheckoutAttempt,
  syncBillingAccess,
  getBillingPlans,
  type BillingPlan,
  type CheckoutAttempt,
} from "./api";
import { period, featureValue } from "./billing-plan-format";
import { formatExactMoney } from "@/features/cfdi/exact-decimal";
import {
  isCheckoutTerminal,
  isCheckoutPlanChange,
  isCheckoutAccessActive,
  isCheckoutRetryablePending,
  pendingCheckoutKey,
  isPlanChangeScheduled,
  isPlanChangeCancelled,
  isRenewalResumeScheduled,
  isRenewalPlanChangeScheduled,
  checkoutActionUrl,
  shouldReadCheckoutAccess,
  shouldPollCheckout,
} from "./checkout-recovery";
import { useSession } from "@/features/session/session-provider";
import { PageHeader } from "@/components/page-header";
import type { CurrentAccess } from "./current-plan";

export function BillingCheckoutReturn({
  attemptId,
  cancelled,
  returnedFromPayment = false,
}: {
  attemptId: string;
  cancelled: boolean;
  returnedFromPayment?: boolean;
}) {
  const [attempt, setAttempt] = useState<CheckoutAttempt>();
  const [access, setAccess] = useState<CurrentAccess>();
  const [plans, setPlans] = useState<BillingPlan[]>();
  const [planError, setPlanError] = useState(false);
  const [planRetry, setPlanRetry] = useState(0);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(0);
  const synchronization = useRef<AbortController | null>(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => () => synchronization.current?.abort(), []);
  async function synchronize() {
    if (synchronization.current) return;
    const controller = new AbortController();
    synchronization.current = controller;
    setSyncing(true);
    setError("");
    try {
      const license = await syncBillingAccess(controller.signal);
      if (controller.signal.aborted) return;
      setAccess(license);
      setManualRefresh((value) => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted) setError(
        cause instanceof ApiError && cause.status === 401
          ? "Inicia sesión nuevamente para actualizar el estado."
          : cause instanceof ApiError && cause.status === 403
            ? "No tienes permiso para actualizar el estado."
            : cause instanceof ApiError && cause.status === 429
              ? "Espera un momento antes de volver a actualizar."
              : "No pudimos consultar tu suscripción. Inténtalo de nuevo.",
      );
    } finally {
      if (synchronization.current === controller) {
        synchronization.current = null;
        setSyncing(false);
      }
    }
  }
  const confirmation = useRef<AbortController | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => () => confirmation.current?.abort(), []);
  async function confirm(retry = false) {
    if (confirmation.current || synchronization.current || checking) return;
    const controller = new AbortController();
    confirmation.current = controller;
    setConfirming(true);
    setError("");
    try {
      let result: CheckoutAttempt;
      if (retry) {
        if (!attempt?.planCode || !attempt.planPriceCode)
          throw new Error("Payment attempt is missing its plan");
        result = await retryCheckoutAttempt(attemptId, controller.signal, {
          planCode: attempt.planCode,
          planPriceCode: attempt.planPriceCode,
        });
      } else {
        result = await confirmCheckoutAttempt(attemptId, controller.signal);
      }
      if (controller.signal.aborted) return;
      setAttempt(result);
      const nextUrl = checkoutActionUrl(result);
      if (nextUrl) window.location.assign(nextUrl);
      else setManualRefresh((value) => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted) setError(
        cause instanceof ApiError && cause.status === 401
          ? "Inicia sesión nuevamente para confirmar el cambio."
          : cause instanceof ApiError && cause.status === 403
            ? "Necesitas permiso de facturación y verificación en dos pasos."
            : cause instanceof ApiError && cause.status === 409
              ? "La suscripción cambió. Actualiza su estado antes de continuar."
              : cause instanceof ApiError && cause.status === 429
                ? "Espera un momento antes de volver a confirmar."
                : retry
                  ? "No pudimos abrir el pago. Inténtalo de nuevo."
                  : "No pudimos confirmar el cambio. Inténtalo de nuevo.",
      );
    } finally {
      if (confirmation.current === controller) {
        confirmation.current = null;
        setConfirming(false);
      }
    }
  }
  const { organization, locale } = useAccountingContext();
  const { session } = useSession();
  useEffect(() => {
    if (!session?.userId) return;
    try {
      const key = pendingCheckoutKey(organization.id, session.userId);
      // Returning from the provider does not confirm cancellation of the contract.
      if (!cancelled || !sessionStorage.getItem(key) || sessionStorage.getItem(key) === attemptId)
        sessionStorage.setItem(key, attemptId);
    } catch {
      /* The result page can still confirm while browser storage is unavailable. */
    }
  }, [attemptId, cancelled, organization.id, session?.userId]);
  const plansHref = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings/billing-plan`;

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let inFlight = false;

    let latest: CheckoutAttempt | undefined;
    let activated = false;
    async function check() {
      if (!active || controller.signal.aborted || inFlight || document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      inFlight = true;
      let received = false;
      setChecking(true);
      try {
        const result = await getCheckoutAttempt(attemptId, controller.signal);
        if (active) {
          latest = result;
          received = true;
          setAttempt(result);
          setError("");
          if (shouldReadCheckoutAccess(result)) {
            const license = await apiClient<CurrentAccess>("/payments/access", {
              signal: controller.signal,
            });
            if (!active || controller.signal.aborted) return;
            setAccess(license);
            activated = isCheckoutAccessActive(result, license);
            if (activated)
              window.dispatchEvent(new Event("balanz:billing-access-changed"));
          } else {
            setAccess(undefined);
          }
        }
      } catch (cause) {
        received = false;
        if (active && !controller.signal.aborted) {
          setError(
            cause instanceof ApiError && cause.status === 404
              ? "La solicitud de pago no está disponible en el despacho activo."
              : "No pudimos consultar el estado. Revisa tu conexión e inténtalo de nuevo.",
          );
        }
      } finally {
        inFlight = false;
        if (active) setChecking(false);
      }
      if (active && received && shouldPollCheckout(latest, activated, cancelled, returnedFromPayment) && Date.now() - startedAt < 120_000) {
        timer = setTimeout(check, 5_000);
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - startedAt < 120_000 &&
          (!latest || shouldPollCheckout(latest, activated, cancelled, returnedFromPayment))) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    queueMicrotask(() => { void check(); });
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [attemptId, manualRefresh, cancelled, returnedFromPayment]);

  const hasPlanDetails = Boolean(attempt?.planCode);
  useEffect(() => {
    if (!hasPlanDetails) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      getBillingPlans(controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setPlans(value);
            setPlanError(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setPlanError(true);
        });
    });
    return () => controller.abort();
  }, [organization.id, hasPlanDetails, planRetry]);
  const selectedPlan = plans?.find((plan) => plan.code === attempt?.planCode);
  const selectedPrice = selectedPlan?.prices.find(
    (price) => price.code === attempt?.planPriceCode,
  );
  const confirmed = isCheckoutAccessActive(attempt, access);
  const scheduled = isPlanChangeScheduled(attempt);
  useEffect(() => {
    if ((!confirmed && !isCheckoutTerminal(attempt) && !isRenewalResumeScheduled(attempt) && !isRenewalPlanChangeScheduled(attempt)) || !session?.userId)
      return;
    const key = pendingCheckoutKey(organization.id, session.userId);
    try {
      if (sessionStorage.getItem(key) === attemptId)
        sessionStorage.removeItem(key);
    } catch {
      /* Storage is optional for displaying the confirmed result. */
    }
  }, [confirmed, attempt, attemptId, organization.id, session?.userId]);
  const terminal = isCheckoutTerminal(attempt);
  const retryRequired = isCheckoutRetryablePending(attempt);
  const approvalUrl = checkoutActionUrl(attempt);
  const planChange = isCheckoutPlanChange(attempt);
  const awaitingApproval = Boolean(approvalUrl && !returnedFromPayment && !planChange);
  const awaitingPaymentConfirmation = returnedFromPayment && !cancelled &&
    attempt?.planChange?.action === "approve_payment" &&
    attempt.planChange.state === "awaiting_approval";
  const needsConfirmation = !awaitingPaymentConfirmation && Boolean(attempt?.planChange?.state === "awaiting_approval" && !confirmed && !scheduled && !terminal);
  const paymentPending = needsConfirmation && attempt?.planChange?.action === "approve_payment";
  const needsAttention =
    retryRequired ||
    attempt?.subscriptionStatus === "past_due" ||
    attempt?.subscriptionStatus === "suspended" ||
    attempt?.status === "rejected";
  const cancellingChange = Boolean(attempt?.planChange?.cancellationRequested);
  const changeCancelled = isPlanChangeCancelled(attempt);
  const abandoned = attempt?.abandoned === true;
  const title = abandoned
    ? "Intento descartado"
    : changeCancelled
    ? "Cambio de plan cancelado"
    : cancellingChange
      ? "Confirma que quieres conservar tu plan actual"
    : confirmed
    ? "Tu suscripción está activa"
    : scheduled
      ? "Tu cambio de plan está programado"
      : retryRequired
        ? "No se pudo iniciar el pago"
      : terminal || needsAttention
        ? "La contratación necesita atención"
        : awaitingApproval
          ? "Puedes retomar tu pago"
        : cancelled
          ? planChange ? "El cambio de plan no se completó" : "Puedes retomar tu pago"
        : needsConfirmation
          ? paymentPending ? "Completa el cambio de plan" : "Confirma tu cambio de plan"
        : returnedFromPayment ? "Estamos confirmando tu pago" : "Estamos confirmando tu suscripción";
  const description = abandoned
    ? "Conservas tu plan o prueba con su vigencia actual. Puedes elegir otro plan cuando quieras."
    : changeCancelled
    ? "Conservas tu plan actual. Ya puedes elegir otro plan en Planes y suscripción."
    : cancellingChange
      ? "Para terminar de cancelar el cambio, confirma en PayPal la renovación de tu plan actual. Después podrás elegir otro."
    : confirmed
    ? "Tu plan ya está disponible para este despacho."
    : scheduled
      ? "La autorización está confirmada. Conservas tu plan actual hasta el próximo ciclo."
    : retryRequired
      ? planChange
        ? "No pudimos iniciar el pago único de la diferencia. Tu cambio de plan sigue guardado; reintenta para continuar."
        : "No pudimos iniciar el pago. Tu solicitud sigue guardada; reintenta para continuar."
      : terminal
        ? "La contratación finalizó sin activar la suscripción."
        : needsAttention
          ? "La suscripción aún no está habilitada. Consulta la facturación para revisar su estado."
          : awaitingApproval
            ? "Puedes continuar en PayPal, descartar este intento o cerrar para retomarlo después. Tu plan actual se conserva mientras el pago siga pendiente."
          : cancelled
            ? planChange
              ? "El cambio no se completó. Puedes retomarlo o descartarlo para conservar tu plan actual."
              : "El pago no se completó. Puedes retomarlo, descartar el intento o cerrar y decidir después."
          : needsConfirmation
            ? paymentPending
              ? "Paga solo la diferencia entre tu plan actual y el nuevo por los días que quedan hasta tu próxima renovación. El nuevo plan se activa cuando se confirme el pago."
              : "Revisa tu autorización para continuar. Si queda un pago pendiente por el cambio, podrás completarlo en el siguiente paso."
          : returnedFromPayment
            ? "Estamos esperando la confirmación del pago para activar tu plan. No necesitas volver a pagar. Puedes consultar el estado aquí."
            : "Estamos verificando el pago. La activación puede tardar unos momentos.";
  const checkoutHref =
    attempt?.planCode && attempt.planPriceCode
      ? `/${locale}/organizations/${encodeURIComponent(organization.slug)}/checkout/payment?${new URLSearchParams({ plan: attempt.planCode, price: attempt.planPriceCode })}`
      : undefined;

  if (attempt?.operation === "change_renewal_plan") return <BillingRenewalPlanChangeResult
    attempt={attempt} plansHref={plansHref} planName={selectedPlan?.name ?? "Plan de próxima renovación"}
    checking={checking} retrying={confirming} error={error} onRefresh={() => setManualRefresh(value => value + 1)} onRetry={() => void confirm(true)} />;

  if (attempt?.operation === "resume_renewal") return <BillingRenewalResumeResult
    attempt={attempt} plansHref={plansHref} planName={plans?.find(plan => plan.code === (attempt.renewalResume?.planCode ?? attempt.planCode))?.name ?? "Plan de próxima renovación"}
    cancelled={cancelled} checking={checking} onRefresh={() => setManualRefresh(value => value + 1)}
    onRetry={() => void confirm(true)} retrying={confirming} error={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        accent={false}
        eyebrow="Planes y suscripción"
        title={title}
        description={description}
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            render={<Link href={plansHref} />}
            aria-label={changeCancelled ? "Cerrar y volver a mi suscripción" : "Cerrar sin descartar el intento y volver a planes"}
            title={changeCancelled ? "Volver a mi suscripción" : "Cerrar sin cancelar el pago"}
          >
            <X aria-hidden="true" />
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Surface>
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-heading-sm font-emphasis">
                {cancellingChange ? changeCancelled ? "Resumen del cambio cancelado" : "Restauración de tu plan actual" : "Resumen de contratación"}
              </h2>
              <p className="mt-1 break-words text-body-sm">
                <span className="text-muted-foreground">Despacho: </span>
                <span className="font-semibold">{organization.name}</span>
              </p>
            </div>
            <div className="space-y-4 p-5">
              {cancellingChange ? (
                <p className="text-body-sm">
                  {changeCancelled
                    ? `El cambio${selectedPlan ? ` a ${selectedPlan.name}` : " de plan"} se canceló. Tu plan actual y su renovación se conservan. Puedes consultar el importe y la fecha vigentes en Mi suscripción.`
                    : "Estás cancelando el cambio de plan. Conservas tus beneficios actuales; falta confirmar en PayPal la renovación de tu plan actual."}
                </p>
              ) : attempt ? (
                <div className="space-y-4 border-b border-border pb-5">
                  <div>
                    <p className="text-caption text-muted-foreground">
                      Plan seleccionado
                    </p>
                    <p className="mt-1 text-heading-md font-semibold">
                      {selectedPlan?.name ??
                        attempt.planCode ??
                        "Plan no disponible"}
                    </p>
                    {selectedPlan?.description ? (
                      <p className="mt-1 text-body-sm text-muted-foreground">
                        {selectedPlan.description}
                      </p>
                    ) : null}
                  </div>
                  {selectedPrice ? (
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <dt className="text-caption text-muted-foreground">
                          Precio de catálogo
                        </dt>
                        <dd className="mt-1 text-heading-sm font-semibold tabular-nums">
                          {formatExactMoney(
                            selectedPrice.amount,
                            selectedPrice.currency,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-caption text-muted-foreground">
                          Frecuencia de cobro
                        </dt>
                        <dd className="mt-1 text-body-sm font-semibold">
                          {period(selectedPrice)}
                        </dd>
                      </div>
                    </dl>
                  ) : hasPlanDetails && !plans && !planError ? (
                    <div role="status" className="space-y-2">
                      <span className="sr-only">
                        Cargando detalles del plan…
                      </span>
                      <div
                        aria-hidden="true"
                        className="h-6 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none"
                      />
                      <div
                        aria-hidden="true"
                        className="h-4 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none"
                      />
                    </div>
                  ) : (
                    <p className="text-body-sm text-muted-foreground">
                      No se pudo consultar el precio de esta opción. Puedes
                      revisar el detalle al continuar al pago.
                    </p>
                  )}
                  <dl>
                    <dt className="text-caption text-muted-foreground">
                      {scheduled
                        ? "Inicio del nuevo plan"
                        : "Fecha de renovación"}
                    </dt>
                    <dd className="mt-1 text-body-sm font-semibold">
                      {scheduled && attempt?.planChange?.effectiveAt
                        ? new Intl.DateTimeFormat("es-MX", {
                            dateStyle: "long",
                            timeZone: "America/Mexico_City",
                          }).format(new Date(attempt.planChange.effectiveAt))
                        : confirmed && access?.renewalAt
                          ? new Intl.DateTimeFormat("es-MX", {
                              dateStyle: "long",
                              timeZone: "America/Mexico_City",
                            }).format(new Date(access.renewalAt))
                          : confirmed
                            ? "Sin próxima renovación confirmada"
                            : "Disponible al activar la suscripción"}
                    </dd>
                  </dl>
                  {attempt.planChange?.amountDueNow && attempt.planChange.currency ? (
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <dt className="text-caption text-muted-foreground">{attempt.planChange.kind === "downgrade" ? "Importe a pagar hoy" : "Pago único por el cambio"}</dt>
                        <dd className="mt-1 text-heading-sm font-semibold tabular-nums">{formatExactMoney(attempt.planChange.amountDueNow, attempt.planChange.currency)}</dd>
                        <dd className="mt-2 text-body-sm text-muted-foreground">{attempt.planChange.kind === "downgrade" ? "El cambio se aplicará en tu próxima renovación. No se genera un cobro hoy." : "Es la diferencia de precio por los días que quedan hasta tu próxima renovación."}</dd>
                      </div>
                      {attempt.planChange.recurringAmount ? (
                        <div>
                          <dt className="text-caption text-muted-foreground">Próximo cobro: {attempt.planChange.nextBillingAt ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mexico_City" }).format(new Date(attempt.planChange.nextBillingAt)) : "fecha pendiente de confirmar"}</dt>
                          <dd className="mt-1 font-semibold tabular-nums">{formatExactMoney(attempt.planChange.recurringAmount, attempt.planChange.currency)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  {selectedPlan?.features.length ? (
                    <div className="space-y-3 border-t border-border pt-4">
                      <h3 className="text-body-sm font-semibold">
                        {scheduled
                          ? "Beneficios a partir del próximo ciclo"
                          : "Beneficios del plan"}
                      </h3>
                      <ul className="grid gap-3 sm:grid-cols-2">
                        {selectedPlan.features.map((feature) => (
                          <li
                            key={feature.code}
                            className="flex items-start gap-3 text-body-sm"
                          >
                            {feature.value === false ? (
                              <Minus
                                className="mt-1 size-4 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            ) : (
                              <Check
                                className="mt-1 size-4 shrink-0 text-primary"
                                aria-hidden="true"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="text-muted-foreground">
                                {feature.name}
                              </p>
                              <p className="font-semibold break-words">
                                {featureValue(feature.value)}
                                {typeof feature.value !== "boolean" &&
                                feature.unit &&
                                feature.unit !== "n_a"
                                  ? ` ${feature.unit}`
                                  : ""}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : selectedPlan ? (
                    <p className="text-body-sm text-muted-foreground">
                      No hay beneficios detallados para este plan.
                    </p>
                  ) : null}
                  {planError ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPlanRetry((value) => value + 1)}
                    >
                      Reintentar detalles del plan
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {!attempt && !error ? (
                <div role="status" aria-busy="true" className="space-y-3">
                  <span className="sr-only">
                    Consultando el estado de la suscripción
                  </span>
                  <div
                    aria-hidden="true"
                    className="h-5 w-48 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none"
                  />
                  <div
                    aria-hidden="true"
                    className="h-4 w-full animate-pulse rounded bg-muted motion-reduce:animate-none"
                  />
                </div>
              ) : attempt ? (
                <div
                  role="status"
                  className="flex items-center gap-3 text-body-sm"
                >
                  {confirmed || scheduled || changeCancelled ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="size-5 shrink-0 text-success"
                    />
                  ) : terminal || cancelled || awaitingApproval || needsAttention ? (
                    <CircleX
                      aria-hidden="true"
                      className="size-5 shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                    />
                  )}
                  <span>
                    {abandoned
                      ? "Intento descartado"
                      : changeCancelled
                        ? "Cambio cancelado; tu plan actual se conserva"
                      : cancellingChange
                        ? "Cancelación del cambio pendiente de confirmar"
                      : confirmed
                      ? "Suscripción activa"
                      : scheduled
                        ? "Cambio de plan programado"
                        : attempt.subscriptionStatus === "suspended"
                          ? "Suscripción suspendida"
                          : attempt.subscriptionStatus === "past_due"
                            ? "Pago pendiente de regularizar"
                            : terminal || cancelled
                              ? "Pago no completado"
                              : awaitingApproval
                                ? "Pago pendiente de completar"
                              : retryRequired
                                ? "Pago aún no iniciado"
                              : needsAttention
                                ? "No se pudo completar la contratación"
                                : "Esperando la confirmación del pago"}
                  </span>
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive-surface p-4 text-body-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <details className="text-caption text-muted-foreground">
                <summary className="min-h-10 cursor-pointer py-2 font-semibold">
                  Referencia de contratación
                </summary>
                <p className="break-all">{attemptId}</p>
              </details>
            </div>
          </Surface>
          <div className="flex flex-wrap gap-3">
            {abandoned ? (
              <Button render={<Link href={plansHref} />}>Ver planes</Button>
            ) : changeCancelled ? (
              <Button render={<Link href={plansHref} />}>Ver mi suscripción</Button>
            ) : cancellingChange ? null : needsConfirmation ? (
              <Button disabled={confirming || checking || syncing} onClick={() => void confirm()}>
                {confirming ? "Preparando…" : paymentPending ? "Continuar al pago" : "Continuar con el cambio"}
              </Button>
            ) : retryRequired ? (
              <Button disabled={confirming || checking || syncing} onClick={() => void confirm(true)}>
                {confirming ? "Retomando pago…" : "Reintentar pago"}
              </Button>
            ) : confirmed || scheduled ? (
              <Button render={<Link href={plansHref} />}>
                Ver mi suscripción
              </Button>
            ) : approvalUrl ? (
              <Button render={<a href={approvalUrl} />}>
                Retomar pago
              </Button>
            ) : cancelled || terminal ? (
              <Button render={<Link href={checkoutHref ?? plansHref} />}>
                {checkoutHref ? "Retomar pago" : "Ver planes"}
              </Button>
            ) : (
              <Button
                disabled={checking || syncing || confirming}
                onClick={() => void synchronize()}
              >
                {syncing ? "Consultando…" : "Consultar estado del pago"}
              </Button>
            )}
            {attempt && !terminal && !confirmed && !scheduled && attempt.planChange?.state !== "effective" && attempt.status !== "rejected" ? (
              <BillingDiscardCheckout
                attemptId={attemptId}
                plansHref={plansHref}
                cancellationRequested={cancellingChange}
                scheduledChange={attempt.planChange?.state === "scheduled"}
                planChange={planChange}
                disabled={confirming || checking || syncing}
              />
            ) : null}
          </div>
        </div>
        <Surface className="h-fit">
          <div className="space-y-3 p-5">
            <p className="flex items-center gap-2 text-body-sm font-semibold">
              <LockKeyhole className="size-4" aria-hidden="true" /> {changeCancelled ? "Tu plan actual se conserva" : cancellingChange ? "Confirma la renovación de tu plan actual" : confirmed ? "Tu suscripción está activa" : abandoned ? "Tu plan actual se conserva" : "Cerrar no cancela el intento"}
            </p>
            <p className="text-body-sm text-muted-foreground">
              {changeCancelled
                ? "El cambio de plan quedó cancelado. Consulta tu plan y su próxima renovación en Mi suscripción."
                : cancellingChange
                ? "Completa la cancelación del cambio en PayPal para conservar la renovación de tu plan actual."
                : confirmed
                ? "Consulta tus beneficios y la próxima renovación desde Planes y suscripción."
                : abandoned
                ? "Este intento ya no puede activar una suscripción en Balanz. Para contratar, elige un plan e inicia una nueva solicitud."
                : "La X te devuelve a Planes y suscripción sin cancelar el pago pendiente. Podrás retomarlo desde ahí."}
            </p>
            <p className="text-body-sm text-muted-foreground">
              {changeCancelled
                ? "No necesitas volver a pagar para conservar tu plan actual. Cerrar esta página no modifica tu suscripción."
                : cancellingChange
                ? "Cerrar esta página no completa la cancelación. Puedes retomarla desde Planes y suscripción."
                : confirmed
                ? "Cerrar esta página no cancela tu suscripción. Puedes administrar tu plan y su renovación desde la configuración."
                : abandoned
                ? "No apruebes el enlace antiguo de PayPal. Si llega una aprobación posterior, gestionaremos la cancelación de esa contratación sin cambiar tu plan actual."
                : "Para abandonar esta contratación, elige «Conservar mi plan actual». Si ya pagaste, primero consulta el estado para evitar un segundo cobro."}
            </p>
          </div>
        </Surface>
      </div>
    </div>
  );
}
