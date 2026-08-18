"use client";

import { useEffect, useRef } from "react";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { AppNavigation } from "@/components/app-navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { BrandMark } from "@/components/brand-mark";
import { ClientSwitcher } from "@/components/client-switcher";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

export function MobileNavigation() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const { client } = useAccountingContext();

  useEffect(() => {
    if (dialogRef.current?.open) dialogRef.current.close();
  }, [pathname]);

  return (
    <div className="md:hidden">
      <Button type="button" variant="ghost" size="icon" onClick={() => dialogRef.current?.showModal()} aria-label="Abrir navegación">
        <Menu className="size-5" />
      </Button>
      <dialog ref={dialogRef} aria-label="Navegación principal" className="m-0 h-dvh w-[calc(100%-2rem)] max-h-none max-w-sm border-0 border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-overlay">
        <div className="flex min-h-full flex-col">
          <div className="flex h-topbar items-center justify-between border-b border-sidebar-border px-4">
            <BrandMark locale="es" inverse />
            <Button type="button" variant="sidebar" size="icon" onClick={() => dialogRef.current?.close()} aria-label="Cerrar navegación"><X className="size-5" /></Button>
          </div>
          <div className="border-b border-sidebar-border px-3 py-3">
            {client ? <ClientSwitcher /> : <WorkspaceSwitcher />}
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-5">
            <AppNavigation onNavigate={() => dialogRef.current?.close()} />
          </div>
          <p className="border-t border-sidebar-border px-5 py-4 text-caption text-sidebar-foreground/65">Datos demostrativos · Hemia</p>
        </div>
      </dialog>
    </div>
  );
}
