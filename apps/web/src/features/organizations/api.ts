import { apiClient } from "@/lib/api-client";
import type { AuthorizationContext, OrganizationSummary, SessionContext } from "@/features/session/types";

export function getOrganizations(signal?: AbortSignal) {
  return apiClient<OrganizationSummary[]>("/me/organizations", { signal });
}

export function selectOrganization(organizationId: string, signal?: AbortSignal) {
  return apiClient<AuthorizationContext | SessionContext>("/auth/session/organization", { method: "PATCH", body: JSON.stringify({ organizationId }), signal });
}

