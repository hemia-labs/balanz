import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireSubmissionLock,
  releaseSubmissionLock,
} from "./submission-guard";

test("bloquea un segundo submit hasta que termina el primero", () => {
  const lock = { current: false };
  assert.equal(acquireSubmissionLock(lock), true);
  assert.equal(acquireSubmissionLock(lock), false);
  releaseSubmissionLock(lock);
  assert.equal(acquireSubmissionLock(lock), true);
});
