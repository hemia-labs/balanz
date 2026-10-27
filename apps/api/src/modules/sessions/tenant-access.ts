export interface TenantAccessState {
  userActive: boolean;
  organizationActive: boolean;
  membershipActive: boolean;
  sessionActive: boolean;
  mfaVerified: boolean;
}

export function isTenantActive(state: TenantAccessState): boolean {
  return Object.values(state).every(Boolean);
}
