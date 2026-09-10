import { test } from "node:test";
import assert from "node:assert/strict";
import { pollSat, canAuthorizeSat, satRecovery, satLabels } from "./sat-state";
test("only active execution polls, waiting SAT requires explicit authorization", () => {
  for (const s of ["submitting", "recovering", "processing_local"])
    assert.equal(pollSat(s), true);
  for (const s of [
    "waiting_sat",
    "requires_user_authorization",
    "external_submission_unknown",
    "completed_with_issues",
    "cancelled",
    "failed",
  ])
    assert.equal(pollSat(s), false);
});
test("new authorization continues waiting process but cannot replay uncertain submission", () => {
  for (const s of [
    "authorization_pending",
    "waiting_sat",
    "requires_user_authorization",
  ])
    assert.equal(canAuthorizeSat(s), true);
  for (const s of [
    "submitting",
    "external_submission_unknown",
    "completed",
    "cancelled",
  ])
    assert.equal(canAuthorizeSat(s), false);
});
test("browser recovery accepts only durable UUID, never credentials or keys", () => {
  assert.equal(
    satRecovery(
      new URLSearchParams("satJob=00000000-0000-4000-8000-000000000001"),
    ),
    "00000000-0000-4000-8000-000000000001",
  );
  for (const s of [null, "https://storage/key", "password", ""])
    assert.equal(
      satRecovery(new URLSearchParams(s ? { satJob: s } : {})),
      null,
    );
});
test("wait and user action have different product messages", () => {
  assert.notEqual(satLabels.waiting_sat, satLabels.requires_user_authorization);
  assert.ok(satLabels.completed_with_issues);
});
