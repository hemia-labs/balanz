import Link from "next/link";
import { Building2, CheckCircle2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { FeaturePendingNotice, Field, Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { demoOrganizationId } from "@/lib/demo-data";

export default function OnboardingPage() {
  const steps = ["Completar datos del despacho", "Crear primer cliente", "Asignar responsable", "Crear ejercicio", "Registrar e.firma o hacerlo después"];
  return <main id="main-content" className="min-h-screen w-full bg-background px-4 py-8"><div className="mx-auto max-w-form space-y-6"><BrandMark locale="es" /><header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">Primer despacho</p><h1 className="text-heading-lg font-bold">Crea tu despacho</h1><p className="mt-1 text-body text-muted-foreground">Serás Titular de la organización. No se contratará ni asignará un plan automáticamente.</p></header><FeaturePendingNotice>El backend de despachos y contratación aún no existe. Este formulario no persiste información.</FeaturePendingNotice><Surface className="p-5"><div className="grid gap-5 sm:grid-cols-2"><Field label="Nombre del despacho"><Input placeholder="Estudio contable" /></Field><Field label="Zona horaria"><Input value="America/Mexico_City" readOnly /></Field></div><div className="mt-6"><h2 className="text-heading-sm font-emphasis">Pasos posteriores</h2><ol className="mt-3 space-y-2">{steps.map((step, index) => <li key={step} className="flex items-center gap-3 rounded-md border border-border px-4 py-3"><span className="grid size-6 place-items-center rounded-full bg-secondary text-caption font-bold text-secondary-foreground">{index + 1}</span>{step}</li>)}</ol></div><div className="mt-6 flex flex-wrap justify-end gap-2"><Button render={<Link href="/es/login" />} variant="outline">Volver</Button><Button render={<Link href={`/es/despachos/${demoOrganizationId}/inicio`} />}><Building2 />Abrir demostración</Button></div></Surface><p className="flex items-center gap-2 text-caption text-muted-foreground"><CheckCircle2 className="size-4" />Los datos mostrados en la demostración son ficticios.</p></div></main>;
}
