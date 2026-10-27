"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ContextSearch({ compact = false, onExpand }: { compact?: boolean; onExpand?: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusRequested = useRef(false);
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { clients, organization } = useAccountingContext();
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  const normalized = query.trim().toLowerCase();
  const results = clients.filter((item) => `${item.name} ${item.rfc}`.toLowerCase().includes(normalized)).slice(0, 4);

  useEffect(() => {
    if (!compact && focusRequested.current) {
      focusRequested.current = false;
      inputRef.current?.focus();
    }
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
      if (!rootRef.current?.getClientRects().length) return;
      event.preventDefault();
      if (compact) {
        focusRequested.current = true;
        onExpand?.();
      } else {
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [compact, onExpand]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          inputRef.current?.focus();
          setOpen(false);
        }
      }}
    >
      {compact ? (
        <Button type="button" variant="sidebar" size="icon" aria-label="Buscar clientes" title="Buscar clientes (⌘/Ctrl + K)" onClick={() => {
          focusRequested.current = true;
          onExpand?.();
        }}>
          <Search className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <>
          <label htmlFor={inputId} className="sr-only">Buscar clientes por nombre o RFC</label>
          <Search className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            id={inputId}
            type="search"
            placeholder="Buscar"
            value={query}
            maxLength={120}
            autoComplete="off"
            aria-keyshortcuts="Meta+K Control+K"
            className="h-8 border-border pr-16 pl-8 text-body-sm shadow-none"
            onFocus={() => setOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1" aria-hidden="true">
            <kbd className="rounded-sm bg-muted px-1 text-caption text-muted-foreground">⌘</kbd>
            <kbd className="rounded-sm bg-muted px-1 text-caption text-muted-foreground">K</kbd>
          </span>
          {open ? (
            <div className="absolute top-full z-30 mt-1 w-full rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-float">
              <p className="px-2 py-2 text-caption text-muted-foreground">Clientes autorizados</p>
              <ul aria-label="Resultados de búsqueda">
                {results.map((item) => (
                  <li key={item.id}>
                    <Link href={`/${locale}/organizations/${organization.slug}/clients/${item.id}/overview`} onClick={() => { setOpen(false); setQuery(""); }} className="block min-h-10 rounded-md px-2 py-2 hover:bg-muted">
                      <span className="block truncate text-body-sm font-medium">{item.name}</span>
                      <span className="block truncate text-caption text-muted-foreground">{item.rfc}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {results.length === 0 ? <p role="status" className="px-2 py-2 text-body-sm text-muted-foreground">No hay clientes que coincidan.</p> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
