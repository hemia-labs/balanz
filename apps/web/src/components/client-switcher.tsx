"use client";

import { Building, Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ClientSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { client, clients, organization } = useAccountingContext();
  if (!client) return null;

  if (compact) {
    return (
      <div className="grid size-10 place-items-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground" title={client.name}>
        <Building className="size-5" aria-hidden="true" />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="sidebar" className="h-auto w-full justify-between px-3 py-2 text-left" />}>
        <span className="min-w-0">
          <span className="block text-caption font-semibold text-sidebar-foreground/55">Cliente activo</span>
          <span className="block truncate text-body-sm text-sidebar-foreground">{client.name}</span>
          <span className="identifier block text-caption font-normal text-sidebar-foreground/65">RFC: {client.rfc}</span>
        </span>
        <ChevronsUpDown className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-80">
        <div className="px-2 py-1.5 text-caption font-semibold text-muted-foreground">Cambiar cliente</div>
        <DropdownMenuSeparator />
        {clients.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => router.push(`/es/despachos/${organization.id}/clientes/${option.id}/resumen`)}
          >
            <Building className="size-4" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{option.name}</span>
              <span className="identifier block text-caption text-muted-foreground">{option.rfc}</span>
            </span>
            {option.id === client.id ? <Check className="size-4" aria-label="Cliente actual" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
