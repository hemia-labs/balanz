"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Bell, Moon, Search, Sun, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
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
import { labelFor } from "@/lib/nav";
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
  const title = labelFor(pathname, dictionary, locale);
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
    const suffix = pathname === `/${locale}` ? "" : pathname.slice(`/${locale}`.length);
    router.push(`/${value}${suffix}`);
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background px-6 lg:px-8">
      <div className="flex flex-col">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-xs text-muted-foreground">{dictionary.topbar.workspaceSummary}</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" placeholder={dictionary.topbar.searchPlaceholder} className="h-9 w-64 pl-8" />
        </div>
        <Button variant="ghost" size="icon" aria-label={dictionary.topbar.notifications}>
          <Bell className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={dictionary.topbar.profile}
            className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <UserRound className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{dictionary.topbar.preferences}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={handleThemeChange}
            >
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
              <DropdownMenuRadioItem value="es">
                {dictionary.topbar.spanish}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en">
                {dictionary.topbar.english}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
