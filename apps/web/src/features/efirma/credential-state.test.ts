import { test } from "node:test";
import assert from "node:assert/strict";
import {
  credentialFileError,
  activeCustody,
  recoveryIds,
  type CustodyState,
} from "./credential-state";

test("credential files require the correct extension and at most 16 KiB", () => {
  assert.equal(
    credentialFileError({ name: "certificate.cer", size: 16384 }, ".cer"),
    null,
  );
  assert.equal(
    credentialFileError({ name: "private.key", size: 16000 }, ".key"),
    null,
  );
  for (const file of [
    undefined,
    { name: "certificate.zip", size: 10 },
    { name: "certificate.cer", size: 0 },
    { name: "certificate.cer", size: 16385 },
  ])
    assert.ok(credentialFileError(file, ".cer"));
});
test("expired and terminal custody require new authorization", () => {
  const state = {
    status: "ready",
    expiresAt: new Date(1000).toISOString(),
  } as CustodyState;
  assert.equal(activeCustody(state, 999), true);
  assert.equal(activeCustody(state, 1000), false);
  for (const status of [
    "consumed",
    "revoked",
    "expired",
    "requires_user_authorization",
  ])
    assert.equal(activeCustody({ ...state, status }, 500), false);
});
test("reload recovery accepts only durable UUID identifiers", () => {
  const entityId = "11111111-1111-4111-8111-111111111111";
  const custodyId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(
    recoveryIds(
      new URLSearchParams({
        entityId,
        custodyId,
        password: "never retain",
        grant: "never retain",
      }),
    ),
    { entityId, custodyId },
  );
  assert.deepEqual(
    recoveryIds(new URLSearchParams("entityId=secret&custodyId=invalid")),
    { entityId: null, custodyId: null },
  );
});
