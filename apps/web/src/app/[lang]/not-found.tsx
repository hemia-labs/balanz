"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { getDictionary, isLocale, defaultLocale } from "@/lib/i18n";
import { usePathname } from "next/navigation";

export default function NotFound() {
  const pathname = usePathname();
  const segment = pathname?.split("/")[1] ?? defaultLocale;
  const locale = isLocale(segment) ? segment : defaultLocale;
  const dictionary = getDictionary(locale);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-[100dvh] w-full items-center justify-center px-4 py-12 focus:outline-none sm:px-6"
    >
      <div className="mx-auto w-full max-w-lg">
        <BrandMark locale={locale} />
        <div className="mt-10 border-l-2 border-brand-mark pl-5">
          <p className="text-caption font-semibold text-accent-foreground">{dictionary.notFound.code}</p>
          <h1 className="mt-1 text-heading-lg font-bold">{dictionary.notFound.title}</h1>
          <p className="mt-2 max-w-md text-body text-muted-foreground">
            {dictionary.notFound.description}
          </p>
        </div>
        <Link href={"/" + locale} className={buttonVariants({ className: "mt-8" })}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {dictionary.notFound.back}
        </Link>
      </div>
    </main>
  );
}
