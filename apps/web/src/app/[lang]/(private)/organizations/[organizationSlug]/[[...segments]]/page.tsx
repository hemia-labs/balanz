import { notFound, redirect } from "next/navigation";
import { AccountingScreen } from "@/components/accounting-screen";
import {
  clientById,
  demoData,
  membershipFor,
  organizationBySlug,
} from "@/lib/demo-data";
import { hasCapability, canAccessClient } from "@/lib/permissions";
import { resolveProductRoute } from "@/lib/product-route";

const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export default async function ProductRoutePage({
  params,
}: {
  params: Promise<{
    lang: string;
    organizationSlug: string;
    segments?: string[];
  }>;
}) {
  const { lang, organizationSlug, segments } = await params;
  const demoOrganization = organizationBySlug(organizationSlug);
  if (!demoMode || !demoOrganization) {
    const route = resolveProductRoute(organizationSlug, segments);
    if (!route) notFound();
    return <AccountingScreen route={route} />;
  }
  const organizationId = demoOrganization.id;
  const membership = membershipFor(organizationId);
  if (!membership)
    redirect(
      `/${lang}/forbidden?recurso=despacho&organizacion=${encodeURIComponent(organizationId)}`,
    );
  const route = resolveProductRoute(organizationId, segments);
  if (!route) notFound();
  if (
    route.capability &&
    !hasCapability(membership.capabilities, route.capability)
  )
    redirect(
      `/${lang}/forbidden?capacidad=${encodeURIComponent(route.capability)}&organizacion=${encodeURIComponent(organizationId)}`,
    );
  if (route.clientId) {
    const client = clientById(organizationId, route.clientId);
    if (!client) notFound();
    if (!canAccessClient(membership, client.id))
      redirect(
        `/${lang}/forbidden?recurso=cliente&organizacion=${encodeURIComponent(organizationId)}`,
      );
  }
  if (
    route.screen === "cfdi-detail" &&
    !route.legalEntityId &&
    !demoData.cfdi.some(
      (item) => item.clientId === route.clientId && item.uuid === route.cfdiId,
    )
  )
    notFound();
  if (
    ["fiscal-year", "period", "diot-period"].includes(route.screen) &&
    route.year !== "2026"
  )
    notFound();
  if (
    route.screen === "period" &&
    !demoData.periods.some((item) => item.slug === route.period)
  )
    notFound();
  return <AccountingScreen route={route} />;
}
