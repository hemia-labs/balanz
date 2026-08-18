import { FeaturePendingNotice, Field, Surface, SurfaceHeader } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { demoData } from "@/lib/demo-data";

const copy: Record<string, { eyebrow: string; title: string; description: string }> = {
  perfil: { eyebrow: "Cuenta global", title: "Mi perfil", description: "Datos personales que se conservan entre membresías y despachos." },
  seguridad: { eyebrow: "Cuenta global", title: "Seguridad y MFA", description: "Controles de acceso personales; MFA requiere integración de autenticación." },
  preferencias: { eyebrow: "Cuenta global", title: "Preferencias", description: "Apariencia y preferencias personales sin mezclar administración del despacho." },
  ayuda: { eyebrow: "Soporte", title: "Ayuda y soporte", description: "Recursos de ayuda y acceso temporal cuando el backend implemente autorización JIT." },
};

export function PersonalScreen({ section }: { section: string }) {
  const content = copy[section] ?? copy.perfil;
  return <div className="space-y-6"><header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">{content.eyebrow}</p><h1 className="text-heading-lg font-bold">{content.title}</h1><p className="mt-1 text-body text-muted-foreground">{content.description}</p></header><Surface><SurfaceHeader title={content.title} />{section === "ayuda" ? <div className="space-y-4 p-5"><FeaturePendingNotice>No existe todavía un servicio de tickets ni autorización temporal de soporte.</FeaturePendingNotice><Field label="Describe tu consulta"><textarea className="min-h-28 rounded-md border border-input bg-card p-3 text-body" placeholder="Incluye el contexto sin compartir contraseñas ni e.firma." /></Field><Button disabled>Enviar solicitud</Button></div> : <div className="grid max-w-form gap-5 p-5 sm:grid-cols-2"><Field label="Nombre"><Input defaultValue={demoData.account.name} /></Field><Field label="Correo"><Input type="email" defaultValue={demoData.account.email} /></Field><Field label={section === "seguridad" ? "MFA" : "Idioma operativo"}><Input value={section === "seguridad" ? "No configurado" : "Español (México)"} readOnly /></Field><Field label="Zona horaria"><Input value="America/Mexico_City" readOnly /></Field><div className="sm:col-span-2"><FeaturePendingNotice>Interfaz preparada; los cambios de cuenta no se persisten.</FeaturePendingNotice></div><div className="sm:col-span-2 flex justify-end"><Button disabled>Guardar cambios</Button></div></div>}</Surface></div>;
}
