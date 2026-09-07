import { apiClient } from "@/lib/api-client";

export type TeamRole = "admin" | "accountant" | "collaborator";
export type MembershipStatus = "pending" | "active" | "suspended" | "revoked";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";
export type InvitationDeliveryStatus = "pending" | "sent" | "failed";

export interface TeamMember {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  role: TeamRole;
  status: MembershipStatus;
  mfaConfigured: boolean;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
}

export interface InvitationItem {
  id: string;
  email: string;
  role: TeamRole;
  proposedPermissions: string[];
  status: InvitationStatus;
  expiresAt: string;
  lastSentAt: string;
  sendCount: number;
  deliveryStatus: InvitationDeliveryStatus;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface InvitationPage {
  items: InvitationItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface InvitationPageQuery {
  page: number;
  limit: number;
  signal?: AbortSignal;
}

export interface CreateInvitationInput {
  email: string;
  role: TeamRole;
  expiresAt: string;
}

export interface AcceptInvitationInput {
  token: string;
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
}

export interface AcceptInvitationResult {
  invitationId: string;
  membershipId: string;
  membershipStatus: MembershipStatus;
  nextStep: "verify_email" | "ready";
}

export const getTeamMembers = (organizationId: string, signal?: AbortSignal) =>
  apiClient<TeamMember[]>(`/organizations/${organizationId}/memberships`, {
    signal,
  });

export const getInvitations = (
  organizationId: string,
  { page, limit, signal }: InvitationPageQuery,
) => {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  return apiClient<InvitationPage>(
    `/organizations/${encodeURIComponent(organizationId)}/invitations?${query}`,
    { signal },
  );
};

export const createInvitation = (
  organizationId: string,
  input: CreateInvitationInput,
) =>
  apiClient<InvitationItem>(`/organizations/${organizationId}/invitations`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const revokeInvitation = (invitationId: string) =>
  apiClient<void>(`/invitations/${invitationId}/revoke`, { method: "POST" });

export const resendInvitation = (invitationId: string) =>
  apiClient<InvitationItem>(`/invitations/${invitationId}/resend`, {
    method: "POST",
  });

export const suspendMembership = (membershipId: string) =>
  apiClient<void>(`/memberships/${membershipId}/suspend`, { method: "PATCH" });

export const reactivateMembership = (membershipId: string) =>
  apiClient<void>(`/memberships/${membershipId}/reactivate`, {
    method: "PATCH",
  });

export const revokeMembership = (membershipId: string) =>
  apiClient<void>(`/memberships/${membershipId}/revoke`, { method: "POST" });

export const acceptInvitation = (
  invitationId: string,
  input: AcceptInvitationInput,
  signal?: AbortSignal,
) =>
  apiClient<AcceptInvitationResult>(`/invitations/${invitationId}/accept`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
