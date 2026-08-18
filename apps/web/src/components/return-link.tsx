"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";

export function ReturnLink({ fallback, label = "Volver" }: { fallback: string; label?: string }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("returnTo");
  const href = requested?.startsWith("/es/") ? requested : fallback;
  return <Link href={href} className="inline-flex min-h-10 items-center gap-2 font-semibold text-primary hover:underline"><ArrowLeft className="size-4" />{label}</Link>;
}
