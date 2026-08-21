import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisClient } from './redis.module';
import { REDIS_CLIENT } from './redis.tokens';

export interface CachedSessionEntry {
  version: 1;
  sessionId: string;
  userId: string;
  organizationId: string | null;
  membershipId: string | null;
  status: 'active' | 'expired' | 'revoked';
  mfaVerifiedAt: string | null;
  expiresAt: string;
  lastActivityAt: string;
  tenantActive: boolean;
  role: string | null;
  permissions: string[];
  assignedAccountIds: string[];
}

export interface CacheLookup<T> {
  available: boolean;
  value: T | null;
}

@Injectable()
export class SessionCacheService {
  private readonly logger = new Logger(SessionCacheService.name);
  private unavailableUntil = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: RedisClient | null,
    private readonly config: ConfigService,
  ) {}

  async get(tokenHash: string): Promise<CacheLookup<CachedSessionEntry>> {
    if (!this.canUse()) {
      this.logger.debug('session_cache.fallback_db');
      return { available: false, value: null };
    }

    try {
      const value = await this.client!.get(this.tokenKey(tokenHash));
      if (!value) {
        this.logger.debug('session_cache.miss');
        return { available: true, value: null };
      }
      const parsed = JSON.parse(value) as unknown;
      this.logger.debug('session_cache.hit');
      return {
        available: true,
        value: this.isEntry(parsed) ? parsed : null,
      };
    } catch {
      this.markUnavailable();
      return { available: false, value: null };
    }
  }

  async set(
    tokenHash: string,
    entry: CachedSessionEntry,
    previousScope?: {
      organizationId: string | null;
      membershipId: string | null;
    },
  ): Promise<boolean> {
    if (!this.canUse()) return false;
    const ttl = Math.max(
      1,
      Math.ceil((new Date(entry.expiresAt).getTime() - Date.now()) / 1_000),
    );

    try {
      const multi = this.client!.multi();
      multi.set(this.tokenKey(tokenHash), JSON.stringify(entry), { EX: ttl });
      multi.set(this.sessionIdKey(entry.sessionId), tokenHash, { EX: ttl });
      multi.sAdd(this.userIndexKey(entry.userId), entry.sessionId);

      if (entry.organizationId) {
        multi.sAdd(
          this.organizationIndexKey(entry.organizationId),
          entry.sessionId,
        );
      }
      if (entry.membershipId) {
        multi.sAdd(
          this.membershipIndexKey(entry.membershipId),
          entry.sessionId,
        );
      }
      if (
        previousScope?.organizationId &&
        previousScope.organizationId !== entry.organizationId
      ) {
        multi.sRem(
          this.organizationIndexKey(previousScope.organizationId),
          entry.sessionId,
        );
      }
      if (
        previousScope?.membershipId &&
        previousScope.membershipId !== entry.membershipId
      ) {
        multi.sRem(
          this.membershipIndexKey(previousScope.membershipId),
          entry.sessionId,
        );
      }
      await multi.exec();
      return true;
    } catch {
      this.markUnavailable();
      return false;
    }
  }

  async touch(tokenHash: string, entry: CachedSessionEntry): Promise<boolean> {
    if (!this.canUse()) return false;
    const ttl = Math.max(
      1,
      Math.ceil((new Date(entry.expiresAt).getTime() - Date.now()) / 1_000),
    );
    entry.lastActivityAt = new Date().toISOString();
    try {
      await this.client!.set(this.tokenKey(tokenHash), JSON.stringify(entry), {
        EX: ttl,
      });
      return true;
    } catch {
      this.markUnavailable();
      return false;
    }
  }

  async acquireActivityLock(
    sessionId: string,
    ttlSeconds: number,
  ): Promise<CacheLookup<boolean>> {
    if (!this.canUse()) return { available: false, value: null };

    try {
      const result = await this.client!.set(this.activityKey(sessionId), '1', {
        NX: true,
        EX: ttlSeconds,
      });
      return { available: true, value: result === 'OK' };
    } catch {
      this.markUnavailable();
      return { available: false, value: null };
    }
  }

  async deleteSession(
    sessionId: string,
    tokenHash?: string,
    entry?: CachedSessionEntry,
  ): Promise<boolean> {
    if (!this.canUse()) return false;

    try {
      const resolvedTokenHash =
        tokenHash ?? (await this.client!.get(this.sessionIdKey(sessionId)));
      const resolvedEntry =
        entry ??
        (resolvedTokenHash
          ? await this.get(resolvedTokenHash).then((result) => result.value)
          : null);
      const multi = this.client!.multi();
      if (resolvedTokenHash) multi.del(this.tokenKey(resolvedTokenHash));
      multi.del(this.sessionIdKey(sessionId));
      multi.del(this.activityKey(sessionId));
      if (resolvedEntry) {
        multi.sRem(this.userIndexKey(resolvedEntry.userId), sessionId);
        if (resolvedEntry.organizationId) {
          multi.sRem(
            this.organizationIndexKey(resolvedEntry.organizationId),
            sessionId,
          );
        }
        if (resolvedEntry.membershipId) {
          multi.sRem(
            this.membershipIndexKey(resolvedEntry.membershipId),
            sessionId,
          );
        }
      }
      await multi.exec();
      return true;
    } catch {
      this.markUnavailable();
      return false;
    }
  }

  async invalidateByUser(userId: string): Promise<void> {
    await this.invalidateIndex(this.userIndexKey(userId));
  }

  async invalidateByOrganization(organizationId: string): Promise<void> {
    await this.invalidateIndex(this.organizationIndexKey(organizationId));
  }

  async invalidateByMembership(membershipId: string): Promise<void> {
    await this.invalidateIndex(this.membershipIndexKey(membershipId));
  }

  private async invalidateIndex(indexKey: string): Promise<void> {
    if (!this.canUse()) return;
    try {
      const sessionIds = await this.client!.sMembers(indexKey);
      await Promise.all(
        sessionIds.map((sessionId) => this.deleteSession(sessionId)),
      );
      await this.client!.del(indexKey);
    } catch {
      this.markUnavailable();
    }
  }

  private canUse(): boolean {
    return Boolean(this.client?.isReady && Date.now() >= this.unavailableUntil);
  }

  private markUnavailable(): void {
    this.unavailableUntil = Date.now() + 5_000;
  }

  private isEntry(value: unknown): value is CachedSessionEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<CachedSessionEntry>;
    return (
      entry.version === 1 &&
      typeof entry.sessionId === 'string' &&
      typeof entry.userId === 'string' &&
      (entry.organizationId === null ||
        typeof entry.organizationId === 'string') &&
      (entry.membershipId === null || typeof entry.membershipId === 'string') &&
      (entry.status === 'active' ||
        entry.status === 'expired' ||
        entry.status === 'revoked') &&
      (entry.mfaVerifiedAt === null ||
        typeof entry.mfaVerifiedAt === 'string') &&
      typeof entry.expiresAt === 'string' &&
      typeof entry.lastActivityAt === 'string' &&
      typeof entry.tenantActive === 'boolean' &&
      (entry.role === null || typeof entry.role === 'string') &&
      Array.isArray(entry.permissions) &&
      entry.permissions.every((permission) => typeof permission === 'string') &&
      Array.isArray(entry.assignedAccountIds) &&
      entry.assignedAccountIds.every((id) => typeof id === 'string')
    );
  }

  private prefix(): string {
    return this.config.get<string>('redis.keyPrefix', 'balanz:');
  }

  private tokenKey(tokenHash: string): string {
    return `${this.prefix()}auth:session:token:${tokenHash}`;
  }

  private sessionIdKey(sessionId: string): string {
    return `${this.prefix()}auth:session:id:${sessionId}`;
  }

  private userIndexKey(userId: string): string {
    return `${this.prefix()}auth:session:index:user:${userId}`;
  }

  private organizationIndexKey(organizationId: string): string {
    return `${this.prefix()}auth:session:index:organization:${organizationId}`;
  }

  private membershipIndexKey(membershipId: string): string {
    return `${this.prefix()}auth:session:index:membership:${membershipId}`;
  }

  private activityKey(sessionId: string): string {
    return `${this.prefix()}auth:session:activity:${sessionId}`;
  }
}
