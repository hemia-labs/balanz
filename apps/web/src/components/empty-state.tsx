import { FileText } from "lucide-react";

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="grid min-h-80 place-items-center rounded-xl border border-border bg-card p-6 text-center shadow-sm">
      <div className="flex max-w-sm flex-col items-center">
        <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="size-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}
