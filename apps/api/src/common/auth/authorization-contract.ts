import { PermissionEffect } from '../../modules/permissions/entities/membership-permission.entity';

export enum AuthorizationDecision {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
  MFA_REQUIRED = 'MFA_REQUIRED',
  REAUTHENTICATION_REQUIRED = 'REAUTHENTICATION_REQUIRED',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
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
