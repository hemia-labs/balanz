"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleUserRound, HelpCircle, LogOut, Moon, Settings2, ShieldCheck, Sun, UserRound, Workflow } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { ContextSearch } from "@/components/context-search";
import { ContextBreadcrumbs } from "@/components/context-breadcrumbs";
import { MobileNavigation } from "@/components/mobile-navigation";
import { NotificationsDrawer } from "@/components/notifications-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabels } from "@/lib/permissions";

type ThemePreference = "system" | "light" | "dark";
const useThemeEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem("theme-preference");
  return stored === "light" || stored === "dark" ? stored : "system";
}

function ConfirmLogout() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  return (
    <>
      <DropdownMenuItem variant="destructive" onClick={() => dialogRef.current?.showModal()}>
        <LogOut className="size-4" /> Cerrar sesión
      </DropdownMenuItem>
      <dialog ref={dialogRef} aria-labelledby="logout-title" className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-card p-0 text-card-foreground shadow-overlay">
        <div className="p-5"><h2 id="logout-title" className="text-heading-sm font-emphasis">Cerrar sesión</h2><p className="mt-2 text-body text-muted-foreground">La demostración volverá a la pantalla de acceso. No existe una sesión de backend que cerrar.</p></div>
        <div className="flex justify-end gap-2 border-t border-border p-4"><Button variant="outline" onClick={() => dialogRef.current?.close()}>Cancelar</Button><Button variant="destructive" onClick={() => { dialogRef.current?.close(); router.push("/es/login"); }}>Cerrar demostración</Button></div>
      </dialog>
    </>
  );
}

export function AppTopbar() {
  const router = useRouter();
  const context = useAccountingContext();
  const { account, client, organization, membership } = context;
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);

  useThemeEffect(() => {
    const resolved = theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = resolved;
    if (theme === "system") {
      localStorage.removeItem("theme-preference");
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme-preference", theme);
      localStorage.setItem("theme", theme);
    }
  }, [theme]);

  const processesHref = `/es/despachos/${organization.id}/procesos`;
  return (
    <header className="sticky top-0 z-10 flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:px-4 lg:px-6">
      <MobileNavigation />
      <div className="min-w-0 lg:hidden">
        <p className="truncate text-body-sm font-semibold">{client ? client.name : organization.name}</p>
        <p className="hidden text-caption text-muted-foreground sm:block">{client ? `${client.rfc} · ${client.currentPeriod}` : roleLabels[membership.role]}</p>
      </div>
      <ContextBreadcrumbs />
      <Badge variant="outline" className="hidden xl:inline-flex">Datos demo</Badge>
      <div className="ml-auto flex items-center gap-1">
        <ContextSearch />
        <Button render={<Link href={processesHref} />} variant="ghost" size="icon" aria-label="Procesos: uno activo y uno con errores">
          <Workflow className="size-4" /><span className="sr-only">1 proceso activo, 1 con errores</span>
        </Button>
        <NotificationsDrawer />
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Abrir menú del perfil" className="grid size-10 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground">
            <UserRound className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="py-2">
                <span className="block text-body-sm font-semibold text-foreground">{account.name}</span>
                <span className="block font-normal">{roleLabels[membership.role]} · {account.email}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/es/perfil")}><CircleUserRound className="size-4" /> Mi perfil</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/es/seguridad")}><ShieldCheck className="size-4" /> Seguridad y MFA</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/es/preferencias")}><Settings2 className="size-4" /> Preferencias</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/es/ayuda")}><HelpCircle className="size-4" /> Ayuda y soporte</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Apariencia</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
                <DropdownMenuRadioItem value="system"><Settings2 className="size-4" /> Sistema</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light"><Sun className="size-4" /> Claro</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark"><Moon className="size-4" /> Oscuro</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <ConfirmLogout />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
