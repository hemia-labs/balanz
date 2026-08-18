import type { ReactNode } from "react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface ProductColumn<Row> {
  id: string;
  header: string;
  numeric?: boolean;
  render: (row: Row) => ReactNode;
}

export function ProductTable<Row>({ caption, columns, rows, rowKey, emptyMessage = "No hay datos para mostrar." }: { caption: string; columns: ProductColumn<Row>[]; rows: Row[]; rowKey: (row: Row) => string; emptyMessage?: string }) {
  return <Table><TableCaption className="sr-only">{caption}</TableCaption><TableHeader><TableRow>{columns.map((column) => <TableHead key={column.id} scope="col" className={cn(column.numeric && "numeric")}>{column.header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length ? rows.map((row) => <TableRow key={rowKey(row)}>{columns.map((column) => <TableCell key={column.id} className={cn(column.numeric && "numeric")}>{column.render(row)}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">{emptyMessage}</TableCell></TableRow>}</TableBody></Table>;
}
