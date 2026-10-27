"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { PermissionNotice } from "@/components/product-patterns";
import type { Capability } from "@/lib/accounting-types";
import { hasCapability } from "@/lib/permissions";

export function PermissionGate({
  capability,
  children,
  fallback = null,
  explainReauthentication = false,
}: {
  capability: Capability;
  children: ReactNode;
  fallback?: ReactNode;
  explainReauthentication?: boolean;
}) {
  const { capabilities, locale, requiresReauthentication } =
    useAccountingContext();
  if (!hasCapability(capabilities, capability)) return fallback;
  return (
    <>
      {children}
      {explainReauthentication && requiresReauthentication(capability) ? (
        <p role="status" className="text-caption text-muted-foreground">
          Esta acción requiere reautenticación.{" "}
          <Link
            href={`/${locale}/security`}
            className="font-semibold text-primary underline"
          >
            Reautenticar sesión
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}

export function PermissionBoundary({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { capabilities } = useAccountingContext();
  if (!hasCapability(capabilities, capability))
    return <PermissionNotice capability={capability} />;
  return children;
}
