import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

export function BrandMark({
  locale,
  inverse = false,
  compact = false,
}: {
  locale: Locale;
  inverse?: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={"/" + locale}
      aria-label="Balanz, inicio"
      className={cn(
        "inline-flex min-h-10 items-center gap-3 rounded-md",
        inverse ? "text-sidebar-foreground" : "text-foreground"
      )}
    >
      <span aria-hidden="true" className="h-7 w-0.5 shrink-0 bg-brand-mark" />
      <span className={cn("min-w-0", compact && "sr-only")}>
        <span className="block text-body-lg font-bold leading-none">balanz</span>
        <span
          className={cn(
            "mt-1 block text-caption leading-none",
            inverse ? "text-sidebar-foreground/70" : "text-muted-foreground"
          )}
        >
          por Hemia
        </span>
      </span>
    </Link>
  );
}
