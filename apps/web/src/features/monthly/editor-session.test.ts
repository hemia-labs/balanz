import assert from "node:assert/strict";
import test from "node:test";
import { MonthlyEditorSession } from "./editor-session";
test("serializes autosaves using the latest server version", async () => {
  const editor = new MonthlyEditorSession("test-instance");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: number[] = [];
  const first = editor.enqueue(async (v) => {
    seen.push(v);
    await gate;
    return { version: v + 1 };
  });
  const second = editor.enqueue(async (v) => {
    seen.push(v);
    return { version: v + 1 };
  });
  await Promise.resolve();
  assert.deepEqual(seen, [0]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(seen, [0, 1]);
  assert.equal(editor.version, 2);
});
test("tenant exit discards a late response and queued draft", async () => {
  const editor = new MonthlyEditorSession("a");
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let secondCalls = 0;
  const first = editor.enqueue(async () => {
    await gate;
    return { version: 1 };
  });
  const firstCheck = assert.rejects(first, /EDITOR_CONTEXT_EXPIRED/);
  const second = editor.enqueue(async () => {
    secondCalls++;
    return { version: 2 };
  });
  const secondCheck = assert.rejects(second, /EDITOR_CONTEXT_EXPIRED/);
  await Promise.resolve();
  editor.invalidate();
  release();
  await Promise.all([firstCheck, secondCheck]);
  assert.equal(editor.version, 0);
  assert.equal(secondCalls, 0);
});
test("reading and heartbeat do not renew editorial activity", async () => {
  const editor = new MonthlyEditorSession("a");
  assert.equal(editor.shouldRenew(), false);
  editor.lastActivity = Date.now() - 91000;
  await editor.enqueue(async (version) => ({ version }), false);
  assert.equal(editor.shouldRenew(), false);
});
test("an unsuccessful request never advances confirmed version", async () => {
  const editor = new MonthlyEditorSession("a");
  await assert.rejects(
    editor.enqueue(async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(editor.version, 0);
  assert.equal(editor.pending, 0);
});
test("new browser instance starts with no draft and distinct authority", () => {
  const first = new MonthlyEditorSession("first"),
    second = new MonthlyEditorSession("second");
  first.version = 7;
  assert.equal(second.version, 0);
  assert.notEqual(first.instanceToken, second.instanceToken);
});
