"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { MfaSettings } from "@/components/mfa-settings";
import { Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getOnboarding } from "@/features/auth/api";
import type { OnboardingResponse } from "@/features/session/types";

function date(value?: string) {
  return value ? value.slice(0, 10) : "—";
}
export default function OnboardingPage() {
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const locale = params.lang ?? "es";
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMfa, setShowMfa] = useState(false);

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

  if (error) return <main className="grid min-h-screen place-items-center px-4"><p role="alert" className="text-body-sm text-destructive">{error}</p></main>;
  if (!data) return <main className="grid min-h-screen place-items-center px-4 text-body-sm text-muted-foreground">Cargando onboarding…</main>;

  return (
    <main id="main-content" className="min-h-screen w-full bg-background px-4 py-8">
      <div className="mx-auto max-w-form space-y-6">
        <BrandMark locale={locale as "es"} />
        <header className="border-l-2 border-brand-mark pl-4">
          <p className="text-caption font-semibold text-accent-foreground">Organización lista</p>
          <h1 className="text-heading-lg font-bold">Completa tu onboarding</h1>
          <p className="mt-1 text-body text-muted-foreground">Eres Titular. Puedes continuar sin MFA y configurarlo después para acciones sensibles.</p>
        </header>
        <Surface className="space-y-5 p-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-caption text-muted-foreground">Suscripción</dt><dd className="font-semibold">{data.subscriptionType}</dd></div>
            <div><dt className="text-caption text-muted-foreground">Estado del trial</dt><dd className="font-semibold">{data.trial.status}</dd></div>
            <div><dt className="text-caption text-muted-foreground">Inicio</dt><dd>{date(data.trial.startedAt)}</dd></div>
            <div><dt className="text-caption text-muted-foreground">Fin</dt><dd>{date(data.trial.endsAt)}</dd></div>
          </dl>
          <p className="rounded-md border border-border bg-muted/30 p-3 text-body-sm">Siguiente paso: {data.nextStep}. El acceso fiscal permanecerá bloqueado hasta que corresponda.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => router.push(`/${locale}`)}>Continuar a la aplicación</Button>
            <Button variant="outline" onClick={() => setShowMfa((value) => !value)}>{showMfa ? "Ocultar MFA" : "Configurar MFA"}</Button>
          </div>
          {showMfa ? <div className="border-t border-border pt-5"><MfaSettings compact /></div> : null}
        </Surface>
      </div>
    </main>
  );
}
