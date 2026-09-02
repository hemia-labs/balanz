import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisClient } from './redis.module';
import { REDIS_CLIENT } from './redis.tokens';

export interface CachedSessionEntry {
  version: 5;
  sessionId: string;
  userId: string;
  organizationId: string | null;
  membershipId: string | null;
  status: 'active' | 'expired' | 'revoked';
  mfaVerifiedAt: string | null;
  reauthenticatedAt: string | null;
  requiresMfa: boolean;
  mfaStatus: 'disabled' | 'pending' | 'active';
  expiresAt: string;
  lastActivityAt: string;
  persistedLastActivityAt: string;
  tenantActive: boolean;
  role: string | null;
  permissions: string[];
  accountAccessMode: 'tenant' | 'assigned';
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

  async set(tokenHash: string, entry: CachedSessionEntry): Promise<boolean> {
    if (!this.canUse()) return false;
    const ttl = this.cacheTtlSeconds(entry);

    try {
      const result = await this.client!.set(
        this.tokenKey(tokenHash),
        JSON.stringify(entry),
        { EX: ttl },
      );
      return result === 'OK';
    } catch {
      this.markUnavailable();
      return false;
    }
  }

  async touch(tokenHash: string, entry: CachedSessionEntry): Promise<boolean> {
    if (!this.canUse()) return false;
    const ttl = this.cacheTtlSeconds(entry);
    try {
      const result = await this.client!.set(
        this.tokenKey(tokenHash),
        JSON.stringify(entry),
        {
          EX: ttl,
          XX: true,
        },
      );
      return result === 'OK';
    } catch {
      this.markUnavailable();
      return false;
    }
  }

  async deleteSession(
    sessionId: string,
    tokenHash?: string,
    cleanupAliases = false,
  ): Promise<boolean> {
    if (!this.canUse()) return false;

    try {
      await this.client!.del([
        ...(tokenHash ? [this.tokenKey(tokenHash)] : []),
      ]);
      if (cleanupAliases) {
        for await (const keys of this.client!.scanIterator({
          MATCH: `${this.prefix()}auth:session:token:*`,
          COUNT: 100,
        })) {
          const values = await this.client!.mGet(keys);
          const aliases = keys.filter(
            (_, index) => this.sessionId(values[index]) === sessionId,
          );
          if (aliases.length > 0) await this.client!.del(aliases);
        }
      }
      return true;
    } catch {
      this.markUnavailable();
      return false;
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
      entry.version === 5 &&
      typeof entry.sessionId === 'string' &&
      typeof entry.userId === 'string' &&
      (entry.organizationId === null ||
        typeof entry.organizationId === 'string') &&
      (entry.membershipId === null || typeof entry.membershipId === 'string') &&
      (entry.status === 'active' ||
        entry.status === 'expired' ||
        entry.status === 'revoked') &&
      (entry.reauthenticatedAt === null ||
        typeof entry.reauthenticatedAt === 'string') &&
      (entry.mfaVerifiedAt === null ||
        typeof entry.mfaVerifiedAt === 'string') &&
      typeof entry.requiresMfa === 'boolean' &&
      (entry.mfaStatus === 'disabled' ||
        entry.mfaStatus === 'pending' ||
        entry.mfaStatus === 'active') &&
      typeof entry.expiresAt === 'string' &&
      typeof entry.lastActivityAt === 'string' &&
      typeof entry.persistedLastActivityAt === 'string' &&
      typeof entry.tenantActive === 'boolean' &&
      (entry.role === null || typeof entry.role === 'string') &&
      Array.isArray(entry.permissions) &&
      entry.permissions.every((permission) => typeof permission === 'string') &&
      (entry.accountAccessMode === 'tenant' ||
        entry.accountAccessMode === 'assigned')
    );
  }

  private sessionId(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      return this.isEntry(parsed) ? parsed.sessionId : null;
    } catch {
      return null;
    }
  }

  private prefix(): string {
    return this.config.get<string>('redis.keyPrefix', 'balanz:');
  }

  private cacheTtlSeconds(entry: CachedSessionEntry): number {
    const now = Date.now();
    const absoluteTtl = (new Date(entry.expiresAt).getTime() - now) / 1_000;
    const idleTtl =
      (new Date(entry.lastActivityAt).getTime() +
        this.config.get<number>('auth.sessionIdleTtlSeconds', 1_800) * 1_000 -
        now) /
      1_000;
    const authorizationTtl = this.config.get<number>(
      'auth.authorizationCacheTtlSeconds',
      60,
    );
    return Math.max(
      1,
      Math.ceil(Math.min(absoluteTtl, idleTtl, authorizationTtl)),
    );
  }

  private tokenKey(tokenHash: string): string {
    return `${this.prefix()}auth:session:token:${tokenHash}`;
  }
}
