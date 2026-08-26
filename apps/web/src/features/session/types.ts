export type SubscriptionType = "trial";

export type SessionState =
  | "checking"
  | "authenticated"
  | "unauthenticated"
  | "tenant_required"
  | "forbidden"
  | "error"
  | "switching_tenant";

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  organizationName: string;
  slug: string;
  subscriptionType: SubscriptionType;
}

export interface RegisterResponse {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: string;
  organizationStatus: string;
  membershipStatus: string;
  subscriptionType: SubscriptionType;
  subscriptionStatus: string;
  nextStep: string;
  mfaRequired: boolean;
  tenantActive: boolean;
}

export interface EmailVerificationResult {
  emailVerified: boolean;
  subscriptionType: SubscriptionType;
  trial: { status: string; startedAt?: string; endsAt?: string };
  nextStep: string;
  mfaStatus: string;
}

export interface OnboardingResponse {
  subscriptionType: SubscriptionType;
  trial: { status: string; startedAt?: string; endsAt?: string };
  nextStep: string;
  mfaStatus: string;
}

export interface SessionContext {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  membershipId: string | null;
  role: string | null;
  permissions: string[];
  assignedAccountIds: string[];
  mfaVerifiedAt: string | null;
  requiresMfa: boolean;
  mfaStatus: string;
  expiresAt: string;
  tenantActive: boolean;
}

export interface AuthorizationContext {
  organizationId: string;
  membershipId: string;
  role: string;
  permissions: string[];
  assignedAccountIds: string[];
  reauthenticationRequiredActions: string[];
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  membershipId: string;
  role: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResponse {
  requiresMfa: boolean;
  tenantActive: boolean;
  mfaStatus: string;
}

export function slugifyOrganization(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "despacho";
}

