import type { Capability } from "./accounting-types";
import { hasCapability } from "./permissions";

export type ProductScreen =
  | "organization-home"
  | "clients"
  | "processes"
  | "team"
  | "audit"
  | "organization-settings"
  | "client-overview"
  | "fiscal-years"
  | "fiscal-year"
  | "period"
  | "client-cfdi"
  | "cfdi-detail"
  | "obligations"
  | "diot-list"
  | "diot-period"
  | "ieps-list"
  | "ieps-instance"
  | "generated-files"
  | "client-alerts"
  | "client-settings";

export interface ResolvedProductRoute {
  screen: ProductScreen;
  organizationId: string;
  clientId?: string;
  legalEntityId?: string;
  year?: string;
  period?: string;
  tab?: string;
  uuid?: string;
  instanceId?: string;
  section?: string;
  capability?: Capability;
}

export function canOpenResolvedProductRoute(
  route: Pick<ResolvedProductRoute, "capability">,
  capabilities: readonly string[],
) {
  return hasCapability(capabilities, route.capability);
}

export function isLivePeriodTabSupported(tab?: string) {
  return !tab || tab === "overview";
}

const periodTabs = [
  "overview",
  "cfdi",
  "payments",
  "payroll",
  "issues",
  "close",
  "exports",
];
export function resolveProductRoute(
  organizationId: string,
  segments: string[] = [],
): ResolvedProductRoute | null {
  const [
    first = "home",
    second,
    third,
    fourth,
    fifth,
    sixth,
    seventh,
    eighth,
    ninth,
  ] = segments;
  if (first === "home" && !second)
    return {
      screen: "organization-home",
      organizationId,
      capability: "organization.view",
    };
  if (first === "clients" && !second)
    return { screen: "clients", organizationId, capability: "clients.view" };
  if (first === "processes" && !second)
    return {
      screen: "processes",
      organizationId,
      capability: "organization.view",
    };
  if (first === "team" && !second)
    return { screen: "team", organizationId, capability: "team.view" };
  if (first === "settings") {
    const capability =
      second === "billing-plan" ? "billing.manage" : "organization.view";
    return {
      screen: "organization-settings",
      organizationId,
      section: second ?? "overview",
      capability,
    };
  }
  if (first !== "clients" || !second) return null;

  const base = { organizationId, clientId: second };
  if (!third || third === "overview")
    return { screen: "client-overview", ...base, capability: "clients.view" };
  if (
    third === "legal-entities" &&
    fourth &&
    fifth === "fiscal-years" &&
    !sixth
  ) {
    return {
      screen: "fiscal-years",
      ...base,
      legalEntityId: fourth,
      capability: "fiscal_years.view",
    };
  }
  if (
    third === "legal-entities" &&
    fourth &&
    fifth === "fiscal-years" &&
    sixth &&
    !seventh
  ) {
    return {
      screen: "fiscal-year",
      ...base,
      legalEntityId: fourth,
      year: sixth,
      capability: "fiscal_years.view",
    };
  }
  if (
    third === "legal-entities" &&
    fourth &&
    fifth === "fiscal-years" &&
    sixth &&
    seventh === "periods" &&
    eighth
  ) {
    const tab = ninth ?? "overview";
    if (!periodTabs.includes(tab)) return null;
    return {
      screen: "period",
      ...base,
      legalEntityId: fourth,
      year: sixth,
      period: eighth,
      tab,
      capability: tab === "payroll" ? "payroll.view" : "fiscal_years.view",
    };
  }
  if (third === "fiscal-years" && !fourth)
    return { screen: "fiscal-years", ...base, capability: "fiscal_years.view" };
  if (third === "fiscal-years" && fourth && !fifth)
    return {
      screen: "fiscal-year",
      ...base,
      year: fourth,
      capability: "fiscal_years.view",
    };
  if (third === "fiscal-years" && fourth && fifth === "periods" && sixth) {
    const tab = seventh ?? "overview";
    if (!periodTabs.includes(tab)) return null;
    return {
      screen: "period",
      ...base,
      year: fourth,
      period: sixth,
      tab,
      capability: tab === "payroll" ? "payroll.view" : "fiscal_years.view",
    };
  }
  if (third === "cfdi" && !fourth)
    return { screen: "client-cfdi", ...base, capability: "clients.view" };
  if (third === "cfdi" && fourth)
    return {
      screen: "cfdi-detail",
      ...base,
      uuid: fourth,
      capability: "clients.view",
    };
  if (third === "alerts" && !fourth)
    return { screen: "client-alerts", ...base, capability: "clients.view" };
  if (third === "settings" && fourth) {
    const capabilities: Record<string, Capability> = {
      data: "clients.manage",
      responsibles: "clients.assign",
      "e-signature-sat": "credentials.manage",
      access: "clients.assign",
    };
    if (!capabilities[fourth]) return null;
    return {
      screen: "client-settings",
      ...base,
      section: fourth,
      capability: capabilities[fourth],
    };
  }
  return null;
}
