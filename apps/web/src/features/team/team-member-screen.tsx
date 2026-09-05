"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  KeyRound,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PermissionAdministrationScreen } from "@/features/permissions/permission-administration-screen";
import { useSession } from "@/features/session/session-provider";
import { isAbortError } from "@/lib/api-client";
import { hasCapability } from "@/lib/permissions";
import {
  getTeamMembers,
  reactivateMembership,
  revokeMembership,
  suspendMembership,
  type TeamMember,
} from "./api";
import { teamErrorMessage } from "./team-errors";

type MemberOperation = "suspend" | "reactivate" | "revoke";

export function TeamMemberScreen({ membershipId }: { membershipId: string }) {
  const { capabilities, locale, organization } = useAccountingContext();
  const { session } = useSession();
  const [member, setMember] = useState<TeamMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [operation, setOperation] = useState<MemberOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const teamHref = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/team`;
  const canManageMembers = hasCapability(capabilities, "members.manage");
  const canManagePermissions = hasCapability(
    capabilities,
    "permissions.manage",
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const members = await getTeamMembers(organization.id, signal);
        if (signal?.aborted) return;
        setMember(
          members.find((item) => item.membershipId === membershipId) ?? null,
        );
      } catch (cause) {
        if (isAbortError(cause)) return;
        setError(teamErrorMessage(cause, "No pudimos cargar el integrante."));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [membershipId, organization.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function confirmOperation() {
    if (!operation || !member) return;
    setBusy(true);
    setError(null);
    try {
      if (operation === "suspend") await suspendMembership(member.membershipId);
      else if (operation === "reactivate")
        await reactivateMembership(member.membershipId);
      else await revokeMembership(member.membershipId);
      const message =
        operation === "suspend"
          ? "La membresía quedó suspendida y sus sesiones se cerraron."
          : operation === "reactivate"
            ? "La membresía quedó activa nuevamente."
            : "La membresía quedó revocada permanentemente.";
      setOperation(null);
      await load();
      setSuccess(message);
    } catch (cause) {
      setError(teamErrorMessage(cause, "No pudimos actualizar la membresía."));
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <p role="status" className="text-body text-muted-foreground">
        Cargando detalle del integrante…
      </p>
    );
  if (!member)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Integrante no disponible</CardTitle>
          <CardDescription>
            No existe dentro de la organización activa o ya no tienes acceso.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button render={<Link href={teamHref} />} variant="outline">
            <ArrowLeft aria-hidden /> Volver a equipo
          </Button>
        </CardFooter>
      </Card>
    );

  const protectedMember =
    member.isOwner || member.membershipId === session?.membershipId;
  const roleLabel = member.isOwner
    ? "Titular"
    : member.role === "admin"
      ? "Administrador"
      : member.role === "accountant"
        ? "Contador"
        : "Colaborador";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-caption font-semibold text-accent-foreground">
            Equipo
          </p>
          <h1 className="text-heading-lg font-bold">{member.displayName}</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Detalle y configuración de la membresía en {organization.name}.
          </p>
        </div>
        <Button render={<Link href={teamHref} />} variant="outline">
          <ArrowLeft aria-hidden /> Volver a equipo
        </Button>
      </header>

      <div aria-live="polite">
        {success ? (
          <p className="rounded-lg border border-success/30 bg-success-surface p-4 text-body-sm text-success">
            {success}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive-surface p-4 text-body-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4" aria-hidden /> Identidad
            </CardTitle>
            <CardDescription>
              Datos visibles de la identidad global.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Nombre" value={member.displayName} />
              <Detail label="Correo" value={member.email} />
              <Detail label="Rol" value={roleLabel} />
              <Detail
                label="Membresía"
                value={<StatusBadge status={statusLabel(member.status)} />}
              />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" aria-hidden /> Seguridad y
              actividad
            </CardTitle>
            <CardDescription>
              Verificación y fechas del acceso organizacional.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail
                label="MFA"
                value={member.mfaConfigured ? "Configurado" : "Sin configurar"}
              />
              <Detail
                label="Fecha de alta"
                value={formatDate(member.joinedAt ?? member.createdAt)}
              />
              <Detail
                label="Última actualización"
                value={formatDate(member.updatedAt)}
              />
              <Detail
                label="Condición"
                value={
                  member.status === "active"
                    ? "Puede iniciar sesión según permisos"
                    : "Acceso organizacional bloqueado"
                }
              />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BriefcaseBusiness className="size-4" aria-hidden /> Cuentas
              cliente
            </CardTitle>
            <CardDescription>
              El acceso a la cartera se administra mediante asignaciones
              independientes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-body-sm text-muted-foreground">
              Esta membresía no obtiene acceso a todas las cuentas por
              pertenecer al despacho. Consulta el flujo de asignaciones de cada
              cliente.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" aria-hidden /> Estado administrativo
            </CardTitle>
            <CardDescription>
              Las acciones modifican acceso y sesiones, no la identidad global.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-body-sm text-muted-foreground">
              {protectedMember
                ? "La membresía del titular o de tu sesión actual está protegida."
                : "Suspender es reversible; revocar requiere un nuevo flujo de incorporación."}
            </p>
          </CardContent>
          {canManageMembers &&
          !protectedMember &&
          member.status !== "revoked" ? (
            <CardFooter className="gap-2">
              {member.status === "active" ? (
                <Button
                  variant="outline"
                  onClick={() => setOperation("suspend")}
                >
                  Suspender
                </Button>
              ) : null}
              {member.status === "suspended" ? (
                <Button
                  variant="outline"
                  onClick={() => setOperation("reactivate")}
                >
                  Reactivar
                </Button>
              ) : null}
              <Button
                variant="destructive"
                onClick={() => setOperation("revoke")}
              >
                Revocar
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      </div>

      {canManagePermissions ? (
        <section aria-labelledby="role-permissions-title">
          <div className="mb-4">
            <h2
              id="role-permissions-title"
              className="text-heading-md font-bold"
            >
              Rol y permisos
            </h2>
            <p className="text-body-sm text-muted-foreground">
              El rol define el máximo y los overrides ajustan permisos
              específicos.
            </p>
          </div>
          <PermissionAdministrationScreen
            embedded
            initialMembershipId={membershipId}
            hideMemberSelector
          />
        </section>
      ) : null}

      <OperationDialog
        operation={operation}
        member={member}
        busy={busy}
        onClose={() => !busy && setOperation(null)}
        onConfirm={confirmOperation}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}
function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Pendiente";
}
function statusLabel(status: TeamMember["status"]) {
  return status === "active"
    ? "Activo"
    : status === "pending"
      ? "Pendiente"
      : status === "suspended"
        ? "Suspendido"
        : "Revocado";
}

function OperationDialog({
  operation,
  member,
  busy,
  onClose,
  onConfirm,
}: {
  operation: MemberOperation | null;
  member: TeamMember;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const copy =
    operation === "suspend"
      ? {
          title: "Suspender membresía",
          description: `${member.displayName} perderá acceso y sus sesiones activas se cerrarán.`,
          action: "Suspender",
        }
      : operation === "reactivate"
        ? {
            title: "Reactivar membresía",
            description: `${member.displayName} podrá iniciar una nueva sesión según su rol y asignaciones.`,
            action: "Reactivar",
          }
        : {
            title: "Revocar membresía",
            description: `El acceso de ${member.displayName} se retirará permanentemente.`,
            action: "Revocar",
          };
  return (
    <Dialog
      open={Boolean(operation)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            Cancelar
          </DialogClose>
          <Button
            variant={operation === "reactivate" ? "default" : "destructive"}
            disabled={busy}
            aria-busy={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "Procesando…" : copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
