import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import type { Locale } from "@/lib/i18n";

export function AuthFrame({
  locale,
  eyebrow,
  systemTitle,
  systemDescription,
  title,
  description,
  requiredHint,
  children,
  footer,
}: {
  locale: Locale;
  eyebrow: string;
  systemTitle: string;
  systemDescription: string;
  title: string;
  description: string;
  requiredHint: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid min-h-[100dvh] w-full focus:outline-none lg:grid-cols-[minmax(0,0.8fr)_minmax(28rem,1.2fr)]"
    >
      <section className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex xl:p-12">
        <BrandMark locale={locale} inverse />
        <div className="max-w-md border-l-2 border-brand-mark pl-5">
          <p className="text-caption font-semibold text-sidebar-foreground/70">{eyebrow}</p>
          <h2 className="mt-2 text-heading-lg font-bold">{systemTitle}</h2>
          <p className="mt-3 text-body-lg text-sidebar-foreground/72">{systemDescription}</p>
        </div>
        <p className="text-caption text-sidebar-foreground/55">Hemia · México</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <BrandMark locale={locale} />
          </div>
          <div className="border-l-2 border-brand-mark pl-4">
            <h1 className="text-heading-lg font-bold">{title}</h1>
            <p className="mt-1 text-body text-muted-foreground">{description}</p>
          </div>
          <div className="mt-6 rounded-lg border border-border bg-card p-5 sm:p-6">
            <p className="mb-5 text-caption text-muted-foreground">{requiredHint}</p>
            {children}
          </div>
          <div className="mt-6 text-body-sm text-muted-foreground">{footer}</div>
        </div>
      </section>
    </main>
  );
}
