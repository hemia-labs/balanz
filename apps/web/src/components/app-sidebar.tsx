"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { nav } from "@/lib/nav";
import type { Dictionary, Locale } from "@/lib/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function AppSidebar({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out md:flex",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex h-16 items-center gap-2 px-3">
        {!collapsed && (
          <a
            href="https://github.com/hemia-labs/balanz"
            target="_blank"
            rel="noreferrer"
            className="flex-1 truncate px-1 text-sm font-semibold"
          >
            balanz
          </a>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? dictionary.sidebar.expand : dictionary.sidebar.collapse}
          aria-expanded={!collapsed}
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? <PanelRight className="size-5" /> : <PanelLeft className="size-5" />}
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {nav.map(({ href, labelKey, icon: Icon }) => {
          const label = dictionary.nav[labelKey];
          const localizedHref = `/${locale}${href === "/" ? "" : href}`;
          const active = href === "/"
            ? pathname === `/${locale}` || pathname === `/${locale}/`
            : pathname.startsWith(localizedHref);
          const link = (
            <Link
              href={localizedHref}
              className={cn(
                "flex min-h-9 items-center gap-3 rounded-md text-sm font-medium transition-colors",
                collapsed ? "justify-center px-0" : "px-3",
                active
                  ? "bg-sidebar-border text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="size-5 shrink-0" />
              <span className={cn(collapsed && "sr-only")}>{label}</span>
            </Link>
          );

          return collapsed ? (
            <Tooltip key={href}>
              <TooltipTrigger delay={700} render={link} />
              <TooltipContent side="right" sideOffset={8}>
                {label}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Fragment key={href}>{link}</Fragment>
          );
        })}
      </nav>
      <div className="m-3 flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent p-3 text-xs">
        <span className="size-2 shrink-0 rounded-full bg-sidebar-primary" />
        {!collapsed && <span className="truncate text-sidebar-foreground/70">{dictionary.sidebar.system}</span>}
      </div>
    </aside>
  );
}
