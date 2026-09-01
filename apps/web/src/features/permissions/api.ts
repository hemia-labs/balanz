import { apiClient } from "@/lib/api-client";

export interface RoleCatalogItem {
  key: "admin" | "accountant" | "collaborator";
  name: string;
  description: string;
  defaultPermissions: string[];
}

export interface MembershipItem {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  role: RoleCatalogItem["key"];
  status: string;
}

export interface MembershipAuthorization {
  organizationId: string;
  membershipId: string;
  role: RoleCatalogItem["key"];
  permissions: Array<{
    key: string;
    name: string;
    status: string;
    sensitive: boolean;
    roleDefault: boolean;
    override: "grant" | "deny" | null;
    effective: boolean;
  }>;
}

export const getRoles = () => apiClient<RoleCatalogItem[]>("/roles");
export const getMemberships = (organizationId: string) =>
  apiClient<MembershipItem[]>(`/organizations/${organizationId}/memberships`);
export const getMembershipAuthorization = (
  organizationId: string,
  membershipId: string,
) =>
  apiClient<MembershipAuthorization>(
    `/organizations/${organizationId}/memberships/${membershipId}/permissions`,
  );
export const setMembershipPermission = (
  organizationId: string,
  membershipId: string,
  permission: string,
  effect: "grant" | "deny",
) =>
  apiClient<MembershipAuthorization>(
    `/organizations/${organizationId}/memberships/${membershipId}/permissions`,
    {
      method: "POST",
      body: JSON.stringify({ permission, effect }),
    },
  );
export const revokeMembershipPermission = (
  organizationId: string,
  membershipId: string,
  permission: string,
) =>
  apiClient<void>(
    `/organizations/${organizationId}/memberships/${membershipId}/permissions/${encodeURIComponent(permission)}`,
    { method: "DELETE" },
  );
export const changeMembershipRole = (
  organizationId: string,
  membershipId: string,
  role: RoleCatalogItem["key"],
) =>
  apiClient<MembershipAuthorization>(
    `/organizations/${organizationId}/memberships/${membershipId}/role`,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    },
  );
