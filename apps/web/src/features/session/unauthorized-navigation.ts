const DEFAULT_LOCALE = "es";
const INTERNAL_ORIGIN = "https://balanz.invalid";

function safeInternalLocation(pathname: string, search: string) {
  const query = search.replace(/^\?/, "");
  const candidate = `${pathname}${query ? `?${query}` : ""}`;

  try {
    const parsed = new URL(candidate, INTERNAL_ORIGIN);
    if (
      parsed.origin !== INTERNAL_ORIGIN ||
      !candidate.startsWith("/") ||
      candidate.startsWith("//") ||
      candidate.includes("\\")
    ) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

export function localeFromPath(pathname: string) {
  const candidate = pathname.split("/").filter(Boolean)[0];
  return candidate === DEFAULT_LOCALE ? candidate : DEFAULT_LOCALE;
}

/**
 * Builds a same-origin return URL and suppresses navigation when the current
 * route is already the login screen, preventing redirect loops.
 */
export function unauthorizedLoginDestination(
  pathname: string,
  search = "",
) {
  const locale = localeFromPath(pathname);
  const loginPath = `/${locale}/login`;
  const normalizedPathname = pathname.replace(/\/$/, "") || "/";
  if (normalizedPathname === loginPath) return null;

  const returnTo = safeInternalLocation(pathname, search);
  return `${loginPath}?returnTo=${encodeURIComponent(returnTo)}`;
}
