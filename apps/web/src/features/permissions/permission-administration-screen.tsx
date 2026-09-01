"use client";

import { useEffect, useState } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { PermissionBoundary } from "@/components/permission-gate";
import { Surface, SurfaceHeader } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api-client";
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

export function PermissionAdministrationScreen() {
  const { organization } = useAccountingContext();
  const [members, setMembers] = useState<MembershipItem[]>([]);
  const [roles, setRoles] = useState<RoleCatalogItem[]>([]);
  const [selected, setSelected] = useState("");
  const [authorization, setAuthorization] =
    useState<MembershipAuthorization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getMemberships(organization.id), getRoles()])
      .then(([nextMembers, nextRoles]) => {
        setMembers(nextMembers);
        setRoles(nextRoles);
        setSelected(nextMembers[0]?.membershipId ?? "");
      })
      .catch((cause) =>
        setError(
          apiErrorMessage(cause, "No se pudo cargar la administración."),
        ),
      );
    return () => controller.abort();
  }, [organization.id]);

  useEffect(() => {
    if (!selected) return;
    void getMembershipAuthorization(organization.id, selected)
      .then(setAuthorization)
      .catch((cause) =>
        setError(apiErrorMessage(cause, "No se pudieron cargar los permisos.")),
      );
  }, [organization.id, selected]);

  const mutate = async (operation: () => Promise<MembershipAuthorization>) => {
    setBusy(true);
    setError(null);
    try {
      setAuthorization(await operation());
      setMembers(await getMemberships(organization.id));
    } catch (cause) {
      setError(apiErrorMessage(cause, "No se pudo guardar el cambio."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PermissionBoundary capability="permissions.manage">
      <div className="space-y-6">
        <header className="border-l-2 border-brand-mark pl-4">
          <p className="text-caption font-semibold text-accent-foreground">
            Administración
          </p>
          <h1 className="text-heading-lg font-bold">Roles y permisos</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Los roles son un catálogo cerrado; aquí puedes consultarlos,
            asignarlos y administrar overrides.
          </p>
        </header>
        {error ? (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Surface>
          <SurfaceHeader
            title="Membresía"
            description="No puedes modificar tu propia membresía ni la del titular."
          />
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <label className="grid gap-1 text-body-sm font-semibold">
              Integrante
              <select
                className="h-10 rounded-md border border-input bg-card px-3"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {members.map((member) => (
                  <option key={member.membershipId} value={member.membershipId}>
                    {member.displayName} · {member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-body-sm font-semibold">
              Rol
              <select
                className="h-10 rounded-md border border-input bg-card px-3"
                value={authorization?.role ?? ""}
                disabled={!authorization || busy}
                onChange={(event) =>
                  void mutate(() =>
                    changeMembershipRole(
                      organization.id,
                      selected,
                      event.target.value as RoleCatalogItem["key"],
                    ),
                  )
                }
              >
                {roles.map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Surface>
        <Surface>
          <SurfaceHeader
            title="Permisos efectivos"
            description="deny > grant > default del rol. Restablecer elimina el override y vuelve al default."
          />
          <div className="divide-y divide-border">
            {authorization?.permissions.map((permission) => (
              <div
                key={permission.key}
                className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center"
              >
                <div>
                  <p className="identifier font-semibold">{permission.key}</p>
                  <p className="text-caption text-muted-foreground">
                    {permission.name} · default:{" "}
                    {permission.roleDefault ? "sí" : "no"} · efectivo:{" "}
                    {permission.effective ? "permitido" : "denegado"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={
                      permission.override === "grant" ? "default" : "outline"
                    }
                    disabled={busy}
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
                      permission.override === "deny" ? "destructive" : "outline"
                    }
                    disabled={busy}
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
                    disabled={busy || !permission.override}
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
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </PermissionBoundary>
  );
}
