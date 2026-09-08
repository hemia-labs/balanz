"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import {
  CircleUserRound,
  HelpCircle,
  KeyRound,
  LogOut,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  Workflow,
} from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { ContextSearch } from "@/components/context-search";
import { ContextBreadcrumbs } from "@/components/context-breadcrumbs";
import { MobileNavigation } from "@/components/mobile-navigation";
import { NotificationsDrawer } from "@/components/notifications-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabels } from "@/lib/permissions";
import { logout } from "@/features/auth/api";

type ThemePreference = "system" | "light" | "dark";
const useThemeEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme-preference");
  return stored === "light" || stored === "dark" ? stored : "light";
}

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "U";
}

function ConfirmLogout({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar sesión</DialogTitle>
          <DialogDescription>
            Se cerrará la sesión activa en este navegador.
          </DialogDescription>
          {error ? (
            <p
              role="alert"
              aria-live="polite"
              className="text-body-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void logout()
                .then(() => {
                  onOpenChange(false);
                  router.push(`/${locale}/login`);
                })
                .catch(() => {
                  setError("No se pudo cerrar la sesión. Intenta de nuevo.");
                  setBusy(false);
                });
            }}
          >
            {busy ? "Cerrando…" : "Cerrar sesión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppTopbar() {
  const router = useRouter();
  const context = useAccountingContext();
  const { account, client, organization, membership, isDemo } = context;
  const pathname = usePathname();
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const accountInitials = getInitials(account.name);

  useThemeEffect(() => {
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
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

  const processesHref = `/${locale}/organizations/${organization.slug}/processes`;
  return (
    <header className="sticky top-0 z-10 flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:px-4 lg:px-6">
      <MobileNavigation />
      <div className="min-w-0 lg:hidden">
        <p className="truncate text-body-sm font-semibold">
          {client ? client.name : organization.name}
        </p>
        <p className="hidden text-caption text-muted-foreground sm:block">
          {client
            ? `${client.rfc} · ${client.currentPeriod}`
            : roleLabels[membership.role]}
        </p>
      </div>
      <ContextBreadcrumbs />
      {isDemo ? (
        <Badge variant="outline" className="hidden xl:inline-flex">
          Datos demo
        </Badge>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <ContextSearch />
        <Button
          render={<Link href={processesHref} />}
          variant="ghost"
          size="icon"
          aria-label="Abrir Centro de procesos"
        >
          <Workflow className="size-4" />
        </Button>
        <NotificationsDrawer />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Abrir menú del perfil de ${account.name}`}
            className="grid size-10 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <Avatar className="size-8">
              {account.avatarUrl ? (
                <AvatarImage src={account.avatarUrl} alt="" />
              ) : null}
              <AvatarFallback aria-hidden="true">
                {accountInitials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="py-2">
                <span className="block text-body-sm font-semibold text-foreground">
                  {account.name}
                </span>
                <span className="block font-normal">
                  {roleLabels[membership.role]} · {account.email}
                </span>
                <span className="mt-1 block font-normal text-muted-foreground">
                  {organization.name} · {membership.capabilities.length}{" "}
                  permisos · {membership.assignedClientIds.length} cuentas
                  asignadas
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push(`/${locale}/profile`)}>
              <CircleUserRound className="size-4" /> Mi perfil
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/${locale}/authorization`)}
            >
              <KeyRound className="size-4" /> Mi acceso
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/${locale}/security`)}
            >
              <ShieldCheck className="size-4" /> Seguridad y MFA
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/${locale}/preferences`)}
            >
              <Settings2 className="size-4" /> Preferencias
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/${locale}/help`)}>
              <HelpCircle className="size-4" /> Ayuda y soporte
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Apariencia</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => setTheme(value as ThemePreference)}
              >
                <DropdownMenuRadioItem value="system">
                  <Settings2 className="size-4" /> Sistema
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  <Sun className="size-4" /> Claro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon className="size-4" /> Oscuro
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setLogoutOpen(true)}
            >
              <LogOut className="size-4" /> Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ConfirmLogout open={logoutOpen} onOpenChange={setLogoutOpen} />
    </header>
  );
}
