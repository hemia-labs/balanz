import { registerAs } from '@nestjs/config';

export type CookieSameSite = 'strict' | 'lax' | 'none';

export default registerAs('cookies', () => {
  const secure = process.env.COOKIE_SECURE === 'true';
  const domain = process.env.COOKIE_DOMAIN || undefined;
  const sessionName =
    process.env.AUTH_SESSION_COOKIE_NAME ||
    (secure ? '__Host-session' : 'balanz_session');

  if (sessionName.startsWith('__Host-') && (!secure || domain)) {
    throw new Error(
      '__Host- session cookies require Secure, Path=/ and no Domain',
    );
  }

  return {
    httpOnly: true,
    secure,
    sameSite: (process.env.COOKIE_SAME_SITE ||
      (process.env.NODE_ENV === 'production'
        ? 'strict'
        : 'lax')) as CookieSameSite,
    domain,
    path: '/',
    sessionName,
  };
});
