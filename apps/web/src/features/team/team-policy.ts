type MembershipStatus = "pending" | "active" | "suspended" | "revoked";

export type MemberAction = "suspend" | "reactivate" | "revoke";

export function availableMemberActions(input: {
  canManage: boolean;
  isOwner: boolean;
  isCurrentMembership: boolean;
  status: MembershipStatus;
}): MemberAction[] {
  if (
    !input.canManage ||
    input.isOwner ||
    input.isCurrentMembership ||
    input.status === "revoked"
  ) {
    return [];
  }
  if (input.status === "active") return ["suspend", "revoke"];
  if (input.status === "suspended") return ["reactivate", "revoke"];
  return ["revoke"];
}
