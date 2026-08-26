"use client";

import { useAccountingContext } from "@/components/accounting-context";
import {
  LiveClientDetailScreen,
  LiveClientsScreen,
  LiveForbiddenScreen,
  LiveFiscalYearsScreen,
  LiveFiscalYearScreen,
  LiveUnavailableScreen,
} from "@/features/clients/live-screens";
import {
  canOpenResolvedProductRoute,
  isLivePeriodTabSupported,
  type ResolvedProductRoute,
} from "@/lib/product-route";
import {
  AuditScreen,
  ClientsScreen,
  OrganizationHomeScreen,
  OrganizationSettingsScreen,
  ProcessesScreen,
  TeamScreen,
} from "@/components/screens/global-screens";
import {
  CfdiDetailScreen,
  ClientAlertsScreen,
  ClientCfdiScreen,
  ClientOverviewScreen,
  ClientSettingsScreen,
  FiscalYearsScreen,
  FiscalYearScreen,
} from "@/components/screens/client-screens";
import { PeriodScreen } from "@/components/screens/period-screens";
import {
  DiotListScreen,
  DiotPeriodScreen,
  GeneratedFilesScreen,
  IepsInstanceScreen,
  IepsListScreen,
  ObligationsScreen,
} from "@/components/screens/obligation-screens";

export function AccountingScreen({ route }: { route: ResolvedProductRoute }) {
  const { capabilities, isDemo, locale, organization } = useAccountingContext();
  const { organizationId, clientId } = route;
  if (!canOpenResolvedProductRoute(route, capabilities)) {
    return <LiveForbiddenScreen capability={route.capability!} />;
  }
  if (!isDemo) {
    switch (route.screen) {
      case "clients":
        return <LiveClientsScreen />;
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
  switch (route.screen) {
    case "organization-home":
      return <OrganizationHomeScreen organizationId={organizationId} />;
    case "clients":
      return <ClientsScreen organizationId={organizationId} />;
    case "processes":
      return <ProcessesScreen organizationId={organizationId} />;
    case "team":
      return <TeamScreen organizationId={organizationId} />;
    case "audit":
      return <AuditScreen />;
    case "organization-settings":
      return (
        <OrganizationSettingsScreen
          organizationId={organizationId}
          section={route.section}
        />
      );
    case "client-overview":
      return (
        <ClientOverviewScreen
          organizationId={organizationId}
          clientId={clientId!}
        />
      );
    case "fiscal-years":
      return (
        <FiscalYearsScreen
          organizationId={organizationId}
          clientId={clientId!}
        />
      );
    case "fiscal-year":
      return (
        <FiscalYearScreen
          organizationId={organizationId}
          clientId={clientId!}
          year={route.year!}
        />
      );
    case "period":
      return (
        <PeriodScreen
          organizationId={organizationId}
          clientId={clientId!}
          year={route.year!}
          period={route.period!}
          tab={route.tab!}
        />
      );
    case "client-cfdi":
      return (
        <ClientCfdiScreen
          organizationId={organizationId}
          clientId={clientId!}
        />
      );
    case "cfdi-detail":
      return (
        <CfdiDetailScreen
          organizationId={organizationId}
          clientId={clientId!}
          uuid={route.uuid!}
        />
      );
    case "obligations":
      return (
        <ObligationsScreen
          organizationId={organizationId}
          clientId={clientId!}
        />
      );
    case "diot-list":
      return (
        <DiotListScreen organizationId={organizationId} clientId={clientId!} />
      );
    case "diot-period":
      return (
        <DiotPeriodScreen
          organizationId={organizationId}
          clientId={clientId!}
          year={route.year!}
          period={route.period!}
          tab={route.tab!}
        />
      );
    case "ieps-list":
      return (
        <IepsListScreen organizationId={organizationId} clientId={clientId!} />
      );
    case "ieps-instance":
      return (
        <IepsInstanceScreen
          organizationId={organizationId}
          clientId={clientId!}
          instanceId={route.instanceId!}
          tab={route.tab!}
        />
      );
    case "generated-files":
      return (
        <GeneratedFilesScreen
          organizationId={organizationId}
          clientId={clientId!}
        />
      );
    case "client-alerts":
      return (
        <ClientAlertsScreen
          organizationId={organizationId}
          clientId={clientId!}
        />
      );
    case "client-settings":
      return (
        <ClientSettingsScreen
          organizationId={organizationId}
          clientId={clientId!}
          section={route.section}
        />
      );
  }
}
