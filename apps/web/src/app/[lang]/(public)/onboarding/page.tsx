"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MfaSettings } from "@/components/mfa-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { getOnboarding } from "@/features/auth/api";
import type { OnboardingResponse } from "@/features/session/types";

type MfaStatus = "disabled" | "pending" | "active";

export default function OnboardingPage() {
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const locale = params.lang ?? "es";
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMfa, setShowMfa] = useState(false);
  const [mfaActivated, setMfaActivated] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    getOnboarding(controller.signal)
      .then((response) => active && setData(response))
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof ApiError && requestError.status === 401) {
          router.replace(`/${locale}/login`);
          return;
        }
        setError(requestError instanceof ApiError ? requestError.message : "No se pudo restaurar el onboarding.");
      });
    return () => { active = false; controller.abort(); };
  }, [locale, router]);

  if (error) return <main className="grid min-h-[100dvh] place-items-center px-4"><p role="alert" className="text-body-sm text-destructive">{error}</p></main>;
  if (!data) return <main className="grid min-h-[100dvh] place-items-center px-4 text-body-sm text-muted-foreground">Cargando onboarding…</main>;

  const mfaStatus = data.mfaStatus as MfaStatus;
  const alreadyActive = mfaStatus === "active";
  const setupView = showMfa || mfaStatus === "pending" || alreadyActive;
  const activationComplete = mfaActivated || alreadyActive;

  return (
    <main id="main-content" className="grid min-h-[100dvh] place-items-center px-4 py-8">
      {setupView ? (
        <Card className="w-full max-w-[28rem] border-border py-0 shadow-float ring-0">
          <CardHeader className="gap-4 p-7 sm:p-8 sm:pb-6">
            <div className="grid size-11 place-items-center rounded-xl bg-secondary text-primary">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-heading-md font-bold">{activationComplete ? "Verificación en dos pasos activada" : "Configura la verificación en dos pasos"}</h1>
              <p className="mt-2 text-body-sm text-muted-foreground">{activationComplete ? "Tu cuenta ya está protegida. Ahora puedes continuar al inicio de Balanz." : "Añade una capa extra de seguridad. Necesitarás tu teléfono además de tu contraseña para iniciar sesión."}</p>
            </div>
          </CardHeader>
          <CardContent className="px-7 pb-7 sm:px-8 sm:pb-8"><MfaSettings compact startOnMount onActivated={() => setMfaActivated(true)} onContinue={() => router.push(`/${locale}`)} onCancel={() => { setShowMfa(false); setMfaActivated(false); }} initialStatus={mfaStatus} /></CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-[28rem] border-border py-0 shadow-float ring-0">
          <CardHeader className="gap-4 p-7 sm:p-8 sm:pb-5">
            <div className="grid size-11 place-items-center rounded-xl bg-secondary text-primary">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-heading-md font-bold">{alreadyActive ? "Tu cuenta está protegida" : "Protege tu cuenta con verificación en dos pasos"}</h1>
              <p className="mt-2 text-body-sm text-muted-foreground">{alreadyActive ? "La verificación en dos pasos ya está activa para tu cuenta." : "Tu registro está completo. Añade una capa extra de seguridad para proteger tu información fiscal y tus CFDI frente a accesos no autorizados."}</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 px-7 pb-7 sm:px-8 sm:pb-8">
            {!alreadyActive && (
              <ul className="space-y-3 text-body-sm">
                {[
                  "Protege tu cuenta aunque alguien consiga tu contraseña.",
                  "Compatible con Google Authenticator, Authy y Microsoft Authenticator.",
                  "Solo toma un minuto configurarlo y puedes desactivarlo cuando quieras.",
                ].map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-secondary text-primary"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 pt-1">
              {!alreadyActive && <Button className="w-full" onClick={() => setShowMfa(true)}>Activar verificación en dos pasos</Button>}
              <Button variant="outline" className="w-full" onClick={() => router.push(`/${locale}`)}>{alreadyActive ? "Continuar a la aplicación" : "Continuar sin activar"}</Button>
            </div>
            {!alreadyActive && <p className="pt-1 text-center text-caption text-muted-foreground">Podrás activarla más tarde desde Configuración › Seguridad.</p>}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
