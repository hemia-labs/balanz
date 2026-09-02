import { ConfigService } from '@nestjs/config';
import { SessionCacheService } from '../src/modules/redis/session-cache.service';
import type { CachedSessionEntry } from '../src/modules/redis/session-cache.service';

function makeEntry(): CachedSessionEntry {
  return {
    version: 5,
    sessionId: 'session-1',
    userId: 'user-1',
    organizationId: 'org-1',
    membershipId: 'membership-1',
    status: 'active',
    mfaVerifiedAt: new Date().toISOString(),
    reauthenticatedAt: new Date().toISOString(),
    requiresMfa: false,
    mfaStatus: 'disabled',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    lastActivityAt: new Date().toISOString(),
    persistedLastActivityAt: new Date().toISOString(),
    tenantActive: true,
    role: 'owner',
    permissions: ['organization.view'],
    accountAccessMode: 'tenant',
  };
}

describe('SessionCacheService', () => {
  it('stores only the hashed-token key and session context with the configured prefix', async () => {
    const set = jest.fn<Promise<'OK'>, [string, string, { EX: number }]>(() =>
      Promise.resolve('OK'),
    );
    const client = {
      isReady: true,
      set,
    };
    const config = {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'redis.keyPrefix' ? 'test:' : fallback,
      ),
    } as unknown as ConfigService;
    const service = new SessionCacheService(client as never, config);

    await expect(service.set('hash-1', makeEntry())).resolves.toBe(true);

    expect(set).toHaveBeenCalledTimes(1);
    const call = set.mock.calls[0];
    expect(call?.[0]).toBe('test:auth:session:token:hash-1');
    expect(call?.[1]).toContain('"sessionId":"session-1"');
    expect(call?.[1]).not.toContain('assignedAccountIds');
    expect(typeof call?.[2].EX).toBe('number');
  });

  it('invalidates the previous cache schema that contained assigned IDs', async () => {
    const legacyEntry = {
      ...makeEntry(),
      version: 3,
      assignedAccountIds: ['account-1'],
    };
    const client = {
      isReady: true,
      get: jest.fn().mockResolvedValue(JSON.stringify(legacyEntry)),
    };
    const config = {
      get: jest.fn().mockReturnValue('test:'),
    } as unknown as ConfigService;
    const service = new SessionCacheService(client as never, config);

    await expect(service.get('hash-1')).resolves.toEqual({
      available: true,
      value: null,
    });
  });

  it('reports Redis unavailable so callers can fall back to PostgreSQL', async () => {
    const client = {
      isReady: true,
      get: jest.fn().mockRejectedValue(new Error('connection refused')),
    };
    const config = {
      get: jest.fn().mockReturnValue('test:'),
    } as unknown as ConfigService;
    const service = new SessionCacheService(client as never, config);

    await expect(service.get('hash-1')).resolves.toEqual({
      available: false,
      value: null,
    });
  });

  it('deletes only the token key', async () => {
    const del = jest.fn<Promise<number>, [string[]]>(() => Promise.resolve(1));
    const client = {
      isReady: true,
      del,
    };
    const config = {
      get: jest.fn().mockReturnValue('test:'),
    } as unknown as ConfigService;
    const service = new SessionCacheService(client as never, config);

    await expect(service.deleteSession('session-1', 'hash-1')).resolves.toBe(
      true,
    );

    expect(del).toHaveBeenCalledWith(['test:auth:session:token:hash-1']);
  });

  it('removes legacy token aliases for the same session during logout', async () => {
    const del = jest.fn<Promise<number>, [string[]]>(() => Promise.resolve(1));
    const legacyEntry = makeEntry();
    const otherEntry = { ...makeEntry(), sessionId: 'session-2' };
    const mGet = jest.fn<Promise<Array<string | null>>, [string[]]>(() =>
      Promise.resolve([
        JSON.stringify(legacyEntry),
        JSON.stringify(otherEntry),
      ]),
    );
    async function* scanIterator() {
      await Promise.resolve();
      yield [
        'test:auth:session:token:legacy-raw-token',
        'test:auth:session:token:other-token',
      ];
    }
    const client = {
      isReady: true,
      del,
      mGet,
      scanIterator,
    };
    const config = {
      get: jest.fn().mockReturnValue('test:'),
    } as unknown as ConfigService;
    const service = new SessionCacheService(client as never, config);

    await expect(
      service.deleteSession('session-1', 'hash-1', true),
    ).resolves.toBe(true);

    expect(del).toHaveBeenNthCalledWith(1, ['test:auth:session:token:hash-1']);
    expect(del).toHaveBeenNthCalledWith(2, [
      'test:auth:session:token:legacy-raw-token',
    ]);
  });

  it('touches only an existing token key so logout cannot be undone', async () => {
    const set = jest.fn<
      Promise<null>,
      [string, string, { EX: number; XX: true }]
    >(() => Promise.resolve(null));
    const client = {
      isReady: true,
      set,
    };
    const config = {
      get: jest.fn().mockReturnValue('test:'),
    } as unknown as ConfigService;
    const service = new SessionCacheService(client as never, config);
    const entry = makeEntry();
    const lastActivityAt = entry.lastActivityAt;

    await expect(service.touch('hash-1', entry)).resolves.toBe(false);
    expect(set).toHaveBeenCalledTimes(1);
    const call = set.mock.calls[0];
    expect(call?.[0]).toBe('test:auth:session:token:hash-1');
    expect(typeof call?.[1]).toBe('string');
    expect(typeof call?.[2].EX).toBe('number');
    expect(call?.[2].XX).toBe(true);
    expect(entry.lastActivityAt).toBe(lastActivityAt);
  });
});
