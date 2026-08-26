import type { Capability } from "./accounting-types";

export type NavigationContext = "organization" | "client";
export interface NavigationRule {
  id: string;
  context: NavigationContext;
  href: string;
  capability?: Capability;
}

export interface OrganizationRouteIdentity {
  id: string;
  slug: string;
}

export function resolveOrganizationRoute<T extends OrganizationRouteIdentity>(
  organizations: readonly T[],
  routeValue: string
) {
  return organizations.find((organization) => organization.id === routeValue || organization.slug === routeValue);
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
