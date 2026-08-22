import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";

export default async function ForbiddenPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { lang } = await params;
  const query = await searchParams;
  const requestedOrganization = typeof query.organizacion === "string" ? query.organizacion : undefined;
  const reason = typeof query.capacidad === "string" ? `La membresía no incluye la capacidad ${query.capacidad}.` : "Tu membresía no permite abrir este contexto.";
  const destination = requestedOrganization ? `/${lang}/despachos/${encodeURIComponent(requestedOrganization)}/inicio` : `/${lang}/select-organization`;
  return <div className="space-y-6"><PageHeader eyebrow="Error 403" title="Acceso restringido" description={reason} /><Surface className="flex min-h-64 items-start gap-4 p-6"><div className="grid size-10 place-items-center rounded-md bg-warning-surface text-warning"><LockKeyhole className="size-5" /></div><div><h2 className="text-heading-sm font-emphasis">Revisa tu asignación o capacidad</h2><p className="mt-2 max-w-xl text-body text-muted-foreground">La autorización debe validarse en el backend para cada operación.</p><Button render={<Link href={destination} />} className="mt-5">Continuar</Button></div></Surface></div>;
}
