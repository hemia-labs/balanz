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
import { canAccessAccountScope } from "@/lib/permissions";

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

const LiveProcessesScreen = dynamic(() =>
  import("@/features/ingestions/live-processes-screen").then(
    (module) => module.LiveProcessesScreen,
  ),
);

const LiveClientCfdiScreen = dynamic(() =>
  import("@/features/cfdi/live-cfdi-screens").then(
    (module) => module.LiveClientCfdiScreen,
  ),
);

const LiveCfdiDetailScreen = dynamic(() =>
  import("@/features/cfdi/live-cfdi-screens").then(
    (module) => module.LiveCfdiDetailScreen,
  ),
);

export function AccountingScreen({ route }: { route: ResolvedProductRoute }) {
  const { accountAccessMode, capabilities, locale, membership, organization } =
    useAccountingContext();
  const { clientId } = route;
  if (!canOpenResolvedProductRoute(route, capabilities)) {
    return <LiveForbiddenScreen capability={route.capability!} />;
  }
  if (
    route.clientId &&
    !canAccessAccountScope(
      accountAccessMode,
      membership.assignedClientIds,
      route.clientId,
    )
  ) {
    return <LiveForbiddenScreen reason="out_of_scope" />;
  }
  switch (route.screen) {
    case "processes":
      return <LiveProcessesScreen />;
    case "client-cfdi":
      return (
        <LiveClientCfdiScreen
          clientId={clientId!}
          legalEntityId={route.legalEntityId}
        />
      );
    case "cfdi-detail":
      if (!route.legalEntityId)
        return (
          <LiveUnavailableScreen
            title="Selecciona primero un RFC"
            description="Abre CFDI desde la lista de una entidad fiscal para conservar el alcance completo."
            returnHref={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${encodeURIComponent(clientId!)}/cfdi`}
            returnLabel="Seleccionar RFC"
          />
        );
      return (
        <LiveCfdiDetailScreen
          clientId={clientId!}
          legalEntityId={route.legalEntityId}
          cfdiId={route.cfdiId!}
        />
      );
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
