import { test } from "node:test";
import assert from "node:assert/strict";
import { pollSat, canAuthorizeSat, satRecovery, satLabels, technicalRetryAction, type SatProcess } from "./sat-state";
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

test('technical retry follows server eligibility, backoff and exhausted budget', () => {
  const process = { status: 'requires_user_authorization', errorCode: 'SAT_TECHNICAL_FAILURE', technicalRetry: { eligible: true, allowed: false, availableAt: '2026-09-15T12:00:00Z', remainingAttempts: 2 } } as SatProcess;
  assert.equal(technicalRetryAction(process), 'waiting');
  assert.equal(technicalRetryAction({ ...process, technicalRetry: { ...process.technicalRetry!, allowed: true } }), 'ready');
  assert.equal(technicalRetryAction({ ...process, status: 'failed', technicalRetry: { eligible: false, allowed: false, availableAt: null, remainingAttempts: 0 } }), 'hidden');
  assert.equal(technicalRetryAction({ ...process, technicalRetry: undefined }), 'hidden');
});
