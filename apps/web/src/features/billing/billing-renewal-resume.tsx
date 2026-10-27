"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ControlledDialog } from "@/components/overlay-dialog";
import { Surface } from "@/components/product-patterns";
import { PageHeader } from "@/components/page-header";
import { useAccountingContext } from "@/components/accounting-context";
import { useSession } from "@/features/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { formatExactMoney } from "@/features/cfdi/exact-decimal";
import { getCheckoutAttempt, resumeBillingRenewal, type BillingSubscription, type CheckoutAttempt } from "./api";
import { billingDate } from "./subscription-management";
import { canReplaceRenewalResume, checkoutActionUrl, isCheckoutTerminal, isRenewalResumeScheduled, isCheckoutRetryablePending, pendingCheckoutKey } from "./checkout-recovery";
import { BillingDiscardCheckout } from "./billing-discard-checkout";

export function BillingRenewalStatus({ renewal, planName }: { renewal: NonNullable<BillingSubscription["pendingRenewal"]>; planName?: string }) {
  if (["preparing", "awaiting_approval"].includes(renewal.state)) return <>
    <p className="font-semibold">Reactivación pendiente de autorizar</p>
    <p className="text-muted-foreground">Tu acceso actual se conserva. Completa la autorización de las próximas renovaciones en PayPal.</p>
    {!renewal.attemptId ? <p className="text-muted-foreground">La solicitud está pendiente del usuario que la inició.</p> : null}
  </>;
  return <>
    <p className="font-semibold">{renewal.state === "effective" ? "Renovación iniciada" : "Renovación activada"}</p>
    <p className="text-muted-foreground">Conservas tu plan actual. No se cobra el período ya pagado.</p>
    {planName ? <p className="text-muted-foreground">Plan para la próxima renovación: <span className="font-semibold text-foreground">{planName}</span>.</p> : null}
    {renewal.state === "effective"
      ? <p className="text-muted-foreground">La renovación comenzó el {billingDate(renewal.effectiveAt)}. Consulta el siguiente cobro en Mi suscripción.</p>
      : <p className="text-muted-foreground">Próximo cobro: <span className="font-semibold tabular-nums text-foreground">{formatExactMoney(renewal.recurringAmount, renewal.currency)}</span> el {billingDate(renewal.effectiveAt)}.</p>}
  </>;
}

