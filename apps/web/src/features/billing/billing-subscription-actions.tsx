"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { useSession } from "@/features/session/session-provider";
import { Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { ControlledDialog } from "@/components/overlay-dialog";
import { ApiError } from "@/lib/api-client";
import { BillingRenewalStatus, BillingResumeRenewal } from "./billing-renewal-resume";
import { BillingDiscardCheckout } from "./billing-discard-checkout";
import {
  cancelBillingSubscription,
  getBillingSubscription,
  type BillingPlan,
  type BillingSubscription,
} from "./api";
import {
  billingDate,
  hasPendingPlanChange,
  subscriptionEnd,
  pendingPlanChangeHref,
  pendingSubscriptionHref,
  hasPendingRenewalPlanChange,
} from "./subscription-management";

export function BillingSubscriptionActions({
  subscription,
  plans,
  onChange,
}: {
  subscription: BillingSubscription;
  plans?: BillingPlan[];
  onChange: (subscription: BillingSubscription | null) => void;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const operationKey = useRef<string | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const { organization, locale } = useAccountingContext();
  const continuationHref = pendingPlanChangeHref(subscription, locale, organization.slug);
  const change = subscription.pendingPlanChange;
  const pendingPayment = subscription.status === "pending";
  const paymentHref = pendingSubscriptionHref(subscription, locale, organization.slug);
  const pendingChange = hasPendingPlanChange(subscription);
  const scheduled =
    subscription.cancellation?.state === "scheduled" ||
    (subscription.cancelAtPeriodEnd &&
      subscription.cancellation?.state !== "pending");
  const renewal = subscription.pendingRenewal;
  const renewalChange = subscription.pendingRenewalPlanChange;
  const pendingRenewalChange = hasPendingRenewalPlanChange(subscription);
  const renewalChangeHref = renewalChange?.attemptId
    ? `/${locale}/organizations/${encodeURIComponent(organization.slug)}/checkout/success?${new URLSearchParams({ attemptId: renewalChange.attemptId })}` : undefined;
  const showingRenewal = Boolean(renewal && renewal.state !== "failed");
  const cancelling = subscription.cancellation?.state === "pending";
  const paidThrough = subscriptionEnd(subscription);
  const [checkedAt] = useState(() => Date.now());
  const hasPaidPeriod = Boolean(
    paidThrough && Date.parse(paidThrough) > checkedAt,
  );
  async function cancel() {
    if (pending.current || !session?.userId) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      const storageKey = `balanz:cancel-subscription:${subscription.organizationId}:${session.userId}:${subscription.id}`;
      if (!operationKey.current) {
        const stored = sessionStorage.getItem(storageKey);
        operationKey.current =
          stored && /^[0-9a-f-]{36}$/i.test(stored)
            ? stored
            : crypto.randomUUID();
        sessionStorage.setItem(storageKey, operationKey.current);
      }
      const updated = await cancelBillingSubscription(
        operationKey.current,
        subscription.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      onChange(updated);
      setOpen(false);
      window.dispatchEvent(new Event("balanz:billing-access-changed"));
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && [404, 409].includes(cause.status)) {
        try {
          const current = await getBillingSubscription(controller.signal);
          if (controller.signal.aborted) return;
          if (!current) {
            onChange(null);
            setOpen(false);
            setError("");
            window.dispatchEvent(new Event("balanz:billing-access-changed"));
            return;
          }
          if (current) {
            onChange(current);
            if (current.cancelAtPeriodEnd || current.cancellation) {
              setOpen(false);
              setError("");
              return;
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      setError(
        cause instanceof ApiError && cause.status === 403
          ? "Necesitas permiso de facturación y verificación en dos pasos para cancelar."
          : cause instanceof ApiError && cause.status === 409
            ? "La cancelación aún no se confirmó. Revisa el estado de la suscripción y vuelve a intentarlo."
            : cause instanceof ApiError && cause.status === 429
              ? "Espera un momento antes de reintentar."
              : "No se pudo confirmar la cancelación. Puedes reintentar la misma solicitud.",
      );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <Surface
        labelledBy={headingId}
        className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-6"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <h2 id={headingId} className="text-heading-sm font-emphasis">
            Gestión de suscripción
          </h2>
          <div
            id={descriptionId}
            className="max-w-xl space-y-1 text-body-sm"
            role="status"
          >
            {pendingRenewalChange && renewalChange ? <>
              <p className="font-semibold">{renewalChange.cancellationRequested ? "Cancelación del cambio de renovación pendiente" : "Cambio de próxima renovación pendiente"}</p>
              <p className="text-muted-foreground">{renewalChange.cancellationRequested
                ? "Confirma en PayPal la renovación anterior para terminar de cancelar este cambio. Tu acceso actual se conserva."
                : `${plans?.find(plan => plan.code === renewalChange.targetPlanCode)?.name ?? renewalChange.targetPlanCode}: desde el ${billingDate(renewalChange.effectiveAt)}, si autorizas el cambio en PayPal. Conservas tu plan actual hasta entonces; no se cobra hoy.`}</p>
            </> : scheduled && hasPaidPeriod && showingRenewal && renewal ? (
              <BillingRenewalStatus renewal={renewal} planName={plans?.find(plan => plan.code === (renewal.planCode ?? subscription.planCode))?.name} />
            ) : pendingPayment && !scheduled ? (
              <>
                <p className="font-semibold">{cancelling ? "Confirmando el descarte del intento" : "Pago pendiente de completar"}</p>
                <p className="text-muted-foreground">
                  {cancelling
                    ? "El descarte sigue en proceso. Puedes comprobarlo de nuevo; tu plan actual se conserva."
                    : "Tu plan o prueba mantienen su vigencia actual. Retoma el pago si quieres continuar; descarta el intento si prefieres quedarte como estás."}
                </p>
              </>
            ) : pendingChange && change ? (
              <>
                <p className="font-semibold">
                  {change.cancellationRequested
                    ? "Cancelación del cambio pendiente de confirmar"
                    : change.state === "scheduled"
                    ? "Cambio de plan programado"
                    : "Cambio de plan pendiente de confirmación"}
                </p>
                <p className="text-muted-foreground">
                  {plans?.find((plan) => plan.code === change.targetPlanCode)
                    ?.name ?? change.targetPlanCode}
                  {change.cancellationRequested
                    ? ": confirma en PayPal la renovación de tu plan actual para terminar de cancelar este cambio. Tu suscripción sigue activa."
                    : change.kind === "upgrade"
                    ? ": se activará cuando completes el pago por los días que quedan hasta tu próxima renovación. Conservas tu plan actual mientras tanto."
                    : `: a partir del ${billingDate(change.effectiveAt)}. Conservas los beneficios actuales hasta entonces.`}
                </p>
              </>
            ) : cancelling ? (
              <>
                <p className="font-semibold">Confirmando la cancelación</p>
                <p className="text-muted-foreground">
                  La solicitud quedó registrada. Billing está confirmando que no
                  se renueve.
                </p>
              </>
            ) : scheduled ? (
              <>
                <p className="font-semibold">Cancelación programada</p>
                <p className="text-muted-foreground">
                  {hasPaidPeriod
                    ? `Acceso hasta el ${billingDate(paidThrough)}. La suscripción ya no se renovará.`
                    : "La renovación quedó cancelada. No hay un período pagado vigente."}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Puedes cancelar la renovación de tu suscripción. Conservarás el
                acceso durante el período ya pagado.
              </p>
            )}
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center gap-3 empty:hidden sm:w-auto sm:max-w-md sm:justify-end">
          {scheduled && hasPaidPeriod && !pendingRenewalChange ? <BillingResumeRenewal subscription={subscription} /> : null}
          {pendingRenewalChange && renewalChangeHref ? <Button render={<a href={renewalChangeHref} />}>Continuar cambio de próxima renovación</Button> : null}
          {renewalChange?.attemptId && !["failed", "effective"].includes(renewalChange.state) ? <BillingDiscardCheckout
            attemptId={renewalChange.attemptId}
            plansHref={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings/billing-plan`}
            cancellationRequested={renewalChange.cancellationRequested}
            renewalPlanChange
            targetPlanName={plans?.find(plan => plan.code === renewalChange.targetPlanCode)?.name}
            scheduledChange={renewalChange.state === "scheduled"}
            planChange
          /> : null}
          {pendingPayment && !scheduled && subscription.pendingCheckoutAttemptId ? <>
            {paymentHref ? <Button render={<a href={paymentHref} />}>Retomar pago</Button> : null}
            <BillingDiscardCheckout
              attemptId={subscription.pendingCheckoutAttemptId}
              cancellationRequested={cancelling}
              plansHref={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings/billing-plan`}
            />
          </> : null}
          {pendingChange && change ? <>
            {continuationHref ? (
              <a
                className="inline-flex min-h-10 items-center font-semibold underline underline-offset-4"
                href={continuationHref}
              >
                {change.cancellationRequested ? "Completar cancelación del cambio" : "Continuar cambio de plan"}
              </a>
            ) : null}
            {change.attemptId ? (
              <BillingDiscardCheckout
                attemptId={change.attemptId}
                plansHref={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings/billing-plan`}
                cancellationRequested={change.cancellationRequested}
                scheduledChange={change.state === "scheduled"}
                planChange
              />
            ) : null}
          </> : null}
          {!scheduled && ["active", "past_due", "suspended"].includes(subscription.status) ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full text-destructive hover:text-destructive sm:w-auto"
              aria-describedby={descriptionId}
              onClick={() => setOpen(true)}
            >
              {cancelling ? "Revisar cancelación" : pendingPayment ? "Cancelar solicitud de pago" : "Cancelar suscripción"}
            </Button>
          ) : null}
        </div>
      </Surface>
      <ControlledDialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={pendingPayment ? "Cancelar la solicitud de pago" : "Cancelar la renovación"}
        description={
          pendingPayment
            ? "Confirma la cancelación antes de elegir otro plan."
            : hasPaidPeriod
            ? "Conservarás el acceso durante el período ya pagado."
            : "Confirma que quieres detener las próximas renovaciones."
        }
      >
        <div className="space-y-4 p-5">
          <p className="text-body-sm">
            {pendingPayment ? (
              "Se cancelará la suscripción pendiente en PayPal. Cuando se confirme, podrás elegir otro plan."
            ) : hasPaidPeriod ? (
              <>
                Tu acceso continuará hasta el{" "}
                <strong>{billingDate(paidThrough)}</strong>. Al confirmar, se
                detendrán las próximas renovaciones.
              </>
            ) : (
              "Al confirmar, se detendrán las próximas renovaciones y los cobros pendientes de esta suscripción."
            )}
          </p>
          {pendingChange ? (
            <p className="text-body-sm text-muted-foreground">
              También se descartará el cambio de plan pendiente. Cancelar
              detiene la renovación de esta suscripción.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-body-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {pendingPayment ? "Volver" : "Conservar suscripción"}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void cancel()}
            >
              {busy ? "Confirmando…" : "Confirmar cancelación"}
            </Button>
          </div>
        </div>
      </ControlledDialog>
    </>
  );
}
