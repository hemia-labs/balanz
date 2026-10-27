"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, LockKeyhole, Minus, X } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/product-patterns";
import { LiveForbiddenScreen } from "@/features/clients/live-fallback-screens";
import { formatExactMoney } from "@/features/cfdi/exact-decimal";
import { useSession } from "@/features/session/session-provider";
import { apiClient, ApiError } from "@/lib/api-client";
import { hasCapability } from "@/lib/permissions";
import {
  getBillingPlans,
  getBillingSubscription,
  getPlanChangeQuote,
  type PlanChangeQuote,
  type BillingSubscription,
  type BillingPlan,
  type BillingPlanPrice,
} from "./api";
import { BillingLegalStep } from "./billing-legal-step";
import { period, featureValue } from "./billing-plan-format";
import { hasCurrentBillingPlan, type CurrentAccess } from "./current-plan";
import { billingDate, canChangeSubscription } from "./subscription-management";

export function BillingPaymentScreen() {
  const { organization, locale, capabilities } = useAccountingContext();
  const { session } = useSession();
  const params = useSearchParams();
  if (!hasCapability(capabilities, "billing.manage")) {
    return <LiveForbiddenScreen capability="billing.manage" />;
  }
  if (!session?.userId)
    return (
      <main className="min-h-screen w-full flex-1 bg-muted/35 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-2xl">
          <BillingPaymentSkeleton />
        </div>
      </main>
    );
  return (
    <PaymentDetails
      key={`${organization.id}:${session.userId}:${params.get("plan")}:${params.get("price")}`}
      organizationId={organization.id}
      organizationName={organization.name}
      userId={session.userId}
      plansHref={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings/billing-plan`}
      planCode={params.get("plan") ?? ""}
      priceCode={params.get("price") ?? ""}
    />
  );
}

function PaymentDetails({
  organizationId,
  organizationName,
  userId,
  plansHref,
  planCode,
  priceCode,
}: {
  organizationId: string;
  organizationName: string;
  userId: string;
  plansHref: string;
  planCode: string;
  priceCode: string;
}) {
  const [state, setState] = useState<{
    plan?: BillingPlan;
    price?: BillingPlanPrice;
    subscription?: BillingSubscription;
    quote?: PlanChangeQuote;
    error?: string;
  }>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (!planCode || !priceCode) {
        setState({ error: "Selecciona un plan y precio desde Planes y suscripción." });
        return;
      }
      void Promise.all([
        getBillingPlans(controller.signal),
        getBillingSubscription(controller.signal),
        apiClient<CurrentAccess>("/payments/access", {
          signal: controller.signal,
        }),
      ])
        .then(async ([plans, subscription, access]) => {
          if (controller.signal.aborted) return;
          const resuming =
            subscription?.pendingPlanChange?.state === "awaiting_approval" &&
            subscription.pendingPlanChange.targetPlanCode === planCode &&
            subscription.pendingPlanChange.targetPlanPriceCode === priceCode;
          if (
            (subscription && !canChangeSubscription(subscription) && !resuming) ||
            (hasCurrentBillingPlan(access) && !subscription) ||
            (subscription?.planCode === planCode &&
              subscription?.planPriceCode === priceCode)
          ) {
            setState({
              error:
                "Esta suscripción no permite otro cambio en este momento. Consulta su estado en Planes y suscripción.",
            });
            return;
          }
          const plan = plans.find((item) => item.code === planCode);
          const price = plan?.prices.find((item) => item.code === priceCode);
          const quote = subscription && plan && price
            ? await getPlanChangeQuote(planCode, priceCode, controller.signal)
            : undefined;
          if (controller.signal.aborted) return;
          setState(
            plan && price
              ? { plan, price, subscription: subscription ?? undefined, quote }
              : {
                  error:
                    "El plan o precio seleccionado ya no está disponible. Regresa a los planes para elegir una opción vigente.",
                },
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            error:
              error instanceof ApiError && error.status === 401
                ? "Inicia sesión nuevamente para continuar."
                : error instanceof ApiError && error.status === 409
                  ? "La suscripción cambió. Consulta su estado antes de continuar."
                  : error instanceof ApiError && error.status === 403
                ? "Necesitas permiso de facturación y verificación en dos pasos para continuar."
                : error instanceof ApiError && error.status === 429
                  ? "Espera un momento antes de volver a consultar la contratación."
                  : "No se pudo cargar la contratación. Inténtalo de nuevo.",
          });
        });
    });
    return () => controller.abort();
  }, [planCode, priceCode, retry]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen w-full min-w-0 flex-1 bg-muted/35 px-4 py-6 focus:outline-none sm:px-6 sm:py-8"
    >
      <Button
        variant="ghost"
        size="icon"
        className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6"
        render={<Link href={plansHref} />}
        aria-label="Cerrar sin cancelar y volver a los planes"
        title="Cerrar sin cancelar el intento"
      >
        <X aria-hidden="true" />
      </Button>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {!state.plan && !state.error ? <BillingPaymentSkeleton /> : null}
        {state.plan || state.error ? (
          <header className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
              <LockKeyhole aria-hidden="true" className="size-4" /> Contratación
              segura
            </p>
            <h1 className="text-heading-lg font-bold">
              {state.plan
                ? `${state.subscription ? "Cambiar a" : "Contratar"} ${state.plan.name}`
                : "Contratar un plan"}
            </h1>
          </header>
        ) : null}
        {state.error ? (
          <Surface>
            <div role="alert" className="space-y-4 p-5">
              <p>{state.error}</p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setState({});
                    setRetry((value) => value + 1);
                  }}
                >
                  Reintentar
                </Button>
                <Button render={<Link href={plansHref} />}>
                  Volver a los planes
                </Button>
              </div>
            </div>
          </Surface>
        ) : null}
        {state.plan && state.price ? (
          <div className="space-y-6">
            <Surface className="min-w-0">
              <div className="min-w-0 border-b border-border px-5 py-4">
                <h2 className="text-heading-sm font-emphasis">
                  {state.subscription
                    ? "Resumen del cambio de plan"
                    : "Resumen de contratación"}
                </h2>
                <p className="mt-1 break-words text-body-sm">
                  <span className="text-muted-foreground">Despacho: </span>
                  <span className="font-semibold">{organizationName}</span>
                </p>
                <p className="mt-1 text-caption text-muted-foreground">
                  El plan cubre los clientes y RFC de este despacho.
                </p>
              </div>
              <div className="space-y-6 p-5">
                {state.quote ? (
                  <div className="space-y-4 rounded-lg border border-border bg-muted p-4 text-body-sm">
                    <p>
                      {state.quote.kind === "upgrade"
                        ? "El nuevo plan empieza cuando confirmes el cambio y se complete el pago de hoy. Ese pago cubre la diferencia de precio entre los dos planes por los días que quedan de tu periodo actual. En tu próxima renovación pagarás el precio normal del nuevo plan."
                        : `El cambio se aplicará el ${billingDate(state.quote.effectiveAt)}, en tu próxima renovación. Conservas tu plan actual y sus beneficios hasta entonces.`}
                    </p>
                    <dl className="grid gap-4 md:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">{state.quote.kind === "upgrade" ? "Pago único de hoy" : "A pagar ahora"}</dt>
                        <dd className="mt-1 font-semibold tabular-nums">{formatExactMoney(state.quote.amountDueNow, state.quote.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Próximo cobro: {billingDate(state.quote.nextBillingAt)}</dt>
                        <dd className="mt-1 font-semibold tabular-nums">{formatExactMoney(state.quote.recurringAmount, state.quote.currency)} {period(state.price).toLowerCase()}</dd>
                      </div>
                    </dl>
                    <p className="text-muted-foreground">
                      {state.quote.kind === "upgrade"
                        ? "En el siguiente paso autorizarás los cobros de las próximas renovaciones y confirmarás el pago único de hoy."
                        : "En el siguiente paso autorizarás los cobros del nuevo plan a partir de la fecha indicada."}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-heading-md font-semibold">
                      {state.plan.name}
                    </h2>
                    {state.plan.description ? (
                      <p className="mt-2 text-body-sm text-muted-foreground">
                        {state.plan.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-baseline justify-end gap-x-2">
                    <span className="text-heading-md font-semibold tabular-nums">
                      {formatExactMoney(
                        state.price.amount,
                        state.price.currency,
                      )}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      / {period(state.price)}
                    </span>
                  </div>
                </div>
                {state.plan.features.length ? (
                  <div className="space-y-3">
                    <h3 className="text-body-sm font-semibold">
                      Características del plan
                    </h3>
                    <ul className="space-y-3">
                      {state.plan.features.map((feature) => (
                        <li
                          key={feature.code}
                          className="flex items-start gap-3 text-body-sm"
                        >
                          {feature.value === false ? (
                            <Minus
                              aria-hidden="true"
                              className="mt-1 size-4 shrink-0 text-muted-foreground"
                            />
                          ) : (
                            <Check
                              aria-hidden="true"
                              className="mt-1 size-4 shrink-0 text-primary"
                            />
                          )}
                          <span className="min-w-0 flex-1 break-words text-muted-foreground">
                            {feature.name}
                          </span>
                          <span className="text-right font-medium">
                            {featureValue(feature.value)}
                            {typeof feature.value !== "boolean" &&
                            feature.unit &&
                            feature.unit !== "n_a"
                              ? ` ${feature.unit}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Surface>
            <div className="min-w-0 space-y-6">
              <BillingLegalStep
                organizationId={organizationId}
                userId={userId}
                planCode={state.plan.code}
                planPriceCode={state.price.code}
                changePlan={Boolean(state.subscription)}
                expectedSubscriptionId={state.subscription?.id}
                expectedAmountDueNow={state.quote?.amountDueNow}
                onReviewQuote={(quote) => {
                  if (quote) {
                    setState((current) => ({ ...current, quote, error: undefined }));
                    return;
                  }
                  setState({});
                  setRetry((value) => value + 1);
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function BillingPaymentSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Cargando información de contratación…</span>
      <header className="space-y-2">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="h-8 w-56" />
      </header>
      <Surface>
        <div className="space-y-3 border-b border-border px-5 py-4">
          <SkeletonBlock className="h-5 w-52" />
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="h-3 w-full max-w-sm" />
        </div>
        <div className="space-y-6 p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="w-full max-w-sm space-y-3">
              <SkeletonBlock className="h-6 w-36" />
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-4/5" />
            </div>
            <SkeletonBlock className="h-6 w-28 shrink-0" />
          </div>
          <div className="space-y-3">
            <SkeletonBlock className="h-4 w-40" />
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonBlock key={index} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </Surface>
      <Surface>
        <div className="space-y-5 p-5">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <SkeletonBlock className="size-5 shrink-0" />
              <SkeletonBlock className="h-4 w-48 max-w-full" />
            </div>
          ))}
        </div>
      </Surface>
      <SkeletonBlock className="h-11 w-full rounded-md" />
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-muted motion-reduce:animate-none ${className}`}
    />
  );
}
