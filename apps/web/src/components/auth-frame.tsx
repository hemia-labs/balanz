import type { ReactNode } from "react";
import Image from "next/image";
import { BrandMark } from "@/components/brand-mark";
import { Card, CardContent } from "@/components/ui/card";
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
  contentClassName,
  centered = false,
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
  contentClassName?: string;
  centered?: boolean;
}) {
  if (centered) {
    return (
      <main id="main-content" tabIndex={-1} className="grid min-h-[100dvh] bg-background focus:outline-none lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.9fr)]">
        <section className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between xl:p-14">
          <BrandMark locale={locale} inverse />
          <div className="relative max-w-lg">
            <p className="text-caption font-semibold text-sidebar-foreground/70">{eyebrow}</p>
            <h2 className="mt-3 text-display font-bold">{systemTitle}</h2>
            <p className="mt-4 max-w-md text-body-lg text-sidebar-foreground/75">{systemDescription}</p>
          </div>
          <p className="text-caption text-sidebar-foreground/60">Hemia · México</p>
          <div aria-hidden="true" className="absolute -bottom-32 -right-20 size-80 rounded-full border border-sidebar-foreground/10" />
          <div aria-hidden="true" className="absolute -bottom-20 -right-8 size-48 rounded-full border border-sidebar-foreground/10" />
        </section>
        <section className="flex min-h-[100dvh] items-center justify-center px-4 py-8 sm:px-8 lg:px-10">
          <div className={"w-full " + (contentClassName ?? "max-w-md")}>
            <Card className="border-border shadow-float ring-0">
              <CardContent className="p-6 sm:p-7">
                <Image src="/logo.png" alt="CFDIOS" width={230} height={58} priority className="h-auto w-48" />
                <div className="mt-6">
                  <h1 className="text-heading-lg font-bold">{title}</h1>
                  <p className="mt-2 text-body text-muted-foreground">{description}</p>
                </div>
                <p className="sr-only">{requiredHint}</p>
                <div className="mt-5">{children}</div>
                <div className="mt-6 text-body-sm text-muted-foreground">{footer}</div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    );
  }

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
        <div className={`w-full ${contentClassName ?? "max-w-md"}`}>
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
