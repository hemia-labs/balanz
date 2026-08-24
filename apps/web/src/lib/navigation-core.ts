import type { Capability } from "./accounting-types";

export type NavigationContext = "organization" | "client";
export interface NavigationRule {
  id: string;
  context: NavigationContext;
  href: string;
  capability?: Capability;
}

export function filterNavigation<T extends NavigationRule>(
  items: readonly T[],
  context: NavigationContext,
  capabilities: readonly Capability[]
) {
  return items.filter(
    (item) => item.context === context && (!item.capability || capabilities.includes(item.capability))
  );
}

export function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export const legacyDestinations: Record<string, string> = {
  documents: "clients",
  queries: "clients",
  income: "clients",
  payroll: "clients",
  reports: "processes",
  certificates: "clients",
  users: "team",
  collaboration: "home",
  plans: "settings/billing-plan",
};

export function resolveLegacyDestination(section: string) {
  return legacyDestinations[section];
}
