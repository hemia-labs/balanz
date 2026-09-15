import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  sortKey?: string;
  numeric?: boolean;
  align?: "start" | "end";
  wrap?: boolean;
  render: (row: Row) => ReactNode;
}

export function DataTable<Row>({
  caption, columns, rows, rowKey,
  emptyMessage = "No hay datos para mostrar.",
  loading = false,
  loadingMessage = "Cargando datos…",
  error,
  sorting,
}: {
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  emptyMessage?: string;
  loading?: boolean;
  loadingMessage?: string;
  error?: ReactNode;
  sorting?: { key: string; direction: "asc" | "desc"; onChange: (key: string, direction: "asc" | "desc") => void };
}) {
  return (
    <Table aria-busy={loading}>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.id} scope="col" aria-sort={sorting && column.sortKey && sorting.key === column.sortKey ? sorting.direction === "asc" ? "ascending" : "descending" : undefined} className={cn(column.numeric && "numeric", column.align === "end" && "text-right")}>
              {column.sortKey && sorting ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-mx-2 px-2 font-semibold pointer-coarse:min-h-11"
                  aria-label={`${column.header}: ordenar ${sorting.key === column.sortKey && sorting.direction === "asc" ? "descendente" : "ascendente"}`}
                  onClick={() => sorting.onChange(column.sortKey!, sorting.key === column.sortKey && sorting.direction === "asc" ? "desc" : "asc")}
                >
                  {column.header}
                  {sorting.key !== column.sortKey ? <ArrowUpDown aria-hidden="true" /> : sorting.direction === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
                </Button>
              ) : column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading || error || !rows.length ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-32 whitespace-normal text-muted-foreground">
              {loading ? <p role="status" className="text-center">{loadingMessage}</p> : error || <p role="status" className="text-center">{emptyMessage}</p>}
            </TableCell>
          </TableRow>
        ) : rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell key={column.id} className={cn(column.numeric && "numeric", column.align === "end" && "text-right", column.wrap && "max-w-xs whitespace-normal break-words")}>
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