export function BillingResumeRenewal({ subscription }: { subscription: BillingSubscription }) {
  const { organization, locale } = useAccountingContext();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const operationKey = useRef<string | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const href = (attemptId: string) => `/${locale}/organizations/${encodeURIComponent(organization.slug)}/checkout/success?${new URLSearchParams({ attemptId })}`;
  const renewal = subscription.pendingRenewal;
  const waiting = renewal && ["preparing", "awaiting_approval"].includes(renewal.state);
  const scheduled = renewal && ["scheduled", "effective"].includes(renewal.state);
  async function resume() {
    if (pending.current || !session?.userId) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const storageKey = `balanz:resume-renewal:${organization.id}:${session.userId}:${subscription.id}`;
      if (!operationKey.current) {
        try {
          const stored = sessionStorage.getItem(storageKey);
          if (stored && /^[0-9a-f-]{36}$/i.test(stored)) operationKey.current = stored;
        } catch { /* The in-memory key still protects retries while storage is unavailable. */ }
        operationKey.current ??= crypto.randomUUID();
        try { sessionStorage.setItem(storageKey, operationKey.current); } catch { /* Optional recovery storage. */ }
      }
      const previous = await getCheckoutAttempt(operationKey.current, controller.signal).catch(() => undefined);
      if (controller.signal.aborted) return;
      if (canReplaceRenewalResume(previous, operationKey.current, subscription.id)) {
        operationKey.current = crypto.randomUUID();
        try { sessionStorage.setItem(storageKey, operationKey.current); } catch { /* The new key survives in memory. */ }
      }
      let receipt: CheckoutAttempt;
      try {
        receipt = await resumeBillingRenewal(operationKey.current, subscription.id, controller.signal);
      } catch (cause) {
        if (controller.signal.aborted) return;
        // Recover the same durable request after an ambiguous transport response.
        const saved = await getCheckoutAttempt(operationKey.current, controller.signal).catch(() => undefined);
        if (!saved || saved.operation !== "resume_renewal" || saved.renewalResume?.sourceSubscriptionId !== subscription.id) throw cause;
        receipt = saved;
      }
      if (controller.signal.aborted) return;
      if (receipt.operation !== "resume_renewal" || receipt.renewalResume?.sourceSubscriptionId !== subscription.id) throw new Error("Renewal response changed");
      try { sessionStorage.setItem(pendingCheckoutKey(organization.id, session.userId), receipt.attemptId); } catch { /* Server retains the pending renewal. */ }
      window.location.assign(href(receipt.attemptId));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof ApiError && cause.status === 401
        ? "Inicia sesión nuevamente para volver a activar la renovación."
        : cause instanceof ApiError && cause.status === 403
          ? "Necesitas permiso de facturación y verificación en dos pasos."
          : cause instanceof ApiError && cause.status === 409
            ? "La suscripción se actualizó. Cierra esta ventana y revisa su estado."
            : cause instanceof ApiError && cause.status === 429
              ? "Espera unos momentos e inténtalo de nuevo."
              : "No pudimos iniciar la reactivación. Inténtalo de nuevo.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  if (scheduled) return renewal.state === "scheduled" && renewal.attemptId
    ? <BillingDiscardCheckout attemptId={renewal.attemptId} plansHref={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings/billing-plan`} renewalResume renewalScheduled />
    : null;
  if (waiting) return renewal.attemptId
    ? <Button render={<Link href={href(renewal.attemptId)} />}>Continuar reactivación</Button>
    : null;
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}>Volver a activar renovación</Button>
    <ControlledDialog open={open} onClose={() => { if (!busy) setOpen(false); }} title="Volver a activar renovación" description="Conservas tu plan y el período que ya pagaste.">
      <div className="space-y-4 p-5">
        <p className="text-body-sm">No pagarás nada hoy. Prepararemos una autorización de PayPal para renovar cuando termine tu período pagado, el {billingDate(subscription.currentPeriodEnd)}.</p>
        <p className="text-body-sm text-muted-foreground">Revisarás el importe y la fecha del próximo cobro antes de autorizar en PayPal. Cerrar esta ventana no cambia tu suscripción.</p>
        {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive-surface p-4 text-body-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Volver</Button>
          <Button disabled={busy} onClick={() => void resume()}>{busy ? "Preparando…" : error ? "Intentar de nuevo" : "Preparar renovación"}</Button>
        </div>
      </div>
    </ControlledDialog>
  </>;
}

export function BillingRenewalResumeResult({ attempt, plansHref, planName, cancelled, checking, onRefresh, onRetry, retrying, error }: {
  attempt: CheckoutAttempt; plansHref: string; planName: string; cancelled: boolean; checking: boolean; onRefresh: () => void; onRetry?: () => void; retrying?: boolean; error?: string;
}) {
  const renewal = attempt.renewalResume;
  const scheduled = isRenewalResumeScheduled(attempt);
  const effective = scheduled && renewal?.state === "effective";
  const terminal = isCheckoutTerminal(attempt) || attempt.status === "rejected";
  const approvalUrl = checkoutActionUrl(attempt);
  return <div className="space-y-6">
    <PageHeader title={effective ? "Renovación iniciada" : scheduled ? "Renovación activada" : terminal ? "Reactivación no completada" : "Autoriza la renovación de tu plan"}
      description={effective ? "La renovación comenzó. Consulta tu acceso y el siguiente cobro en Mi suscripción." : scheduled ? "Conservas tu plan y su próximo cobro quedó programado. No se vuelve a cobrar el período ya pagado." : terminal ? "Tu acceso al período ya pagado se conserva. La renovación sigue cancelada." : "Tu acceso actual se conserva. La renovación se activará cuando PayPal confirme tu autorización."}
      actions={<Button variant="ghost" size="icon" className="min-h-11 min-w-11" render={<Link href={plansHref} />} aria-label="Cerrar y volver a mi suscripción"><X aria-hidden="true" /></Button>} />
    <Surface className="space-y-4 p-5">
      <h2 className="text-heading-sm font-emphasis">{planName}</h2>
      {effective ? <p className="text-body-sm">Inicio de la renovación: {billingDate(renewal.effectiveAt)}.</p> : renewal && !terminal ? <dl className="space-y-3">
        <div><dt className="text-caption text-muted-foreground">Importe a pagar hoy</dt><dd className="font-semibold tabular-nums">{formatExactMoney(renewal.amountDueNow, renewal.currency)}</dd></div>
        <div><dt className="text-caption text-muted-foreground">{scheduled ? "Próximo cobro" : "Próximo cobro si autorizas"}</dt><dd className="font-semibold tabular-nums">{formatExactMoney(renewal.recurringAmount, renewal.currency)} el {billingDate(renewal.effectiveAt)}</dd></div>
      </dl> : null}
      <p role="status" className="text-body-sm">{effective ? "El nuevo período de renovación quedó confirmado." : scheduled ? "PayPal confirmó la autorización de las próximas renovaciones." : terminal ? "No se activó una nueva renovación." : cancelled ? "Saliste de PayPal sin completar la autorización. Puedes retomarla o descartar esta solicitud." : "No necesitas pagar otra vez el período actual. Confirma únicamente las próximas renovaciones en PayPal."}</p>
      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive-surface p-4 text-body-sm text-destructive">{error}</p> : null}
      {!scheduled && !terminal && approvalUrl ? <Button render={<a href={approvalUrl} />}>Autorizar renovación en PayPal</Button> : null}
      {!scheduled && !terminal && isCheckoutRetryablePending(attempt) && onRetry ? <Button disabled={checking || retrying} onClick={onRetry}>{retrying ? "Preparando…" : "Reintentar preparación de la renovación"}</Button> : null}
      {!scheduled && !terminal && !approvalUrl && !isCheckoutRetryablePending(attempt) ? <Button variant="outline" disabled={checking} onClick={onRefresh}>{checking ? "Consultando…" : "Consultar estado de la renovación"}</Button> : null}
      {!scheduled && !terminal ? <BillingDiscardCheckout attemptId={attempt.attemptId} plansHref={plansHref} renewalResume renewalScheduled={scheduled} /> : null}
      {scheduled || terminal ? <Button render={<Link href={plansHref} />}>Ver mi suscripción</Button> : null}
    </Surface>
  </div>;
}
