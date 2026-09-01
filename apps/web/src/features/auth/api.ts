import { apiClient } from "@/lib/api-client";
import type {
  EmailVerificationResult,
  LoginPayload,
  LoginResponse,
  OnboardingResponse,
  RegisterPayload,
  RegisterResponse,
  SessionContext,
} from "@/features/session/types";

export type TotpSetupResponse = {
  factorId: string;
  secret: string;
  otpauthUri: string;
  status: "pending";
};

export function register(payload: RegisterPayload, signal?: AbortSignal) {
  return apiClient<RegisterResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export function login(payload: LoginPayload, signal?: AbortSignal) {
  return apiClient<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export function completeMfa(code: string, signal?: AbortSignal) {
  return apiClient<SessionContext>("/auth/login/mfa", {
    method: "POST",
    body: JSON.stringify({ code }),
    signal,
  });
}

export function reauthenticateSession(code: string, signal?: AbortSignal) {
  return apiClient<SessionContext>("/auth/session/reauthenticate", {
    method: "POST",
    body: JSON.stringify({ code }),
    signal,
  });
}

export function confirmEmail(token: string, signal?: AbortSignal) {
  return apiClient<EmailVerificationResult>(
    "/auth/email/verification/confirm",
    { method: "POST", body: JSON.stringify({ token }), signal },
  );
}

export function resendEmailVerification(email: string, signal?: AbortSignal) {
  return apiClient<void>("/auth/email/verification/resend", {
    method: "POST",
    body: JSON.stringify({ email }),
    signal,
  });
}

export function getOnboarding(signal?: AbortSignal) {
  return apiClient<OnboardingResponse>("/auth/onboarding", { signal });
}

export function setupTotp(signal?: AbortSignal) {
  return apiClient<TotpSetupResponse>("/auth/mfa/totp/setup", {
    method: "POST",
    body: "{}",
    signal,
  });
}

export function verifyTotp(code: string, signal?: AbortSignal) {
  return apiClient<SessionContext>("/auth/mfa/totp/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
    signal,
  });
}

export function disableTotp(
  password: string,
  code: string,
  signal?: AbortSignal,
) {
  return apiClient<SessionContext>("/auth/mfa/totp/disable", {
    method: "POST",
    body: JSON.stringify({ password, code }),
    signal,
  });
}

export function logout(signal?: AbortSignal) {
  return apiClient<void>("/auth/session", { method: "DELETE", signal });
}
