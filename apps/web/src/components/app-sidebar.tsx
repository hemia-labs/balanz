"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { AppNavigation } from "@/components/app-navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { ClientSwitcher } from "@/components/client-switcher";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { ContextSearch } from "@/components/context-search";
import { cn } from "@/lib/utils";

export function AppSidebar({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const pathname = usePathname();
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  const { client, clientName, context, isDemo, organization } =
    useAccountingContext();
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-standard md:flex",
        collapsed ? "w-sidebar-collapsed" : "w-sidebar",
      )}
    >
      <div
        className={cn(
          "flex h-topbar shrink-0 items-center",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <WorkspaceSwitcher compact={collapsed} />
      </div>
      <div className="shrink-0 px-4 py-2">
        <ContextSearch key={organization.id} compact={collapsed} onExpand={onExpand} />
      </div>
      {context === "client" ? (
        <div className="border-b border-sidebar-border px-3 py-3">
          {!collapsed ? (
            <Link
              href={`/${locale}/organizations/${organization.slug}/home`}
              className="mb-2 flex min-h-10 items-center gap-2 rounded-md px-3 text-body-sm font-semibold text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> Volver al
              despacho
            </Link>
          ) : null}
          <ClientSwitcher compact={collapsed} />
          {!client && !clientName && !collapsed ? (
            <p className="px-3 py-2 text-caption font-semibold text-sidebar-foreground/65">
              Cargando cliente…
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <AppNavigation collapsed={collapsed} />
      </div>
      <div
        className={cn(
          "border-t border-sidebar-border p-3",
          collapsed && "text-center",
        )}
      >
        <p
          className={cn(
            "text-caption text-sidebar-foreground/65",
            collapsed && "sr-only",
          )}
        >
          {isDemo ? "Datos demostrativos · Hemia" : "Sesión segura · Hemia"}
        </p>
        {collapsed ? (
          <span
            aria-hidden="true"
            className="mx-auto block size-2 rounded-full bg-brand-mark"
          />
        ) : null}
      </div>
    </aside>
  );
}
