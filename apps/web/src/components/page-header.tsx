import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? (
          <p className="mb-1 text-caption font-semibold text-accent-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="text-heading-lg font-bold text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-body text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
