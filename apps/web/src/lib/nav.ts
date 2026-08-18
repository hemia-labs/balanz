import {
  AlertTriangle, BadgeHelp, Building2, ClipboardCheck, FileSearch, Files, History,
  LayoutDashboard, ListChecks, Settings, ShieldCheck, UsersRound, Workflow,
} from "lucide-react";
import type { Capability } from "@/lib/accounting-types";
import type { NavigationContext } from "@/lib/navigation-core";

export const organizationNavGroups = ["Operación", "Administración", "Soporte"] as const;
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
  { id: "home", label: "Inicio", group: "Operación", context: "organization", suffix: "inicio", icon: LayoutDashboard },
  { id: "clients", label: "Clientes", group: "Operación", context: "organization", suffix: "clientes", capability: "clients.view", icon: Building2 },
  { id: "processes", label: "Procesos", group: "Operación", context: "organization", suffix: "procesos", capability: "organization.view", icon: Workflow },
  { id: "team", label: "Equipo", group: "Administración", context: "organization", suffix: "equipo", capability: "team.view", icon: UsersRound },
  { id: "audit", label: "Auditoría", group: "Administración", context: "organization", suffix: "auditoria", capability: "audit.view", icon: History },
  { id: "settings", label: "Configuración", group: "Administración", context: "organization", suffix: "configuracion", capability: "organization.view", icon: Settings },
  { id: "help", label: "Ayuda y soporte", group: "Soporte", context: "organization", suffix: "ayuda", icon: BadgeHelp },
  { id: "client-overview", label: "Resumen", group: "Cliente", context: "client", suffix: "resumen", capability: "clients.view", icon: LayoutDashboard },
  { id: "fiscal-years", label: "Ejercicios", group: "Cliente", context: "client", suffix: "ejercicios", capability: "clients.view", icon: ListChecks },
  { id: "cfdi", label: "CFDI", group: "Cliente", context: "client", suffix: "cfdi", capability: "clients.view", icon: Files },
  { id: "obligations", label: "Obligaciones fiscales", group: "Cliente", context: "client", suffix: "obligaciones", capability: "obligations.view", icon: ClipboardCheck },
  { id: "alerts", label: "Alertas", group: "Cliente", context: "client", suffix: "alertas", capability: "clients.view", icon: AlertTriangle },
  { id: "client-data", label: "Datos del cliente", group: "Configuración", context: "client", suffix: "configuracion/datos", capability: "clients.manage", icon: FileSearch },
  { id: "responsibles", label: "Responsables", group: "Configuración", context: "client", suffix: "configuracion/responsables", capability: "clients.assign", icon: UsersRound },
  { id: "signature", label: "e.firma y SAT", group: "Configuración", context: "client", suffix: "configuracion/e-firma-sat", capability: "credentials.manage", icon: ShieldCheck },
  { id: "client-obligations", label: "Obligaciones", group: "Configuración", context: "client", suffix: "configuracion/obligaciones", capability: "obligations.configure", icon: ClipboardCheck },
  { id: "access", label: "Accesos", group: "Configuración", context: "client", suffix: "configuracion/accesos", capability: "clients.assign", icon: ShieldCheck },
];

export function organizationBase(locale: string, organizationId: string) {
  return `/${locale}/despachos/${organizationId}`;
}
export function clientBase(locale: string, organizationId: string, clientId: string) {
  return `${organizationBase(locale, organizationId)}/clientes/${clientId}`;
}
export function navHref(
  item: AppNavItem,
  locale: string,
  organizationId: string,
  clientId?: string
) {
  if (item.id === "help") return `/${locale}/ayuda`;
  const base = item.context === "client" && clientId
    ? clientBase(locale, organizationId, clientId)
    : organizationBase(locale, organizationId);
  return `${base}/${item.suffix}`;
}
