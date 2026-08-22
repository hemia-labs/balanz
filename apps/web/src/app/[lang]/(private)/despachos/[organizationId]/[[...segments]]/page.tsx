import { notFound, redirect } from "next/navigation";
import { AccountingScreen } from "@/components/accounting-screen";
import { clientById, demoData, membershipFor, organizationById } from "@/lib/demo-data";
import { hasCapability, canAccessClient } from "@/lib/permissions";
import { resolveProductRoute } from "@/lib/product-route";

const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export default async function ProductRoutePage({ params }: { params: Promise<{ lang: string; organizationId: string; segments?: string[] }> }) {
  const { lang, organizationId, segments } = await params;
  if (!demoMode || !organizationById(organizationId)) {
    return <div className="space-y-4"><header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">Organización activa</p><h1 className="text-heading-lg font-bold">Tu organización está lista</h1><p className="mt-1 text-body text-muted-foreground">La navegación ya respeta tus permisos. Las vistas operativas se habilitarán conforme se conecten los módulos de dominio.</p></header><div className="rounded-md border border-border bg-card p-5 text-body-sm text-muted-foreground">No hay datos demo asociados a este tenant.</div></div>;
  }
  const membership = membershipFor(organizationId);
  if (!membership) redirect(`/${lang}/forbidden?recurso=despacho&organizacion=${encodeURIComponent(organizationId)}`);
  const route = resolveProductRoute(organizationId, segments);
  if (!route) notFound();
  if (route.capability && !hasCapability(membership.capabilities, route.capability)) redirect(`/${lang}/forbidden?capacidad=${encodeURIComponent(route.capability)}&organizacion=${encodeURIComponent(organizationId)}`);
  if (route.clientId) {
    const client = clientById(organizationId, route.clientId);
    if (!client) notFound();
    if (!canAccessClient(membership, client.id)) redirect(`/${lang}/forbidden?recurso=cliente&organizacion=${encodeURIComponent(organizationId)}`);
  }
  if (route.screen === "cfdi-detail" && !demoData.cfdi.some((item) => item.clientId === route.clientId && item.uuid === route.uuid)) notFound();
  if (["fiscal-year", "period", "diot-period"].includes(route.screen) && route.year !== "2026") notFound();
  if (route.screen === "period" && !demoData.periods.some((item) => item.slug === route.period)) notFound();
  return <AccountingScreen route={route} />;
}
