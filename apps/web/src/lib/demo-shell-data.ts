import type {
  Capability,
  DemoAccount,
  DemoClient,
  DemoMembership,
  DemoOrganization,
} from "@/lib/accounting-types";

export type DemoClientShell = Pick<
  DemoClient,
  "id" | "organizationId" | "name" | "rfc" | "currentPeriod"
>;

const titularCapabilities: Capability[] = [
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
  "cfdi.exclude",
  "periods.close",
  "periods.reopen",
  "exports.generate",
  "support.authorize",
];

const demoAccount: DemoAccount = {
  id: "cuenta-demo-mariana",
  name: "Mariana Torres",
  email: "mariana@example.test",
};

const demoOrganizations: DemoOrganization[] = [
  {
    id: "estudio-norte",
    slug: "estudio-norte",
    name: "Estudio Contable Norte",
    shortName: "Estudio Norte",
  },
  {
    id: "colectivo-centro",
    slug: "colectivo-centro",
    name: "Colectivo Fiscal Centro",
    shortName: "Colectivo Centro",
  },
];

const demoMemberships: DemoMembership[] = [
  {
    organizationId: "estudio-norte",
    role: "titular",
    capabilities: titularCapabilities,
    assignedClientIds: ["comercial-sur", "servicios-bajio", "taller-orion"],
  },
  {
    organizationId: "colectivo-centro",
    role: "colaborador",
    capabilities: [
      "organization.view",
      "clients.view",
      "fiscal_entities.view",
      "fiscal_years.view",
    ],
    assignedClientIds: ["distribuidora-lago"],
  },
];

const demoClients: DemoClientShell[] = [
  {
    id: "comercial-sur",
    organizationId: "estudio-norte",
    name: "Comercial del Sur Demo",
    rfc: "DEM010101AA1",
    currentPeriod: "Agosto 2026",
  },
  {
    id: "servicios-bajio",
    organizationId: "estudio-norte",
    name: "Servicios del Bajío Demo",
    rfc: "DEM020202BB2",
    currentPeriod: "Agosto 2026",
  },
  {
    id: "taller-orion",
    organizationId: "estudio-norte",
    name: "Taller Orión Demo",
    rfc: "DEM030303CC3",
    currentPeriod: "Agosto 2026",
  },
  {
    id: "distribuidora-lago",
    organizationId: "colectivo-centro",
    name: "Distribuidora del Lago Demo",
    rfc: "DEM040404DD4",
    currentPeriod: "Agosto 2026",
  },
];

export function organizationById(id: string) {
  return demoOrganizations.find((organization) => organization.id === id);
}

export function organizationBySlug(slug: string) {
  return demoOrganizations.find((organization) => organization.slug === slug);
}

export function membershipFor(organizationId: string) {
  return demoMemberships.find(
    (membership) => membership.organizationId === organizationId,
  );
}

export function clientsFor(organizationId: string) {
  const membership = membershipFor(organizationId);
  if (!membership) return [];
  return demoClients.filter(
    (client) =>
      client.organizationId === organizationId &&
      membership.assignedClientIds.includes(client.id),
  );
}

export function clientById(organizationId: string, clientId: string) {
  return demoClients.find(
    (client) =>
      client.organizationId === organizationId && client.id === clientId,
  );
}

export { demoAccount };
