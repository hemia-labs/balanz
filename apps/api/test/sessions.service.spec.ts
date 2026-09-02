import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { AuthSessionStatus } from '../src/modules/sessions/entities/auth-session.entity';
import type { CachedSessionEntry } from '../src/modules/redis/session-cache.service';

describe('SessionsService Redis resolution', () => {
  it('resolves a cache hit after confirming it is active in PostgreSQL', async () => {
    const rawToken = 'raw-session-token';
    const entry: CachedSessionEntry = {
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
      persistedLastActivityAt: new Date(Date.now() - 360_000).toISOString(),
      tenantActive: true,
      role: 'owner',
      permissions: ['organization.view'],
      accountAccessMode: 'tenant',
    };
    const repository = {
      findOne: jest.fn(),
      existsBy: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const cache = {
      get: jest.fn().mockResolvedValue({ available: true, value: entry }),
      touch: jest.fn().mockResolvedValue(true),
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
      {
        resolve: jest.fn().mockResolvedValue({
          userId: entry.userId,
          sessionId: entry.sessionId,
          organizationId: entry.organizationId,
          membershipId: entry.membershipId,
          role: 'admin',
          permissions: ['organization.view'],
          assignedAccountIds: [],
          accountAccessMode: 'assigned',
          mfaVerifiedAt: new Date(entry.mfaVerifiedAt!),
          reauthenticatedAt: new Date(entry.reauthenticatedAt!),
          requiresMfa: false,
          mfaStatus: 'active',
          expiresAt: new Date(entry.expiresAt),
          tenantActive: true,
          reauthenticationRequiredActions: [],
        }),
      } as never,
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
    expect(repository.update).toHaveBeenCalled();
    const activityUpdate = repository.update.mock.calls[0] as unknown as [
      { id: string; status: AuthSessionStatus },
      { lastActivityAt: unknown },
    ];
    expect(activityUpdate[0]).toEqual(
      expect.objectContaining({
        id: 'session-1',
        status: AuthSessionStatus.ACTIVE,
      }),
    );
    expect(activityUpdate[1].lastActivityAt).toBeInstanceOf(Date);
    expect(entry.persistedLastActivityAt).not.toEqual(
      new Date(Date.now() - 360_000).toISOString(),
    );
  });

  it('rejects and removes a cached session revoked in PostgreSQL', async () => {
    const rawToken = 'revoked-session-token';
    const entry: CachedSessionEntry = {
      version: 5,
      sessionId: 'session-1',
      userId: 'user-1',
      organizationId: 'org-1',
      membershipId: 'membership-1',
      status: 'active',
      mfaVerifiedAt: null,
      reauthenticatedAt: null,
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
      get: jest.fn((key: string, fallback: unknown) => fallback),
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

  it.each([
    {
      label: 'absolute expiry',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      lastActivityAt: new Date().toISOString(),
    },
    {
      label: 'idle expiry',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastActivityAt: new Date(Date.now() - 1_801_000).toISOString(),
    },
  ])('does not slide past $label', async ({ expiresAt, lastActivityAt }) => {
    const entry: CachedSessionEntry = {
      version: 5,
      sessionId: 'session-expired',
      userId: 'user-1',
      organizationId: 'org-1',
      membershipId: 'membership-1',
      status: 'active',
      mfaVerifiedAt: null,
      reauthenticatedAt: null,
      requiresMfa: false,
      mfaStatus: 'disabled',
      expiresAt,
      lastActivityAt,
      persistedLastActivityAt: lastActivityAt,
      tenantActive: true,
      role: 'owner',
      permissions: [],
      accountAccessMode: 'tenant',
    };
    const repository = {
      existsBy: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const cache = {
      get: jest.fn().mockResolvedValue({ available: true, value: entry }),
      deleteSession: jest.fn().mockResolvedValue(true),
      touch: jest.fn(),
    };
    const config = {
      get: jest.fn((_key: string, fallback: unknown) => fallback),
      getOrThrow: jest.fn().mockReturnValue({ sessionName: 'balanz_session' }),
    } as unknown as ConfigService;
    const service = new SessionsService(
      repository as never,
      config,
      {} as never,
      {} as never,
      cache as never,
    );

    await expect(
      service.resolve({
        cookies: { balanz_session: 'expired-token' },
      } as never),
    ).rejects.toThrow('Expired session');
    expect(repository.existsBy).not.toHaveBeenCalled();
    expect(cache.touch).not.toHaveBeenCalled();
    expect(cache.deleteSession).toHaveBeenCalled();
  });

  it('allows bounded idle grace when recovering activity from PostgreSQL', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
    try {
      const rawToken = 'database-fallback-token';
      const session = {
        id: 'session-fallback',
        sessionTokenHash: createHash('sha256').update(rawToken).digest('hex'),
        userId: 'user-1',
        organizationId: 'org-1',
        membershipId: 'membership-1',
        status: AuthSessionStatus.ACTIVE,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
        requiresMfa: false,
        expiresAt: new Date('2026-08-26T14:00:00.000Z'),
        // The durable value is 120 seconds beyond the idle TTL, still inside
        // the 300-second maximum lag allowed for Redis activity persistence.
        lastActivityAt: new Date('2026-08-26T11:28:00.000Z'),
      };
      const context = {
        userId: 'user-1',
        sessionId: 'session-fallback',
        organizationId: 'org-1',
        membershipId: 'membership-1',
        role: 'accountant',
        permissions: ['clients.view'],
        assignedAccountIds: [],
        accountAccessMode: 'assigned',
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
        requiresMfa: false,
        mfaStatus: 'disabled',
        expiresAt: session.expiresAt,
        tenantActive: true,
      };
      const repository = {
        findOne: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const authorization = {
        resolve: jest.fn().mockResolvedValue(context),
      };
      const cache = {
        get: jest.fn().mockResolvedValue({ available: false, value: null }),
        set: jest.fn().mockResolvedValue(false),
      };
      const config = {
        get: jest.fn((key: string, fallback: unknown) => {
          if (key === 'auth.sessionIdleTtlSeconds') return 1_800;
          if (key === 'auth.sessionActivityPersistIntervalSeconds') return 300;
          return fallback;
        }),
        getOrThrow: jest.fn().mockReturnValue({
          sessionName: 'balanz_session',
        }),
      } as unknown as ConfigService;
      const service = new SessionsService(
        repository as never,
        config,
        {} as never,
        authorization as never,
        cache as never,
      );

      const result = await service.resolve({
        cookies: { balanz_session: rawToken },
      } as never);

      expect(result.cacheHit).toBe(false);
      expect(result.context.assignedAccountIds).toEqual([]);
      expect(repository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'session-fallback',
          status: AuthSessionStatus.ACTIVE,
        }),
        { lastActivityAt: new Date('2026-08-26T12:00:00.000Z') },
      );
      expect(session.lastActivityAt).toEqual(
        new Date('2026-08-26T12:00:00.000Z'),
      );
      expect(cache.set).toHaveBeenCalledWith(
        session.sessionTokenHash,
        expect.objectContaining({ version: 5 }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('expires a database session outside the bounded recovery grace', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
    try {
      const rawToken = 'expired-database-token';
      const session = {
        id: 'session-expired-db',
        sessionTokenHash: createHash('sha256').update(rawToken).digest('hex'),
        status: AuthSessionStatus.ACTIVE,
        expiresAt: new Date('2026-08-26T14:00:00.000Z'),
        lastActivityAt: new Date('2026-08-26T11:24:59.000Z'),
      };
      const repository = {
        findOne: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const authorization = { resolve: jest.fn() };
      const cache = {
        get: jest.fn().mockResolvedValue({ available: true, value: null }),
        set: jest.fn(),
      };
      const config = {
        get: jest.fn((key: string, fallback: unknown) => {
          if (key === 'auth.sessionIdleTtlSeconds') return 1_800;
          if (key === 'auth.sessionActivityPersistIntervalSeconds') return 300;
          return fallback;
        }),
        getOrThrow: jest.fn().mockReturnValue({
          sessionName: 'balanz_session',
        }),
      } as unknown as ConfigService;
      const service = new SessionsService(
        repository as never,
        config,
        {} as never,
        authorization as never,
        cache as never,
      );

      await expect(
        service.resolve({
          cookies: { balanz_session: rawToken },
        } as never),
      ).rejects.toThrow('Expired session');
      expect(repository.update).toHaveBeenCalledWith('session-expired-db', {
        status: AuthSessionStatus.EXPIRED,
      });
      expect(authorization.resolve).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
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
      reauthenticatedAt: new Date(),
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
      accountAccessMode: 'assigned',
      mfaVerifiedAt: session.mfaVerifiedAt,
      reauthenticatedAt: session.reauthenticatedAt,
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

  it('revokes only sessions for the affected tenant membership', async () => {
    const sessions = [
      { id: 'session-a', sessionTokenHash: 'hash-a' },
      { id: 'session-b', sessionTokenHash: 'hash-b' },
    ];
    const updateSessions = jest.fn().mockResolvedValue({ affected: 1 });
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

    await service.revokeMembershipSessions(
      'organization-a',
      'membership-a',
      'membership_revoked',
    );

    expect(repository.find).toHaveBeenCalledWith({
      select: { id: true, sessionTokenHash: true },
      where: {
        organizationId: 'organization-a',
        membershipId: 'membership-a',
        status: AuthSessionStatus.ACTIVE,
      },
    });
    expect(updateSessions).toHaveBeenCalledWith(
      {
        organizationId: 'organization-a',
        membershipId: 'membership-a',
        status: AuthSessionStatus.ACTIVE,
      },
      expect.objectContaining({
        status: AuthSessionStatus.REVOKED,
        revokedReason: 'membership_revoked',
      }),
    );
    expect(cache.deleteSession).toHaveBeenCalledWith('session-a', 'hash-a');
    expect(cache.deleteSession).toHaveBeenCalledWith('session-b', 'hash-b');
  });
});
