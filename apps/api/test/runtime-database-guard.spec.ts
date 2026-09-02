import type { DataSource } from 'typeorm';
import { RuntimeDatabaseGuard } from '../src/database/runtime-database-guard.service';

describe('RuntimeDatabaseGuard', () => {
  const safeRow = {
    current_user: 'balanz_api_login',
    session_user: 'balanz_api_login',
    rolsuper: false,
    rolbypassrls: false,
    rolcanlogin: true,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolinherit: false,
    expected_member: true,
    direct_membership_count: 1,
    expected_direct_admin_option: false,
    expected_direct_inherit_option: false,
    expected_direct_set_option: true,
    unexpected_role_count: 0,
    reachable_privileged_role: false,
    reachable_admin_option: false,
    owns_current_database: false,
    owns_fiscal_relation: false,
    direct_fiscal_acl: false,
    can_create_current_database: false,
    safe_search_path: true,
    unsafe_schema_create: false,
  };

  function successfulTransaction(expected: string) {
    return jest.fn(
      async (
        work: (manager: { query: jest.Mock }) => Promise<unknown>,
      ): Promise<unknown> => {
        return await work({
          query: jest
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ current_user: expected }])
            .mockResolvedValueOnce([]),
        });
      },
    );
  }

  function guard(row: object, principal: 'api' | 'worker' = 'api') {
    const expected = principal === 'api' ? 'balanz_api' : 'balanz_worker';
    const dataSource = {
      query: jest.fn().mockResolvedValue([row]),
      transaction: successfulTransaction(expected),
    } as unknown as DataSource;
    return new RuntimeDatabaseGuard(dataSource, principal);
  }

  it('accepts only a dedicated non-bypass login with exclusive membership', async () => {
    await expect(
      guard(safeRow).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  it('checks reachable database ownership and the fixed public schema', async () => {
    const query = jest.fn().mockResolvedValue([safeRow]);
    const dataSource = {
      query,
      transaction: successfulTransaction('balanz_api'),
    } as unknown as DataSource;
    await new RuntimeDatabaseGuard(dataSource, 'api').onApplicationBootstrap();

    const calls = query.mock.calls as unknown as Array<[unknown]>;
    const sql = String(calls[0]?.[0]);
    expect(sql).toContain('datdba IN (SELECT oid FROM reachable)');
    expect(sql).toContain("namespace.nspname = 'public'");
    expect(sql).toContain("current_schemas(false) = ARRAY['public']::name[]");
    expect(sql).toContain(
      "has_schema_privilege(session_user, namespace.oid, 'CREATE')",
    );
    expect(sql).toContain('membership.admin_option');
    expect(sql).toContain('aclexplode');
    expect(sql).toContain('direct_fiscal_acl');
    expect(sql).toContain('attribute.attacl');
    expect(sql).toContain('has_database_privilege');
  });

  it.each([
    ['superuser', { rolsuper: true }],
    ['BYPASSRLS', { rolbypassrls: true }],
    ['CREATEDB', { rolcreatedb: true }],
    ['CREATEROLE', { rolcreaterole: true }],
    ['REPLICATION', { rolreplication: true }],
    ['INHERIT login', { rolinherit: true }],
    ['NOLOGIN', { rolcanlogin: false }],
    ['wrong membership', { expected_member: false }],
    ['missing direct membership', { direct_membership_count: 0 }],
    ['multiple direct memberships', { direct_membership_count: 2 }],
    ['direct ADMIN OPTION', { expected_direct_admin_option: true }],
    ['direct INHERIT OPTION', { expected_direct_inherit_option: true }],
    ['missing SET OPTION', { expected_direct_set_option: false }],
    ['any additional role', { unexpected_role_count: 1 }],
    ['reachable privileged role', { reachable_privileged_role: true }],
    ['ADMIN OPTION membership', { reachable_admin_option: true }],
    ['database ownership', { owns_current_database: true }],
    ['fiscal table ownership', { owns_fiscal_relation: true }],
    ['direct fiscal ACL', { direct_fiscal_acl: true }],
    ['CREATE on current database', { can_create_current_database: true }],
    ['unsafe search path', { safe_search_path: false }],
    ['CREATE on application schema', { unsafe_schema_create: true }],
    ['SET ROLE session', { current_user: 'balanz_api' }],
  ])('fails boot for %s', async (_case, override) => {
    await expect(
      guard({ ...safeRow, ...override }).onApplicationBootstrap(),
    ).rejects.toThrow('Unsafe api PostgreSQL runtime principal');
  });

  it('fails boot when the login cannot SET LOCAL ROLE to the runtime group', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([safeRow]),
      transaction: jest.fn().mockRejectedValue(new Error('permission denied')),
    } as unknown as DataSource;

    await expect(
      new RuntimeDatabaseGuard(dataSource, 'api').onApplicationBootstrap(),
    ).rejects.toThrow('Unsafe api PostgreSQL runtime principal');
  });
});
