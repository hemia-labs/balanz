"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabels } from "@/lib/permissions";

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { organization, membership, organizations, changeOrganization } = useAccountingContext();
  const [error, setError] = useState<string | null>(null);
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";

  if (compact) {
    return (
      <div className="grid size-10 place-items-center rounded-md bg-sidebar-accent text-sidebar-foreground" title={organization.name}>
        <Building2 className="size-5" aria-hidden="true" />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="sidebar" className="h-auto w-full justify-between px-3 py-2 text-left" />
        }
      >
        <span className="min-w-0">
          <span className="block text-caption font-semibold text-sidebar-foreground/55">Despacho activo</span>
          <span className="block truncate text-body-sm text-sidebar-foreground">{organization.name}</span>
          <span className="block text-caption font-normal text-sidebar-foreground/65">{roleLabels[membership.role]}</span>
        </span>
        <ChevronsUpDown className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-72">
        <div className="px-2 py-1.5 text-caption font-semibold text-muted-foreground">Cambiar despacho</div>
        {error ? <p role="alert" aria-live="polite" className="px-2 py-1.5 text-caption text-destructive">{error}</p> : null}
        <DropdownMenuSeparator />
        {organizations.map((option) => {
          return (
            <DropdownMenuItem
              key={option.id}
              onClick={() => {
                if (option.id === organization.id) return;
                setError(null);
                void changeOrganization(option.id)
                  .then(() => router.push(`/${locale}/organizations/${option.slug}/home`))
                  .catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cambiar de organización."));
              }}
            >
              <Building2 className="size-4" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{option.name}</span>
                <span className="block text-caption text-muted-foreground">{option.role}</span>
              </span>
              {option.id === organization.id ? <Check className="size-4" aria-label="Despacho actual" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
