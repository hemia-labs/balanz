"use client";

import {
  FeaturePendingNotice,
  Field,
  Surface,
  SurfaceHeader,
} from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MfaSettings } from "@/components/mfa-settings";
import { SessionReauthentication } from "@/components/session-reauthentication";
import { useAccountingContext } from "@/components/accounting-context";
import { useSession } from "@/features/session/session-provider";

const copy: Record<
  string,
  { eyebrow: string; title: string; description: string }
> = {
  profile: {
    eyebrow: "Cuenta global",
    title: "Mi perfil",
    description:
      "Datos personales que se conservan entre membresías y despachos.",
  },
  security: {
    eyebrow: "Cuenta global",
    title: "Seguridad",
    description: "Administra la verificación en dos pasos de tu cuenta.",
  },
  authorization: {
    eyebrow: "Contexto autorizado",
    title: "Mi acceso",
    description:
      "Consulta el rol, los permisos efectivos y las cuentas asignadas en la organización activa.",
  },
  preferences: {
    eyebrow: "Cuenta global",
    title: "Preferencias",
    description:
      "Apariencia y preferencias personales sin mezclar administración del despacho.",
  },
  help: {
    eyebrow: "Soporte",
    title: "Ayuda y soporte",
    description:
      "Recursos de ayuda y acceso temporal cuando el backend implemente autorización JIT.",
  },
};

export function PersonalScreen({ section }: { section: string }) {
  const content = copy[section] ?? copy.profile;
  const { account, organization } = useAccountingContext();
  const { authorization, session, refreshSession } = useSession();
  const header = (
    <header className="border-l-2 border-brand-mark pl-4">
      <p className="text-caption font-semibold text-accent-foreground">
        {content.eyebrow}
      </p>
      <h1 className="text-heading-lg font-bold">{content.title}</h1>
      <p className="mt-1 text-body text-muted-foreground">
        {content.description}
      </p>
    </header>
  );
  if (section === "security")
    return (
      <div className="max-w-3xl space-y-6">
        {header}
        <MfaSettings
          initialStatus={
            session?.mfaStatus as "disabled" | "pending" | "active" | undefined
          }
          onActivated={() => void refreshSession()}
          onDisabled={() => void refreshSession()}
        />
        <SessionReauthentication />
      </div>
    );
  if (section === "authorization")
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-6 lg:grid-cols-2">
          <Surface>
            <SurfaceHeader title="Membresía activa" />
            <dl className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <dt className="text-caption font-semibold text-muted-foreground">
                  Organización
                </dt>
                <dd className="mt-1 text-body-sm font-semibold">
                  {organization.name}
                </dd>
              </div>
              <div>
                <dt className="text-caption font-semibold text-muted-foreground">
                  Rol
                </dt>
                <dd className="mt-1 identifier text-body-sm">
                  {authorization?.role ?? session?.role ?? "Sin rol activo"}
                </dd>
              </div>
              <div>
                <dt className="text-caption font-semibold text-muted-foreground">
                  Membresía
                </dt>
                <dd className="mt-1 break-all identifier text-body-sm">
                  {authorization?.membershipId ??
                    session?.membershipId ??
                    "Sin membresía activa"}
                </dd>
              </div>
              <div>
                <dt className="text-caption font-semibold text-muted-foreground">
                  Alcance de cuentas
                </dt>
                <dd className="mt-1 text-body-sm">
                  {authorization?.accountAccessMode === "tenant"
                    ? "Todas las cuentas del tenant"
                    : "Sólo asignaciones explícitas"}
                </dd>
              </div>
            </dl>
          </Surface>
          <Surface>
            <SurfaceHeader
              title={`Permisos efectivos (${authorization?.permissions.length ?? 0})`}
            />
            <ul
              className="max-h-80 divide-y divide-border overflow-y-auto"
              aria-label="Permisos efectivos"
            >
              {authorization?.permissions.length ? (
                authorization.permissions.map((permission) => (
                  <li
                    key={permission}
                    className="identifier px-5 py-3 text-body-sm"
                  >
                    {permission}
                  </li>
                ))
              ) : (
                <li className="px-5 py-4 text-body-sm text-muted-foreground">
                  No hay permisos efectivos en este contexto.
                </li>
              )}
            </ul>
          </Surface>
        </div>
        <Surface>
          <SurfaceHeader
            title={`Cuentas asignadas (${authorization?.assignedAccountIds.length ?? 0})`}
            description={
              authorization?.accountAccessMode === "tenant"
                ? "Tu alcance se resuelve a nivel tenant; no requiere una asignación individual para cada cuenta."
                : "Estos identificadores delimitan los recursos fiscales que puede consultar tu membresía."
            }
          />
          <ul className="divide-y divide-border" aria-label="Cuentas asignadas">
            {authorization?.assignedAccountIds.length ? (
              authorization.assignedAccountIds.map((accountId) => (
                <li
                  key={accountId}
                  className="break-all identifier px-5 py-3 text-body-sm"
                >
                  {accountId}
                </li>
              ))
            ) : (
              <li className="px-5 py-4 text-body-sm text-muted-foreground">
                No existen cuentas asignadas en este tenant.
              </li>
            )}
          </ul>
        </Surface>
      </div>
    );
  return (
    <div className="space-y-6">
      {header}
      <Surface>
        <SurfaceHeader title={content.title} />
        {section === "help" ? (
          <div className="space-y-4 p-5">
            <FeaturePendingNotice>
              No existe todavía un servicio de tickets ni autorización temporal
              de soporte.
            </FeaturePendingNotice>
            <Field label="Describe tu consulta">
              <textarea
                className="min-h-28 rounded-md border border-input bg-card p-3 text-body"
                placeholder="Incluye el contexto sin compartir contraseñas ni e.firma."
              />
            </Field>
            <Button disabled>Enviar solicitud</Button>
          </div>
        ) : (
          <div className="grid max-w-form gap-5 p-5 sm:grid-cols-2">
            <Field label="Nombre">
              <Input defaultValue={account.name} />
            </Field>
            <Field label="Correo">
              <Input type="email" defaultValue={account.email} />
            </Field>
            <Field label="Idioma operativo">
              <Input value="Español (México)" readOnly />
            </Field>
            <Field label="Zona horaria">
              <Input value="America/Mexico_City" readOnly />
            </Field>
            <div className="sm:col-span-2">
              <FeaturePendingNotice>
                Interfaz preparada; los cambios de cuenta no se persisten.
              </FeaturePendingNotice>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button disabled>Guardar cambios</Button>
            </div>
          </div>
        )}
      </Surface>
    </div>
  );
}
