import type { AuthSession } from './entities/auth-session.entity';

export interface SessionCreationInput {
  userId: string;
  organizationId?: string | null;
  membershipId?: string | null;
  mfaVerifiedAt?: Date | null;
  reauthenticatedAt?: Date | null;
  requiresMfa?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SessionTokenPair {
  session: AuthSession;
  rawToken: string;
}

export interface SessionRotationResult {
  rawToken: string;
  previousTokenHash: string;
}

export interface ResolvedSession {
  session: AuthSession;
  context: SessionAuthorizationContext;
  tokenHash: string;
  cacheHit: boolean;
}

export interface SessionAuthorizationContext {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  membershipId: string | null;
  role: string | null;
  permissions: string[];
  assignedAccountIds: string[];
  accountAccessMode: 'tenant' | 'assigned';
  mfaVerifiedAt: Date | null;
  reauthenticatedAt: Date | null;
  requiresMfa: boolean;
  mfaStatus: 'disabled' | 'pending' | 'active';
  expiresAt: Date;
  tenantActive: boolean;
  reauthenticationRequiredActions: string[];
}
