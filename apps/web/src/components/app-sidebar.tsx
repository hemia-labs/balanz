"use client";

import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AppNavigation } from "@/components/app-navigation";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Dictionary, Locale } from "@/lib/i18n";

export function AppSidebar({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-standard md:flex",
        collapsed ? "w-sidebar-collapsed" : "w-sidebar"
      )}
    >
      <div
        className={cn(
          "flex h-topbar items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-2" : "justify-between px-4"
        )}
      >
        <BrandMark locale={locale} inverse compact={collapsed} />
        {!collapsed ? (
          <Button
            type="button"
            variant="sidebar"
            size="icon"
            onClick={() => setCollapsed(true)}
            aria-label={dictionary.sidebar.collapse}
            aria-expanded="true"
          >
            <PanelLeftClose className="size-5" />
          </Button>
        ) : null}
      </div>
      {collapsed ? (
        <div className="flex justify-center px-2 pt-3">
          <Button
            type="button"
            variant="sidebar"
            size="icon"
            onClick={() => setCollapsed(false)}
            aria-label={dictionary.sidebar.expand}
            aria-expanded="false"
          >
            <PanelLeftOpen className="size-5" />
          </Button>
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <AppNavigation locale={locale} dictionary={dictionary} collapsed={collapsed} />
      </div>
      <div className={cn("border-t border-sidebar-border p-3", collapsed && "text-center")}>
        <p className={cn("text-caption text-sidebar-foreground/65", collapsed && "sr-only")}>
          {dictionary.sidebar.productLabel}
        </p>
        {collapsed ? <span aria-hidden="true" className="mx-auto block size-2 rounded-full bg-brand-mark" /> : null}
      </div>
    </aside>
  );
}
