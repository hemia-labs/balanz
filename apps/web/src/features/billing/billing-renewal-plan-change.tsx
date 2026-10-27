"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { changeRenewalPlan, getCheckoutAttempt, type BillingPlan, type BillingPlanPrice, type BillingSubscription, type CheckoutAttempt } from "./api";
import { billingDate, canChangeRenewalPlan } from "./subscription-management";
import { canReplaceRenewalPlanChange, checkoutActionUrl, isCheckoutRetryablePending, isCheckoutTerminal, isRenewalPlanChangeScheduled, pendingCheckoutKey } from "./checkout-recovery";
import { BillingDiscardCheckout } from "./billing-discard-checkout";

export function BillingNextRenewalPlan({ subscription, plan, price }: { subscription: BillingSubscription; plan: BillingPlan; price: BillingPlanPrice }) {
  const { organization, locale } = useAccountingContext();
  const router = useRouter();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const operationKey = useRef<string | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const renewal = subscription.pendingRenewal;
  async function prepare() {
    if (pending.current || !session?.userId || !renewal || !canChangeRenewalPlan(subscription)) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const storageKey = `balanz:change-renewal-plan:${organization.id}:${session.userId}:${subscription.id}:${renewal.subscriptionId}:${plan.code}:${price.code}`;
      if (!operationKey.current) {
        try {
          const stored = sessionStorage.getItem(storageKey);
          if (stored && /^[0-9a-f-]{36}$/i.test(stored)) operationKey.current = stored;
        } catch { /* Server recovery remains available without browser storage. */ }
        operationKey.current ??= crypto.randomUUID();
      }
      const expected = { sourceSubscriptionId: subscription.id, renewalSubscriptionId: renewal.subscriptionId, targetPlanCode: plan.code, targetPlanPriceCode: price.code };
      const previous = await getCheckoutAttempt(operationKey.current, controller.signal).catch(() => undefined);
      if (controller.signal.aborted) return;
      if (canReplaceRenewalPlanChange(previous, { ...expected, attemptId: operationKey.current })) operationKey.current = crypto.randomUUID();
      try { sessionStorage.setItem(storageKey, operationKey.current); } catch { /* Preserve the same key in memory. */ }
      let receipt: CheckoutAttempt;
      try {
        receipt = await changeRenewalPlan({ idempotencyKey: operationKey.current, expectedSubscriptionId: subscription.id,
          expectedRenewalSubscriptionId: renewal.subscriptionId, targetPlanCode: plan.code, targetPlanPriceCode: price.code }, controller.signal);
      } catch (cause) {
        if (controller.signal.aborted) return;
        const saved = await getCheckoutAttempt(operationKey.current, controller.signal).catch(() => undefined);
        const change = saved?.renewalPlanChange;
        if (!saved || saved.operation !== "change_renewal_plan" || change?.sourceSubscriptionId !== expected.sourceSubscriptionId ||
          change.renewalSubscriptionId !== expected.renewalSubscriptionId || change.targetPlanCode !== plan.code || change.targetPlanPriceCode !== price.code) throw cause;
        receipt = saved;
      }
      if (controller.signal.aborted) return;
      const change = receipt.renewalPlanChange;
      if (receipt.operation !== "change_renewal_plan" || change?.sourceSubscriptionId !== expected.sourceSubscriptionId ||
        change.renewalSubscriptionId !== expected.renewalSubscriptionId || change.targetPlanCode !== plan.code || change.targetPlanPriceCode !== price.code) throw new Error("Renewal change response mismatch");
      try { sessionStorage.setItem(pendingCheckoutKey(organization.id, session.userId), receipt.attemptId); } catch { /* Durable recovery belongs to Billing. */ }
      router.push(`/${locale}/organizations/${encodeURIComponent(organization.slug)}/checkout/success?${new URLSearchParams({ attemptId: receipt.attemptId })}`);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof ApiError && cause.status === 401
        ? "Inicia sesión nuevamente para cambiar la próxima renovación."
        : cause instanceof ApiError && cause.status === 403
          ? "Necesitas permiso de facturación y verificación en dos pasos."
          : cause instanceof ApiError && cause.status === 409
            ? "La renovación se actualizó. Cierra esta ventana y revisa tu suscripción."
            : cause instanceof ApiError && cause.status === 429
              ? "Espera unos momentos e inténtalo de nuevo."
              : "No pudimos iniciar el cambio. Inténtalo de nuevo.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  return <>
    <Button onClick={() => setOpen(true)} disabled={!canChangeRenewalPlan(subscription)}>Cambiar plan de la próxima renovación</Button>
    <ControlledDialog open={open} onClose={() => { if (!busy) setOpen(false); }} title="Cambiar plan de la próxima renovación" description="Conservas tu plan actual durante el período ya pagado.">
      <div className="space-y-4 p-5">
        <p className="text-body-sm">Elegiste <strong>{plan.name}</strong> por <strong className="tabular-nums">{formatExactMoney(price.amount, price.currency)}</strong> desde el <strong>{billingDate(renewal?.effectiveAt)}</strong>.</p>
        <p className="text-body-sm">No pagarás nada hoy. Revisarás la solicitud antes de autorizar el cambio en PayPal.</p>
        <p className="text-body-sm text-muted-foreground">La renovación que ya autorizaste se conserva hasta que PayPal confirme el nuevo plan. Cerrar esta ventana no modifica tu suscripción.</p>
        {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive-surface p-4 text-body-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Volver</Button>
          <Button disabled={busy} onClick={() => void prepare()}>{busy ? "Preparando…" : error ? "Intentar de nuevo" : "Preparar cambio de renovación"}</Button>
        </div>
      </div>
    </ControlledDialog>
  </>;
}

export function BillingRenewalPlanChangeResult({ attempt, plansHref, planName, checking, retrying, onRefresh, onRetry, error }: {
  attempt: CheckoutAttempt; plansHref: string; planName: string; checking: boolean; retrying: boolean; onRefresh: () => void; onRetry: () => void; error: string;
}) {
  const change = attempt.renewalPlanChange;
  const scheduled = isRenewalPlanChangeScheduled(attempt);
  const effective = scheduled && change?.state === "effective";
  const terminal = isCheckoutTerminal(attempt) || attempt.status === "rejected";
  const cancelling = Boolean(change?.cancellationRequested);
  const cancelled = terminal && change?.state === "failed" && cancelling && attempt.statusFresh;
  const url = checkoutActionUrl(attempt);
  return <div className="space-y-6">
    <PageHeader
      title={cancelled ? "Cambio de renovación cancelado" : cancelling ? "Confirma la renovación anterior" : effective ? "El nuevo plan ya comenzó" : scheduled ? "Plan de próxima renovación actualizado" : terminal ? "Cambio de renovación no completado" : "Autoriza el plan de la próxima renovación"}
      description={cancelled ? "La renovación anterior se conserva y tu acceso actual sigue vigente." : cancelling ? "Completa la restauración de la renovación anterior en PayPal. Tu acceso actual se conserva." : scheduled ? "PayPal confirmó el nuevo plan para la renovación. Conservas tu plan actual hasta entonces." : terminal ? "Tu acceso actual se conserva. Consulta el plan de renovación vigente en Mi suscripción." : "Tu plan actual y la renovación ya autorizada se conservan hasta confirmar este cambio en PayPal."}
      actions={<Button variant="ghost" size="icon" className="min-h-11 min-w-11" render={<Link href={plansHref} />} aria-label="Cerrar sin cancelar el cambio y volver a mi suscripción"><X aria-hidden="true" /></Button>} />
    <Surface className="space-y-4 p-5">
      {!terminal && !cancelling && change ? <>
        <h2 className="text-heading-sm font-emphasis">{planName}</h2>
        <dl className="space-y-3">
          {!effective ? <div><dt className="text-caption text-muted-foreground">Importe a pagar hoy</dt><dd className="font-semibold tabular-nums">{formatExactMoney(change.amountDueNow, change.currency)}</dd></div> : null}
          <div><dt className="text-caption text-muted-foreground">{effective ? "Inicio del nuevo plan" : scheduled ? "Próxima renovación" : "Próxima renovación si autorizas"}</dt><dd className="font-semibold tabular-nums">{formatExactMoney(change.recurringAmount, change.currency)} desde el {billingDate(change.effectiveAt)}</dd></div>
        </dl>
      </> : null}
      <p role="status" className="text-body-sm">{cancelled ? "Cambio cancelado; el plan actual y su renovación se conservan." : cancelling ? "La cancelación del cambio está pendiente de confirmar en PayPal." : scheduled ? "El cambio quedó confirmado sin cobrar de nuevo el período actual." : terminal ? "No se confirmó un cambio de renovación." : "No se genera un cobro hoy. El nuevo plan comenzará con la renovación indicada si confirmas en PayPal."}</p>
      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive-surface p-4 text-body-sm text-destructive">{error}</p> : null}
      {!scheduled && !terminal && url ? <Button render={<a href={url} />}>{cancelling ? "Conservar renovación anterior en PayPal" : "Autorizar cambio de renovación en PayPal"}</Button> : null}
      {!scheduled && !terminal && isCheckoutRetryablePending(attempt) ? <Button disabled={checking || retrying} onClick={onRetry}>{retrying ? "Preparando…" : "Reintentar preparación del cambio"}</Button> : null}
      {!scheduled && !terminal && !url && !isCheckoutRetryablePending(attempt) ? <Button variant="outline" disabled={checking} onClick={onRefresh}>{checking ? "Consultando…" : "Consultar estado del cambio"}</Button> : null}
      {!terminal && !scheduled ? <BillingDiscardCheckout attemptId={attempt.attemptId} plansHref={plansHref} planChange renewalPlanChange targetPlanName={planName} scheduledChange={scheduled} cancellationRequested={cancelling} /> : null}
      {scheduled || terminal ? <Button render={<Link href={plansHref} />}>Ver mi suscripción</Button> : null}
    </Surface>
  </div>;
}
