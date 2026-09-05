export type InvitationSecret = { invitationId: string; token: string };

export function readInvitationSecret(hash: string): InvitationSecret | null {
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const invitationId = params.get("invitationId")?.trim();
  const token = params.get("token")?.trim();
  return invitationId && token ? { invitationId, token } : null;
}
