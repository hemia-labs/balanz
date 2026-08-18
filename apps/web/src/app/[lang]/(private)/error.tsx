"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="rounded-lg border border-destructive/30 bg-destructive-surface p-6 text-destructive" role="alert"><AlertTriangle className="size-6" /><h1 className="mt-4 text-heading-md font-bold">No pudimos cargar esta pantalla</h1><p className="mt-2 max-w-xl text-body">Intenta de nuevo. Si el problema continúa, vuelve al inicio del despacho sin perder el contexto seguro.</p><div className="mt-5 flex gap-2"><Button onClick={reset}>Reintentar</Button><Button render={<Link href="/es/despachos/estudio-norte/inicio" />} variant="outline">Volver al inicio</Button></div></div>;
}
