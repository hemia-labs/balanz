import assert from "node:assert/strict";
import test from "node:test";
import type { DemoMembership } from "./accounting-types";
import { filterNavigation, isNavigationItemActive, resolveLegacyDestination } from "./navigation-core";
import { canAccessClient, hasCapability } from "./permissions";
import { resolveProductRoute } from "./product-route";

const membership: DemoMembership = {
  organizationId: "despacho-demo",
  role: "colaborador",
  capabilities: ["organization.view", "clients.view", "obligations.view"],
  assignedClientIds: ["cliente-asignado"],
};

test("filtra navegación por contexto y capacidad", () => {
  const items = [
    { id: "home", context: "organization" as const, href: "/home", capability: "organization.view" as const },
    { id: "team", context: "organization" as const, href: "/team", capability: "team.view" as const },
    { id: "cfdi", context: "client" as const, href: "/cfdi", capability: "clients.view" as const },
  ];
  assert.deepEqual(filterNavigation(items, "organization", membership.capabilities).map((item) => item.id), ["home"]);
  assert.deepEqual(filterNavigation(items, "client", membership.capabilities).map((item) => item.id), ["cfdi"]);
});

test("identifica la ruta activa sin confundir prefijos parciales", () => {
  assert.equal(isNavigationItemActive("/es/organizations/demo/clients", "/es/organizations/demo/clients"), true);
  assert.equal(isNavigationItemActive("/es/organizations/demo/clients/uno", "/es/organizations/demo/clients"), true);
  assert.equal(isNavigationItemActive("/es/organizations/demo/clients-archived", "/es/organizations/demo/clients"), false);
});

test("resuelve rutas canónicas, pestañas y capacidades", () => {
  const period = resolveProductRoute("demo", ["clients", "cliente", "fiscal-years", "2026", "periods", "08", "payroll"]);
  assert.equal(period?.screen, "period");
  assert.equal(period?.capability, "payroll.view");
  const diot = resolveProductRoute("demo", ["clients", "cliente", "obligations", "diot", "2026", "08", "validations"]);
  assert.equal(diot?.screen, "diot-period");
  assert.equal(diot?.tab, "validations");
  assert.equal(resolveProductRoute("demo", ["clients", "cliente", "fiscal-years", "2026", "periods", "08", "inexistente"]), null);
});

test("aplica capacidades y asignación explícita de cliente", () => {
  assert.equal(hasCapability(membership.capabilities, "obligations.view"), true);
  assert.equal(hasCapability(membership.capabilities, "team.manage"), false);
  assert.equal(canAccessClient(membership, "cliente-asignado"), true);
  assert.equal(canAccessClient(membership, "cliente-ajeno"), false);
});

test("mantiene destinos seguros para rutas heredadas", () => {
  assert.equal(resolveLegacyDestination("users"), "team");
  assert.equal(resolveLegacyDestination("plans"), "settings/billing-plan");
  assert.equal(resolveLegacyDestination("desconocida"), undefined);
});
