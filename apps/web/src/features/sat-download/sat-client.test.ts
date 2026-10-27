import { test } from "node:test";
import assert from "node:assert/strict";
import { submitSatAuthorization } from "./sat-client";
import { abortPendingApiRequests } from "../../lib/api-client";
const id = "00000000-0000-4000-8000-000000000001";
const material = () => {
  const f = new FormData();
  f.set("code", "123456");
  f.set("password", "synthetic");
  f.set("key", new File(["synthetic"], "fixture.key"));
  f.set("certificate", new File(["synthetic"], "fixture.cer"));
  return f;
};
const response = (data: object, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("fresh TOTP precedes contextual custody and 202; clears every sensitive field", async () => {
  const original = fetch,
    body = material();
  const paths: string[] = [];
  globalThis.fetch = async (url, init) => {
    paths.push(String(url));
    if (paths.length === 1) {
      assert.equal(JSON.parse(String(init?.body)).code, "123456");
      return response({ grant: "a".repeat(64) });
    }
    assert.equal((init?.body as FormData).get("grant"), "a".repeat(64));
    assert.equal(init?.cache, "no-store");
    assert.ok(new Headers(init?.headers).get("Idempotency-Key"));
    return response({ processId: id }, 202);
  };
  try {
    await submitSatAuthorization(id, body, new AbortController().signal);
    assert.ok(paths[0].endsWith(id + "/reauth-grants"));
    assert.ok(paths[1].endsWith(id + "/authorizations"));
    assert.equal(Array.from(body.keys()).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("unexpected 200 or another process fails and clears material", async () => {
  const original = fetch;
  try {
    for (const [status, processId] of [
      [200, id],
      [202, "other"],
    ] as const) {
      let calls = 0;
      globalThis.fetch = async () =>
        ++calls === 1
          ? response({ grant: "a".repeat(64) })
          : response({ processId }, status);
      const body = material();
      await assert.rejects(
        submitSatAuthorization(id, body, new AbortController().signal),
      );
      assert.equal(body.get("password"), null);
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("tenant/logout abort cancels the TOTP request and clears credentials", async () => {
  const original = fetch,
    body = material();
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      ),
    );
  try {
    const pending = submitSatAuthorization(
      id,
      body,
      new AbortController().signal,
    );
    abortPendingApiRequests();
    await assert.rejects(pending);
    assert.equal(body.get("key"), null);
    assert.equal(body.get("password"), null);
  } finally {
    globalThis.fetch = original;
  }
});
