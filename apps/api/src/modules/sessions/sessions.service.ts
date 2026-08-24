import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthSession, AuthSessionStatus } from './entities/auth-session.entity';
import { AuthorizationService } from './authorization.service';
import type {
  SessionCreationInput,
  ResolvedSession,
  SessionAuthorizationContext,
  SessionRotationResult,
  SessionTokenPair,
} from './session.types';
import { SessionCacheService } from '../redis/session-cache.service';
import type { CachedSessionEntry } from '../redis/session-cache.service';

interface CookieConfig {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  domain?: string;
  path: string;
  sessionName: string;
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(AuthSession)
    private readonly repository: Repository<AuthSession>,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly cache: SessionCacheService,
  ) {}

  async create(input: SessionCreationInput): Promise<SessionTokenPair> {
    const pair = await this.dataSource.transaction((manager) =>
      this.createForManager(manager, input),
    );
    const context = await this.authorization.resolve(pair.session);
    await this.cacheSession(pair.session, context);
    return pair;
  }

  async createForManager(
    manager: EntityManager,
    input: SessionCreationInput,
  ): Promise<SessionTokenPair> {
    const rawToken = randomBytes(32).toString('hex');
    const now = new Date();
    const session = await manager.getRepository(AuthSession).save(
      manager.getRepository(AuthSession).create({
        sessionTokenHash: this.hashToken(rawToken),
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        membershipId: input.membershipId ?? null,
        status: AuthSessionStatus.ACTIVE,
        mfaVerifiedAt: input.mfaVerifiedAt ?? null,
        requiresMfa: input.requiresMfa ?? false,
        expiresAt: new Date(now.getTime() + this.sessionTtlMs()),
        lastActivityAt: now,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        revokedReason: null,
        revokedAt: null,
      }),
    );

    return { session, rawToken };
  }

  async resolve(request: Request): Promise<ResolvedSession> {
    const rawToken = this.readCookie(request);
    if (!rawToken) throw new UnauthorizedException('Session required');

    const tokenHash = this.hashToken(rawToken);
    const cached = await this.cache.get(tokenHash);
    if (cached.available && cached.value) {
      const entry = cached.value;
      if (
        entry.status !== 'active' ||
        new Date(entry.expiresAt).getTime() <= Date.now()
      ) {
        await this.cache.deleteSession(entry.sessionId, tokenHash);
        if (
          entry.status === 'active' &&
          new Date(entry.expiresAt).getTime() <= Date.now()
        ) {
          await this.repository.update(
            { id: entry.sessionId, status: AuthSessionStatus.ACTIVE },
            { status: AuthSessionStatus.EXPIRED },
          );
        }
        throw new UnauthorizedException('Expired session');
      }

      const stillActive = await this.repository.existsBy({
        id: entry.sessionId,
        sessionTokenHash: tokenHash,
        status: AuthSessionStatus.ACTIVE,
      });
      if (!stillActive) {
        await this.cache.deleteSession(entry.sessionId, tokenHash);
        throw new UnauthorizedException('Invalid session');
      }

      const session = this.fromCache(entry, tokenHash);
      const touched = await this.cache.touch(tokenHash, entry);
      if (touched) {
        await this.persistActivityIfDue(session);
        return {
          session,
          context: this.contextFromCache(entry),
          tokenHash,
          cacheHit: true,
        };
      }
    }

    const session = await this.repository.findOne({
      where: { sessionTokenHash: tokenHash },
    });
    if (!session) throw new UnauthorizedException('Invalid session');

    if (
      session.status !== AuthSessionStatus.ACTIVE ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      if (session.status === AuthSessionStatus.ACTIVE) {
        await this.repository.update(session.id, {
          status: AuthSessionStatus.EXPIRED,
        });
      }
      throw new UnauthorizedException('Expired session');
    }

    const context = await this.authorization.resolve(session);
    await this.cacheSession(session, context);
    return { session, context, tokenHash, cacheHit: false };
  }

  async rotateForManager(
    manager: EntityManager,
    sessionId: string,
  ): Promise<SessionRotationResult> {
    const repository = manager.getRepository(AuthSession);
    const session = await repository.findOne({
      where: { id: sessionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!session || session.status !== AuthSessionStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid session');
    }

    const previousTokenHash = session.sessionTokenHash;
    const rawToken = randomBytes(32).toString('hex');
    session.sessionTokenHash = this.hashToken(rawToken);
    await repository.save(session);
    return { rawToken, previousTokenHash };
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    const session = await this.repository.findOne({ where: { id: sessionId } });
    await this.repository.update(
      { id: sessionId, status: AuthSessionStatus.ACTIVE },
      {
        status: AuthSessionStatus.REVOKED,
        revokedReason: reason.slice(0, 100),
        revokedAt: new Date(),
      },
    );
    await this.cache.deleteSession(sessionId, session?.sessionTokenHash, true);
  }

  async cacheSession(
    session: AuthSession,
    context: SessionAuthorizationContext,
  ): Promise<void> {
    await this.cache.set(
      session.sessionTokenHash,
      this.toCacheEntry(session, context),
    );
  }

  async cacheRotated(
    session: AuthSession,
    previousTokenHash: string,
    context: SessionAuthorizationContext,
  ): Promise<void> {
    await this.cache.deleteSession(session.id, previousTokenHash);
    await this.cacheSession(session, context);
  }

  async revokeOtherSessions(
    userId: string,
    exceptSessionId: string,
    reason: string,
  ): Promise<void> {
    await this.revokeSessionsByUser(userId, reason, exceptSessionId);
  }

  async revokeUserSessions(userId: string, reason: string): Promise<void> {
    await this.revokeSessionsByUser(userId, reason);
  }

  setCookie(response: Response, rawToken: string): void {
    const cookies = this.cookieConfig();
    response.cookie(cookies.sessionName, rawToken, {
      httpOnly: cookies.httpOnly,
      secure: cookies.secure,
      sameSite: cookies.sameSite,
      domain: cookies.domain,
      path: cookies.path,
      maxAge: this.sessionTtlMs(),
    });
  }

  clearCookie(response: Response): void {
    const cookies = this.cookieConfig();
    response.clearCookie(cookies.sessionName, {
      httpOnly: cookies.httpOnly,
      secure: cookies.secure,
      sameSite: cookies.sameSite,
      domain: cookies.domain,
      path: cookies.path,
    });
  }

  readCookie(request: Request): string | undefined {
    const cookies = (
      request as unknown as {
        cookies?: Record<string, unknown>;
      }
    ).cookies;
    const value = cookies?.[this.cookieConfig().sessionName];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sessionTtlMs(): number {
    return this.config.get<number>('auth.sessionTtlSeconds', 28_800) * 1_000;
  }

  private cookieConfig(): CookieConfig {
    return this.config.getOrThrow<CookieConfig>('cookies');
  }

  private toCacheEntry(
    session: AuthSession,
    context: SessionAuthorizationContext,
  ): CachedSessionEntry {
    return {
      version: 2,
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId ?? null,
      membershipId: session.membershipId ?? null,
      status: session.status,
      mfaVerifiedAt: session.mfaVerifiedAt?.toISOString() ?? null,
      requiresMfa: session.requiresMfa,
      mfaStatus: context.mfaStatus,
      expiresAt: session.expiresAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      tenantActive: context.tenantActive,
      role: context.role,
      permissions: context.permissions,
      assignedAccountIds: context.assignedAccountIds,
    };
  }

  private fromCache(entry: CachedSessionEntry, tokenHash: string): AuthSession {
    return {
      id: entry.sessionId,
      sessionTokenHash: tokenHash,
      userId: entry.userId,
      organizationId: entry.organizationId,
      membershipId: entry.membershipId,
      status: entry.status,
      mfaVerifiedAt: entry.mfaVerifiedAt ? new Date(entry.mfaVerifiedAt) : null,
      requiresMfa: entry.requiresMfa,
      expiresAt: new Date(entry.expiresAt),
      lastActivityAt: new Date(entry.lastActivityAt),
    } as unknown as AuthSession;
  }

  private contextFromCache(
    entry: CachedSessionEntry,
  ): SessionAuthorizationContext {
    return {
      userId: entry.userId,
      sessionId: entry.sessionId,
      organizationId: entry.organizationId,
      membershipId: entry.membershipId,
      role: entry.role,
      permissions: entry.permissions,
      assignedAccountIds: entry.assignedAccountIds,
      mfaVerifiedAt: entry.mfaVerifiedAt ? new Date(entry.mfaVerifiedAt) : null,
      requiresMfa: entry.requiresMfa,
      mfaStatus: entry.mfaStatus,
      expiresAt: new Date(entry.expiresAt),
      tenantActive: entry.tenantActive,
    };
  }

  private async revokeSessionsByUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<void> {
    const where = {
      userId,
      status: AuthSessionStatus.ACTIVE,
      ...(exceptSessionId ? { id: Not(exceptSessionId) } : {}),
    };
    const sessions = await this.repository.find({
      select: { id: true, sessionTokenHash: true },
      where,
    });
    await this.repository.update(where, {
      status: AuthSessionStatus.REVOKED,
      revokedReason: reason.slice(0, 100),
      revokedAt: new Date(),
    });
    await Promise.all(
      sessions.map((session) =>
        this.cache.deleteSession(session.id, session.sessionTokenHash),
      ),
    );
  }

  private async persistActivityIfDue(session: AuthSession): Promise<void> {
    const interval = this.config.get<number>(
      'auth.sessionActivityPersistIntervalSeconds',
      300,
    );
    const lock = await this.cache.acquireActivityLock(session.id, interval);
    if (!lock.available || !lock.value) return;

    const now = new Date();
    const result = await this.repository.update(
      { id: session.id, status: AuthSessionStatus.ACTIVE },
      { lastActivityAt: now },
    );
    if (result.affected) session.lastActivityAt = now;
  }
}
