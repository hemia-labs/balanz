"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/features/session/session-provider";
import type { OrganizationSummary } from "@/features/session/types";
import {
  capabilities,
  type Capability,
  type DemoAccount,
  type DemoClient,
  type DemoMembership,
  type DemoOrganization,
} from "@/lib/accounting-types";
import {
  clientById,
  clientsFor,
  membershipFor,
  organizationById,
  organizationBySlug,
} from "@/lib/demo-data";
import { resolveOrganizationRoute } from "@/lib/navigation-core";
import { hasCapability } from "@/lib/permissions";

interface AccountingContextValue {
  locale: string;
  account: DemoAccount;
  organization: DemoOrganization;
  membership: DemoMembership;
  clients: DemoClient[];
  client?: DemoClient;
  clientId?: string;
  clientName?: string;
  capabilities: Capability[];
  context: "organization" | "client";
  isDemo: boolean;
  organizations: OrganizationSummary[];
  changeOrganization: (organizationId: string) => Promise<void>;
  registerClientName: (clientId: string, name: string) => void;
}

const AccountingContext = createContext<AccountingContextValue | null>(null);
const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

function routeIdentifier(pathname: string, segment: string) {
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.indexOf(segment);
  return index >= 0 ? parts[index + 1] : undefined;
}

function mapRole(role: string | null | undefined): DemoMembership["role"] {
  if (role === "owner" || role === "titular") return "titular";
  if (role === "accountant" || role === "responsable") return "responsable";
  return "colaborador";
}

export function AccountingContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, authorization, organizations, switchTenant } = useSession();
  const [liveClientIdentity, setLiveClientIdentity] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const registerClientName = useCallback((clientId: string, name: string) => {
    setLiveClientIdentity((current) =>
      current?.id === clientId && current.name === name
        ? current
        : { id: clientId, name },
    );
  }, []);
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  const organizationSlug =
    routeIdentifier(pathname, "organizations") ??
    searchParams.get("organizacion") ??
    "";
  const routeOrganization =
    resolveOrganizationRoute(organizations, organizationSlug) ??
    (demoMode ? organizationBySlug(organizationSlug) : undefined);
  const activeOrganization =
    resolveOrganizationRoute(organizations, session?.organizationId ?? "") ??
    (demoMode && session?.organizationId
      ? organizationById(session.organizationId)
      : undefined);
  const tenantMismatch = Boolean(
    organizationSlug &&
    (!activeOrganization ||
      !routeOrganization ||
      routeOrganization.id !== activeOrganization.id),
  );

  useEffect(() => {
    if (!tenantMismatch) return;
    const destination = activeOrganization
      ? `/${locale}/organizations/${encodeURIComponent(activeOrganization.slug)}/home`
      : `/${locale}/select-organization`;
    router.replace(destination);
  }, [activeOrganization, locale, router, tenantMismatch]);

  const value = useMemo(() => {
    const organizationId =
      session?.organizationId ?? routeOrganization?.id ?? organizationSlug;
    const apiOrganization = organizations.find(
      (item) => item.id === organizationId,
    );
    const demoOrganization = demoMode
      ? (organizationById(organizationId) ??
        organizationBySlug(organizationSlug))
      : undefined;
    const isDemo = Boolean(demoOrganization && !apiOrganization);
    const organization: DemoOrganization = apiOrganization
      ? {
          id: apiOrganization.id,
          slug: apiOrganization.slug,
          name: apiOrganization.name,
          shortName: apiOrganization.name,
        }
      : demoOrganization
        ? { ...demoOrganization }
        : {
            id: organizationId,
            slug: organizationSlug || organizationId,
            name: "Organización activa",
            shortName: "Organización activa",
          };
    const allowed =
      authorization?.permissions ??
      (isDemo ? (membershipFor(organization.id)?.capabilities ?? []) : []);
    const resolvedCapabilities = capabilities.filter((item) =>
      hasCapability(allowed, item),
    ) as Capability[];
    const membership: DemoMembership = {
      organizationId: organization.id,
      role: mapRole(
        authorization?.role ??
          session?.role ??
          (isDemo ? membershipFor(organization.id)?.role : undefined),
      ),
      capabilities: resolvedCapabilities,
      assignedClientIds:
        isDemo
          ? (membershipFor(organization.id)?.assignedClientIds ?? [])
          : [],
    };
    const clientId = routeIdentifier(pathname, "clients");
    const client =
      isDemo && clientId ? clientById(organization.id, clientId) : undefined;
    const clientName =
      client?.name ??
      (liveClientIdentity && liveClientIdentity.id === clientId
        ? liveClientIdentity.name
        : undefined);
    return {
      locale,
      account: { id: session?.userId ?? "", name: "Cuenta global", email: "" },
      organization,
      membership,
      clients: isDemo ? clientsFor(organization.id) : [],
      client,
      clientId,
      clientName,
      capabilities: resolvedCapabilities,
      context: clientId ? ("client" as const) : ("organization" as const),
      isDemo,
      organizations,
      changeOrganization: switchTenant,
      registerClientName,
    };
  }, [
    authorization,
    locale,
    liveClientIdentity,
    organizationSlug,
    organizations,
    pathname,
    routeOrganization,
    registerClientName,
    session,
    switchTenant,
  ]);

  if (tenantMismatch) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-sm text-slate-600">
        Validando organización…
      </div>
    );
  }

  return (
    <AccountingContext.Provider value={value}>
      {children}
    </AccountingContext.Provider>
  );
}

export function useAccountingContext() {
  const value = useContext(AccountingContext);
  if (!value)
    throw new Error(
      "useAccountingContext debe usarse dentro de AccountingContextProvider",
    );
  return value;
}
