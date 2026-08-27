"use client";

import Link from "next/link";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { Surface, WarningNotice } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import type { Capability } from "@/lib/accounting-types";

export function LiveForbiddenScreen({
  capability,
}: {
  capability: Capability;
}) {
  const { clientId, organization, locale } = useAccountingContext();
  const canReturnToClient = Boolean(clientId && capability !== "clients.view");
  const destination = canReturnToClient
    ? `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${encodeURIComponent(clientId!)}/overview`
    : `/${locale}/organizations/${encodeURIComponent(organization.slug)}/home`;
  return (
    <div className="space-y-6">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Error 403
        </p>
        <h1 className="text-heading-lg font-bold">Acceso restringido</h1>
        <p className="mt-1 max-w-reading text-body text-muted-foreground">
          Tu membresía no incluye la capacidad necesaria para abrir esta
          sección.
        </p>
      </header>
      <Surface className="flex min-h-64 items-start gap-4 p-6">
        <div className="grid size-10 shrink-0 place-items-center rounded-md bg-warning-surface text-warning">
          <LockKeyhole className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-heading-sm font-emphasis">
            Revisa tu asignación o capacidad
          </h2>
          <p className="mt-2 max-w-reading text-body text-muted-foreground">
            Solicita acceso a una persona administradora del despacho si
            necesitas trabajar en esta sección. No se cargaron los datos
            restringidos.
          </p>
          <Button render={<Link href={destination} />} className="mt-5">
            {canReturnToClient ? "Volver al cliente" : "Volver al inicio"}
          </Button>
        </div>
      </Surface>
    </div>
  );
}

export function LiveUnavailableScreen({
  title = "Funcionalidad fuera de esta entrega",
  description = "Esta vista no usa datos demo cuando el modo real está activo. El alcance actual cubre clientes, RFC, asignaciones, ejercicios y períodos.",
  returnHref,
  returnLabel = "Volver a clientes",
}: {
  title?: string;
  description?: string;
  returnHref?: string;
  returnLabel?: string;
} = {}) {
  const { organization, locale } = useAccountingContext();
  const destination =
    returnHref ??
    `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients`;
  return (
    <div className="space-y-4">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Módulo real
        </p>
        <h1 className="text-heading-lg font-bold">{title}</h1>
      </header>
      <WarningNotice>{description}</WarningNotice>
      <Button render={<Link href={destination} />} variant="outline">
        <RefreshCw />
        {returnLabel}
      </Button>
    </div>
  );
}
