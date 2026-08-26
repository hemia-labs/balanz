"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  const organizationSlug = pathname.split("/").filter(Boolean)[2];
  const href = organizationSlug ? `/${locale}/organizations/${organizationSlug}/home` : `/${locale}`;
  return <div className="rounded-lg border border-destructive/30 bg-destructive-surface p-6 text-destructive" role="alert"><AlertTriangle className="size-6" /><h1 className="mt-4 text-heading-md font-bold">No pudimos cargar esta pantalla</h1><p className="mt-2 max-w-xl text-body">Intenta de nuevo. Si el problema continúa, vuelve al inicio del despacho sin perder el contexto seguro.</p><div className="mt-5 flex gap-2"><Button onClick={reset}>Reintentar</Button><Button render={<Link href={href} />} variant="outline">Volver al inicio</Button></div></div>;
}
