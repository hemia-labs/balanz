import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { AuthSessionStatus } from '../src/modules/sessions/entities/auth-session.entity';
import type { CachedSessionEntry } from '../src/modules/redis/session-cache.service';

describe('SessionsService Redis resolution', () => {
  it('resolves a cache hit after confirming it is active in PostgreSQL', async () => {
    const rawToken = 'raw-session-token';
    const entry: CachedSessionEntry = {
      version: 2,
      sessionId: 'session-1',
      userId: 'user-1',
      organizationId: 'org-1',
      membershipId: 'membership-1',
      status: 'active',
      mfaVerifiedAt: new Date().toISOString(),
      requiresMfa: false,
      mfaStatus: 'disabled',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastActivityAt: new Date().toISOString(),
      tenantActive: true,
      role: 'owner',
      permissions: ['organization.view'],
      assignedAccountIds: [],
    };
    const repository = {
      findOne: jest.fn(),
      existsBy: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const cache = {
      get: jest.fn().mockResolvedValue({ available: true, value: entry }),
      touch: jest.fn().mockResolvedValue(true),
      acquireActivityLock: jest
        .fn()
        .mockResolvedValue({ available: true, value: false }),
      set: jest.fn(),
      deleteSession: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string, fallback: unknown) => {
        if (key === 'cookies') {
          return {
            sessionName: 'balanz_session',
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
          };
        }
        return fallback;
      }),
      getOrThrow: jest.fn().mockReturnValue({
        sessionName: 'balanz_session',
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      }),
    } as unknown as ConfigService;
    const service = new SessionsService(
      repository as never,
      config,
      {} as never,
      {} as never,
      cache as never,
    );
    const request = {
      cookies: { balanz_session: rawToken },
    } as never;

    const resolved = await service.resolve(request);

    expect(resolved.cacheHit).toBe(true);
    expect(resolved.session.status).toBe(AuthSessionStatus.ACTIVE);
    expect(resolved.context.permissions).toEqual(['organization.view']);
    expect(repository.existsBy).toHaveBeenCalledWith({
      id: 'session-1',
      sessionTokenHash: createHash('sha256').update(rawToken).digest('hex'),
      status: AuthSessionStatus.ACTIVE,
    });
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('rejects and removes a cached session revoked in PostgreSQL', async () => {
    const rawToken = 'revoked-session-token';
    const entry: CachedSessionEntry = {
      version: 2,
      sessionId: 'session-1',
      userId: 'user-1',
      organizationId: 'org-1',
      membershipId: 'membership-1',
      status: 'active',
      mfaVerifiedAt: null,
      requiresMfa: false,
      mfaStatus: 'disabled',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastActivityAt: new Date().toISOString(),
      tenantActive: true,
      role: 'owner',
      permissions: ['organization.view'],
      assignedAccountIds: [],
    };
    const repository = {
      existsBy: jest.fn().mockResolvedValue(false),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    const cache = {
      get: jest.fn().mockResolvedValue({ available: true, value: entry }),
      touch: jest.fn(),
      deleteSession: jest.fn().mockResolvedValue(false),
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        sessionName: 'balanz_session',
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      }),
    } as unknown as ConfigService;
    const service = new SessionsService(
      repository as never,
      config,
      {} as never,
      {} as never,
      cache as never,
    );

    await expect(
      service.resolve({ cookies: { balanz_session: rawToken } } as never),
    ).rejects.toThrow('Invalid session');
    expect(cache.deleteSession).toHaveBeenCalledWith(
      'session-1',
      createHash('sha256').update(rawToken).digest('hex'),
    );
    expect(cache.touch).not.toHaveBeenCalled();
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('revokes the database session and removes its Redis keys', async () => {
    const session = {
      id: 'session-1',
      sessionTokenHash: 'hash-1',
      userId: 'user-1',
      organizationId: 'org-1',
      membershipId: 'membership-1',
    };
    const updateSession = jest.fn<
      Promise<{ affected: number }>,
      [
        { id: string; status: AuthSessionStatus },
        {
          status: AuthSessionStatus;
          revokedReason: string;
          revokedAt: Date;
        },
      ]
    >(() => Promise.resolve({ affected: 1 }));
    const repository = {
      findOne: jest.fn().mockResolvedValue(session),
      update: updateSession,
    };
    const cache = {
      deleteSession: jest.fn().mockResolvedValue(true),
    };
    const service = new SessionsService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      cache as never,
    );

    await service.revoke('session-1', 'user_logout');

    expect(updateSession).toHaveBeenCalledTimes(1);
    expect(updateSession.mock.calls[0]?.[0]).toEqual({
      id: 'session-1',
      status: AuthSessionStatus.ACTIVE,
    });
    const update = updateSession.mock.calls[0]?.[1];
    expect(update.status).toBe(AuthSessionStatus.REVOKED);
    expect(update.revokedReason).toBe('user_logout');
    expect(update.revokedAt).toBeInstanceOf(Date);
    expect(cache.deleteSession).toHaveBeenCalledWith(
      'session-1',
      'hash-1',
      true,
    );
  });

  it('uses the persisted hash as the only Redis key after rotation', async () => {
    const session = {
      id: 'session-1',
      sessionTokenHash: 'new-persisted-hash',
      userId: 'user-1',
      organizationId: null,
      membershipId: null,
      status: AuthSessionStatus.ACTIVE,
      mfaVerifiedAt: new Date(),
      requiresMfa: true,
      expiresAt: new Date(Date.now() + 60_000),
      lastActivityAt: new Date(),
    };
    const context = {
      userId: 'user-1',
      sessionId: 'session-1',
      organizationId: null,
      membershipId: null,
      role: null,
      permissions: [],
      assignedAccountIds: [],
      mfaVerifiedAt: session.mfaVerifiedAt,
      requiresMfa: true,
      mfaStatus: 'active',
      expiresAt: session.expiresAt,
      tenantActive: false,
    };
    const cache = {
      deleteSession: jest.fn().mockResolvedValue(true),
      set: jest.fn().mockResolvedValue(true),
    };
    const service = new SessionsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cache as never,
    );

    await service.cacheRotated(
      session as never,
      'previous-persisted-hash',
      context as never,
    );

    expect(cache.deleteSession).toHaveBeenCalledWith(
      'session-1',
      'previous-persisted-hash',
    );
    expect(cache.set).toHaveBeenCalledWith(
      'new-persisted-hash',
      expect.objectContaining({ sessionId: 'session-1' }),
    );
  });

  it('revokes user sessions in PostgreSQL and deletes their Redis keys', async () => {
    const sessions = [
      { id: 'session-1', sessionTokenHash: 'hash-1' },
      { id: 'session-2', sessionTokenHash: 'hash-2' },
    ];
    const updateSessions = jest.fn<
      Promise<{ affected: number }>,
      [
        { userId: string; status: AuthSessionStatus },
        {
          status: AuthSessionStatus;
          revokedReason: string;
          revokedAt: Date;
        },
      ]
    >(() => Promise.resolve({ affected: 2 }));
    const repository = {
      find: jest.fn().mockResolvedValue(sessions),
      update: updateSessions,
    };
    const cache = {
      deleteSession: jest.fn().mockResolvedValue(true),
    };
    const service = new SessionsService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      cache as never,
    );

    await service.revokeUserSessions('user-1', 'user_deleted');

    expect(repository.find).toHaveBeenCalledWith({
      select: { id: true, sessionTokenHash: true },
      where: { userId: 'user-1', status: AuthSessionStatus.ACTIVE },
    });
    expect(updateSessions).toHaveBeenCalledTimes(1);
    expect(updateSessions.mock.calls[0]?.[0]).toEqual({
      userId: 'user-1',
      status: AuthSessionStatus.ACTIVE,
    });
    expect(cache.deleteSession).toHaveBeenCalledWith('session-1', 'hash-1');
    expect(cache.deleteSession).toHaveBeenCalledWith('session-2', 'hash-2');
  });
});
