export interface RedisSecret {
  redis_host: string;
  redis_port: number;
  redis_password?: string;
  redis_db: number;
}

export function isRedisSecret(value: unknown): value is RedisSecret {
  if (!value || typeof value !== 'object') return false;
  const secret = value as Partial<RedisSecret>;
  return (
    typeof secret.redis_host === 'string' &&
    secret.redis_host.trim().length > 0 &&
    typeof secret.redis_port === 'number' &&
    Number.isInteger(secret.redis_port) &&
    secret.redis_port >= 1 &&
    secret.redis_port <= 65_535 &&
    (secret.redis_password === undefined ||
      typeof secret.redis_password === 'string') &&
    typeof secret.redis_db === 'number' &&
    Number.isInteger(secret.redis_db) &&
    secret.redis_db >= 0 &&
    secret.redis_db <= 15
  );
}
