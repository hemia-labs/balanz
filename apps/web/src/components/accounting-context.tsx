"use client";

import { createContext, useContext, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "@/features/session/session-provider";
import type { OrganizationSummary } from "@/features/session/types";
import { capabilities, type Capability, type DemoAccount, type DemoClient, type DemoMembership, type DemoOrganization } from "@/lib/accounting-types";
import { clientById, clientsFor, membershipFor, organizationById } from "@/lib/demo-data";

interface AccountingContextValue {
  locale: string;
  account: DemoAccount;
  organization: DemoOrganization;
  membership: DemoMembership;
  clients: DemoClient[];
  client?: DemoClient;
  capabilities: Capability[];
  context: "organization" | "client";
  isDemo: boolean;
  organizations: OrganizationSummary[];
  changeOrganization: (organizationId: string) => Promise<void>;
}

const AccountingContext = createContext<AccountingContextValue | null>(null);
const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

function routeIdentifier(pathname: string, segment: string) {
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.indexOf(segment);
  return index >= 0 ? parts[index + 1] : undefined;
}

function mapRole(role: string | null | undefined): DemoMembership["role"] {
  if (role === "titular" || role === "administrador" || role === "responsable") return role;
  return "colaborador";
}

export function AccountingContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { session, authorization, organizations, switchTenant } = useSession();

  const value = useMemo(() => {
    const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
    const organizationId = session?.organizationId ?? routeIdentifier(pathname, "despachos") ?? searchParams.get("organizacion") ?? "";
    const apiOrganization = organizations.find((item) => item.id === organizationId);
    const demoOrganization = demoMode ? organizationById(organizationId) : undefined;
    const isDemo = Boolean(demoOrganization && !apiOrganization);
    const organization: DemoOrganization = apiOrganization
      ? { id: apiOrganization.id, name: apiOrganization.name, shortName: apiOrganization.name }
      : demoOrganization
        ? { ...demoOrganization }
        : { id: organizationId, name: "Organización activa", shortName: "Organización activa" };
    const allowed = authorization?.permissions ?? (isDemo ? membershipFor(organization.id)?.capabilities ?? [] : []);
    const resolvedCapabilities = capabilities.filter((item) => allowed.includes(item)) as Capability[];
    const membership: DemoMembership = {
      organizationId: organization.id,
      role: mapRole(authorization?.role ?? session?.role ?? (isDemo ? membershipFor(organization.id)?.role : undefined)),
      capabilities: resolvedCapabilities,
      assignedClientIds: authorization?.assignedAccountIds ?? (isDemo ? membershipFor(organization.id)?.assignedClientIds ?? [] : []),
    };
    const clientId = routeIdentifier(pathname, "clientes");
    const client = isDemo && clientId ? clientById(organization.id, clientId) : undefined;
    return {
      locale,
      account: { id: session?.userId ?? "", name: "Cuenta global", email: "" },
      organization,
      membership,
      clients: isDemo ? clientsFor(organization.id) : [],
      client,
      capabilities: resolvedCapabilities,
      context: client ? ("client" as const) : ("organization" as const),
      isDemo,
      organizations,
      changeOrganization: switchTenant,
    };
  }, [authorization, organizations, pathname, searchParams, session, switchTenant]);

  return <AccountingContext.Provider value={value}>{children}</AccountingContext.Provider>;
}

export function useAccountingContext() {
  const value = useContext(AccountingContext);
  if (!value) throw new Error("useAccountingContext debe usarse dentro de AccountingContextProvider");
  return value;
}
