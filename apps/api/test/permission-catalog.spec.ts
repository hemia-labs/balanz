import {
  MFA_SENSITIVE_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  ROLE_PERMISSION_KEYS,
} from '../src/common/auth/permission-catalog';
import { RoleKey } from '../src/modules/permissions/entities/role.entity';

describe('client module permission defaults', () => {
  it('contains the fiscal permissions and marks entity mutation as MFA-sensitive', () => {
    expect(PERMISSION_CATALOG).toEqual(
      expect.arrayContaining([
        'fiscal_entities.view',
        'fiscal_entities.manage',
        'fiscal_years.view',
        'fiscal_years.manage',
      ]),
    );
    expect(MFA_SENSITIVE_PERMISSION_KEYS).toContain('clients.assign');
    expect(MFA_SENSITIVE_PERMISSION_KEYS).toContain('fiscal_entities.manage');
  });

  it('keeps client mutation owner-only while granting assigned read defaults', () => {
    expect(ROLE_PERMISSION_KEYS[RoleKey.OWNER]).toEqual(PERMISSION_CATALOG);
    for (const role of [RoleKey.ACCOUNTANT, RoleKey.COLLABORATOR] as const) {
      expect(ROLE_PERMISSION_KEYS[role]).toEqual(
        expect.arrayContaining([
          'clients.view',
          'fiscal_entities.view',
          'fiscal_years.view',
        ]),
      );
      expect(ROLE_PERMISSION_KEYS[role]).not.toEqual(
        expect.arrayContaining([
          'clients.manage',
          'clients.assign',
          'fiscal_entities.manage',
          'fiscal_years.manage',
        ]),
      );
    }
  });
});
