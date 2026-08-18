"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { nav, navGroups } from "@/lib/nav";
import type { Dictionary, Locale } from "@/lib/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function AppNavigation({
  locale,
  dictionary,
  collapsed = false,
  onNavigate,
}: {
  locale: Locale;
  dictionary: Dictionary;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={dictionary.sidebar.mainNavigation} className="space-y-5">
      {navGroups.map((group) => {
        const items = nav.filter((item) => item.group === group.key);

        return (
          <div key={group.key}>
            {!collapsed ? (
              <p className="mb-2 px-3 text-caption font-semibold text-sidebar-foreground/55">
                {dictionary.navGroups[group.key]}
              </p>
            ) : (
              <div aria-hidden="true" className="mx-3 mb-2 border-t border-sidebar-border" />
            )}
            <div className="space-y-1">
              {items.map(({ href, labelKey, icon: Icon }) => {
                const label = dictionary.nav[labelKey];
                const localizedHref = "/" + locale + (href === "/" ? "" : href);
                const active =
                  href === "/"
                    ? pathname === "/" + locale || pathname === "/" + locale + "/"
                    : pathname.startsWith(localizedHref);
                const link = (
                  <Link
                    href={localizedHref}
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
                  <Tooltip key={href}>
                    <TooltipTrigger delay={500} render={link} />
                    <TooltipContent side="right" sideOffset={8}>
                      {label}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Fragment key={href}>{link}</Fragment>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

