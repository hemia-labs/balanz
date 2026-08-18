"use client";

import { useEffect, useRef } from "react";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { AppNavigation } from "@/components/app-navigation";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import type { Dictionary, Locale } from "@/lib/i18n";

export function MobileNavigation({
  locale,
  dictionary,
}: {
  locale: Locale;
  dictionary: Dictionary;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (dialogRef.current?.open) dialogRef.current.close();
  }, [pathname]);

  function openNavigation() {
    dialogRef.current?.showModal();
  }

  function closeNavigation() {
    dialogRef.current?.close();
  }

  return (
    <div className="md:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={openNavigation}
        aria-label={dictionary.sidebar.open}
      >
        <Menu className="size-5" />
      </Button>
      <dialog
        ref={dialogRef}
        aria-label={dictionary.sidebar.mainNavigation}
        className="m-0 h-dvh w-[calc(100%-2rem)] max-h-none max-w-sm border-0 border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-overlay"
      >
        <div className="flex min-h-full flex-col">
          <div className="flex h-topbar items-center justify-between border-b border-sidebar-border px-4">
            <BrandMark locale={locale} inverse />
            <Button
              type="button"
              variant="sidebar"
              size="icon"
              onClick={closeNavigation}
              aria-label={dictionary.sidebar.close}
            >
              <X className="size-5" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-5">
            <AppNavigation
              locale={locale}
              dictionary={dictionary}
              onNavigate={closeNavigation}
            />
          </div>
          <p className="border-t border-sidebar-border px-5 py-4 text-caption text-sidebar-foreground/65">
            {dictionary.sidebar.productLabel}
          </p>
        </div>
      </dialog>
    </div>
  );
}
