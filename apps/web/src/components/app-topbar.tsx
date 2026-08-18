"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Bell, Moon, Search, Sun, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { MobileNavigation } from "@/components/mobile-navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { isLocale, type Dictionary, type Locale } from "@/lib/i18n";

type Theme = "light" | "dark";
const useThemeEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function getInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";

  const storedTheme = localStorage.getItem("theme");
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;

  return document.documentElement.dataset.theme === "dark" ||
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function AppTopbar({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useThemeEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function handleThemeChange(value: string) {
    const nextTheme: Theme = value === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  }

  function handleLocaleChange(value: string) {
    if (!isLocale(value) || value === locale) return;
    const suffix = pathname === "/" + locale ? "" : pathname.slice(("/" + locale).length);
    router.push("/" + value + suffix);
  }

  return (
    <header className="sticky top-0 z-10 flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:px-4 lg:px-6">
      <MobileNavigation locale={locale} dictionary={dictionary} />
      <div className="min-w-0">
        <p className="truncate text-body-sm font-semibold">{dictionary.topbar.productLabel}</p>
        <p className="hidden text-caption text-muted-foreground sm:block">{dictionary.topbar.productContext}</p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <form
          role="search"
          onSubmit={(event) => event.preventDefault()}
          className="relative mr-1 hidden lg:block"
        >
          <label htmlFor="global-search" className="sr-only">
            {dictionary.topbar.searchLabel}
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="global-search"
            type="search"
            placeholder={dictionary.topbar.searchPlaceholder}
            className="w-72 pl-9"
          />
        </form>
        <Button variant="ghost" size="icon" aria-label={dictionary.topbar.notifications}>
          <Bell className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={dictionary.topbar.profile}
            className="grid size-10 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <UserRound className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{dictionary.topbar.preferences}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
              <DropdownMenuRadioItem value="light">
                <Sun className="size-4" />
                {dictionary.topbar.light}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon className="size-4" />
                {dictionary.topbar.dark}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{dictionary.topbar.language}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuRadioGroup value={locale} onValueChange={handleLocaleChange}>
              <DropdownMenuRadioItem value="es">{dictionary.topbar.spanish}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en">{dictionary.topbar.english}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
