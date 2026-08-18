import {
  ArrowLeftRight,
  BookOpenText,
  Clock3,
  FileBadge2,
  Files,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Search,
  UsersRound,
} from "lucide-react";
import type { Dictionary } from "@/lib/i18n";

export const navGroups = [
  { key: "operation" },
  { key: "analysis" },
  { key: "administration" },
] as const;

export const nav = [
  { href: "/", labelKey: "dashboard", group: "operation", icon: LayoutDashboard },
  { href: "/documents", labelKey: "documents", group: "operation", icon: Files },
  { href: "/queries", labelKey: "queries", group: "operation", icon: Search },
  { href: "/income", labelKey: "income", group: "operation", icon: ArrowLeftRight },
  { href: "/payroll", labelKey: "payroll", group: "operation", icon: FileBadge2 },
  { href: "/reports", labelKey: "reports", group: "analysis", icon: BookOpenText },
  { href: "/certificates", labelKey: "certificates", group: "administration", icon: KeyRound },
  { href: "/users", labelKey: "users", group: "administration", icon: UsersRound },
  { href: "/collaboration", labelKey: "collaboration", group: "administration", icon: MessagesSquare },
  { href: "/plans", labelKey: "plans", group: "administration", icon: Clock3 },
] as const;

export type NavLabelKey = (typeof nav)[number]["labelKey"];

export function labelFor(pathname: string, dictionary: Dictionary, locale: string) {
  const localizedRoot = "/" + locale;
  const route = pathname === localizedRoot ? "/" : pathname.slice(localizedRoot.length) || "/";
  const match = nav
    .filter((item) => (item.href === "/" ? route === "/" : route.startsWith(item.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match ? dictionary.nav[match.labelKey] : dictionary.common.section;
}

export function navItemFor(href: string) {
  return nav.find((item) => item.href === href);
}
