import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// TODO: Migrar los consumidores a FilterBar y eliminar este componente cuando
// no tenga usos. Conservar las validaciones y documentar los filtros especiales.
export function LegacyFilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-end gap-3 border-b border-border bg-muted/35 px-4 py-3", className)}>{children}</div>;
}
