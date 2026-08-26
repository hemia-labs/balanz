import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { FeaturePendingNotice, Field, Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function ForgotPasswordPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return <main id="main-content" className="min-h-screen w-full bg-background px-4 py-10"><div className="mx-auto max-w-md space-y-6"><BrandMark locale={lang as "es"} /><header className="border-l-2 border-brand-mark pl-4"><h1 className="text-heading-lg font-bold">Recupera tu contraseña</h1><p className="mt-1 text-body text-muted-foreground">Ingresa el correo de tu cuenta global.</p></header><Surface className="space-y-5 p-5"><FeaturePendingNotice>No existe un endpoint de recuperación; no se enviará correo.</FeaturePendingNotice><Field label="Correo electrónico"><Input type="email" placeholder="persona@example.test" /></Field><Button className="w-full" disabled>Enviar instrucciones</Button></Surface><Link href={`/${lang}/login`} className="inline-flex min-h-10 items-center font-semibold text-primary hover:underline">Volver a iniciar sesión</Link></div></main>;
}
