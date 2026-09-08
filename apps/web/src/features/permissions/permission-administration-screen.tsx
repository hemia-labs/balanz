"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ellipsis,
  FileText,
  LayoutGrid,
  ReceiptText,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { PermissionBoundary } from "@/components/permission-gate";
import { Surface, SurfaceHeader } from "@/components/product-patterns";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useSession } from "@/features/session/session-provider";
import { reauthenticateSession } from "@/features/auth/api";
import { apiErrorMessage, classifyApiError } from "@/lib/api-client";
import {
  changeMembershipRole,
  getMembershipAuthorization,
  getMemberships,
  getRoles,
  revokeMembershipPermission,
  setMembershipPermission,
  type MembershipAuthorization,
  type MembershipItem,
  type RoleCatalogItem,
} from "./api";

type CategoryKey =
  "all" | "billing" | "cfdi" | "clients" | "processes" | "settings" | "other";
const categories = [
  { key: "all", label: "Todos los permisos", icon: LayoutGrid },
  { key: "billing", label: "Facturación", icon: ReceiptText },
  { key: "cfdi", label: "CFDI", icon: FileText },
  { key: "clients", label: "Clientes", icon: Users },
  { key: "processes", label: "Procesos", icon: Workflow },
  { key: "settings", label: "Configuración", icon: Settings },
  { key: "other", label: "Otros", icon: Ellipsis },
] as const;
const emptyPermissions: MembershipAuthorization["permissions"] = [];

