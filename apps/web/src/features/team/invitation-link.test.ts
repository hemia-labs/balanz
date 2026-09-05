import assert from "node:assert/strict";
import test from "node:test";
import { readInvitationSecret } from "./invitation-link";

test("lee el secreto desde el fragmento del enlace de invitación", () => {
  assert.deepEqual(
    readInvitationSecret("#invitationId=invitation-1&token=secret-1"),
    { invitationId: "invitation-1", token: "secret-1" },
  );
});

test("rechaza enlaces de invitación incompletos", () => {
  assert.equal(readInvitationSecret("#invitationId=invitation-1"), null);
  assert.equal(readInvitationSecret("#token=secret-1"), null);
  assert.equal(readInvitationSecret(""), null);
});
