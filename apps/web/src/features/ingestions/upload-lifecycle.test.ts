import assert from "node:assert/strict";
import test from "node:test";
import { createUploadLifecycle } from "./upload-lifecycle";

test("invalida y aborta el upload al abandonar el scope fiscal", () => {
  const lifecycle = createUploadLifecycle();
  let aborts = 0;
  const request = lifecycle.begin({
    abort: () => {
      aborts += 1;
    },
  });

  assert.equal(lifecycle.isCurrent(request), true);
  lifecycle.invalidate();
  assert.equal(aborts, 1);
  assert.equal(lifecycle.isCurrent(request), false);
  const wouldPublish = lifecycle.isCurrent(request);
  assert.equal(wouldPublish, false);
});

test("un resultado tardío del tenant anterior no reemplaza el upload vigente", () => {
  const lifecycle = createUploadLifecycle();
  let oldAborts = 0;
  let currentAborts = 0;
  const oldRequest = lifecycle.begin({
    abort: () => {
      oldAborts += 1;
    },
  });
  const currentRequest = lifecycle.begin({
    abort: () => {
      currentAborts += 1;
    },
  });

  lifecycle.release(oldRequest);
  assert.equal(oldAborts, 1);
  assert.equal(lifecycle.isCurrent(oldRequest), false);
  assert.equal(lifecycle.isCurrent(currentRequest), true);

  lifecycle.abortCurrent();
  assert.equal(currentAborts, 1);
  assert.equal(lifecycle.isCurrent(currentRequest), true);
  lifecycle.release(currentRequest);
});
