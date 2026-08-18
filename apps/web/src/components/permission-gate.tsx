"use client";

import type { ReactNode } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { PermissionNotice } from "@/components/product-patterns";
import type { Capability } from "@/lib/accounting-types";
import { hasCapability } from "@/lib/permissions";

export function PermissionGate({ capability, children, fallback = null }: { capability: Capability; children: ReactNode; fallback?: ReactNode }) {
  const { capabilities } = useAccountingContext();
  if (!hasCapability(capabilities, capability)) return fallback;
  return children;
}

export function PermissionBoundary({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { capabilities } = useAccountingContext();
  if (!hasCapability(capabilities, capability)) return <PermissionNotice capability={capability} />;
  return children;
}
