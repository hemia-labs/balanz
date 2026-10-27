import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Worker as NodeWorker } from "node:worker_threads";
import { resolve } from "node:path";
import type {} from "./zip-hash.worker";
import { hashZipFile } from "./zip-file-hash";
import { ApiError, apiErrorMessage } from "../../lib/api-client";
import {
  uploadZip as transportUploadZip,
  validateZipSelection,
  readZipIntent,
  ZIP_RECOVERY_KEY,
  ZIP_MAX_BYTES,
  confirmZipUpload,
} from "./zip-upload-transport";
import { clearIngestionRecovery } from "./recovery-store";
import { normalizeIngestionJob, normalizeIngestionItems } from "./types";
import { startIngestionJobPolling } from "./ingestion-job-poller";

function createHashWorker(): Worker {
  // Run the production worker in an actual separate Node thread, bridging only
  // the browser message API. The payload crosses structured clone as a Blob.
  const native = new NodeWorker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (value) => parentPort.postMessage(value);
    require(workerData);
    parentPort.on('message', (data) => self.onmessage({ data }));
  `,
    { eval: true, workerData: resolve(__dirname, "zip-hash.worker.js") },
  );
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: (value: unknown) => native.postMessage(value),
    terminate: () => {
      void native.terminate();
    },
  } as unknown as Worker;
  native.on("message", (data: unknown) =>
    worker.onmessage?.call(worker, { data } as MessageEvent),
  );
  native.on("error", () =>
    worker.onerror?.call(worker, { preventDefault() {} } as ErrorEvent),
  );
  return worker;
}
function uploadZip(
  options: Omit<Parameters<typeof transportUploadZip>[0], "createHashWorker">,
) {
  return transportUploadZip({ ...options, createHashWorker });
}

test("ZIP checksum runs in a separate worker, returns the exact SHA and never reads bytes on the caller thread", async () => {
  const file = new File(["abc"], "a.zip");
  file.arrayBuffer = () => {
    throw new Error("caller must not read bytes");
  };
  assert.equal(
    await hashZipFile(file, new AbortController().signal, createHashWorker),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("ZIP preparation cancellation terminates the worker before init", async () => {
  browser();
  let terminated = 0,
    requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("unexpected request");
  };
  const worker = {
    postMessage() {},
    terminate() {
      terminated++;
    },
  } as unknown as Worker;
  const transfer = transportUploadZip({
    scope,
    file: new File([new Uint8Array(30)], "a.zip"),
    createHashWorker: () => worker,
  });
  transfer.abort();
  await assert.rejects(transfer.promise, { code: "ABORTED" });
  assert.equal(terminated, 1);
  assert.equal(requests, 0);
});
test("ZIP hash worker errors are safe and terminate preparation", async () => {
  let terminated = 0;
  const worker = {
    postMessage() {
      queueMicrotask(() =>
        worker.onmessage?.call(worker, {
          data: { error: "sensitive internal data" },
        } as MessageEvent),
      );
    },
    terminate() {
      terminated++;
    },
  } as unknown as Worker;
  await assert.rejects(
    hashZipFile(
      new File(["abc"], "a.zip"),
      new AbortController().signal,
      () => worker,
    ),
    { code: "ZIP_HASH_FAILED" },
  );
  assert.equal(terminated, 1);
});
test("ZIP confirmation waits for the durable owner and recovers the same job", async () => {
  let calls = 0;
  globalThis.fetch = async () =>
    ++calls === 1
      ? response({ code: "UPLOAD_CONFIRM_IN_PROGRESS" }, 409)
      : response(accepted, 202);
  assert.equal((await confirmZipUpload(uploadId)).jobId, accepted.jobId);
  assert.equal(calls, 2);
});
test("ZIP confirmation wait is cancellable", async () => {
  const controller = new AbortController();
  globalThis.fetch = async () => {
    setTimeout(() => controller.abort(), 20);
    return response({ code: "UPLOAD_CONFIRM_IN_PROGRESS" }, 409);
  };
  await assert.rejects(confirmZipUpload(uploadId, controller.signal), {
    code: "ABORTED",
  });
});
for (const code of [
  "ZIP_EMPTY",
  "ZIP_CORRUPT",
  "ZIP_LIMIT_EXCEEDED",
  "ZIP_UNSAFE_ENTRY",
  "ZIP_ENCRYPTED",
  "ZIP_NESTED",
  "ZIP_ENTRY_UNSUPPORTED",
  "ZIP_CANCELLED",
  "UPLOAD_CONFIRM_IN_PROGRESS",
])
  test(`ZIP presents actionable Spanish instead of the raw ${code} code`, () => {
    const message = apiErrorMessage(new ApiError(422, code, code), "fallback");
    assert.notEqual(message, "fallback");
    assert.ok(!message.includes(code));
    assert.ok(message.length > 35);
  });

const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  clientAccountId: "22222222-2222-4222-8222-222222222222",
  legalEntityId: "33333333-3333-4333-8333-333333333333",
};
const uploadId = "44444444-4444-4444-8444-444444444444";
const accepted = {
  uploadId,
  objectId: "55555555-5555-4555-8555-555555555555",
  jobId: "66666666-6666-4666-8666-666666666666",
  correlationId: "77777777-7777-4777-8777-777777777777",
  status: "queued",
};
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalXhr = Object.getOwnPropertyDescriptor(
  globalThis,
  "XMLHttpRequest",
);
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalXhr)
    Object.defineProperty(globalThis, "XMLHttpRequest", originalXhr);
  else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
});
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}
function browser() {
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  return storage;
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
class Xhr extends EventTarget {
  upload = new EventTarget();
  status = 200;
  responseText = "";
  timeout = 0;
  withCredentials = false;
  url = "";
  headers: Record<string, string> = {};
  open(method: string, url: string) {
    assert.equal(method, "PUT");
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(file: File) {
    queueMicrotask(() => {
      const event = Object.assign(new Event("progress"), {
        loaded: file.size / 2,
        total: file.size,
        lengthComputable: true,
      });
      this.upload.dispatchEvent(event);
      this.dispatchEvent(new Event("load"));
    });
  }
  abort() {
    this.dispatchEvent(new Event("abort"));
  }
}
test("ZIP accepts one .zip up to exactly 50 MiB", () => {
  assert.equal(
    validateZipSelection([{ name: "fiscal.ZIP", size: ZIP_MAX_BYTES }]),
    null,
  );
});
test("ZIP rejects missing, multiple, extension, empty and oversized files", () => {
  for (const files of [
    [],
    [
      { name: "a.zip", size: 100 },
      { name: "b.zip", size: 100 },
    ],
    [{ name: "a.xml", size: 100 }],
    [{ name: "a.zip", size: 0 }],
    [{ name: "a.zip", size: ZIP_MAX_BYTES + 1 }],
  ])
    assert.ok(validateZipSelection(files));
});
test("ZIP rejects unsafe upload filenames", () => {
  for (const name of [
    "../x.zip",
    "C:x.zip",
    "/x.zip",
    "x\\x.zip",
    "a\u0000.zip",
  ])
    assert.ok(validateZipSelection([{ name, size: 100 }]));
});
test("ZIP executes init, actual PUT progress and confirm 202; stores only durable IDs", async () => {
  const storage = browser();
  const calls: string[] = [];
  let confirms = 0;
  let progress = 0;
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: Xhr,
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/init")) {
      const dto = JSON.parse(String(init?.body)) as {
        sha256: string;
        sizeBytes: number;
      };
      assert.match(dto.sha256, /^[0-9a-f]{64}$/);
      assert.equal(dto.sizeBytes, 30);
      return response(
        {
          uploadId,
          upload: {
            url: "https://storage.invalid/signed-secret",
            headers: { "content-type": "application/zip" },
            expiresAt: new Date().toISOString(),
          },
        },
        201,
      );
    }
    confirms++;
    return confirms === 1
      ? response({ code: "UPLOAD_NOT_CONFIRMABLE", message: "pending" }, 409)
      : response(accepted, 202);
  };
  const result = await uploadZip({
    scope,
    file: new File([new Uint8Array(30)], "a.zip"),
    onProgress: (value) => {
      progress = value.percent;
    },
  }).promise;
  assert.equal(result.jobId, accepted.jobId);
  assert.equal(progress, 50);
  assert.equal(confirms, 2);
  assert.equal(calls.length, 3);
  const stored = JSON.parse(storage.getItem(ZIP_RECOVERY_KEY)!) as Record<
    string,
    unknown
  >;
  assert.deepEqual(
    Object.keys(stored).sort(),
    [
      "organizationId",
      "clientAccountId",
      "legalEntityId",
      "intentId",
      "uploadId",
    ].sort(),
  );
  assert.ok(!JSON.stringify(stored).includes("signed-secret"));
});
test("ZIP recovers confirmation after reload without selecting or retransferring bytes", async () => {
  const storage = browser();
  storage.setItem(
    ZIP_RECOVERY_KEY,
    JSON.stringify({
      ...scope,
      intentId: "88888888-8888-4888-8888-888888888888",
      uploadId,
    }),
  );
  globalThis.fetch = async () => response(accepted, 202);
  const saved = readZipIntent(scope);
  assert.equal(saved?.uploadId, uploadId);
  assert.equal(
    (await confirmZipUpload(saved!.uploadId!)).jobId,
    accepted.jobId,
  );
});
test("ZIP restores same intent across browser restart and strips uncontracted metadata", () => {
  const storage = memoryStorage();
  storage.setItem(
    ZIP_RECOVERY_KEY,
    JSON.stringify({
      ...scope,
      intentId: "88888888-8888-4888-8888-888888888888",
      uploadId,
      url: "forbidden",
    }),
  );
  const saved = readZipIntent(scope, storage);
  assert.equal(saved?.uploadId, uploadId);
  assert.equal("url" in saved!, false);
});
test("tenant switch clears ZIP intent and accepted ingestion recovery", () => {
  const storage = memoryStorage();
  storage.setItem(
    ZIP_RECOVERY_KEY,
    JSON.stringify({
      ...scope,
      intentId: "88888888-8888-4888-8888-888888888888",
      uploadId,
    }),
  );
  assert.equal(
    readZipIntent({ ...scope, organizationId: "other" }, storage),
    null,
  );
  assert.equal(storage.getItem(ZIP_RECOVERY_KEY), null);
  storage.setItem(ZIP_RECOVERY_KEY, "anything");
  clearIngestionRecovery(storage);
  assert.equal(storage.getItem(ZIP_RECOVERY_KEY), null);
});
test("ZIP abort stops admission before upload and confirmation", async () => {
  browser();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response({});
  };
  const handle = uploadZip({
    scope,
    file: new File([new Uint8Array(30)], "a.zip"),
  });
  handle.abort();
  await assert.rejects(handle.promise);
  assert.equal(calls, 0);
});
test("ZIP cancellation aborts the active XHR", async () => {
  browser();
  let sent: () => void = () => {};
  const sending = new Promise<void>((resolve) => {
    sent = resolve;
  });
  class PendingXhr extends Xhr {
    override send() {
      sent();
    }
  }
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: PendingXhr,
  });
  globalThis.fetch = async (input) =>
    String(input).endsWith("/init")
      ? response(
          {
            uploadId,
            upload: { url: "https://storage.invalid/signed", headers: {} },
          },
          201,
        )
      : response({ code: "UPLOAD_NOT_CONFIRMABLE" }, 409);
  const handle = uploadZip({
    scope,
    file: new File([new Uint8Array(30)], "a.zip"),
  });
  const rejected = assert.rejects(handle.promise, /cancelada/);
  await sending;
  handle.abort();
  await rejected;
});
test("ZIP refuses a non-202 confirmation", async () => {
  globalThis.fetch = async () => response(accepted, 200);
  await assert.rejects(confirmZipUpload(uploadId), /no confirmó/);
});
test("ZIP displays durable partial counters and paginated ordinals without synthetic results", () => {
  const job = normalizeIngestionJob({
    id: accepted.jobId,
    source: "manual_zip",
    status: "completed_with_issues",
    stage: null,
    counters: {
      total: 30,
      incorporated: 1,
      duplicate: 1,
      invalid: 1,
      unsupported: 27,
    },
  });
  assert.equal(job.sourceType, "manual_zip");
  assert.equal(job.counters.total, 30);
  assert.equal(job.counters.unsupported, 27);
  const items = normalizeIngestionItems({
    items: [
      {
        id: "entry26",
        ordinal: 26,
        productResult: "unsupported",
        error: { code: "ZIP_ENTRY_UNSUPPORTED" },
      },
    ],
  });
  assert.equal(items[0].ordinal, 26);
  assert.equal(items[0].result, "unsupported");
});
test("ZIP terminal polling recovers items from the requested page", async () => {
  const job = normalizeIngestionJob({
    id: accepted.jobId,
    source: "manual_zip",
    status: "completed_with_issues",
    counters: { total: 30, unsupported: 30 },
  });
  let stop: () => void = () => {};
  await new Promise<void>((resolve, reject) => {
    stop = startIngestionJobPolling({
      getJob: () =>
        Promise.resolve({
          job,
          notModified: false,
          etag: "zip",
          retryAfter: null,
        }),
      getItems: () =>
        Promise.resolve(
          normalizeIngestionItems({
            items: [{ id: "26", ordinal: 26, result: "unsupported" }],
          }),
        ),
      onChange: (state) => {
        if (state.error) reject(state.error);
        if (state.items.length) {
          assert.equal(state.items[0].ordinal, 26);
          assert.equal(state.job?.status, "completed_with_issues");
          resolve();
        }
      },
    });
  });
  stop();
});
