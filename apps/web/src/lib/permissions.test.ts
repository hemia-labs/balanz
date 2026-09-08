import assert from "node:assert/strict";
import test from "node:test";
import { canAccessAccountScope, labelBackendRole } from "./permissions";

test("traduce las claves de rol del backend", () => {
  assert.equal(labelBackendRole("owner"), "Titular");
  assert.equal(labelBackendRole("accountant"), "Contador responsable");
  assert.equal(labelBackendRole("collaborator"), "Colaborador");
  assert.equal(labelBackendRole("admin"), "Administrador de plataforma");
});

test("conserva las claves de rol desconocidas", () => {
  assert.equal(labelBackendRole("new-role"), "new-role");
});

test("aplica accountAccessMode sin inferir alcance por nombre de rol", () => {
  assert.equal(canAccessAccountScope("tenant", [], "account-b"), true);
  assert.equal(
    canAccessAccountScope("assigned", ["account-a"], "account-a"),
    true,
  );
  assert.equal(
    canAccessAccountScope("assigned", ["account-a"], "account-b"),
    false,
  );
});
