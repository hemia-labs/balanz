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

export function isClientNavigationItemActive(
  itemId: string,
  pathname: string,
  href: string,
) {
  if (isNavigationItemActive(pathname, href)) return true;
  if (
    !["fiscal-years", "cfdi"].includes(itemId) ||
    (!href.endsWith("/fiscal-years") && !href.endsWith("/cfdi"))
  ) {
    return false;
  }

  const suffix = itemId === "cfdi" ? "/cfdi" : "/fiscal-years";
  const clientHref = href.slice(0, -suffix.length);
  const fiscalEntityPrefix = `${clientHref}/legal-entities/`;
  if (!pathname.startsWith(fiscalEntityPrefix)) return false;

  const entityRoute = pathname.slice(fiscalEntityPrefix.length);
  return itemId === "cfdi"
    ? /^[^/]+\/cfdi(?:\/|$)/.test(entityRoute)
    : /^[^/]+\/fiscal-years(?:\/|$)/.test(entityRoute);
}
