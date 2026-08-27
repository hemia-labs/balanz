"use client";

import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api-client";
import type { PageMeta } from "./types";

export const selectClass =
  "h-10 rounded-md border border-input bg-card px-3 text-body-sm";
export const roleLabels: Record<string, string> = {
  owner: "Titular",
  accountant: "Contador responsable",
  collaborator: "Colaborador",
};

export function ErrorNotice({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-body-sm text-destructive"
    >
      {apiErrorMessage(error, fallback)}
    </div>
  );
}

export function LoadingState({
  label = "Cargando clientes…",
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-card p-8 text-center text-body-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

export function CollectionPagination({
  meta,
  itemLabel,
  onPageChange,
}: {
  meta: PageMeta | null;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  if (!meta) return null;
  const first =
    meta.total === 0
      ? 0
      : Math.min((meta.page - 1) * meta.limit + 1, meta.total);
  const last = Math.min(meta.page * meta.limit, meta.total);
  const previousPage = Math.max(
    1,
    Math.min(meta.page - 1, meta.totalPages || 1),
  );
  return (
    <nav
      aria-label={`Paginación de ${itemLabel}`}
      className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-body-sm text-muted-foreground">
        {first}–{last} de {meta.total} {itemLabel}
      </p>
      {meta.totalPages > 1 || meta.page > 1 ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={meta.page <= 1}
            onClick={() => onPageChange(previousPage)}
          >
            Anterior
          </Button>
          <span className="flex min-h-9 items-center px-2 text-body-sm tabular-nums">
            Página {meta.page} de {Math.max(meta.totalPages, 1)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={meta.page >= meta.totalPages}
            onClick={() => onPageChange(meta.page + 1)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