export function PermissionAdministrationScreen({
  embedded = false,
  initialMembershipId,
  hideMemberSelector = false,
}: {
  embedded?: boolean;
  initialMembershipId?: string;
  hideMemberSelector?: boolean;
}) {
  const { organization } = useAccountingContext();
  const { session, refreshSession } = useSession();
  const [members, setMembers] = useState<MembershipItem[]>([]);
  const [roles, setRoles] = useState<RoleCatalogItem[]>([]);
  const [selected, setSelected] = useState("");
  const [authorization, setAuthorization] =
    useState<MembershipAuthorization | null>(null);
  const [category, setCategory] = useState<CategoryKey>("all");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"permissions" | "detail">("permissions");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reauthenticationOpen, setReauthenticationOpen] = useState(false);
  const [reauthenticationCode, setReauthenticationCode] = useState("");
  const pendingMutation = useRef<
    (() => Promise<MembershipAuthorization>) | null
  >(null);

  useEffect(() => {
    void Promise.all([getMemberships(organization.id), getRoles()])
      .then(([nextMembers, nextRoles]) => {
        setMembers(nextMembers);
        setRoles(nextRoles);
        setSelected(
          nextMembers.some(
            (member) => member.membershipId === initialMembershipId,
          )
            ? initialMembershipId!
            : (nextMembers[0]?.membershipId ?? ""),
        );
      })
      .catch((cause) =>
        setError(
          apiErrorMessage(cause, "No se pudo cargar la administración."),
        ),
      );
  }, [initialMembershipId, organization.id]);

  useEffect(() => {
    if (!selected) return;
    void getMembershipAuthorization(organization.id, selected)
      .then(setAuthorization)
      .catch((cause) =>
        setError(apiErrorMessage(cause, "No se pudieron cargar los permisos.")),
      );
  }, [organization.id, selected]);

  const member = members.find((item) => item.membershipId === selected);
  const protectedMember = Boolean(
    member?.isOwner || selected === session?.membershipId,
  );
  const permissions = authorization?.permissions ?? emptyPermissions;
  const counts = useMemo(() => {
    const result: Record<CategoryKey, number> = {
      all: permissions.length,
      billing: 0,
      cfdi: 0,
      clients: 0,
      processes: 0,
      settings: 0,
      other: 0,
    };
    for (const permission of permissions)
      result[permissionCategory(permission.key)] += 1;
    return result;
  }, [permissions]);
  const visiblePermissions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return permissions.filter(
      (permission) =>
        (category === "all" ||
          permissionCategory(permission.key) === category) &&
        (!normalizedQuery ||
          permission.key.toLowerCase().includes(normalizedQuery) ||
          permission.name.toLowerCase().includes(normalizedQuery)),
    );
  }, [category, permissions, query]);

  const runMutation = async (
    operation: () => Promise<MembershipAuthorization>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      setAuthorization(await operation());
      setMembers(await getMemberships(organization.id));
      return true;
    } catch (cause) {
      setError(apiErrorMessage(cause, "No se pudo guardar el cambio."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (operation: () => Promise<MembershipAuthorization>) => {
    if (protectedMember) return;
    setBusy(true);
    setError(null);
    try {
      setAuthorization(await operation());
      setMembers(await getMemberships(organization.id));
    } catch (cause) {
      if (classifyApiError(cause) === "reauthentication_required") {
        pendingMutation.current = operation;
        setReauthenticationCode("");
        setReauthenticationOpen(true);
      } else {
        setError(apiErrorMessage(cause, "No se pudo guardar el cambio."));
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmReauthentication = async (event: React.FormEvent) => {
    event.preventDefault();
    const operation = pendingMutation.current;
    if (reauthenticationCode.length !== 6 || !operation) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticateSession(reauthenticationCode);
      await refreshSession();
      setReauthenticationOpen(false);
      setReauthenticationCode("");
      pendingMutation.current = null;
      await runMutation(operation);
    } catch (cause) {
      setError(apiErrorMessage(cause, "No se pudo reautenticar la sesión."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PermissionBoundary capability="permissions.manage">
      <div className="space-y-6">
        {!embedded ? (
          <header className="border-l-2 border-brand-mark pl-4">
            <p className="text-caption font-semibold text-accent-foreground">
              Administración
            </p>
            <h1 className="text-heading-lg font-bold">Roles y permisos</h1>
            <p className="mt-1 text-body text-muted-foreground">
              Consulta roles y administra permisos específicos por integrante.
            </p>
          </header>
        ) : null}
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle>Membresía</CardTitle>
            <CardDescription>
              No puedes modificar tu propia membresía ni la del titular.
            </CardDescription>
          </CardHeader>
          <CardContent
            className={`grid gap-3 ${hideMemberSelector ? "max-w-xl" : "md:grid-cols-2"}`}
          >
            {!hideMemberSelector ? (
              <label className="grid gap-1.5 text-body-sm font-semibold">
                Integrante
                <Select
                  value={selected}
                  onValueChange={(value) => setSelected(value ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecciona un integrante">
                      {member
                        ? `${member.displayName} · ${member.email}`
                        : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((item) => (
                      <SelectItem
                        key={item.membershipId}
                        value={item.membershipId}
                      >
                        {item.displayName} · {item.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ) : null}
            <label className="grid gap-1.5 text-body-sm font-semibold">
              Rol
              <Select
                value={authorization?.role ?? ""}
                disabled={!authorization || busy || protectedMember}
                onValueChange={(value) =>
                  void mutate(() =>
                    changeMembershipRole(
                      organization.id,
                      selected,
                      value as RoleCatalogItem["key"],
                    ),
                  )
                }
              >
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue placeholder="Selecciona un rol">
                    {roles.find((role) => role.key === authorization?.role)
                      ?.name ?? null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.key} value={role.key}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </CardContent>
        </Card>

        <div
          className="flex gap-6 border-b border-border"
          role="tablist"
          aria-label="Información de la membresía"
        >
          <TabButton
            active={tab === "permissions"}
            onClick={() => setTab("permissions")}
          >
            Permisos
          </TabButton>
          <TabButton active={tab === "detail"} onClick={() => setTab("detail")}>
            Detalle del integrante
          </TabButton>
        </div>

        {tab === "permissions" ? (
          <Surface className="overflow-hidden">
            <div className="grid min-h-[30rem] md:grid-cols-[15rem_1fr]">
              <aside
                className="space-y-3 border-b border-border p-4 md:border-b-0 md:border-r"
                aria-label="Categorías de permisos"
              >
                <Input
                  type="search"
                  placeholder="Buscar permisos…"
                  aria-label="Buscar permisos"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <nav className="space-y-1">
                  {categories.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        aria-current={
                          category === item.key ? "page" : undefined
                        }
                        onClick={() => setCategory(item.key)}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-body-sm transition-colors ${category === item.key ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                      >
                        <Icon className="size-4" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        <span className="numeric rounded-full bg-muted px-2 py-0.5 text-caption">
                          {counts[item.key]}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </aside>
              <section aria-labelledby="effective-permissions-title">
                <div className="border-b border-border p-4">
                  <h2
                    id="effective-permissions-title"
                    className="text-heading-sm font-bold"
                  >
                    Permisos efectivos
                  </h2>
                  <p className="text-body-sm text-muted-foreground">
                    deny &gt; grant &gt; default del rol. Restablecer elimina el
                    override.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableCaption className="sr-only">
                      Permisos efectivos de la membresía seleccionada
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Permiso</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visiblePermissions.length ? (
                        visiblePermissions.map((permission) => (
                          <TableRow key={permission.key}>
                            <TableCell className="identifier font-semibold">
                              {permission.key}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {permission.name}
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                status={
                                  permission.effective
                                    ? "Permitido"
                                    : "Denegado"
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant={
                                    permission.override === "grant"
                                      ? "secondary"
                                      : "outline"
                                  }
                                  className={
                                    permission.override === "grant"
                                      ? "bg-success-surface text-success hover:bg-success-surface/80"
                                      : undefined
                                  }
                                  aria-pressed={permission.override === "grant"}
                                  disabled={busy || protectedMember}
                                  onClick={() =>
                                    void mutate(() =>
                                      setMembershipPermission(
                                        organization.id,
                                        selected,
                                        permission.key,
                                        "grant",
                                      ),
                                    )
                                  }
                                >
                                  Grant
                                </Button>
                                <Button
                                  size="sm"
                                  variant={
                                    permission.override === "deny"
                                      ? "secondary"
                                      : "outline"
                                  }
                                  className={
                                    permission.override === "deny"
                                      ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
                                      : undefined
                                  }
                                  aria-pressed={permission.override === "deny"}
                                  disabled={busy || protectedMember}
                                  onClick={() =>
                                    void mutate(() =>
                                      setMembershipPermission(
                                        organization.id,
                                        selected,
                                        permission.key,
                                        "deny",
                                      ),
                                    )
                                  }
                                >
                                  Deny
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={
                                    busy ||
                                    protectedMember ||
                                    !permission.override
                                  }
                                  onClick={() =>
                                    void mutate(async () => {
                                      await revokeMembershipPermission(
                                        organization.id,
                                        selected,
                                        permission.key,
                                      );
                                      return getMembershipAuthorization(
                                        organization.id,
                                        selected,
                                      );
                                    })
                                  }
                                >
                                  Restablecer
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="h-32 text-center text-muted-foreground"
                          >
                            No hay permisos que coincidan con el filtro.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          </Surface>
        ) : (
          <MemberDetail member={member} authorization={authorization} />
        )}
        <Dialog
          open={reauthenticationOpen}
          onOpenChange={(open) => {
            setReauthenticationOpen(open);
            if (!open) pendingMutation.current = null;
          }}
        >
          <DialogContent>
            <form onSubmit={confirmReauthentication} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Confirma el cambio de permisos</DialogTitle>
                <DialogDescription>
                  Ingresa el código vigente de tu aplicación autenticadora. Al
                  validarlo, aplicaremos automáticamente el cambio pendiente.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label
                  className="text-body-sm font-semibold"
                  htmlFor="role-reauth-code"
                >
                  Código de 6 dígitos
                </label>
                <InputOTP
                  id="role-reauth-code"
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
              {error ? (
                <p role="alert" className="text-body-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReauthenticationOpen(false)}
                  disabled={busy}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={busy || reauthenticationCode.length !== 6}
                >
                  {busy ? "Verificando…" : "Confirmar y aplicar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionBoundary>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`border-b-2 px-4 py-3 text-body-sm font-semibold ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

function MemberDetail({
  member,
  authorization,
}: {
  member?: MembershipItem;
  authorization: MembershipAuthorization | null;
}) {
  return (
    <Surface>
      <SurfaceHeader
        title="Detalle del integrante"
        description="Resumen de identidad, membresía y autorización en el tenant activo."
      />
      <dl className="grid gap-5 p-5 text-body-sm sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Nombre" value={member?.displayName} />
        <Detail label="Correo" value={member?.email} />
        <Detail label="Rol" value={authorization?.role} />
        <Detail label="Membresía" value={member?.status} />
        <Detail
          label="MFA"
          value={member?.mfaConfigured ? "Configurado" : "Sin configurar"}
        />
        <Detail
          label="Permisos efectivos"
          value={String(
            authorization?.permissions.filter(
              (permission) => permission.effective,
            ).length ?? 0,
          )}
        />
      </dl>
    </Surface>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value || "No disponible"}</dd>
    </div>
  );
}

function permissionCategory(key: string): Exclude<CategoryKey, "all"> {
  const prefix = key.split(".", 1)[0];
  if (
    prefix === "billing" ||
    prefix === "cfdi" ||
    prefix === "clients" ||
    prefix === "processes" ||
    prefix === "settings"
  )
    return prefix;
  return "other";
}
