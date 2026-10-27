"use client";
import {
  currentPlanStatus,
  planActionLabel,
  type CurrentAccess,
} from "./current-plan";
import Link from "next/link";
import { period, featureValue } from "./billing-plan-format";
import { useEffect, useId, useState } from "react";
import { ArrowRight, Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAccountingContext } from "@/components/accounting-context";
import { PageHeader } from "@/components/page-header";
import { Surface } from "@/components/product-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { LiveUnavailableScreen } from "@/features/clients/live-fallback-screens";
import { formatExactMoney } from "@/features/cfdi/exact-decimal";
import { apiClient, ApiError } from "@/lib/api-client";
import { hasCapability } from "@/lib/permissions";
import {
  getCheckoutAttempt,
  getBillingPlans,
  getBillingSubscription,
  type BillingPlan,
  type BillingSubscription,
} from "./api";
import { BillingNextRenewalPlan } from "./billing-renewal-plan-change";
import { BillingSubscriptionActions } from "./billing-subscription-actions";
import { useSession } from "@/features/session/session-provider";
import {
  canChangeSubscription,
  canChangeRenewalPlan,
  subscriptionRefreshDelay,
} from "./subscription-management";
import {
  isCheckoutRetryablePending,
  isCheckoutTerminal,
  pendingCheckoutId,
  pendingCheckoutKey,
} from "./checkout-recovery";

