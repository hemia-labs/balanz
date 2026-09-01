import {
  AlertTriangle,
  BadgeHelp,
  Building2,
  FileSearch,
  Files,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  UsersRound,
  Workflow,
} from "lucide-react";
import type { Capability } from "@/lib/accounting-types";
import type { NavigationContext } from "@/lib/navigation-core";

export const organizationNavGroups = [
  "Operación",
  "Administración",
  "Soporte",
] as const;
export const clientNavGroups = ["Cliente", "Configuración"] as const;

export interface AppNavItem {
  id: string;
  label: string;
  group: string;
  context: NavigationContext;
  suffix: string;
  capability?: Capability;
  icon: typeof LayoutDashboard;
}

export const appNavigation: AppNavItem[] = [
  {
    id: "home",
    label: "Inicio",
    group: "Operación",
    context: "organization",
    suffix: "home",
    icon: LayoutDashboard,
  },
  {
    id: "clients",
    label: "Clientes",
    group: "Operación",
    context: "organization",
    suffix: "clients",
    capability: "clients.view",
    icon: Building2,
  },
  {
    id: "processes",
    label: "Procesos",
    group: "Operación",
    context: "organization",
    suffix: "processes",
    capability: "organization.view",
    icon: Workflow,
  },
  {
    id: "team",
    label: "Equipo",
    group: "Administración",
    context: "organization",
    suffix: "team",
    capability: "team.view",
    icon: UsersRound,
  },
  {
    id: "settings",
    label: "Configuración",
    group: "Administración",
    context: "organization",
    suffix: "settings",
    capability: "organization.view",
    icon: Settings,
  },
  {
    id: "help",
    label: "Ayuda y soporte",
    group: "Soporte",
    context: "organization",
    suffix: "help",
    icon: BadgeHelp,
  },
  {
    id: "client-overview",
    label: "Resumen",
    group: "Cliente",
    context: "client",
    suffix: "overview",
    capability: "clients.view",
    icon: LayoutDashboard,
  },
  {
    id: "fiscal-years",
    label: "Ejercicios",
    group: "Cliente",
    context: "client",
    suffix: "fiscal-years",
    capability: "fiscal_years.view",
    icon: ListChecks,
  },
  {
    id: "cfdi",
    label: "CFDI",
    group: "Cliente",
    context: "client",
    suffix: "cfdi",
    capability: "clients.view",
    icon: Files,
  },
  {
    id: "alerts",
    label: "Alertas",
    group: "Cliente",
    context: "client",
    suffix: "alerts",
    capability: "clients.view",
    icon: AlertTriangle,
  },
  {
    id: "client-data",
    label: "Datos del cliente",
    group: "Configuración",
    context: "client",
    suffix: "settings/data",
    capability: "clients.manage",
    icon: FileSearch,
  },
  {
    id: "responsibles",
    label: "Responsables",
    group: "Configuración",
    context: "client",
    suffix: "settings/responsibles",
    capability: "clients.assign",
    icon: UsersRound,
  },
  {
    id: "signature",
    label: "e.firma y SAT",
    group: "Configuración",
    context: "client",
    suffix: "settings/e-signature-sat",
    capability: "credentials.manage",
    icon: ShieldCheck,
  },
  {
    id: "access",
    label: "Accesos",
    group: "Configuración",
    context: "client",
    suffix: "settings/access",
    capability: "clients.assign",
    icon: ShieldCheck,
  },
];

export function organizationBase(locale: string, organizationSlug: string) {
  return `/${locale}/organizations/${organizationSlug}`;
}
export function clientBase(
  locale: string,
  organizationSlug: string,
  clientId: string,
) {
  return `${organizationBase(locale, organizationSlug)}/clients/${clientId}`;
}
export function navHref(
  item: AppNavItem,
  locale: string,
  organizationSlug: string,
  clientId?: string,
) {
  if (item.id === "help") return `/${locale}/help`;
  const base =
    item.context === "client" && clientId
      ? clientBase(locale, organizationSlug, clientId)
      : organizationBase(locale, organizationSlug);
  return `${base}/${item.suffix}`;
}
