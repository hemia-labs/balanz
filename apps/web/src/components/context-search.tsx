"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { demoData } from "@/lib/demo-data";

export function ContextSearch() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const { client, clients, organization } = useAccountingContext();
  const placeholder = client
    ? `Buscar CFDI, UUID, RFC o folio en ${client.name}`
    : "Buscar cliente, RFC, UUID o folio";
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return { clients: clients.slice(0, 3), cfdi: demoData.cfdi.filter((item) => !client || item.clientId === client.id).slice(0, 3) };
    return {
      clients: clients.filter((item) => `${item.name} ${item.rfc}`.toLowerCase().includes(normalized)).slice(0, 4),
      cfdi: demoData.cfdi.filter((item) => (!client || item.clientId === client.id) && `${item.uuid} ${item.rfc} ${item.name}`.toLowerCase().includes(normalized)).slice(0, 4),
    };
  }, [client, clients, query]);
  return (
    <>
      <Button type="button" variant="outline" className="hidden w-80 justify-start font-normal text-muted-foreground lg:flex" onClick={() => dialogRef.current?.showModal()}>
        <Search className="size-4" /> <span className="truncate">{placeholder}</span>
      </Button>
      <dialog ref={dialogRef} aria-labelledby={titleId} className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-lg border border-border bg-card p-0 text-card-foreground shadow-overlay">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <Search className="size-5 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="context-search" id={titleId} className="sr-only">{placeholder}</label>
          <Input id="context-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="border-0 px-0 focus-visible:outline-none" />
          <Button type="button" variant="ghost" size="icon" onClick={() => dialogRef.current?.close()} aria-label="Cerrar búsqueda"><X className="size-4" /></Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          <p className="px-3 py-2 text-caption font-semibold text-muted-foreground">Clientes autorizados</p>
          {results.clients.map((item) => (
            <Link key={item.id} href={`/es/despachos/${organization.id}/clientes/${item.id}/resumen`} onClick={() => dialogRef.current?.close()} className="flex min-h-12 items-center justify-between rounded-md px-3 py-2 hover:bg-muted">
              <span><span className="block font-semibold">{item.name}</span><span className="identifier text-caption text-muted-foreground">{item.rfc}</span></span><span className="text-caption text-muted-foreground">Cliente</span>
            </Link>
          ))}
          <p className="mt-2 px-3 py-2 text-caption font-semibold text-muted-foreground">CFDI demostrativos</p>
          {results.cfdi.map((item) => (
            <Link key={item.uuid} href={`/es/despachos/${organization.id}/clientes/${item.clientId}/cfdi/${item.uuid}`} onClick={() => dialogRef.current?.close()} className="flex min-h-12 items-center justify-between rounded-md px-3 py-2 hover:bg-muted">
              <span><span className="identifier block font-semibold">{item.uuid}</span><span className="text-caption text-muted-foreground">{item.name}</span></span><span className="text-caption text-muted-foreground">{item.type}</span>
            </Link>
          ))}
          {results.clients.length + results.cfdi.length === 0 ? <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">No hay resultados demo para esta búsqueda.</p> : null}
        </div>
        <p className="border-t border-border px-5 py-3 text-caption text-muted-foreground">Búsqueda local sobre fixtures autorizados. Integración de backend pendiente.</p>
      </dialog>
    </>
  );
}
