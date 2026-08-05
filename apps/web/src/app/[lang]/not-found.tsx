"use client";

import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getDictionary, isLocale, defaultLocale } from "@/lib/i18n";
import { usePathname } from "next/navigation";

export default function NotFound() {
  const pathname = usePathname();
  const segment = pathname?.split("/")[1] ?? defaultLocale;
  const locale = isLocale(segment) ? segment : defaultLocale;
  const dictionary = getDictionary(locale);

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
          <FileQuestion className="size-6" />
        </div>
        <p className="mt-6 text-sm font-medium text-muted-foreground">{dictionary.notFound.code}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{dictionary.notFound.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {dictionary.notFound.description}
        </p>
        <Link href={`/${locale}`} className={buttonVariants({ className: "mt-6" })}>
          {dictionary.notFound.back}
        </Link>
      </div>
    </main>
  );
}
