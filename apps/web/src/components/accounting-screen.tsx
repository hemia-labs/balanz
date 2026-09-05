"use client";

import dynamic from "next/dynamic";
import { useAccountingContext } from "@/components/accounting-context";
import {
  LiveForbiddenScreen,
  LiveUnavailableScreen,
} from "@/features/clients/live-fallback-screens";
import {
  canOpenResolvedProductRoute,
  isLivePeriodTabSupported,
  type ResolvedProductRoute,
} from "@/lib/product-route";

const LiveClientsScreen = dynamic(() =>
  import("@/features/clients/live-clients-screen").then(
    (module) => module.LiveClientsScreen,
  ),
);

const LiveClientDetailScreen = dynamic(() =>
  import("@/features/clients/live-client-detail-screen").then(
    (module) => module.LiveClientDetailScreen,
  ),
);

const LiveFiscalYearsScreen = dynamic(() =>
  import("@/features/clients/live-fiscal-screens").then(
    (module) => module.LiveFiscalYearsScreen,
  ),
);

const LiveFiscalYearScreen = dynamic(() =>
  import("@/features/clients/live-fiscal-screens").then(
    (module) => module.LiveFiscalYearScreen,
  ),
);

const PermissionAdministrationScreen = dynamic(() =>
  import("@/features/permissions/permission-administration-screen").then(
    (module) => module.PermissionAdministrationScreen,
  ),
);

export function AccountingScreen({ route }: { route: ResolvedProductRoute }) {
  const { capabilities, locale, membership, organization } =
    useAccountingContext();
  const { clientId } = route;
  if (!canOpenResolvedProductRoute(route, capabilities)) {
    return <LiveForbiddenScreen capability={route.capability!} />;
  }
  if (
    route.clientId &&
    !membership.assignedClientIds.includes(route.clientId)
  ) {
    return <LiveForbiddenScreen reason="out_of_scope" />;
  }
  switch (route.screen) {
    case "clients":
      return <LiveClientsScreen />;
    case "team":
      return <PermissionAdministrationScreen />;
    case "client-overview":
      return <LiveClientDetailScreen clientId={clientId!} section="overview" />;
    case "client-settings":
      if (
        route.section === "data" ||
        route.section === "responsibles" ||
        route.section === "access"
      ) {
        return (
          <LiveClientDetailScreen
            clientId={clientId!}
            section={route.section}
          />
        );
      }
      return <LiveUnavailableScreen />;
    case "fiscal-years":
      return (
        <LiveFiscalYearsScreen
          key={route.legalEntityId ?? "entity-selector"}
          clientId={clientId!}
          legalEntityId={route.legalEntityId}
        />
      );
    case "fiscal-year":
      return (
        <LiveFiscalYearScreen
          clientId={clientId!}
          legalEntityId={route.legalEntityId}
          year={route.year!}
        />
      );
    case "period":
      if (!isLivePeriodTabSupported(route.tab)) {
        const clientBase = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${encodeURIComponent(clientId!)}`;
        const periodOverviewHref = route.legalEntityId
          ? `${clientBase}/legal-entities/${encodeURIComponent(route.legalEntityId)}/fiscal-years/${encodeURIComponent(route.year!)}/periods/${encodeURIComponent(route.period!)}/overview`
          : `${clientBase}/fiscal-years/${encodeURIComponent(route.year!)}/periods/${encodeURIComponent(route.period!)}/overview`;
        return (
          <LiveUnavailableScreen
            title="Pestaña de período no disponible"
            description="Esta pestaña todavía no está conectada a datos reales. Puedes volver al resumen del período sin perder el contexto del RFC y ejercicio seleccionados."
            returnHref={periodOverviewHref}
            returnLabel="Volver al resumen del período"
          />
        );
      }
      return (
        <LiveFiscalYearScreen
          clientId={clientId!}
          legalEntityId={route.legalEntityId}
          year={route.year!}
          selectedMonth={route.period}
        />
      );
    default:
      return <LiveUnavailableScreen />;
  }
}
