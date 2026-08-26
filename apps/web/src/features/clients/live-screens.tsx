"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Archive, Plus, RefreshCw, Save, UserRoundPlus, X } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import {
  DefinitionGrid,
  Field,
  FilterBar,
  Surface,
  SurfaceHeader,
  WarningNotice,
} from "@/components/product-patterns";
import { ProductTable } from "@/components/product-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiErrorMessage, isAbortError } from "@/lib/api-client";
import {
  archiveClient,
  archiveLegalEntity,
  createAssignment,
  createClient,
  createFiscalYear,
  createLegalEntity,
  getAvailableMembers,
  getClient,
  getClients,
  getFiscalYears,
  getPeriods,
  getPrimaryCandidates,
  revokeAssignment,
  updateClient,
  updateLegalEntity,
} from "./api";
import type {
  AssignmentResponsibility,
  ClientDetail,
  ClientPage,
  FiscalYear,
  LegalEntity,
  MemberCandidate,
  PeriodsResponse,
} from "./types";

const selectClass =
  "h-10 rounded-md border border-input bg-card px-3 text-body-sm";
const roleLabels: Record<string, string> = {
  owner: "Titular",
  accountant: "Contador responsable",
  collaborator: "Colaborador",
};
const responsibilityLabels: Record<AssignmentResponsibility, string> = {
  primary: "Responsable principal",
  collaborator: "Colaborador",
  reviewer: "Revisor",
};
const RFC_PATTERN = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
const monthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function ErrorNotice({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-body-sm text-destructive"
    >
      {apiErrorMessage(error, fallback)}
    </div>
  );
}

function apiFieldError(error: unknown, ...fields: string[]) {
  if (!(error instanceof ApiError)) return undefined;
  for (const field of fields) {
    const message = error.fieldErrors[field]?.[0];
    if (message) return message;
  }
  return undefined;
}

function LoadingState({ label = "Cargando clientes…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-card p-8 text-center text-body-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-lg border border-border bg-card p-0 text-card-foreground shadow-overlay"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-heading-sm font-emphasis">{title}</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X />
        </Button>
      </div>
      {children}
    </dialog>
  );
}

