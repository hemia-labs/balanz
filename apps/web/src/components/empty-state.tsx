import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  eyebrow,
  title,
  message,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  message: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card" aria-labelledby="empty-state-title">
      <div className="flex min-h-64 items-start gap-4 p-6 sm:p-8">
        <div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="max-w-2xl pt-0.5">
          <p className="text-caption font-semibold text-accent-foreground">{eyebrow}</p>
          <h2 id="empty-state-title" className="mt-1 text-heading-sm font-emphasis">
            {title}
          </h2>
          <p className="mt-2 text-body text-muted-foreground">{message}</p>
        </div>
      </div>
      <div aria-hidden="true" className="h-1 border-t border-double border-border-strong bg-numeric-band" />
    </section>
  );
}
