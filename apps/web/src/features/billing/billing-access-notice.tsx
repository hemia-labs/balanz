"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import {
  apiClient,
  ApiError,
  subscribeToBillingAccessRequired,
} from "@/lib/api-client";
import { useSession } from "@/features/session/session-provider";
import { Button } from "@/components/ui/button";
import { CheckCircle2, CircleX, LoaderCircle, X } from "lucide-react";
import { getCheckoutAttempt } from "./api";
import {
  isCheckoutAccessActive,
  checkoutActionUrl,
  isCheckoutTerminal,
  isCheckoutPlanChange,
  isPlanChangeScheduled,
  isRenewalResumeScheduled,
  isRenewalPlanChangeScheduled,
  isCheckoutRetryablePending,
  pendingCheckoutId,
  pendingCheckoutKey,
  shouldMonitorBillingAccess,
} from "./checkout-recovery";
export type BillingAccessSummary = {
  active: boolean;
  source: "trial" | "billing" | null;
  reason: string;
  validUntil: string | null;
  confirmedAt: string | null;
  subscriptionId?: string | null;
  planCode?: string | null;
};
export function BillingAccessNotice() {
  const { organization, locale, isDemo } = useAccountingContext();
  const pathname = usePathname();
  const { session } = useSession();
  const userId = session?.userId;
  const monitorsAccess = shouldMonitorBillingAccess(pathname);
  const isReturnPage = /\/checkout\/(success|cancel)$/.test(pathname);
  const [notification, setNotification] = useState<{
    organizationId: string;
    userId: string;
    status:
      | "pending"
      | "active"
      | "scheduled"
      | "retry_required"
      | "approval_required"
      | "cancelling_change";
    attemptId?: string;
    effectiveAt?: string;
    subscriptionId?: string | null;
    planCode?: string | null;
    planChange?: boolean;
  }>();
  const [state, setState] = useState<{
    organizationId: string;
    access: BillingAccessSummary;
  }>();
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (isDemo || isReturnPage) return;
    const controller = new AbortController();
    const pendingKey = userId
      ? pendingCheckoutKey(organization.id, userId)
      : undefined;
    const pendingId = () => {
      try {
        return pendingKey
          ? pendingCheckoutId(sessionStorage.getItem(pendingKey))
          : undefined;
      } catch {
        return undefined;
      }
    };
    const clearPending = (id: string) => {
      try {
        if (pendingKey && pendingId() === id)
          sessionStorage.removeItem(pendingKey);
      } catch {
        /* Monitoring can retry without modifying the checkout. */
      }
    };
    let inFlight = false;
    let pollAfter = 0;
    let refreshPending = false;
    const load = () => {
      if (controller.signal.aborted || document.visibilityState !== "visible" ||
          (!monitorsAccess && !pendingId()))
        return;
      if (inFlight) {
        refreshPending = true;
        return;
      }
      inFlight = true;
      void apiClient<BillingAccessSummary>("/payments/access", {
        signal: controller.signal,
      })
        .then(async (access) => {
          if (controller.signal.aborted) return;
          setState({ organizationId: organization.id, access });
          const attemptId = pendingId();
          if (!attemptId) {
            setNotification((notice) => {
              if (
                !notice ||
                notice.organizationId !== organization.id ||
                notice.userId !== userId
              )
                return notice;
              return notice.status === "active" &&
                isCheckoutAccessActive(
                  {
                    subscriptionStatus: "active",
                    subscriptionId: notice.subscriptionId,
                    planCode: notice.planCode,
                  },
                  access,
                )
                ? notice
                : undefined;
            });
            return;
          }
          if (!userId || isReturnPage) return;
          try {
            const attempt = await getCheckoutAttempt(
              attemptId,
              controller.signal,
            );
            if (controller.signal.aborted || pendingId() !== attemptId) return;
            pollAfter = 0;
            if (isCheckoutAccessActive(attempt, access)) {
              clearPending(attemptId);
              setNotification({
                organizationId: organization.id,
                userId,
                status: "active",
                subscriptionId: access.subscriptionId,
                planCode: access.planCode,
              });
              window.dispatchEvent(new Event("balanz:billing-access-changed"));
            } else if (isRenewalResumeScheduled(attempt) || isRenewalPlanChangeScheduled(attempt)) {
              clearPending(attemptId);
              setNotification(undefined);
              window.dispatchEvent(new Event("balanz:billing-access-changed"));
            } else if (["resume_renewal", "change_renewal_plan"].includes(attempt.operation ?? "")) {
              if (isCheckoutTerminal(attempt) || attempt.status === "rejected") {
                clearPending(attemptId);
                setNotification(undefined);
              } else {
                // The current paid access remains valid; recovery lives in subscription management.
                pollAfter = checkoutActionUrl(attempt) ? Number.POSITIVE_INFINITY : Date.now() + 5_000;
                setNotification(undefined);
              }
            } else if (attempt.planChange?.cancellationRequested && !isCheckoutTerminal(attempt)) {
              pollAfter = checkoutActionUrl(attempt) ? Number.POSITIVE_INFINITY : Date.now() + 5_000;
              setNotification({ organizationId: organization.id, userId, status: "cancelling_change", attemptId });
            } else if (isPlanChangeScheduled(attempt)) {
              pollAfter = Math.max(
                Date.now() + 60_000,
                Date.parse(attempt.planChange!.effectiveAt),
              );
              setNotification({
                organizationId: organization.id,
                userId,
                status: "scheduled",
                effectiveAt: attempt.planChange!.effectiveAt,
              });
            } else if (attempt.planChange?.state === "awaiting_approval") {
              clearPending(attemptId);
              setNotification(undefined);
            } else if (attempt.subscriptionStatus === "pending" && checkoutActionUrl(attempt)) {
              pollAfter = Number.POSITIVE_INFINITY;
              setNotification({
                organizationId: organization.id,
                userId,
                status: "approval_required",
                attemptId,
              });
            } else if (isCheckoutRetryablePending(attempt)) {
              pollAfter = Number.POSITIVE_INFINITY;
              setNotification({
                organizationId: organization.id,
                userId,
                status: "retry_required",
                attemptId,
                planChange: isCheckoutPlanChange(attempt),
              });
            } else if (
              isCheckoutTerminal(attempt) ||
              attempt.status === "rejected"
            ) {
              clearPending(attemptId);
              setNotification(undefined);
            } else {
              setNotification({
                organizationId: organization.id,
                userId,
                status: "pending",
              });
            }
          } catch (error) {
            if (
              !controller.signal.aborted &&
              error instanceof ApiError &&
              error.status === 404
            ) {
              clearPending(attemptId);
              setNotification(undefined);
            }
          }
        })
        .catch(() => {
          /* Operation errors remain visible in their own screens. */
        })
        .finally(() => {
          inFlight = false;
          if (refreshPending) {
            refreshPending = false;
            load();
          }
        });
    };
    refreshRef.current = load;
    queueMicrotask(load);
    const timer = window.setInterval(() => {
      if (!isReturnPage && pendingId() && Date.now() >= pollAfter) load();
    }, 5_000);
    const onVisibilityChange = () => {
      if (!inFlight && document.visibilityState === "visible") load();
    };
    window.addEventListener("balanz:billing-access-changed", load);
    const onFocus = () => { if (!inFlight) load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unsubscribe = subscribeToBillingAccessRequired(() => {
      if (!controller.signal.aborted) {
        setState({
          organizationId: organization.id,
          access: {
            active: false,
            source: null,
            reason: "billing_inactive",
            validUntil: null,
            confirmedAt: null,
          },
        });
        load();
      }
    });
    return () => {
      controller.abort();
      window.clearInterval(timer);
      if (refreshRef.current === load) refreshRef.current = () => {};
      window.removeEventListener("balanz:billing-access-changed", load);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
    };
  }, [organization.id, isDemo, userId, isReturnPage, monitorsAccess]);
  const access =
    state?.organizationId === organization.id ? state.access : undefined;
  useEffect(() => {
    if (!access?.active || !access.validUntil) return;
    const validUntil = Date.parse(access.validUntil);
    if (!Number.isFinite(validUntil)) return;

    let timer: number;
    const scheduleRefresh = () => {
      const delay = validUntil - Date.now() + 1_000;
      if (delay > 2_147_483_647) {
        timer = window.setTimeout(scheduleRefresh, 2_147_483_647);
      } else {
        timer = window.setTimeout(
          () => refreshRef.current(),
          Math.max(0, delay),
        );
      }
    };
    scheduleRefresh();
    return () => window.clearTimeout(timer);
  }, [access?.active, access?.validUntil]);
  if (
    !isDemo &&
    !isReturnPage &&
    notification?.organizationId === organization.id &&
    notification.userId === userId
  ) {
    const confirmed = notification.status === "active";
    const scheduled = notification.status === "scheduled";
    return (
      <div
        role="status"
        className={`mb-6 flex items-start gap-3 rounded-lg border p-4 text-body-sm ${confirmed ? "border-success/30 bg-success-surface text-success" : "border-border bg-muted text-foreground"}`}
      >
        {confirmed || scheduled ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        ) : ["retry_required", "approval_required", "cancelling_change"].includes(notification.status) ? (
          <CircleX className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <LoaderCircle
            className="mt-0.5 size-5 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">
            {confirmed
              ? "Tu suscripción está activa"
              : scheduled
                ? "Tu cambio de plan está programado"
                : notification.status === "cancelling_change"
                  ? "La cancelación del cambio está pendiente"
                : notification.status === "approval_required"
                  ? "Tu pago está pendiente"
                : notification.status === "retry_required"
                  ? notification.planChange
                    ? "No pudimos iniciar el pago de tu cambio de plan"
                    : "No se pudo iniciar el pago"
                  : "Estamos revisando el pago"}
          </p>
          <p>
            {confirmed
              ? "Balanz recibió la licencia de tu contratación. Ya puedes usar tu plan."
              : scheduled && notification.effectiveAt
                ? `Conservas tu plan actual hasta el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mexico_City" }).format(new Date(notification.effectiveAt))}.`
                : notification.status === "cancelling_change"
                  ? "Conservas tu plan actual. Completa la confirmación en PayPal para mantener sus próximas renovaciones."
                : notification.status === "approval_required"
                  ? "Tu plan actual se conserva. Puedes retomar el pago o descartar el intento desde Planes y suscripción."
                : notification.status === "retry_required"
                  ? notification.planChange
                    ? "Tu cambio sigue guardado. Revisa el importe y reintenta para pagar una sola vez la diferencia."
                    : "Tu solicitud sigue guardada. Reintenta para continuar con el pago."
                  : "Estamos comprobando el estado del pago. La suscripción se activa cuando el pago quede confirmado."}
          </p>
          <Link
            className="inline-flex min-h-10 items-center font-semibold underline underline-offset-4"
            href={["retry_required", "approval_required", "cancelling_change"].includes(notification.status) && notification.attemptId
              ? `/${locale}/organizations/${encodeURIComponent(organization.slug)}/checkout/success?${new URLSearchParams({ attemptId: notification.attemptId })}`
              : `/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings/billing-plan`}
          >
            {notification.status === "cancelling_change"
              ? "Revisar cancelación del cambio"
              : notification.status === "approval_required"
              ? "Retomar pago"
              : notification.status === "retry_required"
              ? "Revisar pago"
                : "Ver mi suscripción"}
          </Link>
        </div>
        {confirmed ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cerrar aviso de suscripción activa"
            onClick={() => setNotification(undefined)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    );
  }
  if (
    !access ||
    access.active ||
    isDemo ||
    /\/organizations\/[^/]+\/settings(?:\/|$)/.test(pathname)
  )
    return null;
  return (
    <div
      role="status"
      className="mb-6 w-full max-w-2xl rounded-lg border border-border bg-muted px-4 py-3 text-body-sm"
    >
      {access.reason === "confirmation_expired"
        ? "La vigencia del acceso confirmado terminó. Consulta tu suscripción en facturación."
        : "Necesitas una prueba o suscripción vigente para iniciar nuevas operaciones fiscales."}
      {" Puedes consultar y exportar los datos existentes. "}
      <Link
        className="underline underline-offset-4 focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
        href={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/settings/billing-plan`}
      >
        Consultar facturación
      </Link>
    </div>
  );
}
