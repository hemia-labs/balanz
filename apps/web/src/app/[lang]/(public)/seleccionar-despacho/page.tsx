"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getOrganizations, selectOrganization } from "@/features/organizations/api";
import type { OrganizationSummary } from "@/features/session/types";

export function SelectOrganizationPage() {
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const locale = params.lang ?? "es";
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getOrganizations(controller.signal)
      .then((items) => { if (active) setOrganizations(items); })
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof ApiError && requestError.code === "ABORTED") return;
        if (requestError instanceof ApiError && requestError.status === 401) router.replace(`/${locale}/login`);
        else setError("No se pudieron cargar tus organizaciones.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [locale, router]);

  async function select(organization: OrganizationSummary) {
    setChanging(organization.id);
    setError(null);
    try {
      await selectOrganization(organization.id);
      router.replace(`/${locale}/despachos/${organization.id}/inicio`);
    } catch (requestError) {
      if (!(requestError instanceof ApiError && requestError.code === "ABORTED")) setError(requestError instanceof ApiError ? requestError.message : "No se pudo activar la organización.");
    } finally {
      setChanging(null);
    }
  }

  return <main id="main-content" className="min-h-screen w-full bg-background px-4 py-8"><div className="mx-auto max-w-2xl space-y-6"><BrandMark locale={locale as "es"} /><header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">Cuenta global</p><h1 className="text-heading-lg font-bold">Selecciona un despacho</h1><p className="mt-1 text-body text-muted-foreground">El perfil y las capacidades cambian según la membresía seleccionada.</p></header>{error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive">{error}</p> : null}{loading ? <p className="text-body-sm text-muted-foreground">Cargando organizaciones…</p> : organizations.length === 0 ? <p className="text-body-sm text-muted-foreground">No tienes organizaciones disponibles.</p> : <div className="space-y-3">{organizations.map((organization) => <Surface key={organization.id} className="flex items-center gap-4 p-5"><div className="grid size-10 place-items-center rounded-md bg-secondary text-secondary-foreground"><Building2 className="size-5" /></div><span className="min-w-0 flex-1"><span className="block font-semibold">{organization.name}</span><span className="text-body-sm text-muted-foreground">{organization.slug}</span></span><Button variant="outline" onClick={() => select(organization)} disabled={changing !== null}>{changing === organization.id ? "Activando…" : "Continuar"}</Button></Surface>)}</div>}<p className="text-caption text-muted-foreground">No se selecciona automáticamente un despacho si el contexto deja de ser válido.</p></div></main>;
}

export default SelectOrganizationPage;
