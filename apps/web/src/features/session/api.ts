import { apiClient } from "@/lib/api-client";
import type { AuthorizationContext, SessionContext } from "./types";

export function getSession(signal?: AbortSignal) {
  return apiClient<SessionContext>("/auth/session", { signal });
}

export function getAuthorization(signal?: AbortSignal) {
  return apiClient<AuthorizationContext>("/me/authorization", { signal });
}

