"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw, UserPlus } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { Surface, SurfaceHeader } from "@/components/product-patterns";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reauthenticateSession } from "@/features/auth/api";
import { useSession } from "@/features/session/session-provider";
import { classifyApiError, isAbortError } from "@/lib/api-client";
import { hasCapability } from "@/lib/permissions";
import {
  createInvitation,
  getInvitations,
  getTeamMembers,
  reactivateMembership,
  revokeInvitation,
  revokeMembership,
  suspendMembership,
  type InvitationItem,
  type MembershipStatus,
  type TeamMember,
  type TeamRole,
} from "./api";
import { teamErrorMessage } from "./team-errors";

const roleLabels: Record<TeamRole, string> = {
  admin: "Administrador",
  accountant: "Contador",
  collaborator: "Colaborador",
};

const membershipLabels: Record<MembershipStatus, string> = {
  active: "Activo",
  pending: "Pendiente",
  suspended: "Suspendido",
  revoked: "Revocado",
};

const invitationLabels = {
  pending: "Pendiente",
  accepted: "Aceptada",
  expired: "Expirada",
  revoked: "Revocada",
} as const;

type PendingAction =
  | { kind: "invitation-revoke"; invitation: InvitationItem }
  | {
      kind:
        "membership-suspend" | "membership-reactivate" | "membership-revoke";
      member: TeamMember;
    };

