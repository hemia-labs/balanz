import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { demoOrganizationId, membershipFor, organizationById } from "@/lib/demo-data";

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requestedOrganization = typeof query.organizacion === "string" ? query.organizacion : undefined;
  const organizationId = requestedOrganization && organizationById(requestedOrganization) && membershipFor(requestedOrganization) ? requestedOrganization : demoOrganizationId;
  const reason = typeof query.capacidad === "string" ? `La membresía no incluye la capacidad ${query.capacidad}.` : "Tu membresía demostrativa no permite abrir este contexto.";
  return <div className="space-y-6"><PageHeader eyebrow="Error 403" title="Acceso restringido" description={reason} /><Surface className="flex min-h-64 items-start gap-4 p-6"><div className="grid size-10 place-items-center rounded-md bg-warning-surface text-warning"><LockKeyhole className="size-5" /></div><div><h2 className="text-heading-sm font-emphasis">Revisa tu asignación o capacidad</h2><p className="mt-2 max-w-xl text-body text-muted-foreground">Ocultar una opción no autoriza ni protege una operación. El backend deberá validar tenant, membresía, asignación y capacidad.</p><Button render={<Link href={`/es/despachos/${organizationId}/inicio`} />} className="mt-5">Volver al despacho</Button></div></Surface></div>;
}
