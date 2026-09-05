import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsService } from '@hemia/secrets/nestjs';
import { createClient, type RedisClientType } from 'redis';
import redisConfig, { type RedisConfig } from '../../config/redis.config';
import { SecretsModule } from '../secrets/secrets.module';
import { isRedisSecret, type RedisSecret } from './redis.types';
import { REDIS_CLIENT } from './redis.tokens';
import { SessionCacheService } from './session-cache.service';
import { RedisWakeupService } from './redis-wakeup.service';
import { ObservabilityModule } from '../../common/observability/observability.module';
import type { FiscalPlatformConfig } from '../../config/fiscal-platform.config';
import { shutdownRedisClient } from './redis-client-shutdown';
import { redisReconnectDelayMs } from './redis-reconnect-policy';

export type RedisClient = RedisClientType;

@Injectable()
export class RedisLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly shutdownTimeoutMs: number;
  private retryTimer?: NodeJS.Timeout;
  private retryAttempt = 0;
  private connecting = false;
  private shuttingDown = false;
  private readonly onClientUnavailable = (): void => {
    if (!this.shuttingDown) this.scheduleRetry();
  };

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: RedisClient | null,
    config: ConfigService,
  ) {
    this.shutdownTimeoutMs =
      config.getOrThrow<FiscalPlatformConfig>(
        'fiscalPlatform',
      ).redisWakeup.timeoutMs;
    this.client?.on('error', this.onClientUnavailable);
    this.client?.on('end', this.onClientUnavailable);
  }

  onModuleInit(): void {
    this.ensureConnected();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.client?.off('error', this.onClientUnavailable);
    this.client?.off('end', this.onClientUnavailable);
    if (this.client) {
      await shutdownRedisClient(this.client, this.shutdownTimeoutMs);
    }
  }

  private ensureConnected(): void {
    if (
      !this.client ||
      this.shuttingDown ||
      this.connecting ||
      this.client.isOpen
    ) {
      return;
    }
    this.connecting = true;
    void this.client
      .connect()
      .then(() => {
        this.retryAttempt = 0;
      })
      .catch(() => {
        if (!this.shuttingDown) this.scheduleRetry();
      })
      .finally(() => {
        this.connecting = false;
      });
  }

  private scheduleRetry(): void {
    if (this.shuttingDown || this.retryTimer || !this.client) return;
    const delayMs = redisReconnectDelayMs(this.retryAttempt);
    this.retryAttempt = Math.min(this.retryAttempt + 1, 5);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.ensureConnected();
    }, delayMs);
    this.retryTimer.unref();
  }
}

@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    SecretsModule,
    ObservabilityModule,
  ],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService, SecretsService],
      useFactory: async (
        config: ConfigService,
        secrets: SecretsService,
      ): Promise<RedisClient | null> => {
        const logger = new Logger('Redis');
        const enabled = config.get<boolean>('redis.enabled', true);
        if (!enabled) return null;

        const configured = config.getOrThrow<RedisConfig>('redis');
        let connection = configured.host
          ? {
              host: configured.host,
              port: configured.port,
              password: configured.password,
              database: configured.database,
            }
          : null;

        if (config.get<boolean>('secrets.enabled', false)) {
          try {
            const secret =
              await secrets.getRequired<RedisSecret>('cache/redis');
            if (isRedisSecret(secret)) {
              connection = {
                host: secret.redis_host,
                port: secret.redis_port,
                password: secret.redis_password,
                database: secret.redis_db,
              };
            } else {
              logger.warn(
                'Secret cache/redis is invalid; trying REDIS_* configuration',
              );
            }
          } catch {
            logger.warn(
              'Secret cache/redis is unavailable; trying REDIS_* configuration',
            );
          }
        }

        if (!connection) {
          logger.warn(
            'Redis configuration not found; PostgreSQL remains authoritative',
          );
          return null;
        }

        const client = createClient({
          socket: {
            host: connection.host,
            port: connection.port,
            connectTimeout: configured.connectTimeoutMs,
            reconnectStrategy: false,
          },
          password: connection.password,
          database: connection.database,
        });
        client.on('error', () => {
          logger.warn('Redis unavailable; PostgreSQL remains authoritative');
        });
        return client;
      },
    },
    RedisLifecycle,
    SessionCacheService,
    RedisWakeupService,
  ],
  exports: [REDIS_CLIENT, SessionCacheService, RedisWakeupService],
})
export class RedisModule {}
