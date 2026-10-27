"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { getOrganizations, selectOrganization } from "@/features/organizations/api";
import type { OrganizationSummary } from "@/features/session/types";
import { safeInternalReturnTo } from "@/lib/navigation-security";
import { labelBackendRole } from "@/lib/permissions";

let organizationsRequest: Promise<OrganizationSummary[]> | null = null;

function loadOrganizations() {
  organizationsRequest ??= getOrganizations().finally(() => {
    organizationsRequest = null;
  });
  return organizationsRequest;
}

export function SelectOrganizationPage() {
  const params = useParams<{ lang: string }>();
  const router = useRouter();
  const locale = params.lang ?? "es";
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadOrganizations()
      .then((items) => {
        if (!active) return;
        setOrganizations(items);
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof ApiError && requestError.status === 401) router.replace(`/${locale}/login`);
        else setError("No se pudieron cargar tus organizaciones.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locale, router]);

  async function select(organization: OrganizationSummary) {
    setChanging(organization.id);
    setError(null);
    try {
      await selectOrganization(organization.id);
      const destination = typeof window === "undefined"
        ? null
        : safeInternalReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
      router.replace(destination ?? `/${locale}/organizations/${organization.slug}/home`);
    } catch (requestError) {
      if (!(requestError instanceof ApiError && requestError.code === "ABORTED")) setError(requestError instanceof ApiError ? requestError.message : "No se pudo activar la organización.");
    } finally {
      setChanging(null);
    }
  }

  const selectedOrganization = organizations.find(({ id }) => id === selectedId);

  return (
    <main id="main-content" tabIndex={-1} className="grid min-h-[100dvh] bg-auth-background focus:outline-none lg:grid-cols-[minmax(0,0.8fr)_minmax(28rem,1.2fr)]">
      <section className="auth-sidebar relative hidden overflow-hidden p-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between xl:p-14">
        <Link href={`/${locale}`} aria-label="CFDIOS, inicio" className="inline-flex min-h-10 items-center rounded-md">
          <Image src="/logo-white.png" alt="" width={192} height={48} priority className="h-auto w-48" />
        </Link>
        <div className="relative z-10 max-w-sm">
          <h2 className="text-heading-lg font-bold">Un mismo acceso, todos tus despachos.</h2>
          <p className="mt-4 text-body-lg text-sidebar-foreground/75">Cambia de espacio cuando lo necesites. Cada despacho conserva su propio perfil, permisos y datos fiscales.</p>
        </div>
        <Image src="/isotipo-white.svg" alt="" width={560} height={560} aria-hidden="true" className="pointer-events-none absolute -bottom-16 -right-20 size-72 opacity-25" />
      </section>

      <section className="flex min-w-0 min-h-[100dvh] items-center justify-center px-4 py-8 sm:px-8 lg:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <BrandMark locale={locale as "es"} />
          </div>
          <Card className="rounded-lg border-border py-0 shadow-float ring-0" aria-busy={loading || changing !== null}>
            <CardContent className="p-6 sm:p-7">
            <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Building2 className="size-5" aria-hidden="true" />
            </div>
            <div className="mt-5">
              <p className="text-caption font-semibold text-muted-foreground">Cuenta global</p>
              <h1 className="mt-1 text-heading-sm font-bold">Selecciona un despacho</h1>
              <p className="mt-2 text-body-sm text-muted-foreground">El perfil y las capacidades cambian según la membresía que elijas.</p>
            </div>

            {error ? <p role="alert" aria-live="polite" className="mt-4 rounded-md border border-destructive/30 bg-destructive-surface p-3 text-body-sm text-destructive">{error}</p> : null}

            {loading ? (
              <p className="mt-5 text-body-sm text-muted-foreground" role="status">Cargando despachos…</p>
            ) : organizations.length === 0 ? (
              <p className="mt-5 text-body-sm text-muted-foreground">No tienes despachos disponibles.</p>
            ) : (
              <fieldset className="mt-5 min-w-0 space-y-2" disabled={changing !== null}>
                <legend className="sr-only">Despachos disponibles</legend>
                {organizations.map((organization) => {
                  const checked = selectedId === organization.id;
                  return (
                    <label key={organization.id} className="block cursor-pointer">
                      <input
                        type="radio"
                        name="organization"
                        value={organization.id}
                        checked={checked}
                        onChange={() => setSelectedId(organization.id)}
                        className="peer sr-only"
                      />
                      <span className={`flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 transition-colors duration-150 ease-standard peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring ${checked ? "border-primary bg-secondary" : "border-border hover:bg-muted"}`}>
                        <span className={`grid size-8 shrink-0 place-items-center rounded-md ${checked ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground"}`} aria-hidden="true">
                          <span className="text-body-sm font-bold">{organization.name.charAt(0).toUpperCase()}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-sm font-semibold">{organization.name}</span>
                          <span className="block truncate text-caption text-muted-foreground">{organization.slug} · {labelBackendRole(organization.role)}</span>
                        </span>
                        <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${checked ? "border-primary" : "border-input"}`} aria-hidden="true">
                          <span className={`size-2 rounded-full bg-primary ${checked ? "" : "opacity-0"}`} />
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}

            <div className="mt-5 grid gap-2">
              <Button className="w-full" onClick={() => selectedOrganization && void select(selectedOrganization)} disabled={!selectedOrganization || changing !== null}>
                {changing ? "Activando…" : "Continuar"}
              </Button>
              <Button render={<Link href={`/${locale}/login`} />} variant="outline" className="w-full" disabled={changing !== null}>
                Usar otra cuenta
              </Button>
            </div>

            <p className="mt-4 text-center text-caption text-muted-foreground">No se selecciona un despacho automáticamente si el contexto deja de ser válido.</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

export default SelectOrganizationPage;
