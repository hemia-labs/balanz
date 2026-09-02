import { registerAs } from '@nestjs/config';
import { parseCorsOrigins } from './cors-origins';

export function getCorsOptions(nodeEnv: string, corsOrigins: string[]) {
  if (nodeEnv === 'production' && corsOrigins.length === 0) {
    throw new Error('APP_CORS_ORIGINS is required in production');
  }

  return {
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  };
}

export default registerAs('app', () => ({
  port: Number(process.env.APP_PORT) || 3021,
  nodeEnv: process.env.NODE_ENV || 'development',
  globalPrefix: process.env.APP_GLOBAL_PREFIX || 'api/v1',
  // En desarrollo sólo se autoriza el frontend local por defecto.
  corsOrigins: parseCorsOrigins(
    process.env.APP_CORS_ORIGINS ||
      (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5181'),
  ),
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS) || 0,
}));