export function BillingSettingsScreen({ section }: { section: string }) {
  const { organization, locale, capabilities } = useAccountingContext();
  const base = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings`;
  if (section === "billing-plan")
    return <BillingPlansScreen key={organization.id} />;
  if (section !== "overview")
    return (
      <LiveUnavailableScreen
        returnHref={base}
        returnLabel="Volver a Configuración"
      />
    );
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Configuración"
        description={`Administra la configuración de ${organization.name}.`}
      />
      <Surface>
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-6">
          <div className="min-w-0 space-y-1">
            <h2 className="text-heading-sm font-emphasis">
              Planes y suscripción
            </h2>
            <p className="max-w-xl text-body-sm text-muted-foreground">
              Consulta tu plan actual, compara las opciones disponibles y
              administra la contratación del despacho.
            </p>
          </div>
          {hasCapability(capabilities, "billing.manage") ? (
            <Link
              href={`${base}/billing-plan`}
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "w-full sm:w-auto sm:shrink-0",
              })}
            >
              Ver planes y suscripción
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <p className="text-body-sm text-muted-foreground">
              Solicita permiso para administrar la facturación a una persona
              administradora.
            </p>
          )}
        </div>
      </Surface>
    </div>
  );
}

function BillingPlansScreen() {
  const headingPrefix = useId();
  const { organization, locale } = useAccountingContext();
  const { session } = useSession();
  const userId = session?.userId;
  const [state, setState] = useState<{ plans?: BillingPlan[]; error?: string }>(
    {},
  );
  const [current, setCurrent] = useState<{
    access?: CurrentAccess;
    error?: string;
  }>({});
  const [subscription, setSubscription] =
    useState<BillingSubscription | null>();
  const [subscriptionError, setSubscriptionError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<{
    planCode: string;
    planPriceCode: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    let started = false;
    let pausedForRetry = false;
    let refreshTimer: number | undefined;
    const loadAccess = () => {
      if (
        inFlight ||
        pausedForRetry ||
        controller.signal.aborted ||
        document.visibilityState !== "visible"
      )
        return;
      inFlight = true;
      started = true;
      void Promise.allSettled([
        apiClient<CurrentAccess>("/payments/access", {
          signal: controller.signal,
        }),
        getBillingSubscription(controller.signal),
      ])
        .then(async ([access, management]) => {
          if (controller.signal.aborted) return;
          setCurrent(
            access.status === "fulfilled"
              ? { access: access.value }
              : {
                  error:
                    "No se pudo cargar tu plan actual. Inténtalo de nuevo.",
                },
          );
          if (management.status === "fulfilled") {
            const pendingPlanChange = management.value?.pendingPlanChange;
            let attemptId = pendingPlanChange?.attemptId ?? management.value?.pendingCheckoutAttemptId;
            let pendingCheckoutAttemptId = management.value?.pendingCheckoutAttemptId;
            if (!attemptId && userId && (pendingPlanChange || management.value?.status === "pending")) {
              try {
                attemptId = pendingCheckoutId(
                  sessionStorage.getItem(
                    pendingCheckoutKey(organization.id, userId),
                  ),
                );
              } catch {
                /* Subscription refresh still works when browser storage is unavailable. */
              }
            }
            let retryRequired = false;
            if (attemptId) {
              try {
                const attempt = await getCheckoutAttempt(
                  attemptId,
                  controller.signal,
                );
                if (management.value?.status === "pending" &&
                    attempt.subscriptionId === management.value.id &&
                    !isCheckoutTerminal(attempt) && attempt.status !== "rejected") {
                  pendingCheckoutAttemptId = attempt.attemptId;
                }
                retryRequired = Boolean(
                  pendingPlanChange && isCheckoutRetryablePending(attempt),
                );
              } catch {
                /* Keep the normal refresh behavior when attempt status cannot be read. */
              }
            }
            if (controller.signal.aborted) return;
            pausedForRetry = retryRequired;
            window.clearTimeout(refreshTimer);
            const delay = retryRequired
              ? undefined
              : subscriptionRefreshDelay(management.value);
            refreshTimer = delay === undefined
              ? undefined
              : window.setTimeout(loadAccess, delay);
            setSubscription(management.value ? { ...management.value, pendingCheckoutAttemptId } : null);
            setSubscriptionError(false);
          } else {
            setSubscription(undefined);
            setSubscriptionError(true);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const onBillingAccessChanged = () => {
      pausedForRetry = false;
      loadAccess();
    };
    window.addEventListener("balanz:billing-access-changed", onBillingAccessChanged);
    const resumePendingRefresh = () => {
      if (!pausedForRetry && (!started || refreshTimer !== undefined)) loadAccess();
    };
    document.addEventListener("visibilitychange", resumePendingRefresh);
    // Strict Mode's discarded setup must not start requests that cleanup immediately aborts.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      loadAccess();
      getBillingPlans(controller.signal)
        .then((plans) => {
          if (!controller.signal.aborted) setState({ plans });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof ApiError && error.code === "MFA_SETUP_REQUIRED"
              ? "Configura la verificación en dos pasos para consultar la facturación."
              : error instanceof ApiError && error.code === "MFA_REQUIRED"
                ? "Completa la verificación en dos pasos para consultar la facturación."
                : error instanceof ApiError && error.status === 403
                  ? "Tu membresía no permite consultar la facturación de esta organización."
                  : "No se pudieron cargar los planes. Inténtalo de nuevo.";
          setState({ error: message });
        });
    });
    return () => {
      controller.abort();
      window.removeEventListener("balanz:billing-access-changed", onBillingAccessChanged);
      document.removeEventListener("visibilitychange", resumePendingRefresh);
      window.clearTimeout(refreshTimer);
    };
  }, [organization.id, retry, userId]);
  const selectedPlan = state.plans?.find(
    (plan) => plan.code === selected?.planCode,
  );
  const selectedPrice = selectedPlan?.prices.find(
    (price) => price.code === selected?.planPriceCode,
  );
  const futureRenewal = subscription?.pendingRenewal;
  const futureMode = futureRenewal?.state === "scheduled";
  const futureSelectable = canChangeRenewalPlan(subscription);
  const selectedFutureIsCurrent = Boolean(selected && futureRenewal &&
    selected.planCode === (futureRenewal.planCode ?? subscription?.planCode) &&
    selected.planPriceCode === (futureRenewal.planPriceCode ?? subscription?.planPriceCode));
  function reload() {
    setState({});
    setCurrent({});
    setSubscription(undefined);
    setSubscriptionError(false);
    setSelected(null);
    setRetry((value) => value + 1);
  }
  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Planes y suscripción"
        description={`Compara tu plan actual y las opciones para ${organization.name}. La suscripción cubre los clientes y RFC del despacho.`}
      />
      {current.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4 text-body-sm"
        >
          <p>{current.error}</p>
          <Button variant="outline" onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : null}
      {subscriptionError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4 text-body-sm"
        >
          <p>
            No se pudo consultar la gestión de tu suscripción. Actualiza el
            estado para cambiar o cancelar.
          </p>
          <Button variant="outline" onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : null}
      <div className="space-y-4">
        {(!current.access && !current.error) ||
        (!state.plans && !state.error) ? (
          <span role="status" className="sr-only">
            Cargando planes y suscripción…
          </span>
        ) : null}
        <ul
          aria-label="Planes para Balanz"
          aria-busy={
            (!current.access && !current.error) ||
            (!state.plans && !state.error)
          }
          className="grid grid-cols-1 gap-x-6 md:grid-cols-2 xl:grid-cols-3"
        >
          {!current.access && !current.error ? <BillingPlanSkeleton /> : null}
          {current.access?.source === "trial" ? (
            <li className="mb-6 grid min-w-0 md:row-span-5 md:grid-rows-subgrid">
              <Surface
                labelledBy={`${headingPrefix}-trial`}
                className="grid h-full min-w-0 grid-rows-[auto_auto_auto_auto_1fr] border-primary p-5 md:row-span-5 md:grid-rows-subgrid"
              >
                <div className="contents">
                  <div className="flex flex-wrap items-start justify-between gap-2 pb-3">
                    <h2
                      id={`${headingPrefix}-trial`}
                      className="text-heading-md font-semibold"
                    >
                      Prueba gratuita
                    </h2>
                    <Badge variant={current.access.active ? "info" : "warning"}>
                      {current.access.active
                        ? "Tu plan actual"
                        : "Prueba finalizada"}
                    </Badge>
                  </div>
                  <p className="pb-4 text-body-sm leading-relaxed text-muted-foreground">
                    Conoce Balanz y trabaja con la información de tu despacho.
                  </p>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4">
                    <p className="text-body-sm text-muted-foreground">
                      {currentPlanStatus(current.access)}
                    </p>
                    <p className="text-heading-lg font-semibold">Sin costo</p>
                  </div>
                  <div className="pt-4">
                    <Button
                      variant="outline"
                      disabled
                      className="min-h-11 w-full"
                    >
                      {current.access.active
                        ? "Prueba en curso"
                        : "Prueba finalizada"}
                    </Button>
                  </div>
                  <div className="pt-5">
                    <h3 className="text-caption font-semibold uppercase tracking-wide">
                      Beneficios durante la prueba
                    </h3>
                    {current.access.active ? (
                      <ul
                        className="mt-3 space-y-3"
                        aria-label="Beneficios de la prueba gratuita"
                      >
                        {[
                          "Carga de CFDI en XML y ZIP",
                          "Descargas del SAT con e.firma",
                          "Gestión y revisión de períodos contables",
                        ].map((benefit) => (
                          <li
                            key={benefit}
                            className="flex items-start gap-3 text-body-sm"
                          >
                            <Check
                              aria-hidden="true"
                              className="mt-1 size-4 shrink-0 text-primary"
                            />
                            <span>{benefit}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-4 text-body-sm text-muted-foreground">
                        Elige una suscripción para continuar con nuevas
                        operaciones fiscales.
                      </p>
                    )}
                    <p className="mt-4 text-caption text-muted-foreground">
                      Las acciones disponibles dependen de los permisos de tu
                      membresía.
                    </p>
                    <div className="mt-4 space-y-1 border-t border-border pt-4">
                      {current.access.validUntil ? (
                        <p className="text-body-sm font-semibold">
                          {current.access.active
                            ? "Tu prueba termina el "
                            : "Tu prueba terminó el "}
                          {new Intl.DateTimeFormat("es-MX", {
                            dateStyle: "long",
                            timeZone: "America/Mexico_City",
                          }).format(new Date(current.access.validUntil))}
                          .
                        </p>
                      ) : null}
                      <p className="text-body-sm text-muted-foreground">
                        Selecciona un plan de pago cuando decidas continuar.
                      </p>
                    </div>
                  </div>
                </div>
              </Surface>
            </li>
          ) : null}
          {!state.plans && !state.error ? (
            <>
              <BillingPlanSkeleton />
              <BillingPlanSkeleton />
            </>
          ) : null}
          {state.error || state.plans?.length === 0 ? (
            <li className="mb-6 grid min-w-0 md:row-span-5 md:grid-rows-subgrid">
              <Surface className="h-full md:row-span-5">
                {state.error ? (
                  <div role="alert" className="space-y-4 p-6">
                    <p>{state.error}</p>
                    <Button variant="outline" onClick={reload}>
                      Reintentar
                    </Button>
                  </div>
                ) : null}
                {state.plans?.length === 0 ? (
                  <div className="space-y-4 p-6">
                    <p>No hay planes disponibles en este momento.</p>
                    <Button variant="outline" onClick={reload}>
                      Actualizar
                    </Button>
                  </div>
                ) : null}
              </Surface>
            </li>
          ) : null}
          {state.plans?.flatMap((plan, planIndex) =>
            plan.prices.map((price, priceIndex) => {
              const isCurrent =
                current.access?.source === "billing" &&
                current.access.planCode === plan.code &&
                (!subscription?.planPriceCode ||
                  subscription.planPriceCode === price.code);
              const isSelected =
                selected?.planCode === plan.code &&
                selected.planPriceCode === price.code;
              const headingId = `${headingPrefix}-${planIndex}-${priceIndex}`;
              const isRenewalCurrent = Boolean(futureMode &&
                plan.code === (futureRenewal.planCode ?? subscription?.planCode) &&
                price.code === (futureRenewal.planPriceCode ?? subscription?.planPriceCode));
              const actionLabel = futureMode
                ? isRenewalCurrent ? "Plan de próxima renovación" : isSelected ? "Plan seleccionado" : "Cambiar próxima renovación"
                : isCurrent
                ? "Plan actual"
                : isSelected
                  ? "Plan seleccionado"
                  : current.access?.source === "billing"
                    ? "Cambiar plan"
                    : planActionLabel(current.access, plan.code, isSelected);
              return (
                <li
                  key={`${plan.code}:${price.code}`}
                  className="mb-6 grid min-w-0 md:row-span-5 md:grid-rows-subgrid"
                >
                  <Surface
                    labelledBy={headingId}
                    className={`grid h-full min-w-0 grid-rows-[auto_auto_auto_auto_1fr] p-5 md:row-span-5 md:grid-rows-subgrid ${isSelected ? "border-primary ring-1 ring-primary" : ""}`}
                  >
                    <div className="contents">
                      <div className="flex flex-wrap items-start justify-between gap-2 pb-3">
                        <h2
                          id={headingId}
                          className="break-words text-heading-md font-semibold"
                        >
                          {plan.name}
                        </h2>
                        {isCurrent ? (
                          <Badge variant="success">Tu plan actual</Badge>
                        ) : null}
                        {isRenewalCurrent ? <Badge variant="secondary">Próxima renovación</Badge> : null}
                        {isSelected ? (
                          <Badge variant="secondary">
                            <Check aria-hidden="true" />
                            Seleccionado
                          </Badge>
                        ) : null}
                      </div>
                      <p className="break-words pb-4 text-body-sm leading-relaxed text-muted-foreground">
                        {plan.description}
                      </p>
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4">
                        <p className="text-body-sm text-muted-foreground">
                          {period(price)}
                        </p>
                        <p className="break-words text-right text-heading-lg font-semibold tabular-nums">
                          {formatExactMoney(price.amount, price.currency)}
                        </p>
                      </div>
                      <div className="pt-4">
                        <Button
                          className="min-h-11 w-full"
                          variant={(futureMode ? isRenewalCurrent : isCurrent) ? "outline" : "default"}
                          disabled={
                            !current.access ||
                            subscription === undefined ||
                            subscriptionError ||
                            (futureMode ? isRenewalCurrent || !futureSelectable : isCurrent ||
                            (Boolean(subscription) && !canChangeSubscription(subscription))) ||
                            (current.access.source === "billing" &&
                              !subscription)
                          }
                          aria-pressed={isSelected}
                          aria-label={`${actionLabel}: ${plan.name}, ${period(price).toLowerCase()}, ${formatExactMoney(price.amount, price.currency)}`}
                          onClick={() => {
                            const choice = {
                              planCode: plan.code,
                              planPriceCode: price.code,
                            };
                            setSelected(choice);
                          }}
                        >
                          {isSelected ? <Check aria-hidden="true" /> : null}
                          {actionLabel}
                        </Button>
                      </div>
                      <div className="pt-5">
                        <h3 className="text-caption font-semibold uppercase tracking-wide">
                          Beneficios incluidos
                        </h3>
                        {plan.features.length ? (
                          <ul
                            aria-label={`Características de ${plan.name}`}
                            className="mt-3 space-y-3"
                          >
                            {plan.features.map((feature) => (
                              <li
                                key={feature.code}
                                className="flex items-start gap-3"
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
                                <div className="min-w-0 text-body-sm">
                                  <p className="break-words text-muted-foreground">
                                    {feature.name}
                                  </p>
                                  <p className="break-words font-semibold">
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
                        ) : (
                          <p className="mt-6 text-body-sm text-muted-foreground">
                            Sin características especificadas
                          </p>
                        )}
                        {isCurrent && current.access?.renewalAt ? (
                          <p className="mt-4 border-t border-border pt-4 text-body-sm text-muted-foreground">
                            Próxima renovación:{" "}
                            <span className="font-semibold text-foreground">
                              {new Intl.DateTimeFormat("es-MX", {
                                dateStyle: "long",
                                timeZone: "America/Mexico_City",
                              }).format(new Date(current.access.renewalAt))}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Surface>
                </li>
              );
            }),
          )}
        </ul>
      </div>
      {subscription ? (
        <BillingSubscriptionActions
          key={subscription.id}
          subscription={subscription}
          plans={state.plans}
          onChange={setSubscription}
        />
      ) : null}
      {selectedPlan &&
      selectedPrice &&
      current.access &&
      (subscription
        ? futureMode ? futureSelectable && !selectedFutureIsCurrent : canChangeSubscription(subscription)
        : !subscriptionError &&
          subscription !== undefined &&
          current.access.source !== "billing") ? (
        <div className="fixed bottom-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-background p-4 shadow-sm sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-lg">
          <div className="min-w-0">
            <p className="text-body font-semibold">{selectedPlan.name}</p>
            <p className="text-body-sm text-muted-foreground">
              {formatExactMoney(selectedPrice.amount, selectedPrice.currency)} ·{" "}
              {period(selectedPrice)}
            </p>
          </div>
          {futureMode && subscription ? <BillingNextRenewalPlan
            key={`${subscription.id}:${futureRenewal.subscriptionId}:${selectedPlan.code}:${selectedPrice.code}`}
            subscription={subscription} plan={selectedPlan} price={selectedPrice} /> : <Button
            className="ml-auto min-h-11"
            render={
              <Link
                href={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/checkout/payment?${new URLSearchParams({ plan: selectedPlan.code, price: selectedPrice.code }).toString()}`}
              />
            }
          >
            {subscription ? "Revisar cambio de plan" : "Continuar"}{" "}
            <ArrowRight aria-hidden="true" />
          </Button>}
        </div>
      ) : null}
    </div>
  );
}

function BillingPlanSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="mb-6 grid min-w-0 md:row-span-5 md:grid-rows-subgrid"
    >
      <Surface className="h-full space-y-5 p-5 md:row-span-5">
        <div className="space-y-3 animate-pulse motion-reduce:animate-none">
          <div className="h-6 w-3/5 rounded bg-muted" />
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-4/5 rounded bg-muted" />
        </div>
        <div className="flex justify-between border-b border-border pb-4 animate-pulse motion-reduce:animate-none">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="h-8 w-2/5 rounded bg-muted" />
        </div>
        <div className="h-11 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="space-y-3 animate-pulse motion-reduce:animate-none">
          <div className="h-3 w-1/2 rounded bg-muted" />
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-4/5 rounded bg-muted" />
          <div className="h-4 w-3/4 rounded bg-muted" />
        </div>
      </Surface>
    </li>
  );
}
