import type { Capability } from "./accounting-types";

export type ProductScreen =
  | "organization-home" | "clients" | "processes" | "team" | "audit"
  | "organization-settings" | "client-overview" | "fiscal-years" | "fiscal-year"
  | "period" | "client-cfdi" | "cfdi-detail" | "obligations" | "diot-list"
  | "diot-period" | "ieps-list" | "ieps-instance" | "generated-files"
  | "client-alerts" | "client-settings";

export interface ResolvedProductRoute {
  screen: ProductScreen;
  organizationId: string;
  clientId?: string;
  year?: string;
  period?: string;
  tab?: string;
  uuid?: string;
  instanceId?: string;
  section?: string;
  capability?: Capability;
}

const periodTabs = ["resumen", "cfdi", "pagos", "nomina", "incidencias", "cierre", "exportaciones"];
const diotTabs = ["resumen", "operaciones", "validaciones", "ajustes", "vista-previa", "archivos"];
const iepsTabs = ["resumen", "cfdi-fuente", "impuestos", "productos", "clasificacion", "informacion-adicional", "validaciones", "vista-previa", "archivos"];

export function resolveProductRoute(organizationId: string, segments: string[] = []): ResolvedProductRoute | null {
  const [first = "inicio", second, third, fourth, fifth, sixth, seventh] = segments;
  if (first === "inicio" && !second) return { screen: "organization-home", organizationId, capability: "organization.view" };
  if (first === "clientes" && !second) return { screen: "clients", organizationId, capability: "clients.view" };
  if (first === "procesos" && !second) return { screen: "processes", organizationId, capability: "organization.view" };
  if (first === "equipo" && !second) return { screen: "team", organizationId, capability: "team.view" };
  if (first === "auditoria" && !second) return { screen: "audit", organizationId, capability: "audit.view" };
  if (first === "configuracion") {
    const capability = second === "plan-facturacion" ? "billing.manage" : "organization.view";
    return { screen: "organization-settings", organizationId, section: second ?? "resumen", capability };
  }
  if (first !== "clientes" || !second) return null;

  const base = { organizationId, clientId: second };
  if (!third || third === "resumen") return { screen: "client-overview", ...base, capability: "clients.view" };
  if (third === "ejercicios" && !fourth) return { screen: "fiscal-years", ...base, capability: "clients.view" };
  if (third === "ejercicios" && fourth && !fifth) return { screen: "fiscal-year", ...base, year: fourth, capability: "clients.view" };
  if (third === "ejercicios" && fourth && fifth === "periodos" && sixth) {
    const tab = seventh ?? "resumen";
    if (!periodTabs.includes(tab)) return null;
    return { screen: "period", ...base, year: fourth, period: sixth, tab, capability: tab === "nomina" ? "payroll.view" : "clients.view" };
  }
  if (third === "cfdi" && !fourth) return { screen: "client-cfdi", ...base, capability: "clients.view" };
  if (third === "cfdi" && fourth) return { screen: "cfdi-detail", ...base, uuid: fourth, capability: "clients.view" };
  if (third === "alertas" && !fourth) return { screen: "client-alerts", ...base, capability: "clients.view" };
  if (third === "configuracion" && fourth) {
    const capabilities: Record<string, Capability> = {
      datos: "clients.manage", responsables: "clients.assign", "e-firma-sat": "credentials.manage",
      obligaciones: "obligations.configure", accesos: "clients.assign",
    };
    if (!capabilities[fourth]) return null;
    return { screen: "client-settings", ...base, section: fourth, capability: capabilities[fourth] };
  }
  if (third !== "obligaciones") return null;
  if (!fourth) return { screen: "obligations", ...base, capability: "obligations.view" };
  if (fourth === "archivos-generados" && !fifth) return { screen: "generated-files", ...base, capability: "obligations.view" };
  if (fourth === "diot" && !fifth) return { screen: "diot-list", ...base, capability: "obligations.view" };
  if (fourth === "diot" && fifth && sixth) {
    const tab = seventh ?? "resumen";
    if (!diotTabs.includes(tab)) return null;
    return { screen: "diot-period", ...base, year: fifth, period: sixth, tab, capability: "obligations.view" };
  }
  if (fourth === "ieps" && !fifth) return { screen: "ieps-list", ...base, capability: "obligations.view" };
  if (fourth === "ieps" && fifth) {
    const tab = sixth ?? "resumen";
    if (!iepsTabs.includes(tab)) return null;
    return { screen: "ieps-instance", ...base, instanceId: fifth, tab, capability: "obligations.view" };
  }
  return null;
}
