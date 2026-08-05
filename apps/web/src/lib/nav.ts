import { CheckCircle2, Clock, FileText, LayoutDashboard, Search, Settings, Users } from "lucide-react";
import type { Dictionary } from "@/lib/i18n";

export const nav = [
  { href: "/", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/documents", labelKey: "documents", icon: FileText },
  { href: "/queries", labelKey: "queries", icon: Search },
  { href: "/income", labelKey: "income", icon: FileText },
  { href: "/reports", labelKey: "reports", icon: CheckCircle2 },
  { href: "/certificates", labelKey: "certificates", icon: Settings },
  { href: "/users", labelKey: "users", icon: Users },
  { href: "/plans", labelKey: "plans", icon: Clock },
  { href: "/collaboration", labelKey: "collaboration", icon: Users },
  { href: "/payroll", labelKey: "payroll", icon: FileText },
] as const;

export function labelFor(pathname: string, dictionary: Dictionary, locale: string) {
  const localizedRoot = `/${locale}`;
  const route = pathname === localizedRoot ? "/" : pathname.slice(localizedRoot.length) || "/";
  const match = nav
    .filter((n) => (n.href === "/" ? route === "/" : route.startsWith(n.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match ? dictionary.nav[match.labelKey] : dictionary.common.section;
}
