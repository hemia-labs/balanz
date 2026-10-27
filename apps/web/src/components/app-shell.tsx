"use client";

import { useState, type ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen w-full flex-1">
      <AppSidebar collapsed={collapsed} onExpand={() => setCollapsed(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed((current) => !current)}
        />
        {children}
      </div>
    </div>
  );
}
