"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { reauthenticateSession } from "@/features/auth/api";
import { useSession } from "@/features/session/session-provider";
import { apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Surface, SurfaceHeader } from "@/components/product-patterns";

export function SessionReauthentication() {
  const { session, refreshSession } = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (session?.mfaStatus !== "active") return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await reauthenticateSession(code);
      setCode("");
      setSuccess(
        "Sesión reautenticada. Ya puedes confirmar acciones sensibles.",
      );
      await refreshSession();
    } catch (cause) {
      setError(apiErrorMessage(cause, "No se pudo reautenticar la sesión."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface>
      <SurfaceHeader
        title="Reautenticación para acciones sensibles"
        description="Confirma un código vigente antes de cerrar períodos, descargar del SAT o generar exportaciones protegidas."
      />
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <KeyRound
            className="mt-1 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="space-y-3">
            <label
              className="block text-body-sm font-semibold"
              htmlFor="reauth-code"
            >
              Código de tu aplicación autenticadora
            </label>
            <InputOTP
              id="reauth-code"
              maxLength={6}
              value={code}
              onChange={setCode}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              aria-label="Código de reautenticación de 6 dígitos"
            >
              <InputOTPGroup className="w-full max-w-sm justify-between gap-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="size-11 rounded-md border text-heading-sm sm:size-12"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
        {success ? (
          <p
            role="status"
            aria-live="polite"
            className="text-body-sm text-success"
          >
            {success}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Verificando…" : "Reautenticar sesión"}
          </Button>
        </div>
      </form>
    </Surface>
  );
}
