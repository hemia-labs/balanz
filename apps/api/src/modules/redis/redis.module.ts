import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecretsService } from '@hemia/secrets/nestjs';
import { createClient, type RedisClientType } from 'redis';
import redisConfig, { type RedisConfig } from '../../config/redis.config';
import { SecretsModule } from '../secrets/secrets.module';
import { isRedisSecret, type RedisSecret } from './redis.types';
import { REDIS_CLIENT } from './redis.tokens';
import { SessionCacheService } from './session-cache.service';

export type RedisClient = RedisClientType;

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: RedisClient | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
  }
}

@Module({
  imports: [ConfigModule.forFeature(redisConfig), SecretsModule],
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
            'Redis configuration not found; session requests will use PostgreSQL',
          );
          return null;
        }

        const client = createClient({
          socket: {
            host: connection.host,
            port: connection.port,
            connectTimeout: configured.connectTimeoutMs,
          },
          password: connection.password,
          database: connection.database,
        });
        client.on('error', () => {
          logger.warn(
            'Redis unavailable; session requests will use PostgreSQL',
          );
        });
        void client.connect().catch(() => {
          logger.warn(
            'Redis connection failed; session requests will use PostgreSQL',
          );
        });
        return client;
      },
    },
    RedisLifecycle,
    SessionCacheService,
  ],
  exports: [REDIS_CLIENT, SessionCacheService],
})
export class RedisModule {}
