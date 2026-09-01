import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  enabled: boolean;
  host?: string;
  port: number;
  password?: string;
  database: number;
  keyPrefix: string;
  connectTimeoutMs: number;
}

export default registerAs('redis', (): RedisConfig => ({
  enabled: process.env.REDIS_ENABLED !== 'false',
  host: process.env.REDIS_HOST?.trim() || undefined,
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  database: Number(process.env.REDIS_DB) || 0,
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'balanz:',
  connectTimeoutMs: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 1_000,
}));
