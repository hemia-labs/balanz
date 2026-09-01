import { PermissionEffect } from '../../modules/permissions/entities/membership-permission.entity';

export enum AuthorizationDecision {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
  MFA_REQUIRED = 'MFA_REQUIRED',
  REAUTHENTICATION_REQUIRED = 'REAUTHENTICATION_REQUIRED',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
}

export const REAUTHENTICATION_WINDOW_MS = 15 * 60 * 1000;

export function hasRecentReauthentication(
  verifiedAt: Date | null | undefined,
  now = Date.now(),
): boolean {
  return Boolean(
    verifiedAt &&
    verifiedAt.getTime() >= now - REAUTHENTICATION_WINDOW_MS &&
    verifiedAt.getTime() <= now,
  );
}

/** Resuelve únicamente precedencia. Las condiciones de seguridad se evalúan aparte. */
export function resolveEffectivePermission(input: {
  roleDefault: boolean;
  activeOverride?: PermissionEffect | null;
}): boolean {
  if (input.activeOverride === PermissionEffect.DENY) return false;
  if (input.activeOverride === PermissionEffect.GRANT) return true;
  return input.roleDefault;
}
