import assert from "node:assert/strict";
import test from "node:test";
import { labelBackendRole } from "./permissions";

test("traduce las claves de rol del backend", () => {
  assert.equal(labelBackendRole("owner"), "Titular");
  assert.equal(labelBackendRole("accountant"), "Contador responsable");
  assert.equal(labelBackendRole("collaborator"), "Colaborador");
  assert.equal(labelBackendRole("admin"), "Administrador de plataforma");
});

test("conserva las claves de rol desconocidas", () => {
  assert.equal(labelBackendRole("new-role"), "new-role");
});
