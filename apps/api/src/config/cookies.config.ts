import { registerAs } from '@nestjs/config';

export type CookieSameSite = 'strict' | 'lax' | 'none';

export default registerAs('cookies', () => ({
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: (process.env.COOKIE_SAME_SITE || 'lax') as CookieSameSite,
  domain: process.env.COOKIE_DOMAIN || undefined,
  path: '/',
  sessionName: process.env.AUTH_SESSION_COOKIE_NAME || 'balanz_session',
}));
