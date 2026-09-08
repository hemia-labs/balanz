"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export function TeamReauthenticationDialog({
  open,
  code,
  busy,
  error,
  onCodeChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  code: string;
  busy: boolean;
  error: string | null;
  onCodeChange: (code: string) => void;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void onConfirm();
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirma la acción administrativa</DialogTitle>
            <DialogDescription>
              Ingresa el código vigente de tu aplicación autenticadora. Al
              validarlo, reintentaremos automáticamente la acción pendiente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              className="text-body-sm font-semibold"
              htmlFor="team-reauth-code"
            >
              Código de 6 dígitos
            </label>
            <InputOTP
              id="team-reauth-code"
              maxLength={6}
              value={code}
              onChange={onCodeChange}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              autoFocus
            >
              <InputOTPGroup className="gap-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {error ? (
            <p role="alert" className="text-body-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Verificando…" : "Confirmar y continuar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
