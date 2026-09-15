import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-8">
      <div className="min-w-0 max-w-3xl break-words sm:flex-1 sm:basis-80">
        <h1 className="text-heading-lg font-bold text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-body text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex min-w-0 max-w-full flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
