import assert from "node:assert/strict";
import test from "node:test";
import {
  ingestionProgress,
  isTerminalIngestionStatus,
  retryAfterMilliseconds,
} from "./polling";

test("distingue estados terminales del job durable", () => {
  assert.equal(isTerminalIngestionStatus("completed"), true);
  assert.equal(isTerminalIngestionStatus("completed_with_issues"), true);
  assert.equal(isTerminalIngestionStatus("failed_final"), true);
  assert.equal(isTerminalIngestionStatus("cancelled"), true);
  assert.equal(isTerminalIngestionStatus("processing"), false);
  assert.equal(isTerminalIngestionStatus("failed_retryable"), false);
});

test("respeta Retry-After en segundos o fecha y aplica límites", () => {
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  assert.equal(retryAfterMilliseconds("3", now), 3_000);
  assert.equal(
    retryAfterMilliseconds("Thu, 03 Sep 2026 12:00:05 GMT", now),
    5_000,
  );
  assert.equal(retryAfterMilliseconds("no-es-fecha", now), 2_000);
  assert.equal(retryAfterMilliseconds("120", now), 30_000);
});

test("deriva progreso técnico sin fingir avance de transferencia", () => {
  assert.equal(ingestionProgress("queued", null), 20);
  assert.equal(ingestionProgress("processing", "scanning"), 35);
  assert.equal(ingestionProgress("processing", "persisting"), 85);
  assert.equal(ingestionProgress("completed", null), 100);
});
