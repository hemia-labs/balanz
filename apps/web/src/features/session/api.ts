import { apiClient } from "@/lib/api-client";
import type { AuthorizationContext, SessionDetails } from "./types";

export function getSession(signal?: AbortSignal) {
  return apiClient<SessionDetails>("/auth/session", { signal });
}

export function getAuthorization(signal?: AbortSignal) {
  return apiClient<AuthorizationContext>("/me/authorization", { signal });
}
