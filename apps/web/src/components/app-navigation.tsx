"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { appNavigation, clientNavGroups, navHref, organizationNavGroups } from "@/lib/nav";
import { filterNavigation, isNavigationItemActive } from "@/lib/navigation-core";
import { cn } from "@/lib/utils";

export function AppNavigation({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  const { capabilities, client, context, organization } = useAccountingContext();
  const groups = context === "client" ? clientNavGroups : organizationNavGroups;
  const items = filterNavigation(
    appNavigation.map((item) => ({
      ...item,
      href: navHref(item, locale, organization.id, client?.id),
    })),
    context,
    capabilities
  );

  return (
    <nav aria-label="Navegación principal" className="space-y-5">
      {groups.map((group) => {
        const groupedItems = items.filter((item) => item.group === group);
        if (groupedItems.length === 0) return null;
        return (
          <div key={group}>
            {!collapsed ? (
              <p className="mb-2 px-3 text-caption font-semibold text-sidebar-foreground/55">{group}</p>
            ) : (
              <div aria-hidden="true" className="mx-3 mb-2 border-t border-sidebar-border" />
            )}
            <div className="space-y-1">
              {groupedItems.map(({ href, id, icon: Icon, label }) => {
                const active = isNavigationItemActive(pathname, href);
                const link = (
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-10 items-center gap-3 rounded-md text-body-sm font-semibold text-sidebar-foreground transition-colors duration-150 ease-standard",
                      collapsed ? "justify-center px-0" : "px-3",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:bg-sidebar-ring"
                        : "text-sidebar-foreground/76 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
                    <span className={cn(collapsed && "sr-only")}>{label}</span>
                  </Link>
                );
                return collapsed ? (
                  <Tooltip key={id}>
                    <TooltipTrigger delay={500} render={link} />
                    <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={id}>{link}</div>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
