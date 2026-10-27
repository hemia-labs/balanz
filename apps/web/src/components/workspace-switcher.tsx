"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const mockWorkspaces = [
  { name: "Estudio Contable Norte", description: "Equipo contable · Ejemplo" },
  { name: "Finanzas y Asociados", description: "Administración · Ejemplo" },
];

function WorkspaceAvatar({ name }: { name: string }) {
  return (
    <Avatar className="size-8 rounded-md border border-border" aria-hidden="true">
      <AvatarFallback className="rounded-none bg-primary text-primary-foreground">
        {name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "E"}
      </AvatarFallback>
    </Avatar>
  );
}

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { organization, organizations, changeOrganization } = useAccountingContext();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label={`Cambiar espacio de trabajo: ${organization.name}`}
            title={compact ? organization.name : undefined}
            className={cn(
              "gap-2 text-left",
              compact ? "size-10 p-1" : "h-12 w-full min-w-0 justify-between px-2",
            )}
          />
        }
      >
        <WorkspaceAvatar name={organization.name} />
        {!compact ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-caption font-normal text-muted-foreground">Espacio de trabajo</span>
              <span className="block truncate text-body-sm font-medium text-sidebar-foreground">{organization.name}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? "right" : "bottom"} align="start" className="w-72">
        {error ? <p role="alert" className="px-2 py-2 text-caption text-destructive">{error}</p> : null}
        {pending ? <p role="status" className="px-2 py-2 text-caption text-muted-foreground">Cambiando espacio de trabajo…</p> : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Espacios de trabajo</DropdownMenuLabel>
        {organizations.map((option) => (
          <DropdownMenuItem
            key={option.id}
            className="gap-3 py-2"
            disabled={pending}
            closeOnClick={false}
            onClick={() => {
              if (pending) return;
              if (option.id === organization.id) {
                setOpen(false);
                return;
              }
              setError(null);
              setPending(true);
              void changeOrganization(option.id)
                .then(() => setOpen(false))
                .catch(() => {
                  setError("No se pudo cambiar de espacio de trabajo. Intenta de nuevo.");
                  setOpen(true);
                })
                .finally(() => setPending(false));
            }}
          >
            <WorkspaceAvatar name={option.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{option.name}</span>
              <span className="block truncate text-caption text-muted-foreground">{option.slug}</span>
            </span>
            {option.id === organization.id ? (
              <>
                <Check className="size-4 text-primary" aria-hidden="true" />
                <span className="sr-only">Espacio actual</span>
              </>
            ) : null}
          </DropdownMenuItem>
        ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Ejemplos · No disponibles para acceso</DropdownMenuLabel>
          {mockWorkspaces.map((option) => (
            <DropdownMenuItem key={option.name} className="gap-3 py-2" disabled>
              <WorkspaceAvatar name={option.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{option.name}</span>
                <span className="block truncate text-caption text-muted-foreground">{option.description}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
