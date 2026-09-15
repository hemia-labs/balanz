"use client";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";

export function CollectionPagination({
  meta,
  itemLabel,
  onPageChange,
}: {
  meta: { page: number; limit: number; total: number; totalPages: number } | null;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  if (!meta) return null;
  const first = meta.total === 0
    ? 0
    : Math.min((meta.page - 1) * meta.limit + 1, meta.total);
  const last = Math.min(meta.page * meta.limit, meta.total);
  const previousPage = Math.max(1, Math.min(meta.page - 1, meta.totalPages || 1));

  return (
    <Pagination
      aria-label={`Paginación de ${itemLabel}`}
      className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-body-sm text-muted-foreground">
        {first}–{last} de {meta.total} {itemLabel}
      </p>
      {meta.totalPages > 1 || meta.page > 1 ? (
        <PaginationContent className="flex-wrap">
          <PaginationItem>
            <PaginationPrevious
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => onPageChange(previousPage)}
            />
          </PaginationItem>
          <PaginationItem>
            <span className="flex min-h-9 items-center px-2 text-body-sm tabular-nums">
              Página {meta.page} de {Math.max(meta.totalPages, 1)}
            </span>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => onPageChange(meta.page + 1)}
            />
          </PaginationItem>
        </PaginationContent>
      ) : null}
    </Pagination>
  );
}
