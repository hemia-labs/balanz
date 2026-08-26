"use client";

import { FeaturePendingNotice, Field, Surface, SurfaceHeader } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MfaSettings } from "@/components/mfa-settings";
import { useAccountingContext } from "@/components/accounting-context";
import { useSession } from "@/features/session/session-provider";

const copy: Record<string, { eyebrow: string; title: string; description: string }> = {
  profile: { eyebrow: "Cuenta global", title: "Mi perfil", description: "Datos personales que se conservan entre membresías y despachos." },
  security: { eyebrow: "Cuenta global", title: "Seguridad", description: "Administra la verificación en dos pasos de tu cuenta." },
  preferences: { eyebrow: "Cuenta global", title: "Preferencias", description: "Apariencia y preferencias personales sin mezclar administración del despacho." },
  help: { eyebrow: "Soporte", title: "Ayuda y soporte", description: "Recursos de ayuda y acceso temporal cuando el backend implemente autorización JIT." },
};

export function PersonalScreen({ section }: { section: string }) {
  const content = copy[section] ?? copy.profile;
  const { account } = useAccountingContext();
  const { session, refreshSession } = useSession();
  const header = <header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">{content.eyebrow}</p><h1 className="text-heading-lg font-bold">{content.title}</h1><p className="mt-1 text-body text-muted-foreground">{content.description}</p></header>;
  if (section === "security") return <div className="max-w-3xl space-y-6">{header}<MfaSettings initialStatus={session?.mfaStatus as "disabled" | "pending" | "active" | undefined} onActivated={() => void refreshSession()} onDisabled={() => void refreshSession()} /></div>;
  return <div className="space-y-6">{header}<Surface><SurfaceHeader title={content.title} />{section === "help" ? <div className="space-y-4 p-5"><FeaturePendingNotice>No existe todavía un servicio de tickets ni autorización temporal de soporte.</FeaturePendingNotice><Field label="Describe tu consulta"><textarea className="min-h-28 rounded-md border border-input bg-card p-3 text-body" placeholder="Incluye el contexto sin compartir contraseñas ni e.firma." /></Field><Button disabled>Enviar solicitud</Button></div> : <div className="grid max-w-form gap-5 p-5 sm:grid-cols-2"><Field label="Nombre"><Input defaultValue={account.name} /></Field><Field label="Correo"><Input type="email" defaultValue={account.email} /></Field><Field label="Idioma operativo"><Input value="Español (México)" readOnly /></Field><Field label="Zona horaria"><Input value="America/Mexico_City" readOnly /></Field><div className="sm:col-span-2"><FeaturePendingNotice>Interfaz preparada; los cambios de cuenta no se persisten.</FeaturePendingNotice></div><div className="sm:col-span-2 flex justify-end"><Button disabled>Guardar cambios</Button></div></div>}</Surface></div>;
}
