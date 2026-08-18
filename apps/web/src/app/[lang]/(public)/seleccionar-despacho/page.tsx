import Link from "next/link";
import { Building2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Surface } from "@/components/product-patterns";
import { Badge } from "@/components/ui/badge";
import { demoData } from "@/lib/demo-data";
import { roleLabels } from "@/lib/permissions";

export default function SelectOrganizationPage() {
 return <main id="main-content" className="min-h-screen w-full bg-background px-4 py-8"><div className="mx-auto max-w-2xl space-y-6"><BrandMark locale="es" /><header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">Cuenta global</p><h1 className="text-heading-lg font-bold">Selecciona un despacho</h1><p className="mt-1 text-body text-muted-foreground">El perfil y las capacidades cambian según la membresía seleccionada.</p></header><div className="space-y-3">{demoData.memberships.map((membership) => { const organization = demoData.organizations.find((item) => item.id === membership.organizationId)!; const clientCount = membership.assignedClientIds.length; return <Link key={organization.id} href={`/es/despachos/${organization.id}/inicio`} className="block"><Surface className="flex items-center gap-4 p-5 transition-colors hover:bg-muted/55"><div className="grid size-10 place-items-center rounded-md bg-secondary text-secondary-foreground"><Building2 className="size-5" /></div><span className="min-w-0 flex-1"><span className="block font-semibold">{organization.name}</span><span className="text-body-sm text-muted-foreground">{clientCount} {clientCount === 1 ? "cliente asignado" : "clientes asignados"}</span></span><Badge variant="outline">{roleLabels[membership.role]}</Badge></Surface></Link>; })}</div><p className="text-caption text-muted-foreground">No se selecciona automáticamente un despacho si el último contexto deja de ser válido.</p></div></main>;
}
