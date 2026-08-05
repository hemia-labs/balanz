import { NextRequest, NextResponse } from "next/server";
import { defaultLocale, isLocale, locales } from "@/lib/i18n";

function getPreferredLocale(request: NextRequest) {
  const language = request.headers.get("accept-language")?.split(",")[0]?.split("-")[0]?.toLowerCase();
  return language && isLocale(language) ? language : defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)
  );

  if (hasLocale) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${getPreferredLocale(request)}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
