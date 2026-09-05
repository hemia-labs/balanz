import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ApiError } from "../../lib/api-client";
import {
  startIngestionJobPolling,
  type IngestionPollingState,
} from "./ingestion-job-poller";
import { normalizeIngestionJob, type IngestionItem } from "./types";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function advance(context: TestContext, ms: number) {
  context.mock.timers.tick(ms);
  await flush();
}
function response(status: "processing" | "completed") {
  return {
    job: normalizeIngestionJob({ id: "job", status }),
    notModified: false,
    etag: status,
    retryAfter: "2",
  };
}
const unchanged = {
  job: null,
  notModified: true,
  etag: "processing",
  retryAfter: "2",
};

for (const error of [
  new ApiError(0, "Red", "NETWORK_ERROR"),
  new ApiError(503, "Temporal"),
]) {
  test(`recupera un poll fallido (${error.status}) y alcanza el resultado terminal`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const states: IngestionPollingState[] = [];
    const etags: Array<string | null> = [];
    let requests = 0;
    const items = [{ id: "item", result: "incorporated" }] as IngestionItem[];
    const stop = startIngestionJobPolling({
      getJob: async ({ etag }) => {
        etags.push(etag);
        requests += 1;
        if (requests === 2) throw error;
        if (requests === 3) return unchanged;
        return response(requests === 1 ? "processing" : "completed");
      },
      getItems: async () => items,
      onChange: (state) => states.push(state),
    });
    context.after(stop);
    await flush();
    await advance(context, 2_000);
    assert.equal(states[states.length - 1].error, error);
    await advance(context, 2_000);
    assert.equal(states[states.length - 1].error, null);
    await advance(context, 2_000);
    assert.equal(states[states.length - 1].job?.status, "completed");
    assert.deepEqual(states[states.length - 1].items, items);
    assert.deepEqual(etags, [null, "processing", "processing", "processing"]);
    await advance(context, 60_000);
    assert.equal(requests, 4);
  });
}

test("recupera items terminales con backoff aunque el job responda 304", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  let itemRequests = 0;
  const states: IngestionPollingState[] = [];
  const stop = startIngestionJobPolling({
    getJob: async () => (++requests === 1 ? response("completed") : unchanged),
    getItems: async () => {
      if (++itemRequests < 3) throw new ApiError(503, "Temporal");
      return [{ id: "recovered" }] as IngestionItem[];
    },
    onChange: (state) => states.push(state),
  });
  context.after(stop);
  await flush();
  await advance(context, 2_000);
  await advance(context, 3_999);
  assert.equal(itemRequests, 2);
  await advance(context, 1);
  assert.equal(states[states.length - 1].error, null);
  assert.equal(states[states.length - 1].items[0].id, "recovered");
});

for (const status of [401, 403, 404]) {
  test(`detiene el seguimiento y descarta datos sin acceso (${status})`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let requests = 0;
    const states: IngestionPollingState[] = [];
    const stop = startIngestionJobPolling({
      getJob: async () => {
        if (++requests > 1) throw new ApiError(status, "Sin acceso");
        return response("processing");
      },
      getItems: async () => [],
      onChange: (state) => states.push(state),
    });
    context.after(stop);
    await flush();
    await advance(context, 2_000);
    await advance(context, 60_000);
    assert.equal(requests, 2);
    assert.equal(states[states.length - 1].job, null);
    assert.deepEqual(states[states.length - 1].items, []);
  });
}

test("limita la espera creciente a 30 segundos", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  const stop = startIngestionJobPolling({
    getJob: async () => {
      requests += 1;
      throw new ApiError(503, "Temporal");
    },
    getItems: async () => [],
    onChange() {},
  });
  context.after(stop);
  await flush();
  for (const delay of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    const before = requests;
    await advance(context, delay - 1);
    assert.equal(requests, before);
    await advance(context, 1);
    assert.equal(requests, before + 1);
  }
});

test("abandonar el scope aborta la consulta e ignora resultados tardíos", async () => {
  const states: IngestionPollingState[] = [];
  let finish!: (value: ReturnType<typeof response>) => void;
  let signal!: AbortSignal;
  const stop = startIngestionJobPolling({
    getJob: (options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    getItems: async () => {
      throw new Error("No debe consultar items obsoletos");
    },
    onChange: (state) => states.push(state),
  });
  stop();
  finish(response("completed"));
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(states.length, 1);
});
