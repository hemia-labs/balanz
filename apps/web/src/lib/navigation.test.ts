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
    { id: "inicio", context: "organization" as const, href: "/inicio", capability: "organization.view" as const },
    { id: "equipo", context: "organization" as const, href: "/equipo", capability: "team.view" as const },
    { id: "cfdi", context: "client" as const, href: "/cfdi", capability: "clients.view" as const },
  ];
  assert.deepEqual(filterNavigation(items, "organization", membership.capabilities).map((item) => item.id), ["inicio"]);
  assert.deepEqual(filterNavigation(items, "client", membership.capabilities).map((item) => item.id), ["cfdi"]);
});

test("identifica la ruta activa sin confundir prefijos parciales", () => {
  assert.equal(isNavigationItemActive("/es/despachos/demo/clientes", "/es/despachos/demo/clientes"), true);
  assert.equal(isNavigationItemActive("/es/despachos/demo/clientes/uno", "/es/despachos/demo/clientes"), true);
  assert.equal(isNavigationItemActive("/es/despachos/demo/clientes-archivados", "/es/despachos/demo/clientes"), false);
});

test("resuelve rutas canónicas, pestañas y capacidades", () => {
  const period = resolveProductRoute("demo", ["clientes", "cliente", "ejercicios", "2026", "periodos", "08", "nomina"]);
  assert.equal(period?.screen, "period");
  assert.equal(period?.capability, "payroll.view");
  const diot = resolveProductRoute("demo", ["clientes", "cliente", "obligaciones", "diot", "2026", "08", "validaciones"]);
  assert.equal(diot?.screen, "diot-period");
  assert.equal(diot?.tab, "validaciones");
  assert.equal(resolveProductRoute("demo", ["clientes", "cliente", "ejercicios", "2026", "periodos", "08", "inexistente"]), null);
});

test("aplica capacidades y asignación explícita de cliente", () => {
  assert.equal(hasCapability(membership.capabilities, "obligations.view"), true);
  assert.equal(hasCapability(membership.capabilities, "team.manage"), false);
  assert.equal(canAccessClient(membership, "cliente-asignado"), true);
  assert.equal(canAccessClient(membership, "cliente-ajeno"), false);
});

test("mantiene destinos seguros para rutas heredadas", () => {
  assert.equal(resolveLegacyDestination("users"), "equipo");
  assert.equal(resolveLegacyDestination("plans"), "configuracion/plan-facturacion");
  assert.equal(resolveLegacyDestination("desconocida"), undefined);
});
