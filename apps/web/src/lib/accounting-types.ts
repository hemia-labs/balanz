export const capabilities = [
  "organization.view",
  "organization.manage",
  "ownership.manage",
  "billing.manage",
  "team.view",
  "members.manage",
  "permissions.manage",
  "clients.view",
  "clients.manage",
  "clients.assign",
  "fiscal_entities.view",
  "fiscal_entities.manage",
  "fiscal_years.view",
  "fiscal_years.manage",
  "credentials.manage",
  "sat.download",
  "payroll.view",
  "cfdi.review",
  "cfdi.exclude",
  "periods.close",
  "periods.reopen",
  "exports.generate",
  "obligations.view",
  "obligations.configure",
  "diot.generate",
  "ieps.generate",
  "audit.view",
  "support.authorize",
] as const;

export type Capability = (typeof capabilities)[number];
export type MembershipRole =
  "administrador" | "titular" | "responsable" | "colaborador";
export type PeriodStatus =
  | "Sin iniciar"
  | "En preparación"
  | "En revisión"
  | "Listo para cerrar"
  | "Cerrado"
  | "Con novedades"
  | "Reabierto"
  | "Bloqueado";

export interface DemoAccount {
  id: string;
  name: string;
  email: string;
}
export interface DemoOrganization {
  id: string;
  slug: string;
  name: string;
  shortName: string;
}
export interface DemoMembership {
  organizationId: string;
  role: MembershipRole;
  capabilities: Capability[];
  assignedClientIds: string[];
}
export interface DemoClient {
  id: string;
  organizationId: string;
  name: string;
  rfc: string;
  responsible: string;
  currentPeriod: string;
  status: PeriodStatus;
  progress: number;
  incidents: number;
  lastCutoff: string;
  lastActivity: string;
  eSignature: "Vigente" | "Próxima a vencer" | "Vencida";
  satConnection: "Conectado" | "Requiere atención" | "Sin configurar";
}
export interface DemoPeriod {
  month: string;
  slug: string;
  status: PeriodStatus;
  progress: number;
  cfdi: number;
  incidents: number;
  cutoff: string;
  version: string;
  responsible: string;
}
export interface DemoProcess {
  id: string;
  type: string;
  clientId: string;
  period: string;
  status: "En proceso" | "Completado" | "Con errores";
  satStatus?: string;
  progress: number;
  requestedBy: string;
  startedAt: string;
  updatedAt: string;
  result: string;
}
export interface DemoCfdi {
  uuid: string;
  clientId: string;
  type: "Ingreso" | "Egreso" | "Pago" | "Nómina";
  direction: "Emitido" | "Recibido";
  rfc: string;
  name: string;
  date: string;
  method: "PUE" | "PPD";
  total: number;
  currency: "MXN" | "USD";
  status: "Revisado" | "Pendiente" | "Cancelado" | "Con incidencia";
  paymentComplement: "No aplica" | "Completo" | "Pendiente";
}
export interface DemoNotification {
  id: string;
  title: string;
  detail: string;
  kind: "info" | "warning" | "danger" | "success";
  href: string;
  time: string;
}
export interface DemoFixtureSet {
  mode: "demo";
  account: DemoAccount;
  organizations: DemoOrganization[];
  memberships: DemoMembership[];
  clients: DemoClient[];
  periods: DemoPeriod[];
  processes: DemoProcess[];
  cfdi: DemoCfdi[];
  notifications: DemoNotification[];
}
