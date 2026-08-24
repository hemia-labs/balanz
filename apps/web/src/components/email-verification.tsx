"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, isAbortError } from "@/lib/api-client";
import { confirmEmail, resendEmailVerification } from "@/features/auth/api";
import type { EmailVerificationResult } from "@/features/session/types";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/product-patterns";

type PendingRegistration = { email?: string; organizationName?: string; subscriptionType?: string };

export function EmailVerification({ locale = "es" }: { locale?: string }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRegistration>({});
  const [state, setState] = useState<"ready" | "confirming" | "success" | "error">("ready");
  const [result, setResult] = useState<EmailVerificationResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    const value = hash.startsWith("#") ? new URLSearchParams(hash.slice(1)).get("token") : null;
    const tokenTimer = value ? window.setTimeout(() => setToken(value), 0) : undefined;
    let pendingTimer: number | undefined;
    if (hash) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    try {
      const stored = sessionStorage.getItem("balanz_pending_registration");
      const pending = stored ? JSON.parse(stored) as PendingRegistration : null;
      if (pending) pendingTimer = window.setTimeout(() => setPending(pending), 0);
    } catch {
      // A malformed non-sensitive onboarding hint is safe to ignore.
    }
    return () => {
      if (tokenTimer) window.clearTimeout(tokenTimer);
      if (pendingTimer) window.clearTimeout(pendingTimer);
      requestController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function confirm() {
    if (!token || state === "confirming") return;
    setState("confirming");
    setMessage(null);
    requestController.current?.abort();
    requestController.current = new AbortController();
    try {
      const confirmation = await confirmEmail(token, requestController.current.signal);
      setResult(confirmation);
      setState("success");
      setToken(null);
      sessionStorage.removeItem("balanz_pending_registration");
      router.replace(`/${locale}/onboarding`);
    } catch (error) {
      if (isAbortError(error)) return;
      setState("error");
      setMessage(error instanceof ApiError ? error.message : "El enlace no pudo confirmarse.");
    }
  }

  useEffect(() => {
    if (token) void confirm();
  }, [token]);

  async function resend() {
    if (!pending.email || cooldown > 0) return;
    setMessage(null);
    requestController.current?.abort();
    requestController.current = new AbortController();
    try {
      await resendEmailVerification(pending.email, requestController.current.signal);
      setMessage("Si el correo puede verificarse, recibirás un nuevo enlace.");
      setCooldown(60);
    } catch (error) {
      if (isAbortError(error)) return;
      if (error instanceof ApiError && error.status === 429) {
        setMessage("Ya solicitaste un enlace recientemente. Intenta de nuevo más tarde.");
      } else {
        setMessage("Si el correo puede verificarse, recibirás un nuevo enlace.");
      }
    }
  }

  return (
    <main id="main-content" className="grid min-h-screen place-items-center bg-background px-4 py-8">
      <Surface className="w-full max-w-form space-y-5 p-6">
        <div>
          <p className="text-caption font-semibold text-accent-foreground">Verificación de correo</p>
          <h1 className="mt-1 text-heading-lg font-bold">Confirma tu correo</h1>
          <p className="mt-2 text-body-sm text-muted-foreground">
            Revisa tu bandeja de entrada{pending.email ? ` (${pending.email})` : ""}. Te enviamos un enlace para activar tu cuenta.
          </p>
          <p className="text-body-sm text-muted-foreground">
            Si no lo encuentras, revisa la carpeta de spam o correo no deseado.
          </p>
        </div>
        {message ? <p role="status" aria-live="polite" className="rounded-md border border-border bg-muted/30 p-3 text-body-sm">{message}</p> : null}
        {state === "success" ? (
          <div className="space-y-4">
            <p className="text-body-sm text-success">Correo confirmado. Tu prueba gratuita está lista.</p>
            {result ? <dl className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-body-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Correo</dt><dd className="font-semibold">{result.emailVerified ? "Verificado" : "Pendiente"}</dd></div>
              <div><dt className="text-muted-foreground">Suscripción</dt><dd className="font-semibold">{result.subscriptionType}</dd></div>
              <div><dt className="text-muted-foreground">Trial</dt><dd className="font-semibold">{result.trial.status}</dd></div>
              <div><dt className="text-muted-foreground">Siguiente paso</dt><dd className="font-semibold">{result.nextStep}</dd></div>
            </dl> : null}
            <Button className="w-full" onClick={() => router.replace(`/${locale}/onboarding`)}>Continuar al onboarding</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {token ? <Button className="w-full" onClick={confirm} disabled={state === "confirming"}>{state === "confirming" ? "Confirmando…" : "Confirmar correo"}</Button> : null}
            {state === "error" ? <p role="alert" className="text-body-sm text-destructive">{message ?? "El enlace es inválido, expiró o ya fue usado."}</p> : null}
            <Button type="button" variant="outline" className="w-full" onClick={resend} disabled={!pending.email || cooldown > 0}>
              {cooldown > 0 ? `Reenviar en ${cooldown}s` : "Reenviar enlace"}
            </Button>
          </div>
        )}
      </Surface>
    </main>
  );
}
