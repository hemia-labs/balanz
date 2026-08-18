import type { ResolvedProductRoute } from "@/lib/product-route";
import { AuditScreen, ClientsScreen, OrganizationHomeScreen, OrganizationSettingsScreen, ProcessesScreen, TeamScreen } from "@/components/screens/global-screens";
import { CfdiDetailScreen, ClientAlertsScreen, ClientCfdiScreen, ClientOverviewScreen, ClientSettingsScreen, FiscalYearsScreen, FiscalYearScreen } from "@/components/screens/client-screens";
import { PeriodScreen } from "@/components/screens/period-screens";
import { DiotListScreen, DiotPeriodScreen, GeneratedFilesScreen, IepsInstanceScreen, IepsListScreen, ObligationsScreen } from "@/components/screens/obligation-screens";

export function AccountingScreen({ route }: { route: ResolvedProductRoute }) {
  const { organizationId, clientId } = route;
  switch (route.screen) {
    case "organization-home": return <OrganizationHomeScreen organizationId={organizationId} />;
    case "clients": return <ClientsScreen organizationId={organizationId} />;
    case "processes": return <ProcessesScreen organizationId={organizationId} />;
    case "team": return <TeamScreen organizationId={organizationId} />;
    case "audit": return <AuditScreen />;
    case "organization-settings": return <OrganizationSettingsScreen organizationId={organizationId} section={route.section} />;
    case "client-overview": return <ClientOverviewScreen organizationId={organizationId} clientId={clientId!} />;
    case "fiscal-years": return <FiscalYearsScreen organizationId={organizationId} clientId={clientId!} />;
    case "fiscal-year": return <FiscalYearScreen organizationId={organizationId} clientId={clientId!} year={route.year!} />;
    case "period": return <PeriodScreen organizationId={organizationId} clientId={clientId!} year={route.year!} period={route.period!} tab={route.tab!} />;
    case "client-cfdi": return <ClientCfdiScreen organizationId={organizationId} clientId={clientId!} />;
    case "cfdi-detail": return <CfdiDetailScreen organizationId={organizationId} clientId={clientId!} uuid={route.uuid!} />;
    case "obligations": return <ObligationsScreen organizationId={organizationId} clientId={clientId!} />;
    case "diot-list": return <DiotListScreen organizationId={organizationId} clientId={clientId!} />;
    case "diot-period": return <DiotPeriodScreen organizationId={organizationId} clientId={clientId!} year={route.year!} period={route.period!} tab={route.tab!} />;
    case "ieps-list": return <IepsListScreen organizationId={organizationId} clientId={clientId!} />;
    case "ieps-instance": return <IepsInstanceScreen organizationId={organizationId} clientId={clientId!} instanceId={route.instanceId!} tab={route.tab!} />;
    case "generated-files": return <GeneratedFilesScreen organizationId={organizationId} clientId={clientId!} />;
    case "client-alerts": return <ClientAlertsScreen organizationId={organizationId} clientId={clientId!} />;
    case "client-settings": return <ClientSettingsScreen organizationId={organizationId} clientId={clientId!} section={route.section} />;
  }
}
