"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Capability, DemoAccount, DemoClient, DemoMembership, DemoOrganization } from "@/lib/accounting-types";
import { clientById, clientsFor, demoData, demoOrganizationId, membershipFor, organizationById } from "@/lib/demo-data";

interface AccountingContextValue {
  locale: "es";
  account: DemoAccount;
  organization: DemoOrganization;
  membership: DemoMembership;
  clients: DemoClient[];
  client?: DemoClient;
  capabilities: Capability[];
  context: "organization" | "client";
  isDemo: true;
}

const AccountingContext = createContext<AccountingContextValue | null>(null);

function routeIdentifier(pathname: string, segment: string) {
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.indexOf(segment);
  return index >= 0 ? parts[index + 1] : undefined;
}

export function AccountingContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = useMemo(() => {
    const organizationId = routeIdentifier(pathname, "despachos") ?? searchParams.get("organizacion") ?? demoOrganizationId;
    const organization = organizationById(organizationId) ?? demoData.organizations[0];
    const membership = membershipFor(organization.id) ?? demoData.memberships[0];
    const clientId = routeIdentifier(pathname, "clientes");
    const client = clientId ? clientById(organization.id, clientId) : undefined;
    return {
      locale: "es" as const,
      account: demoData.account,
      organization,
      membership,
      clients: clientsFor(organization.id),
      client,
      capabilities: membership.capabilities,
      context: client ? ("client" as const) : ("organization" as const),
      isDemo: true as const,
    };
  }, [pathname, searchParams]);

  useEffect(() => {
    localStorage.setItem("last-demo-organization", value.organization.id);
  }, [value.organization.id]);

  return <AccountingContext.Provider value={value}>{children}</AccountingContext.Provider>;
}

export function useAccountingContext() {
  const value = useContext(AccountingContext);
  if (!value) throw new Error("useAccountingContext debe usarse dentro de AccountingContextProvider");
  return value;
}
