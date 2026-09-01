import assert from "node:assert/strict";
import test from "node:test";
import type { DemoMembership } from "./accounting-types";
import {
  filterNavigation,
  isClientNavigationItemActive,
  isNavigationItemActive,
  resolveOrganizationRoute,
} from "./navigation-core";
import { canAccessClient, hasCapability } from "./permissions";
import {
  canOpenResolvedProductRoute,
  isLivePeriodTabSupported,
  resolveProductRoute,
} from "./product-route";

const membership: DemoMembership = {
  organizationId: "despacho-demo",
  role: "colaborador",
  capabilities: ["organization.view", "clients.view", "fiscal_years.view"],
  assignedClientIds: ["cliente-asignado"],
};

test("filtra navegación por contexto y capacidad", () => {
  const items = [
    {
      id: "home",
      context: "organization" as const,
      href: "/home",
      capability: "organization.view" as const,
    },
    {
      id: "team",
      context: "organization" as const,
      href: "/team",
      capability: "team.view" as const,
    },
    {
      id: "cfdi",
      context: "client" as const,
      href: "/cfdi",
      capability: "clients.view" as const,
    },
  ];
  assert.deepEqual(
    filterNavigation(items, "organization", membership.capabilities).map(
      (item) => item.id,
    ),
    ["home"],
  );
  assert.deepEqual(
    filterNavigation(items, "client", membership.capabilities).map(
      (item) => item.id,
    ),
    ["cfdi"],
  );
});

test("identifica la ruta activa sin confundir prefijos parciales", () => {
  assert.equal(
    isNavigationItemActive(
      "/es/organizations/demo/clients",
      "/es/organizations/demo/clients",
    ),
    true,
  );
  assert.equal(
    isNavigationItemActive(
      "/es/organizations/demo/clients/uno",
      "/es/organizations/demo/clients",
    ),
    true,
  );
  assert.equal(
    isNavigationItemActive(
      "/es/organizations/demo/clients-archived",
      "/es/organizations/demo/clients",
    ),
    false,
  );
});

test("mantiene Ejercicios activo dentro de un RFC, ejercicio y período", () => {
  const href = "/es/organizations/demo/clients/cliente/fiscal-years";
  assert.equal(
    isClientNavigationItemActive(
      "fiscal-years",
      "/es/organizations/demo/clients/cliente/legal-entities/rfc-1/fiscal-years/2026/periods/01/overview",
      href,
    ),
    true,
  );
  assert.equal(
    isClientNavigationItemActive(
      "client-overview",
      "/es/organizations/demo/clients/cliente/legal-entities/rfc-1/fiscal-years/2026/periods/01/overview",
      "/es/organizations/demo/clients/cliente/overview",
    ),
    false,
  );
  assert.equal(
    isClientNavigationItemActive(
      "fiscal-years",
      "/es/organizations/demo/clients/otro/legal-entities/rfc-1/fiscal-years/2026",
      href,
    ),
    false,
  );
});

test("resuelve rutas canónicas, pestañas y capacidades", () => {
  const overview = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "fiscal-years",
    "2026",
    "periods",
    "08",
    "overview",
  ]);
  const cfdi = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "fiscal-years",
    "2026",
    "periods",
    "08",
    "cfdi",
  ]);
  const period = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "fiscal-years",
    "2026",
    "periods",
    "08",
    "payroll",
  ]);
  assert.equal(overview?.capability, "fiscal_years.view");
  assert.equal(cfdi?.capability, "fiscal_years.view");
  assert.equal(period?.screen, "period");
  assert.equal(period?.capability, "payroll.view");
  const unsupportedObligation = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "obligations",
    "diot",
    "2026",
    "08",
    "validations",
  ]);
  assert.equal(unsupportedObligation, null);
  assert.equal(
    resolveProductRoute("demo", [
      "clients",
      "cliente",
      "fiscal-years",
      "2026",
      "periods",
      "08",
      "inexistente",
    ]),
    null,
  );
});

