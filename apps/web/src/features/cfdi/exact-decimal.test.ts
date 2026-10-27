import assert from "node:assert/strict";
import test from "node:test";
import { formatExactDecimal, formatExactMoney } from "./exact-decimal";

test("formatea importes exactos sin convertirlos a float", () => {
  assert.equal(formatExactDecimal("12345678901234567890.00100"), "12,345,678,901,234,567,890.00100");
  assert.equal(formatExactDecimal("-1000.50"), "-1,000.50");
  assert.equal(formatExactMoney("1000.00", "MXN"), "MXN 1,000.00");
});

test("no altera representaciones no decimales ni inventa valores", () => {
  assert.equal(formatExactDecimal("1e3"), "1e3");
  assert.equal(formatExactDecimal(null), "—");
});
