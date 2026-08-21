import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthRateLimit } from './entities/auth-rate-limit.entity';

@Injectable()
export class AuthRateLimitService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async consume(
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const keyHash = createHash('sha256')
      .update(`${scope}:${key}`)
      .digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowSeconds * 1_000);

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO "auth_rate_limits"
          ("scope", "key_hash", "attempts", "window_started_at", "expires_at")
         VALUES ($1, $2, 0, $3, $4)
         ON CONFLICT ("scope", "key_hash") DO NOTHING`,
        [scope, keyHash, now, expiresAt],
      );

      const repository = manager.getRepository(AuthRateLimit);
      const row = await repository.findOne({
        where: { scope, keyHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) return false;

      if (row.expiresAt.getTime() <= now.getTime()) {
        row.attempts = 1;
        row.windowStartedAt = now;
        row.expiresAt = expiresAt;
        await repository.save(row);
        return true;
      }

      if (row.attempts >= limit) return false;
      row.attempts += 1;
      await repository.save(row);
      return true;
    });
  }

  resendLimit(): number {
    return this.config.get<number>('auth.verificationResendLimit', 3);
  }

  resendWindowSeconds(): number {
    return this.config.get<number>('auth.verificationResendWindowSeconds', 900);
  }

  mfaVerifyLimit(): number {
    return this.config.get<number>('auth.mfaVerifyLimit', 5);
  }

  mfaVerifyWindowSeconds(): number {
    return this.config.get<number>('auth.mfaVerifyWindowSeconds', 300);
  }
}