export function TeamScreen() {
  const { capabilities, locale, organization } = useAccountingContext();
  const canManage = hasCapability(capabilities, "members.manage");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const [nextMembers, nextInvitations] = await Promise.all([
          getTeamMembers(organization.id, signal),
          canManage
            ? getInvitations(organization.id, signal)
            : Promise.resolve({ items: [] }),
        ]);
        if (signal?.aborted) return;
        setMembers(nextMembers);
        setInvitations(nextInvitations.items);
      } catch (cause) {
        if (isAbortError(cause)) return;
        setError(
          teamErrorMessage(
            cause,
            "No pudimos cargar el equipo. Revisa tu conexión e intenta de nuevo.",
          ),
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canManage, organization.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const refresh = async (message: string) => {
    await load();
    setSuccess(message);
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    const key =
      pendingAction.kind === "invitation-revoke"
        ? pendingAction.invitation.id
        : pendingAction.member.membershipId;
    setBusyAction(key);
    setError(null);
    try {
      if (pendingAction.kind === "invitation-revoke") {
        await revokeInvitation(pendingAction.invitation.id);
        await refresh("La invitación quedó revocada.");
      } else if (pendingAction.kind === "membership-suspend") {
        await suspendMembership(pendingAction.member.membershipId);
        await refresh(
          "La membresía quedó suspendida y sus sesiones se cerraron.",
        );
      } else if (pendingAction.kind === "membership-reactivate") {
        await reactivateMembership(pendingAction.member.membershipId);
        await refresh("La membresía quedó activa nuevamente.");
      } else {
        await revokeMembership(pendingAction.member.membershipId);
        await refresh("La membresía quedó revocada permanentemente.");
      }
      setPendingAction(null);
    } catch (cause) {
      setError(
        teamErrorMessage(cause, "No pudimos completar el cambio solicitado."),
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-caption font-semibold text-accent-foreground">
            Administración
          </p>
          <h1 className="text-heading-lg font-bold">Equipo</h1>
          <p className="mt-1 max-w-reading text-body text-muted-foreground">
            Consulta quién pertenece a {organization.name} y administra sus
            invitaciones y accesos.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canManage ? (
            <InviteDialog
              organizationName={organization.name}
              organizationId={organization.id}
              open={inviteOpen}
              onOpenChange={setInviteOpen}
              onCreated={() => refresh("La invitación fue enviada.")}
            />
          ) : null}
        </div>
      </header>

      <>
        <div aria-live="polite" aria-atomic="true">
          {success ? (
            <p className="rounded-lg border border-success/30 bg-success-surface p-4 text-body-sm text-success">
              {success}
            </p>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive-surface p-4 text-destructive"
            >
              <p className="flex gap-2 text-body-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => load()}
              >
                <RefreshCw aria-hidden /> Reintentar
              </Button>
            </div>
          ) : null}
        </div>

        <Surface>
          <SurfaceHeader
            title="Miembros"
            description="El rol define el máximo permitido; las cuentas cliente requieren una asignación independiente."
          />
          <MembersTable
            members={members}
            loading={loading}
            detailBaseHref={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/team`}
          />
        </Surface>

        {canManage ? (
          <Surface>
            <SurfaceHeader
              title="Invitaciones"
              description="El correo muestra el estado confirmado por el servidor; una invitación no concede cuentas ni permisos por sí sola."
            />
            <InvitationsTable
              invitations={invitations}
              loading={loading}
              busyAction={busyAction}
              onRevoke={(invitation) =>
                setPendingAction({ kind: "invitation-revoke", invitation })
              }
            />
          </Surface>
        ) : null}

        <ConfirmationDialog
          action={pendingAction}
          busy={busyAction !== null}
          onClose={() => !busyAction && setPendingAction(null)}
          onConfirm={confirmAction}
        />
      </>
    </div>
  );
}

function InviteDialog({
  organizationId,
  organizationName,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationId: string;
  organizationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const { refreshSession } = useSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("collaborator");
  const [expiresOn, setExpiresOn] = useState("");
  const [requiresReauthentication, setRequiresReauthentication] =
    useState(false);
  const [reauthenticationCode, setReauthenticationCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRequiresReauthentication(false);
      setReauthenticationCode("");
      setFormError(null);
    }
    onOpenChange(nextOpen);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const expiresAt = new Date(`${expiresOn}T23:59:59`);
    try {
      if (requiresReauthentication) {
        await reauthenticateSession(reauthenticationCode);
        await refreshSession();
      }
      await createInvitation(organizationId, {
        email,
        role,
        expiresAt: expiresAt.toISOString(),
      });
      setEmail("");
      setRole("collaborator");
      setExpiresOn("");
      setRequiresReauthentication(false);
      setReauthenticationCode("");
      onOpenChange(false);
      await onCreated();
    } catch (cause) {
      if (classifyApiError(cause) === "reauthentication_required") {
        setRequiresReauthentication(true);
        setReauthenticationCode("");
      } else {
        setFormError(
          teamErrorMessage(cause, "No pudimos enviar la invitación."),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <UserPlus aria-hidden /> Invitar miembro
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Invitar miembro</DialogTitle>
            <DialogDescription>
              La invitación pertenecerá a {organizationName}. No asignará
              cuentas cliente ni permisos personalizados.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 px-5 pt-2 pb-5">
            <label className="grid gap-2 text-body-sm font-semibold">
              Correo electrónico
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(formError)}
                aria-describedby={formError ? "invite-error" : undefined}
                placeholder="persona@despacho.mx"
              />
            </label>
            {requiresReauthentication ? (
              <div className="grid gap-2 rounded-lg bg-muted/60 p-4">
                <label
                  htmlFor="invitation-reauth-code"
                  className="text-body-sm font-semibold"
                >
                  Confirma con tu código MFA
                </label>
                <p className="text-caption text-muted-foreground">
                  Por seguridad, confirma esta acción con el código vigente de
                  tu aplicación autenticadora.
                </p>
                <InputOTP
                  id="invitation-reauth-code"
                  maxLength={6}
                  value={reauthenticationCode}
                  onChange={setReauthenticationCode}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  autoFocus
                >
                  <InputOTPGroup className="gap-2">
                    {Array.from({ length: 6 }, (_, index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
            ) : null}
            <label className="grid gap-2 text-body-sm font-semibold">
              Rol inicial
              <Select
                value={role}
                onValueChange={(value) => setRole(value as TeamRole)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue>{roleLabels[role]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collaborator">Colaborador</SelectItem>
                  <SelectItem value="accountant">Contador</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-body-sm font-semibold">
              Fecha límite para aceptar
              <Input
                type="date"
                required
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
                aria-describedby="invitation-expiration-help"
              />
              <span
                id="invitation-expiration-help"
                className="text-caption font-normal text-muted-foreground"
              >
                Después de esta fecha, la invitación ya no podrá aceptarse.
              </span>
            </label>
            {formError ? (
              <p
                id="invite-error"
                role="alert"
                className="text-body-sm text-destructive"
              >
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="p-5">
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              type="submit"
              disabled={
                submitting ||
                (requiresReauthentication && reauthenticationCode.length !== 6)
              }
              aria-busy={submitting}
            >
              {submitting
                ? "Enviando…"
                : requiresReauthentication
                  ? "Confirmar y enviar"
                  : "Enviar invitación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MembersTable({
  members,
  loading,
  detailBaseHref,
}: {
  members: TeamMember[];
  loading: boolean;
  detailBaseHref: string;
}) {
  return (
    <div className="overflow-x-auto" aria-busy={loading}>
      <Table>
        <TableCaption className="sr-only">
          Miembros del despacho activo
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Miembro</TableHead>
            <TableHead scope="col">Rol</TableHead>
            <TableHead scope="col">Membresía</TableHead>
            <TableHead scope="col">MFA</TableHead>
            <TableHead scope="col">Alta</TableHead>
            <TableHead scope="col">Actualización</TableHead>
            <TableHead scope="col">Acción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <LoadingRow columns={7} />
          ) : members.length === 0 ? (
            <EmptyRow
              columns={7}
              message="No hay miembros para mostrar en esta organización."
            />
          ) : (
            members.map((member) => (
              <TableRow key={member.membershipId}>
                <TableCell>
                  <p className="font-semibold">{member.displayName}</p>
                  <p className="text-caption text-muted-foreground">
                    {member.email}
                  </p>
                </TableCell>
                <TableCell>
                  {member.isOwner ? "Titular" : roleLabels[member.role]}
                </TableCell>
                <TableCell>
                  <StatusBadge status={membershipLabels[member.status]} />
                </TableCell>
                <TableCell>
                  {member.mfaConfigured ? "Configurado" : "Sin configurar"}
                </TableCell>
                <TableCell className="numeric whitespace-nowrap">
                  {formatDate(member.joinedAt ?? member.createdAt)}
                </TableCell>
                <TableCell className="numeric whitespace-nowrap">
                  {formatDate(member.updatedAt)}
                </TableCell>
                <TableCell>
                  <MemberActions
                    detailHref={`${detailBaseHref}/${encodeURIComponent(member.membershipId)}`}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function MemberActions({ detailHref }: { detailHref: string }) {
  return (
    <Button render={<Link href={detailHref} />} size="sm" variant="outline">
      Ver detalle
    </Button>
  );
}

function InvitationsTable({
  invitations,
  loading,
  busyAction,
  onRevoke,
}: {
  invitations: InvitationItem[];
  loading: boolean;
  busyAction: string | null;
  onRevoke: (invitation: InvitationItem) => void;
}) {
  return (
    <div className="overflow-x-auto" aria-busy={loading}>
      <Table>
        <TableCaption className="sr-only">
          Invitaciones del despacho activo
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Destinatario</TableHead>
            <TableHead scope="col">Rol</TableHead>
            <TableHead scope="col">Estado</TableHead>
            <TableHead scope="col">Expira</TableHead>
            <TableHead scope="col">Último envío</TableHead>
            <TableHead scope="col">Acción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <LoadingRow columns={6} />
          ) : invitations.length === 0 ? (
            <EmptyRow columns={6} message="No hay invitaciones para mostrar." />
          ) : (
            invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="font-semibold">
                  {invitation.email}
                </TableCell>
                <TableCell>{roleLabels[invitation.role]}</TableCell>
                <TableCell>
                  <StatusBadge status={invitationLabels[invitation.status]} />
                </TableCell>
                <TableCell className="numeric whitespace-nowrap">
                  {formatDate(invitation.expiresAt)}
                </TableCell>
                <TableCell className="numeric whitespace-nowrap">
                  {formatDate(invitation.lastSentAt)}
                </TableCell>
                <TableCell>
                  {invitation.status === "pending" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyAction === invitation.id}
                      onClick={() => onRevoke(invitation)}
                    >
                      Revocar invitación
                    </Button>
                  ) : (
                    <span className="text-caption text-muted-foreground">
                      Sin acciones disponibles
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ConfirmationDialog({
  action,
  busy,
  onClose,
  onConfirm,
}: {
  action: PendingAction | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const copy = confirmationCopy(action);
  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="outline" disabled={busy} />}
          >
            Cancelar
          </DialogClose>
          <Button
            type="button"
            variant={copy.destructive ? "destructive" : "default"}
            disabled={busy}
            aria-busy={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "Procesando…" : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function confirmationCopy(action: PendingAction | null) {
  if (!action)
    return {
      title: "Confirmar acción",
      description: "",
      confirm: "Confirmar",
      destructive: false,
    };
  if (action.kind === "invitation-revoke")
    return {
      title: "Revocar invitación",
      description: `La invitación para ${action.invitation.email} dejará de ser válida inmediatamente.`,
      confirm: "Revocar invitación",
      destructive: true,
    };
  if (action.kind === "membership-suspend")
    return {
      title: "Suspender membresía",
      description: `${action.member.displayName} perderá acceso y sus sesiones activas se cerrarán. Podrás reactivar la membresía después.`,
      confirm: "Suspender membresía",
      destructive: true,
    };
  if (action.kind === "membership-reactivate")
    return {
      title: "Reactivar membresía",
      description: `${action.member.displayName} podrá iniciar una nueva sesión conforme a su rol y asignaciones.`,
      confirm: "Reactivar membresía",
      destructive: false,
    };
  return {
    title: "Revocar membresía",
    description: `El acceso de ${action.member.displayName} se retirará permanentemente y sus sesiones activas se cerrarán.`,
    confirm: "Revocar membresía",
    destructive: true,
  };
}

function LoadingRow({ columns }: { columns: number }) {
  return (
    <TableRow>
      <TableCell
        colSpan={columns}
        className="h-32 text-center text-muted-foreground"
      >
        <span role="status">Cargando información del equipo…</span>
      </TableCell>
    </TableRow>
  );
}
function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <TableRow>
      <TableCell
        colSpan={columns}
        className="h-32 text-center text-muted-foreground"
      >
        {message}
      </TableCell>
    </TableRow>
  );
}
function formatDate(value: string | null) {
  if (!value) return "Pendiente";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
