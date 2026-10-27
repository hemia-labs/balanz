"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ControlledDialog } from "@/components/overlay-dialog";
import { ApiError } from "@/lib/api-client";
import { cancelCheckoutAttempt } from "./api";
import { isCheckoutUrl } from "./checkout-recovery";

export function BillingDiscardCheckout({
  attemptId,
  plansHref,
  cancellationRequested = false,
  scheduledChange = false,
  planChange = false,
  renewalPlanChange = false,
  renewalResume = false,
  renewalScheduled = false,
  disabled = false,
  targetPlanName,
}: {
  attemptId: string;
  plansHref: string;
  cancellationRequested?: boolean;
  scheduledChange?: boolean;
  planChange?: boolean;
  renewalPlanChange?: boolean;
  renewalResume?: boolean;
  renewalScheduled?: boolean;
  disabled?: boolean;
  targetPlanName?: string;
}) {
  const cancellingPlanChange = planChange || scheduledChange || renewalPlanChange;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approvalUrl, setApprovalUrl] = useState<string>();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function cancel() {
    if (pending.current || disabled) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await cancelCheckoutAttempt(attemptId, controller.signal);
      if (controller.signal.aborted) return;
      if (result.cancelled) {
        window.location.assign(plansHref);
      } else if (isCheckoutUrl(result.approvalUrl)) {
        setApprovalUrl(result.approvalUrl);
      } else {
        setError(cancellingPlanChange ? "Estamos confirmando la cancelación del cambio. Tu plan actual se conserva; vuelve a comprobarlo en un momento." : "Estamos confirmando el descarte. Tu plan actual se conserva; vuelve a comprobarlo en un momento.");
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(
        cause instanceof ApiError && cause.status === 409
          ? cancellingPlanChange ? "El cambio requiere verificar su estado antes de cancelarlo. Actualiza Mi suscripción; tu plan actual se conserva." : "El pago ya se confirmó o sigue en proceso. Actualiza su estado antes de descartar el intento. No cancelamos ninguna suscripción activa."
          : cause instanceof ApiError && cause.status === 401
            ? "Inicia sesión nuevamente para descartar el intento."
          : cause instanceof ApiError && cause.status === 403
            ? "Necesitas permiso de facturación y verificación en dos pasos para descartar el intento."
          : cause instanceof ApiError && cause.status === 429
            ? "Espera un momento antes de volver a comprobar el descarte."
            : "No pudimos confirmar el descarte. Puedes volver a intentarlo; no se canceló tu plan actual.",
      );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <div className="space-y-3">
      <Button variant="outline" disabled={disabled || busy} onClick={() => setOpen(true)}>
        {renewalPlanChange ? cancellationRequested ? "Completar cancelación del cambio" : scheduledChange ? targetPlanName ? `Cancelar cambio a ${targetPlanName}` : "Cancelar cambio de próxima renovación" : "Conservar renovación anterior"
          : renewalScheduled ? "Desactivar renovación automática" : renewalResume ? "Descartar reactivación" : cancellingPlanChange && cancellationRequested ? "Completar cancelación del cambio"
          : scheduledChange ? "Cancelar cambio programado"
          : cancellationRequested ? "Completar descarte del intento" : "Conservar mi plan actual"}
      </Button>
      <ControlledDialog
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        title={renewalPlanChange ? "¿Cancelar el cambio de próxima renovación?" : renewalScheduled ? "¿Desactivar la renovación automática?" : renewalResume ? "¿Descartar la reactivación?" : cancellingPlanChange ? scheduledChange ? "¿Cancelar el cambio programado?" : "¿Cancelar este cambio de plan?" : "¿Descartar este intento de pago?"}
        description={renewalPlanChange ? "Tu acceso actual y la renovación anterior se conservan." : renewalResume ? "Tu acceso al período ya pagado se conserva." : cancellingPlanChange ? "Conservarás tu plan actual y sus próximas renovaciones." : "Conservarás tu plan o prueba con su vigencia actual."}
      >
        <div className="space-y-4 p-5">
          <p className="text-body-sm">
            {renewalPlanChange
              ? "Cancelaremos únicamente este cambio de próxima renovación. Tu plan del período ya pagado conserva su vigencia."
              : renewalScheduled
              ? "Cancelaremos únicamente la autorización de próximas renovaciones. Conservarás el acceso al período ya pagado."
              : renewalResume
              ? "Descartaremos únicamente esta solicitud de reactivación. La renovación seguirá cancelada y conservarás tu acceso actual."
              : cancellingPlanChange
              ? "Cancelaremos únicamente el cambio de plan. Tu suscripción seguirá activa y se renovará con tu plan actual."
              : "Cerraremos este intento en Balanz y podrás elegir otro plan. Tu plan o prueba conservarán su vigencia actual."}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {renewalPlanChange
              ? "Esta acción no genera un cobro. Si PayPal ya confirmó el nuevo plan, tendrás que autorizar la restauración de la renovación anterior para completar la cancelación."
              : renewalScheduled
              ? "Esta acción no genera cobros ni reembolsos del período actual."
              : renewalResume
              ? "Si apruebas después un enlace descartado, no activará una renovación en Balanz; gestionaremos la cancelación de esa autorización."
              : cancellingPlanChange
              ? "Esta acción no genera un cobro. Si PayPal ya autorizó el cambio, tendrás que confirmar ahí la renovación de tu plan actual para terminar de cancelarlo."
              : "Si después apruebas el enlace antiguo de PayPal, no cambiará tu plan. Gestionaremos la cancelación de esa contratación; si llega a cobrarse, el pago quedará registrado para revisar su devolución."}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {renewalScheduled
              ? "Cerrar esta ventana conserva la renovación programada. Sólo se cancelará cuando confirmes."
              : renewalResume
              ? "Cerrar esta ventana no descarta la reactivación. Podrás retomarla desde Mi suscripción."
              : cancellingPlanChange
              ? "Cerrar esta ventana no cancela el cambio. La cancelación quedará pendiente hasta que completes la confirmación."
              : "Cerrar esta ventana no descarta el intento. Podrás retomarlo después desde Planes y suscripción."}
          </p>
          {approvalUrl ? (
            <>
              <p role="status" className="text-body-sm">
                {renewalPlanChange ? "Para conservar el plan anterior de la próxima renovación, falta confirmar su restauración en PayPal." : "Para conservar la renovación de tu plan actual, falta confirmarla en PayPal."} El cambio seguirá pendiente hasta que completes ese paso.
              </p>
              <Button render={<a href={approvalUrl} />}>{renewalPlanChange ? "Restaurar renovación anterior en PayPal" : "Confirmar mi plan actual en PayPal"}</Button>
            </>
          ) : null}
          {error ? <p role="alert" className="text-body-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{cancellingPlanChange ? "Volver" : "Volver al intento"}</Button>
            {!approvalUrl ? (
              <Button disabled={busy || disabled} onClick={() => void cancel()}>
                {busy ? "Confirmando…" : renewalScheduled ? "Confirmar cancelación" : renewalResume ? "Confirmar descarte" : cancellingPlanChange ? "Confirmar cancelación del cambio" : "Descartar intento"}
              </Button>
            ) : null}
          </div>
        </div>
      </ControlledDialog>
    </div>
  );
}
