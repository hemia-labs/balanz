import {
  PERMISSION_CATALOG,
  PERMISSION_KEY_PATTERN,
  ROLE_PERMISSION_KEYS,
  isPermissionKey,
  permissionDefinition,
} from '../src/common/auth/permission-catalog';
import { resolveEffectivePermission } from '../src/common/auth/authorization-contract';
import { PermissionEffect } from '../src/modules/permissions/entities/membership-permission.entity';
import { RoleKey } from '../src/modules/permissions/entities/role.entity';

describe('MVP permission contract', () => {
  const huPermissions = [
    'credentials.manage',
    'sat.download',
    'payroll.view',
    'cfdi.exclude',
    'exceptions.accept',
    'periods.close',
    'periods.reopen',
    'exports.generate',
    'support.authorize',
    'members.manage',
    'permissions.manage',
  ] as const;

  it('contains only stable atomic permission keys', () => {
    expect(new Set(PERMISSION_CATALOG).size).toBe(PERMISSION_CATALOG.length);
    for (const key of PERMISSION_CATALOG) {
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
      expect(isPermissionKey(key)).toBe(true);
    }
    for (const key of huPermissions) {
      expect(PERMISSION_CATALOG).toContain(key);
      expect(permissionDefinition(key)).toMatchObject({
        sensitive: true,
        requiresMfa: true,
        requiresReauthentication: true,
      });
    }
    expect(isPermissionKey('periods.close_client_1')).toBe(false);
    expect(isPermissionKey('close_period')).toBe(false);
    expect(isPermissionKey('*.*')).toBe(false);
  });

  it('defines defaults for exactly the three MVP roles', () => {
    expect(Object.keys(ROLE_PERMISSION_KEYS).sort()).toEqual(
      Object.values(RoleKey).sort(),
    );
    expect(ROLE_PERMISSION_KEYS[RoleKey.ADMIN]).toEqual(PERMISSION_CATALOG);
    for (const key of huPermissions) {
      expect(ROLE_PERMISSION_KEYS[RoleKey.COLLABORATOR]).not.toContain(key);
    }
  });

  it('applies deny, then grant, then the role default', () => {
    expect(
      resolveEffectivePermission({
        roleDefault: true,
        activeOverride: PermissionEffect.DENY,
      }),
    ).toBe(false);
    expect(
      resolveEffectivePermission({
        roleDefault: false,
        activeOverride: PermissionEffect.GRANT,
      }),
    ).toBe(true);
    expect(resolveEffectivePermission({ roleDefault: true })).toBe(true);
    expect(resolveEffectivePermission({ roleDefault: false })).toBe(false);
  });
});
