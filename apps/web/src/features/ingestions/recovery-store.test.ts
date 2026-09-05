import assert from "node:assert/strict";
import test from "node:test";
import {
  clearIngestionRecovery,
  readIngestionRecovery,
  saveIngestionRecovery,
} from "./recovery-store";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const scope = {
  organizationId: "org-a",
  clientAccountId: "account-a",
  legalEntityId: "entity-a",
};

test("persiste sólo referencias técnicas recuperables del proceso", () => {
  const storage = memoryStorage();
  saveIngestionRecovery(
    scope,
    {
      uploadId: "upload-a",
      objectId: "object-a",
      jobId: "job-a",
      status: "queued",
      links: { ingestion: "/api/v1/ingestions/job-a" },
      correlationId: "correlation-a",
    },
    storage,
  );
  const recovered = readIngestionRecovery(scope, storage);
  assert.equal(recovered?.jobId, "job-a");
  const serialized = [...storage.values.values()][0];
  assert.equal(serialized.includes("filename"), false);
  assert.equal(serialized.includes("idempotency"), false);
  assert.equal(serialized.includes("accessUrl"), false);
});

test("descarta recuperación al cambiar tenant o scope fiscal", () => {
  const storage = memoryStorage();
  saveIngestionRecovery(
    scope,
    {
      uploadId: "upload-a",
      objectId: "object-a",
      jobId: "job-a",
      status: "queued",
      links: {},
      correlationId: "correlation-a",
    },
    storage,
  );
  assert.equal(
    readIngestionRecovery({ ...scope, organizationId: "org-b" }, storage),
    null,
  );
  assert.equal(storage.values.size, 0);
  clearIngestionRecovery(storage);
});
