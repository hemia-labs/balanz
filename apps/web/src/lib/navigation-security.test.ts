import assert from "node:assert/strict";
import test from "node:test";
import { safeInternalReturnTo } from "./navigation-security";

test("acepta sólo returnTo interno", () => {
  assert.equal(safeInternalReturnTo("/es/dashboard"), "/es/dashboard");
  assert.equal(safeInternalReturnTo("https://example.com"), null);
  assert.equal(safeInternalReturnTo("//example.com"), null);
});