function useClientDetail(clientId: string) {
  const { organization, registerClientName } = useAccountingContext();
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setLoading(true);
      setError(null);
      void getClient(clientId, controller.signal)
        .then((nextDetail) => {
          setDetail(nextDetail);
          registerClientName(nextDetail.account.id, nextDetail.account.name);
        })
        .catch((cause) => {
          if (!isAbortError(cause)) setError(cause);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [clientId, organization.id, registerClientName, revision]);
  return { detail, error, loading, reload };
}

function NewClientDialog({
  open,
  onClose,
  base,
}: {
  open: boolean;
  onClose: () => void;
  base: string;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberCandidate[]>([]);
  const [name, setName] = useState("");
  const [rfc, setRfc] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void getPrimaryCandidates(controller.signal)
      .then((items) => {
        setError(null);
        setMembers(items);
        setMembershipId((current) => current || items[0]?.membershipId || "");
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setError(cause);
      });
    return () => controller.abort();
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const normalizedRfc = rfc.trim().toUpperCase();
    if (!RFC_PATTERN.test(normalizedRfc)) {
      setError(
        new ApiError(
          422,
          "Revisa los campos señalados e intenta de nuevo.",
          "VALIDATION_ERROR",
          {
            "legalEntity.rfc": [
              "Ingresa un RFC válido de 12 o 13 caracteres, sin espacios ni guiones.",
            ],
          },
        ),
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await createClient({
        accountName: name.trim(),
        legalEntity: { legalName: name.trim(), rfc: normalizedRfc },
        primaryMembershipId: membershipId,
        fiscalYear: year,
      });
      onClose();
      router.push(
        `${base}/clients/${created.clientAccountId}/legal-entities/${created.legalEntityId}/fiscal-years/${year}`,
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  const rfcConflict =
    error instanceof ApiError && error.code === "LEGAL_ENTITY_RFC_CONFLICT";
  const nameError = apiFieldError(
    error,
    "accountName",
    "legalEntity.legalName",
  );
  const rfcError = rfcConflict
    ? "Este RFC ya está activo dentro de la organización."
    : apiFieldError(error, "legalEntity.rfc", "rfc");
  const membershipError = apiFieldError(error, "primaryMembershipId");
  const yearError = apiFieldError(error, "fiscalYear", "year");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Crear cliente"
      description="Se crearán cuenta, RFC, responsable, ejercicio y doce períodos en una sola operación."
    >
      <form onSubmit={submit} className="space-y-5 p-5">
        <ErrorNotice error={error} fallback="No se pudo crear el cliente." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Razón social / nombre inicial">
            <Input
              required
              maxLength={160}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "new-client-name-error" : undefined}
              autoFocus
            />
            {nameError ? (
              <span
                id="new-client-name-error"
                className="text-caption text-destructive"
              >
                {nameError}
              </span>
            ) : null}
          </Field>
          <Field label="RFC">
            <Input
              required
              minLength={12}
              maxLength={13}
              value={rfc}
              onChange={(event) => {
                setRfc(event.target.value.toUpperCase());
                setError(null);
              }}
              placeholder="ABC010101AA1"
              aria-invalid={Boolean(rfcError)}
              aria-describedby={
                rfcError
                  ? "new-client-rfc-help new-client-rfc-error"
                  : "new-client-rfc-help"
              }
              className="identifier"
            />
            <span
              id="new-client-rfc-help"
              className="text-caption text-muted-foreground"
            >
              Usa 12 caracteres para persona moral o 13 para persona física.
            </span>
            {rfcError ? (
              <span
                id="new-client-rfc-error"
                className="text-caption text-destructive"
              >
                {rfcError}
              </span>
            ) : null}
          </Field>
          <Field label="Responsable principal">
            <select
              required
              className={selectClass}
              value={membershipId}
              onChange={(event) => {
                setMembershipId(event.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(membershipError)}
              aria-describedby={
                membershipError ? "new-client-membership-error" : undefined
              }
            >
              <option value="" disabled>
                Selecciona un responsable
              </option>
              {members.map((member) => (
                <option key={member.membershipId} value={member.membershipId}>
                  {member.displayName} · {roleLabels[member.role]}
                </option>
              ))}
            </select>
            {membershipError ? (
              <span
                id="new-client-membership-error"
                className="text-caption text-destructive"
              >
                {membershipError}
              </span>
            ) : null}
          </Field>
          <Field label="Ejercicio inicial">
            <Input
              required
              type="number"
              min={2000}
              max={new Date().getFullYear() + 1}
              value={year}
              onChange={(event) => {
                setYear(Number(event.target.value));
                setError(null);
              }}
              aria-invalid={Boolean(yearError)}
              aria-describedby={yearError ? "new-client-year-error" : undefined}
            />
            {yearError ? (
              <span
                id="new-client-year-error"
                className="text-caption text-destructive"
              >
                {yearError}
              </span>
            ) : null}
          </Field>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || !membershipId}>
            {pending ? "Creando…" : "Crear cliente"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function LiveClientsScreen() {
  const { organization, capabilities } = useAccountingContext();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [page, setPage] = useState<ClientPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const queryKey = searchParams.toString();
  const base = `/${pathname.split("/").filter(Boolean)[0] ?? "es"}/organizations/${encodeURIComponent(organization.slug)}`;
  const canCreate = [
    "clients.manage",
    "clients.assign",
    "fiscal_entities.manage",
    "fiscal_years.manage",
  ].every((permission) => capabilities.includes(permission as never));

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      if (search.trim()) next.set("search", search.trim());
      else next.delete("search");
      next.set("page", "1");
      if (next.toString() !== searchParams.toString())
        router.replace(`${pathname}?${next.toString()}`);
    }, 300);
    return () => globalThis.clearTimeout(timer);
  }, [pathname, router, search, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(queryKey);
    const timer = globalThis.setTimeout(() => {
      setLoading(true);
      setError(null);
      void getClients(
        {
          search: params.get("search") || undefined,
          status: params.get("status") || undefined,
          page: Number(params.get("page") || 1),
          limit: 25,
          sort:
            (params.get("sort") as "name" | "status" | "updatedAt") || "name",
          direction: (params.get("direction") as "asc" | "desc") || "asc",
        },
        controller.signal,
      )
        .then(setPage)
        .catch((cause) => {
          if (!isAbortError(cause)) setError(cause);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [organization.id, queryKey]);

  function setQuery(key: string, value?: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.set("page", "1");
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-caption font-semibold text-accent-foreground">
            Cartera
          </p>
          <h1 className="text-heading-lg font-bold">Clientes</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Consulta cuentas, entidades fiscales, responsables y el ejercicio
            más reciente.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            Nuevo cliente
          </Button>
        ) : null}
      </header>
      <Surface>
        <FilterBar>
          <Field label="Buscar">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre o código"
              className="w-64"
            />
          </Field>
          <Field label="Estado">
            <select
              className={selectClass}
              value={searchParams.get("status") ?? ""}
              onChange={(event) => setQuery("status", event.target.value)}
            >
              <option value="">Activos y suspendidos</option>
              <option value="active">Activo</option>
              <option value="suspended">Suspendido</option>
            </select>
          </Field>
          <Field label="Orden">
            <select
              className={selectClass}
              value={searchParams.get("sort") ?? "name"}
              onChange={(event) => setQuery("sort", event.target.value)}
            >
              <option value="name">Nombre</option>
              <option value="status">Estado</option>
              <option value="updatedAt">Actualización</option>
            </select>
          </Field>
          <Button variant="outline" onClick={() => router.replace(pathname)}>
            Limpiar filtros
          </Button>
        </FilterBar>
        {loading ? (
          <LoadingState />
        ) : error ? (
          <div className="p-5">
            <ErrorNotice
              error={error}
              fallback="No se pudo cargar la cartera."
            />
          </div>
        ) : (
          <ProductTable
            caption="Directorio de clientes"
            rows={page?.items ?? []}
            rowKey={(row) => row.account.id}
            columns={[
              {
                id: "client",
                header: "Cliente",
                render: (row) => (
                  <div>
                    <Link
                      href={`${base}/clients/${row.account.id}/overview`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {row.account.name}
                    </Link>
                    <p className="identifier text-caption text-muted-foreground">
                      {row.primaryLegalEntity?.rfc ?? "Sin RFC activo"}
                    </p>
                  </div>
                ),
              },
              {
                id: "responsible",
                header: "Responsable",
                render: (row) =>
                  row.primaryAssignment?.displayName ?? "Sin responsable",
              },
              {
                id: "year",
                header: "Ejercicio reciente",
                render: (row) => row.latestFiscalYear?.year ?? "—",
              },
              {
                id: "period",
                header: "Mes actual",
                render: (row) =>
                  row.currentPeriod ? (
                    <StatusBadge status={row.currentPeriod.status} />
                  ) : (
                    "Sin período"
                  ),
              },
              {
                id: "status",
                header: "Estado",
                render: (row) => <StatusBadge status={row.account.status} />,
              },
              {
                id: "updated",
                header: "Actualización",
                render: (row) =>
                  new Date(row.account.updatedAt).toLocaleDateString("es-MX"),
              },
              {
                id: "action",
                header: "Acción",
                render: (row) => (
                  <Button
                    render={
                      <Link
                        href={`${base}/clients/${row.account.id}/overview`}
                      />
                    }
                    variant="outline"
                    size="sm"
                  >
                    Abrir cliente
                  </Button>
                ),
              },
            ]}
          />
        )}
        {page && page.meta.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-border p-4">
            <p className="text-body-sm text-muted-foreground">
              Página {page.meta.page} de {page.meta.totalPages} ·{" "}
              {page.meta.total} clientes
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page.meta.page <= 1}
                onClick={() => setQuery("page", String(page.meta.page - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page.meta.page >= page.meta.totalPages}
                onClick={() => setQuery("page", String(page.meta.page + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </Surface>
      <NewClientDialog
        open={creating}
        onClose={() => setCreating(false)}
        base={base}
      />
    </div>
  );
}

function AccountEditor({
  detail,
  reload,
}: {
  detail: ClientDetail;
  reload: () => void;
}) {
  const [name, setName] = useState(detail.account.name);
  const [code, setCode] = useState(detail.account.code ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await updateClient(detail.account.id, {
        name,
        code,
        expectedVersion: detail.account.version,
      });
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <ErrorNotice error={error} fallback="No se pudo actualizar la cuenta." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre de la cuenta">
          <Input
            required
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Código interno">
          <Input
            maxLength={50}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Opcional"
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        <Save />
        {pending ? "Guardando…" : "Guardar cuenta"}
      </Button>
    </form>
  );
}

function LegalEntityEditor({
  entity,
  canManage,
  reload,
}: {
  entity: LegalEntity;
  canManage: boolean;
  reload: () => void;
}) {
  const [legalName, setLegalName] = useState(entity.legalName);
  const [rfc, setRfc] = useState(entity.rfc);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    setError(null);
    try {
      await updateLegalEntity(entity.id, {
        legalName,
        rfc,
        expectedVersion: entity.version,
      });
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  async function archive() {
    if (!window.confirm(`¿Archivar el RFC ${entity.rfc}?`)) return;
    setPending(true);
    setError(null);
    try {
      await archiveLegalEntity(entity.id);
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  if (!canManage)
    return (
      <div>
        <p className="font-semibold">{entity.legalName}</p>
        <p className="identifier text-caption text-muted-foreground">
          {entity.rfc}
        </p>
      </div>
    );
  return (
    <div className="min-w-72 space-y-2">
      <Input
        value={legalName}
        onChange={(event) => setLegalName(event.target.value)}
        aria-label={`Razón social de ${entity.rfc}`}
      />
      <Input
        value={rfc}
        onChange={(event) => setRfc(event.target.value.toUpperCase())}
        aria-label={`RFC ${entity.rfc}`}
        className="identifier"
      />
      <ErrorNotice error={error} fallback="No se pudo modificar el RFC." />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void save()}
        >
          <Save />
          Guardar
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => void archive()}
        >
          <Archive />
          Archivar
        </Button>
      </div>
    </div>
  );
}

function AddLegalEntityForm({
  clientId,
  reload,
}: {
  clientId: string;
  reload: () => void;
}) {
  const [legalName, setLegalName] = useState("");
  const [rfc, setRfc] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await createLegalEntity(clientId, { legalName, rfc });
      setLegalName("");
      setRfc("");
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border-t border-border p-5 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
    >
      <Field label="Nueva razón social">
        <Input
          required
          value={legalName}
          onChange={(event) => setLegalName(event.target.value)}
        />
      </Field>
      <Field label="RFC">
        <Input
          required
          minLength={12}
          maxLength={13}
          value={rfc}
          onChange={(event) => setRfc(event.target.value.toUpperCase())}
          className="identifier"
        />
      </Field>
      <Button type="submit" disabled={pending}>
        <Plus />
        {pending ? "Agregando…" : "Agregar RFC"}
      </Button>
      <div className="sm:col-span-3">
        <ErrorNotice
          error={error}
          fallback="No se pudo agregar la entidad fiscal."
        />
      </div>
    </form>
  );
}

function AssignmentManager({
  detail,
  reload,
}: {
  detail: ClientDetail;
  reload: () => void;
}) {
  const [members, setMembers] = useState<MemberCandidate[]>([]);
  const [membershipId, setMembershipId] = useState("");
  const [responsibility, setResponsibility] =
    useState<AssignmentResponsibility>("collaborator");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getAvailableMembers(detail.account.id, controller.signal)
      .then((items) => {
        setMembers(items);
        setMembershipId(
          items.find((item) => !item.assignmentId)?.membershipId ??
            items[0]?.membershipId ??
            "",
        );
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setError(cause);
      });
    return () => controller.abort();
  }, [detail.account.id, detail.assignments]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await createAssignment(detail.account.id, {
        membershipId,
        responsibility,
      });
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm("¿Retirar esta asignación?")) return;
    setPending(true);
    setError(null);
    try {
      await revokeAssignment(detail.account.id, id);
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <ProductTable
        caption="Asignaciones activas"
        rows={detail.assignments}
        rowKey={(row) => row.id}
        columns={[
          {
            id: "member",
            header: "Miembro",
            render: (row) => (
              <div>
                <p className="font-semibold">{row.displayName}</p>
                <p className="text-caption text-muted-foreground">
                  {row.email}
                </p>
              </div>
            ),
          },
          {
            id: "role",
            header: "Perfil",
            render: (row) => roleLabels[row.role],
          },
          {
            id: "responsibility",
            header: "Responsabilidad",
            render: (row) => responsibilityLabels[row.responsibility],
          },
          {
            id: "action",
            header: "Acción",
            render: (row) =>
              row.responsibility === "primary" ? (
                <span className="text-caption text-muted-foreground">
                  Reemplaza con otro principal
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => void revoke(row.id)}
                >
                  Retirar
                </Button>
              ),
          },
        ]}
      />
      <form
        onSubmit={submit}
        className="grid gap-3 border-t border-border p-5 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
      >
        <Field label="Miembro">
          <select
            required
            className={selectClass}
            value={membershipId}
            onChange={(event) => setMembershipId(event.target.value)}
          >
            {members.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>
                {member.displayName} ·{" "}
                {member.assignmentId
                  ? responsibilityLabels[member.responsibility!]
                  : "sin asignar"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Responsabilidad">
          <select
            className={selectClass}
            value={responsibility}
            onChange={(event) =>
              setResponsibility(event.target.value as AssignmentResponsibility)
            }
          >
            <option value="collaborator">Colaborador</option>
            <option value="reviewer">Revisor</option>
            <option value="primary">Responsable principal</option>
          </select>
        </Field>
        <Button type="submit" disabled={pending || !membershipId}>
          <UserRoundPlus />
          {pending
            ? "Asignando…"
            : responsibility === "primary"
              ? "Cambiar principal"
              : "Asignar"}
        </Button>
        <div className="sm:col-span-3">
          <ErrorNotice
            error={error}
            fallback="No se pudo modificar la asignación."
          />
        </div>
      </form>
    </div>
  );
}

function CreateYearForm({
  entity,
  reload,
}: {
  entity: LegalEntity;
  reload: () => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await createFiscalYear(entity.id, year);
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Field label={`Nuevo ejercicio para ${entity.rfc}`}>
        <Input
          type="number"
          min={2000}
          max={new Date().getFullYear() + 1}
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          className="w-36"
        />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        <Plus />
        {pending ? "Creando…" : "Crear ejercicio"}
      </Button>
      <ErrorNotice error={error} fallback="No se pudo crear el ejercicio." />
    </form>
  );
}

export type LiveClientDetailSection =
  | "overview"
  | "data"
  | "responsibles"
  | "access";

export function LiveClientDetailScreen({
  clientId,
  section = "overview",
}: {
  clientId: string;
  section?: LiveClientDetailSection;
}) {
  const { organization, capabilities, locale } = useAccountingContext();
  const router = useRouter();
  const { detail, error, loading, reload } = useClientDetail(clientId);
  const canManage = capabilities.includes("clients.manage");
  const canManageEntities = capabilities.includes("fiscal_entities.manage");
  const canAssign = capabilities.includes("clients.assign");
  const base = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${clientId}`;
  if (loading) return <LoadingState label="Cargando cliente…" />;
  if (error || !detail)
    return (
      <ErrorNotice
        error={error}
        fallback="No se encontró el cliente o ya no tienes acceso."
      />
    );
  const account = detail.account;
  async function archiveAccount() {
    if (
      !window.confirm(
        `¿Archivar la cuenta ${account.name}? Esta acción no se puede revertir.`,
      )
    )
      return;
    try {
      await archiveClient(account.id);
      router.push(
        `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients`,
      );
    } catch (cause) {
      window.alert(apiErrorMessage(cause, "No se pudo archivar la cuenta."));
    }
  }

  if (section === "overview") {
    return (
      <div className="space-y-6">
        <header className="border-l-2 border-brand-mark pl-4">
          <p className="text-caption font-semibold text-accent-foreground">
            Resumen del cliente
          </p>
          <h1 className="text-heading-lg font-bold">{account.name}</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Consulta el estado general de la cuenta, sus RFC, responsables y
            ejercicios fiscales.
          </p>
        </header>
        <DefinitionGrid
          items={[
            {
              label: "Estado de cuenta",
              value: <StatusBadge status={account.status} />,
            },
            {
              label: "RFC activos",
              value: detail.legalEntities.filter(
                (entity) => entity.status === "active",
              ).length,
            },
            {
              label: "Responsable principal",
              value: detail.primaryAssignment?.displayName ?? "Sin responsable",
            },
            { label: "Ejercicios", value: detail.fiscalYears.length },
          ]}
        />
        <Surface>
          <SurfaceHeader
            title="Accesos rápidos"
            description="Abre directamente la sección que necesitas gestionar."
          />
          <div className="grid gap-3 p-5 md:grid-cols-3">
            <Link
              href={`${base}/settings/data`}
              className="rounded-md border border-border p-4 transition-colors hover:bg-muted"
            >
              <p className="font-semibold">Datos del cliente</p>
              <p className="mt-1 text-body-sm text-muted-foreground">
                Nombre de cuenta y entidades fiscales.
              </p>
            </Link>
            <Link
              href={`${base}/settings/responsibles`}
              className="rounded-md border border-border p-4 transition-colors hover:bg-muted"
            >
              <p className="font-semibold">Responsables</p>
              <p className="mt-1 text-body-sm text-muted-foreground">
                Responsable principal, colaboradores y revisores.
              </p>
            </Link>
            <Link
              href={`${base}/fiscal-years`}
              className="rounded-md border border-border p-4 transition-colors hover:bg-muted"
            >
              <p className="font-semibold">Ejercicios</p>
              <p className="mt-1 text-body-sm text-muted-foreground">
                Ejercicios y períodos por entidad fiscal.
              </p>
            </Link>
          </div>
        </Surface>
        <Surface>
          <SurfaceHeader
            title="Entidades fiscales"
            description="RFC asociados a esta cuenta cliente."
            actions={
              <Button
                render={<Link href={`${base}/fiscal-years`} />}
                variant="outline"
                size="sm"
              >
                Ver ejercicios
              </Button>
            }
          />
          <ProductTable
            caption="Resumen de entidades fiscales"
            rows={detail.legalEntities}
            rowKey={(entity) => entity.id}
            columns={[
              {
                id: "entity",
                header: "Entidad fiscal",
                render: (entity) => (
                  <div>
                    <p className="font-semibold">{entity.legalName}</p>
                    <p className="identifier text-caption text-muted-foreground">
                      {entity.rfc}
                    </p>
                  </div>
                ),
              },
              {
                id: "status",
                header: "Estado",
                render: (entity) => <StatusBadge status={entity.status} />,
              },
              {
                id: "years",
                header: "Ejercicios",
                render: (entity) =>
                  detail.fiscalYears.filter(
                    (year) => year.legalEntityId === entity.id,
                  ).length,
              },
            ]}
          />
        </Surface>
      </div>
    );
  }

  if (section === "responsibles") {
    return (
      <div className="space-y-6">
        <header className="border-l-2 border-brand-mark pl-4">
          <p className="text-caption font-semibold text-accent-foreground">
            Configuración
          </p>
          <h1 className="text-heading-lg font-bold">Responsables</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Administra quién atiende, colabora o revisa la cuenta de {account.name}.
          </p>
        </header>
        <DefinitionGrid
          items={[
            {
              label: "Responsable principal",
              value: detail.primaryAssignment?.displayName ?? "Sin responsable",
            },
            {
              label: "Asignaciones activas",
              value: detail.assignments.filter((row) => row.status === "active")
                .length,
            },
          ]}
        />
        <Surface>
          <SurfaceHeader
            title="Asignaciones"
            description="Solo puede existir un responsable principal activo por cliente."
          />
          {canAssign ? (
            <AssignmentManager detail={detail} reload={reload} />
          ) : (
            <ProductTable
              caption="Asignaciones visibles"
              rows={detail.assignments}
              rowKey={(row) => row.id}
              columns={[
                {
                  id: "member",
                  header: "Miembro",
                  render: (row) => row.displayName,
                },
                {
                  id: "role",
                  header: "Perfil",
                  render: (row) => roleLabels[row.role],
                },
                {
                  id: "responsibility",
                  header: "Responsabilidad",
                  render: (row) => responsibilityLabels[row.responsibility],
                },
              ]}
            />
          )}
        </Surface>
      </div>
    );
  }

  if (section === "access") {
    return (
      <div className="space-y-6">
        <header className="border-l-2 border-brand-mark pl-4">
          <p className="text-caption font-semibold text-accent-foreground">
            Configuración
          </p>
          <h1 className="text-heading-lg font-bold">Accesos</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Consulta qué miembros tienen acceso a {account.name} y con qué perfil.
          </p>
        </header>
        <Surface>
          <SurfaceHeader
            title="Miembros con acceso"
            description="El acceso se deriva de las asignaciones activas del cliente."
            actions={
              canAssign ? (
                <Button
                  render={<Link href={`${base}/settings/responsibles`} />}
                  variant="outline"
                  size="sm"
                >
                  Administrar asignaciones
                </Button>
              ) : undefined
            }
          />
          <ProductTable
            caption="Miembros con acceso al cliente"
            rows={detail.assignments.filter((row) => row.status === "active")}
            rowKey={(row) => row.id}
            emptyMessage="Este cliente todavía no tiene miembros con acceso."
            columns={[
              {
                id: "member",
                header: "Miembro",
                render: (row) => (
                  <div>
                    <p className="font-semibold">{row.displayName}</p>
                    <p className="text-caption text-muted-foreground">
                      {row.email}
                    </p>
                  </div>
                ),
              },
              {
                id: "role",
                header: "Perfil",
                render: (row) => roleLabels[row.role],
              },
              {
                id: "responsibility",
                header: "Responsabilidad",
                render: (row) => responsibilityLabels[row.responsibility],
              },
            ]}
          />
        </Surface>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-caption font-semibold text-accent-foreground">
            Configuración
          </p>
          <h1 className="text-heading-lg font-bold">Datos del cliente</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Edita la cuenta y las entidades fiscales de {account.name}.
          </p>
        </div>
        {canManage ? (
          <Button variant="destructive" onClick={() => void archiveAccount()}>
            <Archive />
            Archivar cuenta
          </Button>
        ) : null}
      </header>
      <Surface>
        <SurfaceHeader
          title="Datos de la cuenta"
          description="El nombre y código pertenecen a ClientAccount; el RFC no."
        />
        {canManage ? (
          <AccountEditor detail={detail} reload={reload} />
        ) : (
          <div className="p-5">
            <p className="font-semibold">{detail.account.name}</p>
            <p className="text-body-sm text-muted-foreground">
              Código: {detail.account.code ?? "Sin código"}
            </p>
          </div>
        )}
      </Surface>
      <Surface>
        <SurfaceHeader
          title="Entidades fiscales"
          description="Cada RFC conserva razón social, versión y ejercicios propios."
        />
        <ProductTable
          caption="Entidades fiscales"
          rows={detail.legalEntities}
          rowKey={(entity) => entity.id}
          columns={[
            {
              id: "entity",
              header: "Entidad fiscal",
              render: (entity) => (
                <LegalEntityEditor
                  entity={entity}
                  canManage={canManageEntities}
                  reload={reload}
                />
              ),
            },
            {
              id: "status",
              header: "Estado",
              render: (entity) => <StatusBadge status={entity.status} />,
            },
            {
              id: "years",
              header: "Ejercicios",
              render: (entity) =>
                detail.fiscalYears
                  .filter((year) => year.legalEntityId === entity.id)
                  .map((year) => (
                    <Link
                      key={year.id}
                      className="mr-2 font-semibold text-primary hover:underline"
                      href={`${base}/legal-entities/${entity.id}/fiscal-years/${year.year}`}
                    >
                      {year.year}
                    </Link>
                  )),
            },
            {
              id: "open",
              header: "Acción",
              render: (entity) => (
                <Button
                  render={
                    <Link
                      href={`${base}/legal-entities/${entity.id}/fiscal-years`}
                    />
                  }
                  variant="outline"
                  size="sm"
                >
                  Abrir ejercicios
                </Button>
              ),
            },
          ]}
        />
        {canManageEntities ? (
          <AddLegalEntityForm clientId={clientId} reload={reload} />
        ) : null}
      </Surface>
    </div>
  );
}

function LegalEntitySelector({
  detail,
  base,
  suffix,
}: {
  detail: ClientDetail;
  base: string;
  suffix: string;
}) {
  const active = detail.legalEntities.filter(
    (entity) => entity.status === "active",
  );
  return (
    <div className="space-y-5">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Contexto fiscal
        </p>
        <h1 className="text-heading-lg font-bold">Selecciona un RFC</h1>
        <p className="mt-1 text-body text-muted-foreground">
          Esta cuenta tiene varias entidades fiscales. Elige una para continuar
          sin asumir un RFC arbitrario.
        </p>
      </header>
      <Surface>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {active.map((entity) => (
            <Link
              key={entity.id}
              href={`${base}/legal-entities/${entity.id}/fiscal-years${suffix}`}
              className="rounded-md border border-border p-4 hover:bg-muted"
            >
              <p className="font-semibold">{entity.legalName}</p>
              <p className="identifier text-body-sm text-muted-foreground">
                {entity.rfc}
              </p>
            </Link>
          ))}
        </div>
      </Surface>
    </div>
  );
}

export function LiveFiscalYearsScreen({
  clientId,
  legalEntityId,
}: {
  clientId: string;
  legalEntityId?: string;
}) {
  const { organization, locale, capabilities } = useAccountingContext();
  const router = useRouter();
  const { detail, error, loading } = useClientDetail(clientId);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [yearsError, setYearsError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const base = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${clientId}`;
  const active = useMemo(
    () =>
      detail?.legalEntities.filter((entity) => entity.status === "active") ??
      [],
    [detail],
  );
  useEffect(() => {
    if (!legalEntityId && active.length === 1)
      router.replace(`${base}/legal-entities/${active[0].id}/fiscal-years`);
  }, [active, base, legalEntityId, router]);
  useEffect(() => {
    if (!legalEntityId) return;
    const controller = new AbortController();
    void getFiscalYears(legalEntityId, controller.signal)
      .then((items) => {
        setYearsError(null);
        setYears(items);
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setYearsError(cause);
      });
    return () => controller.abort();
  }, [legalEntityId, organization.id, revision]);
  if (loading) return <LoadingState label="Cargando ejercicios…" />;
  if (error || !detail)
    return (
      <ErrorNotice error={error} fallback="No se pudo cargar el cliente." />
    );
  if (!legalEntityId)
    return active.length === 1 ? (
      <LoadingState label="Abriendo el único RFC…" />
    ) : (
      <LegalEntitySelector detail={detail} base={base} suffix="" />
    );
  const entity = active.find((item) => item.id === legalEntityId);
  if (!entity)
    return (
      <ErrorNotice
        error={new ApiError(404, "Entidad fiscal no encontrada")}
        fallback="Entidad fiscal no encontrada."
      />
    );
  return (
    <div className="space-y-6">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Ejercicios fiscales
        </p>
        <h1 className="text-heading-lg font-bold">{entity.legalName}</h1>
        <p className="identifier mt-1 text-body-sm text-muted-foreground">
          {detail.account.name} · RFC {entity.rfc}
        </p>
      </header>
      <ErrorNotice
        error={yearsError}
        fallback="No se pudieron cargar los ejercicios."
      />
      <Surface>
        <SurfaceHeader
          title="Ejercicios"
          description="Cada ejercicio pertenece a este RFC y contiene doce períodos."
          actions={
            capabilities.includes("fiscal_years.manage") ? (
              <CreateYearForm
                entity={entity}
                reload={() => setRevision((value) => value + 1)}
              />
            ) : undefined
          }
        />
        <ProductTable
          caption={`Ejercicios de ${entity.rfc}`}
          rows={years}
          rowKey={(year) => year.id}
          columns={[
            {
              id: "year",
              header: "Año",
              render: (year) => (
                <Link
                  className="font-semibold text-primary hover:underline"
                  href={`${base}/legal-entities/${entity.id}/fiscal-years/${year.year}`}
                >
                  {year.year}
                </Link>
              ),
            },
            {
              id: "status",
              header: "Estado",
              render: (year) => <StatusBadge status={year.status} />,
            },
            {
              id: "version",
              header: "Versión",
              render: (year) => year.version,
            },
            {
              id: "action",
              header: "Acción",
              render: (year) => (
                <Button
                  render={
                    <Link
                      href={`${base}/legal-entities/${entity.id}/fiscal-years/${year.year}`}
                    />
                  }
                  variant="outline"
                  size="sm"
                >
                  Ver períodos
                </Button>
              ),
            },
          ]}
        />
      </Surface>
    </div>
  );
}

export function LiveFiscalYearScreen({
  clientId,
  legalEntityId,
  year,
  selectedMonth,
}: {
  clientId: string;
  legalEntityId?: string;
  year: string;
  selectedMonth?: string;
}) {
  const { organization, locale } = useAccountingContext();
  const router = useRouter();
  const { detail, error, loading } = useClientDetail(clientId);
  const [data, setData] = useState<PeriodsResponse | null>(null);
  const [periodError, setPeriodError] = useState<unknown>(null);
  const [periodLoading, setPeriodLoading] = useState(Boolean(legalEntityId));
  const base = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${clientId}`;
  const active = useMemo(
    () =>
      detail?.legalEntities.filter((entity) => entity.status === "active") ??
      [],
    [detail],
  );
  useEffect(() => {
    if (!legalEntityId && active.length === 1)
      router.replace(
        `${base}/legal-entities/${active[0].id}/fiscal-years/${year}`,
      );
  }, [active, base, legalEntityId, router, year]);
  useEffect(() => {
    if (!legalEntityId) return;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setPeriodLoading(true);
      setPeriodError(null);
      void getFiscalYears(legalEntityId, controller.signal)
        .then((years) => {
          const match = years.find((item) => String(item.year) === year);
          if (!match)
            throw new ApiError(
              404,
              "Ejercicio fiscal no encontrado",
              "FISCAL_YEAR_NOT_FOUND",
            );
          return getPeriods(match.id, controller.signal);
        })
        .then(setData)
        .catch((cause) => {
          if (!isAbortError(cause)) setPeriodError(cause);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPeriodLoading(false);
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [legalEntityId, organization.id, year]);
  if (loading) return <LoadingState label="Cargando contexto fiscal…" />;
  if (error || !detail)
    return (
      <ErrorNotice error={error} fallback="No se pudo cargar el cliente." />
    );
  if (!legalEntityId)
    return active.length === 1 ? (
      <LoadingState label="Abriendo el único RFC…" />
    ) : (
      <LegalEntitySelector detail={detail} base={base} suffix={`/${year}`} />
    );
  const entity = active.find((item) => item.id === legalEntityId);
  if (!entity)
    return (
      <ErrorNotice
        error={new ApiError(404, "Entidad fiscal no encontrada")}
        fallback="Entidad fiscal no encontrada."
      />
    );
  if (periodLoading)
    return <LoadingState label="Cargando los doce períodos…" />;
  if (periodError || !data)
    return (
      <ErrorNotice
        error={periodError}
        fallback="No se pudieron cargar los períodos."
      />
    );
  const selectedPeriod = selectedMonth
    ? data.periods.find(
        (period) =>
          String(period.month).padStart(2, "0") ===
          selectedMonth.padStart(2, "0"),
      )
    : undefined;
  if (selectedMonth && !selectedPeriod)
    return (
      <ErrorNotice
        error={new ApiError(
          404,
          "Período fiscal no encontrado",
          "FISCAL_PERIOD_NOT_FOUND",
        )}
        fallback="No se encontró el período solicitado."
      />
    );
  if (selectedPeriod) {
    const selectedMonthName =
      monthNames[selectedPeriod.month - 1] ?? `Mes ${selectedPeriod.month}`;
    return (
      <div className="space-y-6">
        <header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-caption font-semibold text-accent-foreground">
              Período fiscal
            </p>
            <h1 className="text-heading-lg font-bold">
              {selectedMonthName} {year}
            </h1>
            <p className="identifier mt-1 text-body-sm text-muted-foreground">
              {detail.account.name} · {entity.legalName} · RFC {entity.rfc}
            </p>
          </div>
          <Button
            render={
              <Link
                href={`${base}/legal-entities/${entity.id}/fiscal-years/${year}`}
              />
            }
            variant="outline"
          >
            Volver al ejercicio
          </Button>
        </header>
        <DefinitionGrid
          items={[
            {
              label: "Estado del período",
              value: <StatusBadge status={selectedPeriod.status} />,
            },
            { label: "Ejercicio", value: year },
            {
              label: "Fecha de corte",
              value: selectedPeriod.cutoffAt
                ? new Date(selectedPeriod.cutoffAt).toLocaleString("es-MX")
                : "Sin corte",
            },
            {
              label: "Versión de bloqueo",
              value: selectedPeriod.lockVersion,
            },
          ]}
        />
        <WarningNotice>
          Este período está disponible en modo consulta. Las transiciones de
          preparación, revisión y cierre no forman parte de esta entrega.
        </WarningNotice>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Ejercicio fiscal
        </p>
        <h1 className="text-heading-lg font-bold">Ejercicio {year}</h1>
        <p className="identifier mt-1 text-body-sm text-muted-foreground">
          {detail.account.name} · RFC {entity.rfc} · {year}
        </p>
      </header>
      <Surface>
        <ProductTable
          caption={`Períodos ${year} de ${entity.rfc}`}
          rows={data.periods}
          rowKey={(period) => period.id}
          columns={[
            {
              id: "month",
              header: "Mes",
              render: (period) => (
                <Link
                  className="font-semibold text-primary hover:underline"
                  href={`${base}/legal-entities/${entity.id}/fiscal-years/${year}/periods/${String(period.month).padStart(2, "0")}/overview`}
                >
                  {monthNames[period.month - 1]}
                </Link>
              ),
            },
            {
              id: "status",
              header: "Estado",
              render: (period) => <StatusBadge status={period.status} />,
            },
            {
              id: "cutoff",
              header: "Fecha de corte",
              render: (period) =>
                period.cutoffAt
                  ? new Date(period.cutoffAt).toLocaleString("es-MX")
                  : "Sin corte",
            },
            {
              id: "version",
              header: "Versión de bloqueo",
              render: (period) => period.lockVersion,
            },
          ]}
        />
      </Surface>
    </div>
  );
}

export function LiveUnavailableScreen() {
  const { organization, locale } = useAccountingContext();
  return (
    <div className="space-y-4">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Módulo real
        </p>
        <h1 className="text-heading-lg font-bold">
          Funcionalidad fuera de esta entrega
        </h1>
      </header>
      <WarningNotice>
        Esta vista no usa datos demo cuando el modo real está activo. El alcance
        actual cubre clientes, RFC, asignaciones, ejercicios y períodos.
      </WarningNotice>
      <Button
        render={
          <Link
            href={`/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients`}
          />
        }
        variant="outline"
      >
        <RefreshCw />
        Volver a clientes
      </Button>
    </div>
  );
}
