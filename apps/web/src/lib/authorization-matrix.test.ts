import assert from "node:assert/strict";
import test from "node:test";
import type { Capability, DemoMembership } from "./accounting-types";
import { filterNavigation } from "./navigation-core";
import { canAccessClient, hasCapability } from "./permissions";

const assignedAccountId = "account-assigned";
const outsideAccountId = "account-outside";

function membership(
  capabilities: Capability[],
  assignedClientIds = [assignedAccountId],
): DemoMembership {
  return {
    organizationId: "organization-active",
    role: "responsable",
    capabilities,
    assignedClientIds,
  };
}

test("matriz frontend separa permiso efectivo y alcance de cuenta", () => {
  const cases = [
    {
      name: "permiso y cuenta asignada",
      current: membership(["clients.view"]),
      permission: "clients.view" as Capability,
      accountId: assignedAccountId,
      expected: true,
    },
    {
      name: "deny efectivo elimina el permiso",
      current: membership([]),
      permission: "clients.view" as Capability,
      accountId: assignedAccountId,
      expected: false,
    },
    {
      name: "grant efectivo agrega el permiso",
      current: membership(["exports.generate"]),
      permission: "exports.generate" as Capability,
      accountId: assignedAccountId,
      expected: true,
    },
    {
      name: "permiso sin asignación queda fuera de alcance",
      current: membership(["clients.view"]),
      permission: "clients.view" as Capability,
      accountId: outsideAccountId,
      expected: false,
    },
  ];

  for (const item of cases) {
    const allowed =
      hasCapability(item.current.capabilities, item.permission) &&
      canAccessClient(item.current, item.accountId);
    assert.equal(allowed, item.expected, item.name);
  }
});

test("la navegación consume claves exactas sin inferir ni aceptar comodines", () => {
  const items = [
    {
      id: "clients",
      context: "organization" as const,
      href: "/clients",
      capability: "clients.view" as Capability,
    },
    {
      id: "team",
      context: "organization" as const,
      href: "/team",
      capability: "permissions.manage" as Capability,
    },
  ];
  assert.deepEqual(
    filterNavigation(items, "organization", ["clients.view"]).map(
      ({ id }) => id,
    ),
    ["clients"],
  );
  assert.equal(hasCapability(["periods.close"], "periods.close"), true);
  assert.equal(hasCapability(["close_period"], "periods.close"), false);
  assert.equal(hasCapability(["periods.*"], "periods.close"), false);
});

test("un cambio de tenant no reutiliza permisos ni asignaciones anteriores", () => {
  const previous = membership(
    ["clients.view", "permissions.manage"],
    [assignedAccountId],
  );
  const next = {
    organizationId: "organization-next",
    role: "colaborador" as const,
    capabilities: ["organization.view"] as Capability[],
    assignedClientIds: [] as string[],
  };
  assert.equal(
    hasCapability(previous.capabilities, "permissions.manage"),
    true,
  );
  assert.equal(hasCapability(next.capabilities, "permissions.manage"), false);
  assert.equal(canAccessClient(next, assignedAccountId), false);
  assert.notEqual(previous.organizationId, next.organizationId);
});
