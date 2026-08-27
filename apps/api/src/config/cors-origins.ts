/**
 * Parses APP_CORS_ORIGINS as a list of canonical HTTP(S) origins.
 *
 * An origin is only scheme, host and optional port. Paths (other than a lone
 * trailing slash), credentials, query strings and fragments are rejected so
 * CORS and CSRF compare the same normalized values.
 */
export function parseCorsOrigins(value: string): string[] {
  if (value.trim() === '') return [];

  const entries = value.split(',');
  const origins = new Set<string>();

  for (const entry of entries) {
    const candidate = entry.trim();
    if (!candidate) {
      throw new Error('APP_CORS_ORIGINS contains an empty origin');
    }

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(
        `APP_CORS_ORIGINS contains an invalid origin: ${candidate}`,
      );
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `APP_CORS_ORIGINS only accepts http(s) origins: ${candidate}`,
      );
    }
    if (parsed.username || parsed.password) {
      throw new Error(
        `APP_CORS_ORIGINS must not contain credentials: ${candidate}`,
      );
    }

    const authorityStart = candidate.indexOf('://') + 3;
    const suffixStart = candidate.slice(authorityStart).search(/[\\/?#]/);
    const suffix =
      suffixStart === -1 ? '' : candidate.slice(authorityStart + suffixStart);
    if (parsed.pathname !== '/' || (suffix !== '' && suffix !== '/')) {
      throw new Error(
        `APP_CORS_ORIGINS must contain exact origins without path, query or fragment: ${candidate}`,
      );
    }

    origins.add(parsed.origin);
  }

  return [...origins];
}
