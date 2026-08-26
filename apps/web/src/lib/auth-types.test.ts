import assert from "node:assert/strict";
import test from "node:test";
import { slugifyOrganization } from "./auth-types";

test("deriva un slug ASCII estable para la organización", () => {
  assert.equal(slugifyOrganization("  Estudio Contable Norte, S.C. "), "estudio-contable-norte-s-c");
  assert.equal(slugifyOrganization("áéíóú"), "aeiou");
  assert.equal(slugifyOrganization("---"), "despacho");
});
