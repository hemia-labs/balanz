import type { EntityManager } from 'typeorm';
import { assertNoExternalRoleState } from '../src/database/scripts/provision-fiscal-runtime-logins';

describe('runtime login provisioning policy', () => {
  const safeState = {
    expectedMemberships: 1,
    memberCount: 0,
    unexpectedGroupMembers: 0,
    ownsDatabase: false,
    ownsRelation: false,
    ownsProcedure: false,
    ownsType: false,
    ownsSchema: false,
    directPublicAcl: false,
    canCreateCurrentDatabase: false,
    unsafeSchemaCreate: false,
    unexpectedMemberships: 0,
  };

  function managerWith(state: typeof safeState): EntityManager {
    return {
      query: jest.fn().mockResolvedValue([state]),
    } as unknown as EntityManager;
  }

  it('accepts a login only when it is the sole expected-group member', async () => {
    const manager = managerWith(safeState);

    await expect(
      assertNoExternalRoleState(
        manager,
        'balanz_api_login',
        'balanz_api',
        true,
      ),
    ).resolves.toBeUndefined();

    const calls = (manager.query as jest.Mock).mock.calls as Array<
      [string, string[]]
    >;
    expect(calls[0]?.[0]).toContain('group_member.rolname <> $1');
    expect(calls[0]?.[1]).toEqual(['balanz_api_login', 'balanz_api']);
  });

  it('rejects any sibling member even when its membership is SET-only', async () => {
    const manager = managerWith({
      ...safeState,
      unexpectedGroupMembers: 1,
    });

    await expect(
      assertNoExternalRoleState(
        manager,
        'balanz_api_login',
        'balanz_api',
        true,
      ),
    ).rejects.toThrow('only member of that group');

    const calls = (manager.query as jest.Mock).mock.calls as Array<
      [string, string[]]
    >;
    const sql = calls[0]?.[0] ?? '';
    expect(sql).not.toMatch(
      /group_membership\.(?:admin_option|inherit_option|set_option)/,
    );
  });

  it.each([
    ['database', { ownsDatabase: true }],
    ['relation', { ownsRelation: true }],
    ['function', { ownsProcedure: true }],
    ['type', { ownsType: true }],
    ['schema', { ownsSchema: true }],
  ])(
    'rejects %s ownership by the login or expected group',
    async (_kind, override) => {
      const manager = managerWith({ ...safeState, ...override });

      await expect(
        assertNoExternalRoleState(
          manager,
          'balanz_api_login',
          'balanz_api',
          true,
        ),
      ).rejects.toThrow('must own no database or public schema objects');
    },
  );

  it('checks ownership for both the LOGIN and expected runtime group', async () => {
    const manager = managerWith(safeState);

    await assertNoExternalRoleState(
      manager,
      'balanz_api_login',
      'balanz_api',
      true,
    );

    const calls = (manager.query as jest.Mock).mock.calls as Array<
      [string, string[]]
    >;
    const sql = calls[0]?.[0] ?? '';
    expect(sql).toContain('owner.rolname IN ($1, $2)');
    expect(sql).toContain('procedure.proowner');
    expect(sql).toContain('type.typowner');
    expect(sql).toContain('namespace.nspowner');
  });
});
