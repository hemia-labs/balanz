import assert from "node:assert/strict";
import test from "node:test";
import { availableMemberActions } from "./team-policy";

test("hides every administrative action without members.manage", () => {
  assert.deepEqual(
    availableMemberActions({
      canManage: false,
      isOwner: false,
      isCurrentMembership: false,
      status: "active",
    }),
    [],
  );
});

test("protects the owner and current membership", () => {
  assert.deepEqual(
    availableMemberActions({
      canManage: true,
      isOwner: true,
      isCurrentMembership: false,
      status: "active",
    }),
    [],
  );
  assert.deepEqual(
    availableMemberActions({
      canManage: true,
      isOwner: false,
      isCurrentMembership: true,
      status: "suspended",
    }),
    [],
  );
});

test("offers only transitions supported by the current status", () => {
  const base = {
    canManage: true,
    isOwner: false,
    isCurrentMembership: false,
  };
  assert.deepEqual(availableMemberActions({ ...base, status: "active" }), [
    "suspend",
    "revoke",
  ]);
  assert.deepEqual(availableMemberActions({ ...base, status: "suspended" }), [
    "reactivate",
    "revoke",
  ]);
  assert.deepEqual(availableMemberActions({ ...base, status: "pending" }), [
    "revoke",
  ]);
  assert.deepEqual(availableMemberActions({ ...base, status: "revoked" }), []);
});
