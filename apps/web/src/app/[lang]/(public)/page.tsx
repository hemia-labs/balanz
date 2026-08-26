"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError } from "@/lib/api-client";
import { getOrganizations } from "@/features/organizations/api";
import { getSession } from "@/features/session/api";
import { organizationBase } from "@/lib/nav";

export default function EntryPage() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
    let mounted = true;
    const controller = new AbortController();

    Promise.all([getSession(controller.signal), getOrganizations(controller.signal)])
      .then(([{ organizationId }, organizations]) => {
        if (!mounted) return;
        const organization = organizationId ? organizations.find((item) => item.id === organizationId) : undefined;
        router.replace(
          organization
            ? `${organizationBase(locale, organization.slug)}/home`
            : `/${locale}/seleccionar-despacho`,
        );
      })
      .catch((error) => {
        if (mounted && error instanceof ApiError && error.status === 401) {
          router.replace(`/${locale}/login`);
        } else if (mounted) {
          router.replace(`/${locale}/login?error=session`);
        }
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [pathname, router]);

  return <div className="grid min-h-screen place-items-center text-body-sm text-muted-foreground">Cargando sesión…</div>;
}
