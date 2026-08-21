import { ConfigService } from '@nestjs/config';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { AuthSessionStatus } from '../src/modules/sessions/entities/auth-session.entity';
import type { CachedSessionEntry } from '../src/modules/redis/session-cache.service';

describe('SessionsService Redis resolution', () => {
  it('resolves a valid cache hit without querying PostgreSQL', async () => {
    const rawToken = 'raw-session-token';
    const entry: CachedSessionEntry = {
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
    const repository = {
      findOne: jest.fn(),
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
    expect(repository.findOne).not.toHaveBeenCalled();
  });
});
