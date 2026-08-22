"use client";

import Link from "next/link";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AppNavigation } from "@/components/app-navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { BrandMark } from "@/components/brand-mark";
import { ClientSwitcher } from "@/components/client-switcher";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  const { client, context, organization } = useAccountingContext();
  return (
    <aside className={cn(
      "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-standard md:flex",
      collapsed ? "w-sidebar-collapsed" : "w-sidebar"
    )}>
      <div className={cn("flex h-topbar items-center border-b border-sidebar-border", collapsed ? "justify-center px-2" : "justify-between px-4")}>
        <BrandMark locale="es" inverse compact={collapsed} />
        {!collapsed ? (
          <Button type="button" variant="sidebar" size="icon" onClick={() => setCollapsed(true)} aria-label="Colapsar navegación" aria-expanded="true">
            <PanelLeftClose className="size-5" />
          </Button>
        ) : null}
      </div>
      {collapsed ? (
        <div className="flex justify-center px-2 pt-3">
          <Button type="button" variant="sidebar" size="icon" onClick={() => setCollapsed(false)} aria-label="Expandir navegación" aria-expanded="false">
            <PanelLeftOpen className="size-5" />
          </Button>
        </div>
      ) : null}
      <div className="border-b border-sidebar-border px-3 py-3">
        {context === "client" && client ? (
          <>
            {!collapsed ? (
                <Link href={`/${locale}/despachos/${organization.id}/inicio`} className="mb-2 flex min-h-10 items-center gap-2 rounded-md px-3 text-body-sm font-semibold text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground">
                <ArrowLeft className="size-4" aria-hidden="true" /> Volver al despacho
              </Link>
            ) : null}
            <ClientSwitcher compact={collapsed} />
          </>
        ) : <WorkspaceSwitcher compact={collapsed} />}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <AppNavigation collapsed={collapsed} />
      </div>
      <div className={cn("border-t border-sidebar-border p-3", collapsed && "text-center")}>
        <p className={cn("text-caption text-sidebar-foreground/65", collapsed && "sr-only")}>Datos demostrativos · Hemia</p>
        {collapsed ? <span aria-hidden="true" className="mx-auto block size-2 rounded-full bg-brand-mark" /> : null}
      </div>
    </aside>
  );
}
