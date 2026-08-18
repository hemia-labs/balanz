import { notFound, redirect } from "next/navigation";
import { AccountingScreen } from "@/components/accounting-screen";
import { clientById, demoData, membershipFor, organizationById } from "@/lib/demo-data";
import { hasCapability, canAccessClient } from "@/lib/permissions";
import { resolveProductRoute } from "@/lib/product-route";

export default async function ProductRoutePage({ params }: { params: Promise<{ lang: string; organizationId: string; segments?: string[] }> }) {
  const { lang, organizationId, segments } = await params;
  if (lang !== "es") redirect(`/es/despachos/${organizationId}/${(segments ?? []).join("/")}`);
  if (!organizationById(organizationId)) notFound();
  const membership = membershipFor(organizationId);
  if (!membership) redirect(`/es/sin-acceso?recurso=despacho&organizacion=${encodeURIComponent(organizationId)}`);
  const route = resolveProductRoute(organizationId, segments);
  if (!route) notFound();
  if (route.capability && !hasCapability(membership.capabilities, route.capability)) redirect(`/es/sin-acceso?capacidad=${encodeURIComponent(route.capability)}&organizacion=${encodeURIComponent(organizationId)}`);
  if (route.clientId) {
    const client = clientById(organizationId, route.clientId);
    if (!client) notFound();
    if (!canAccessClient(membership, client.id)) redirect(`/es/sin-acceso?recurso=cliente&organizacion=${encodeURIComponent(organizationId)}`);
  }
  if (route.screen === "cfdi-detail" && !demoData.cfdi.some((item) => item.clientId === route.clientId && item.uuid === route.uuid)) notFound();
  if (["fiscal-year", "period", "diot-period"].includes(route.screen) && route.year !== "2026") notFound();
  if (route.screen === "period" && !demoData.periods.some((item) => item.slug === route.period)) notFound();
  return <AccountingScreen route={route} />;
}