test("incluye legalEntityId en rutas fiscales multi-RFC", () => {
  const year = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "legal-entities",
    "entidad-1",
    "fiscal-years",
    "2026",
  ]);
  assert.equal(year?.screen, "fiscal-year");
  assert.equal(year?.legalEntityId, "entidad-1");
  assert.equal(year?.capability, "fiscal_years.view");

  const period = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "legal-entities",
    "entidad-2",
    "fiscal-years",
    "2026",
    "periods",
    "08",
    "overview",
  ]);
  assert.equal(period?.screen, "period");
  assert.equal(period?.legalEntityId, "entidad-2");
  assert.equal(period?.period, "08");

  const payroll = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "legal-entities",
    "entidad-2",
    "fiscal-years",
    "2026",
    "periods",
    "08",
    "payroll",
  ]);
  assert.equal(payroll?.screen, "period");
  assert.equal(payroll?.tab, "payroll");
  assert.equal(payroll?.capability, "payroll.view");
});

test("protege rutas live y no interpreta pestañas fuera de alcance como resumen", () => {
  const responsibles = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "settings",
    "responsibles",
  ]);
  const access = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "settings",
    "access",
  ]);
  assert.ok(responsibles);
  assert.ok(access);
  assert.equal(responsibles.capability, "clients.assign");
  assert.equal(access.capability, "clients.assign");
  assert.equal(
    canOpenResolvedProductRoute(responsibles, ["clients.view"]),
    false,
  );
  assert.equal(canOpenResolvedProductRoute(access, ["clients.view"]), false);
  assert.equal(
    canOpenResolvedProductRoute(responsibles, [
      "clients.view",
      "clients.assign",
    ]),
    true,
  );
  assert.equal(
    canOpenResolvedProductRoute(access, ["clients.view", "clients.assign"]),
    true,
  );
  assert.equal(canOpenResolvedProductRoute(access, ["clients.*"]), false);
  assert.equal(canOpenResolvedProductRoute(access, ["*.*"]), false);
  assert.equal(canOpenResolvedProductRoute(access, ["client.*"]), false);
  const audit = resolveProductRoute("demo", ["audit"]);
  assert.equal(audit, null);
  assert.equal(isLivePeriodTabSupported("overview"), true);
  assert.equal(isLivePeriodTabSupported("payroll"), false);
  assert.equal(isLivePeriodTabSupported("cfdi"), false);
});

test("separa el resumen de las secciones de configuración del cliente", () => {
  const overview = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "overview",
  ]);
  assert.equal(overview?.screen, "client-overview");
  assert.equal(overview?.capability, "clients.view");

  const data = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "settings",
    "data",
  ]);
  assert.equal(data?.screen, "client-settings");
  assert.equal(data?.section, "data");
  assert.equal(data?.capability, "clients.manage");

  const responsibles = resolveProductRoute("demo", [
    "clients",
    "cliente",
    "settings",
    "responsibles",
  ]);
  assert.equal(responsibles?.screen, "client-settings");
  assert.equal(responsibles?.section, "responsibles");
  assert.equal(responsibles?.capability, "clients.assign");
});

test("aplica capacidades y asignación explícita de cliente", () => {
  assert.equal(
    hasCapability(membership.capabilities, "fiscal_years.view"),
    true,
  );
  assert.equal(hasCapability(membership.capabilities, "members.manage"), false);
  assert.equal(canAccessClient(membership, "cliente-asignado"), true);
  assert.equal(canAccessClient(membership, "cliente-ajeno"), false);
});

test("no acepta comodines ni infiere permisos en frontend", () => {
  assert.equal(hasCapability(["*.*"], "clients.view"), false);
  assert.equal(hasCapability(["clients.*"], "clients.view"), false);
  assert.equal(hasCapability(["clients.view"], "clients.view"), true);
});

test("resuelve el tenant de una ruta por slug o identificador", () => {
  const organizations = [
    { id: "org-a", slug: "despacho-a" },
    { id: "org-b", slug: "despacho-b" },
  ];
  assert.equal(
    resolveOrganizationRoute(organizations, "despacho-b")?.id,
    "org-b",
  );
  assert.equal(
    resolveOrganizationRoute(organizations, "org-a")?.slug,
    "despacho-a",
  );
  assert.equal(
    resolveOrganizationRoute(organizations, "desconocida"),
    undefined,
  );
});
