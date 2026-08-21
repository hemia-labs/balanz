import { ConfigService } from '@nestjs/config';
import { SessionCacheService } from '../src/modules/redis/session-cache.service';
import type { CachedSessionEntry } from '../src/modules/redis/session-cache.service';

function makeEntry(): CachedSessionEntry {
  return {
    version: 1,
    sessionId: 'session-1',
    userId: 'user-1',
    organizationId: 'org-1',
    membershipId: 'membership-1',
    status: 'active',
    mfaVerifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    lastActivityAt: new Date().toISOString(),
    tenantActive: true,
    role: 'owner',
    permissions: ['organization.view'],
    assignedAccountIds: [],
  };
}

interface MultiMock {
  set: jest.Mock<MultiMock, [unknown, unknown, unknown?]>;
  sAdd: jest.Mock<MultiMock, [unknown, unknown]>;
  sRem: jest.Mock<MultiMock, [unknown, unknown]>;
  del: jest.Mock<MultiMock, [unknown]>;
  exec: jest.Mock<Promise<unknown[]>, []>;
}

function makeMulti(): MultiMock {
  const multi = {} as MultiMock;
  multi.set = jest.fn(() => multi);
  multi.sAdd = jest.fn(() => multi);
  multi.sRem = jest.fn(() => multi);
  multi.del = jest.fn(() => multi);
  multi.exec = jest.fn<Promise<unknown[]>, []>(() => Promise.resolve([]));
  return multi;
}

describe('SessionCacheService', () => {
  it('stores only the hashed-token key and session context with the configured prefix', async () => {
    const multi = makeMulti();
    const client = {
      isReady: true,
      multi: jest.fn(() => multi),
    };
    const config = {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'redis.keyPrefix' ? 'test:' : fallback,
      ),
    } as unknown as ConfigService;
    const service = new SessionCacheService(client as never, config);

    await expect(service.set('hash-1', makeEntry())).resolves.toBe(true);

    const tokenCall = multi.set.mock.calls.find(
      (call) => call[0] === 'test:auth:session:token:hash-1',
    );
    expect(tokenCall?.[1]).toEqual(
      expect.stringContaining('"sessionId":"session-1"'),
    );
    const options = tokenCall?.[2] as { EX?: unknown } | undefined;
    expect(typeof options?.EX).toBe('number');
    expect(multi.set).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('raw-token'),
      expect.anything(),
    );
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

  it('uses NX and the configured activity window for persistence throttling', async () => {
    const client = {
      isReady: true,
      set: jest.fn().mockResolvedValue('OK'),
    };
    const config = {
      get: jest.fn().mockReturnValue('test:'),
    } as unknown as ConfigService;
    const service = new SessionCacheService(client as never, config);

    await expect(
      service.acquireActivityLock('session-1', 300),
    ).resolves.toEqual({ available: true, value: true });
    expect(client.set).toHaveBeenCalledWith(
      'test:auth:session:activity:session-1',
      '1',
      { NX: true, EX: 300 },
    );
  });
});
