import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: Number(process.env.APP_PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  globalPrefix: process.env.APP_GLOBAL_PREFIX || 'api/v1',
  // CSV -> string[]; vacío o '*' => CORS abierto
  corsOrigins: (process.env.APP_CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
}));
