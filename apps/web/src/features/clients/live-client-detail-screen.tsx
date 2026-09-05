"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Archive, Plus, RefreshCw, Save, UserRoundPlus } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import {
  DefinitionGrid,
  Field,
  FilterBar,
  Surface,
  SurfaceHeader,
} from "@/components/product-patterns";
import { ProductTable } from "@/components/product-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Capability } from "@/lib/accounting-types";
import { apiErrorMessage, isAbortError } from "@/lib/api-client";
import { hasCapability } from "@/lib/permissions";
import {
  archiveClient,
  archiveLegalEntity,
  createAssignment,
  createLegalEntity,
  getAssignments,
  getAvailableMembers,
  revokeAssignment,
  updateClient,
  updateLegalEntity,
} from "./api";
import {
  DOMAIN_SEARCH_MAX_LENGTH,
  entityContextSuffix,
  normalizeDomainSearch,
} from "./entity-context";
import {
  CollectionPagination,
  ErrorNotice,
  LoadingState,
  roleLabels,
  selectClass,
} from "./live-screen-primitives";
import {
  DOMAIN_PAGE_LIMIT,
  type MemberCandidateLoader,
  useDebouncedValue,
  useMemberCandidatePage,
} from "./live-query-hooks";
import { useClientDetail } from "./use-client-detail";
import { LiveForbiddenScreen } from "./live-fallback-screens";
import type {
  AccountAssignment,
  AssignmentResponsibility,
  ClientDetail,
  CollectionPage,
  LegalEntity,
} from "./types";

const responsibilityLabels: Record<AssignmentResponsibility, string> = {
  primary: "Responsable principal",
  collaborator: "Colaborador",
  reviewer: "Revisor",
};

interface ClientAssignmentsLoadState {
  organizationId: string | null;
  clientId: string | null;
  requestId: number;
  status: "loading" | "ready" | "error";
  assignments: CollectionPage<AccountAssignment> | null;
  error: unknown;
}

function useClientAssignments(
  clientId: string,
  {
    search = "",
    page = 1,
    limit = DOMAIN_PAGE_LIMIT,
  }: { search?: string; page?: number; limit?: number } = {},
) {
  const { organization } = useAccountingContext();
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);
  const [state, setState] = useState<ClientAssignmentsLoadState>({
    organizationId: null,
    clientId: null,
    requestId: 0,
    status: "loading",
    assignments: null,
    error: null,
  });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const requestId = ++requestSequence.current;
    const organizationId = organization.id;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setState({
        organizationId,
        clientId,
        requestId,
        status: "loading",
        assignments: null,
        error: null,
      });
      void getAssignments(
        clientId,
        { search: search || undefined, page, limit },
        controller.signal,
      )
        .then((assignments) => {
          if (controller.signal.aborted) return;
          setState((current) =>
            current.organizationId === organizationId &&
            current.clientId === clientId &&
            current.requestId === requestId
              ? {
                  organizationId,
                  clientId,
                  requestId,
                  status: "ready",
                  assignments,
                  error: null,
                }
              : current,
          );
        })
        .catch((cause) => {
          if (controller.signal.aborted || isAbortError(cause)) return;
          setState((current) =>
            current.organizationId === organizationId &&
            current.clientId === clientId &&
            current.requestId === requestId
              ? {
                  organizationId,
                  clientId,
                  requestId,
                  status: "error",
                  assignments: null,
                  error: cause,
                }
              : current,
          );
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [clientId, limit, organization.id, page, revision, search]);
  const belongsToClient =
    state.organizationId === organization.id && state.clientId === clientId;
  return {
    assignments:
      belongsToClient && state.status === "ready" ? state.assignments : null,
    error: belongsToClient && state.status === "error" ? state.error : null,
    loading: !belongsToClient || state.status === "loading",
    reload,
  };
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
  assignmentPage,
  assignmentSearch,
  onAssignmentSearchChange,
  onAssignmentPageChange,
  clientId,
  reload,
}: {
  assignmentPage: CollectionPage<AccountAssignment>;
  assignmentSearch: string;
  onAssignmentSearchChange: (value: string) => void;
  onAssignmentPageChange: (page: number) => void;
  clientId: string;
  reload: () => void;
}) {
  const [membershipId, setMembershipId] = useState("");
  const [responsibility, setResponsibility] =
    useState<AssignmentResponsibility>("collaborator");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [membersRevision, setMembersRevision] = useState(0);
  const availableMemberLoader = useCallback<MemberCandidateLoader>(
    (query, signal) => getAvailableMembers(clientId, query, signal),
    [clientId],
  );
  const candidates = useMemberCandidatePage(
    availableMemberLoader,
    true,
    membersRevision,
  );
  const members = candidates.result?.items ?? [];
  const selectedMembershipId = members.some(
    (member) => member.membershipId === membershipId,
  )
    ? membershipId
    : (members.find((item) => !item.assignmentId)?.membershipId ??
      members[0]?.membershipId ??
      "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await createAssignment(clientId, {
        membershipId: selectedMembershipId,
        responsibility,
      });
      setMembersRevision((value) => value + 1);
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
      await revokeAssignment(clientId, id);
      setMembersRevision((value) => value + 1);
      reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <FilterBar>
        <Field label="Buscar asignación">
          <Input
            type="search"
            maxLength={DOMAIN_SEARCH_MAX_LENGTH}
            value={assignmentSearch}
            onChange={(event) => onAssignmentSearchChange(event.target.value)}
            placeholder="Nombre o correo"
            className="w-72"
          />
        </Field>
      </FilterBar>
      <ProductTable
        caption="Asignaciones activas"
        rows={assignmentPage.items}
        rowKey={(row) => row.id}
        emptyMessage="Este cliente todavía no tiene asignaciones activas."
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
      <CollectionPagination
        meta={assignmentPage.meta}
        itemLabel="asignaciones"
        onPageChange={onAssignmentPageChange}
      />
      <form onSubmit={submit} className="space-y-4 border-t border-border p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_14rem_auto] lg:items-end">
          <Field label="Buscar miembro">
            <Input
              type="search"
              maxLength={DOMAIN_SEARCH_MAX_LENGTH}
              value={candidates.search}
              onChange={(event) => candidates.setSearch(event.target.value)}
              placeholder="Nombre o correo"
            />
          </Field>
          <Field label="Miembro">
            <select
              required
              className={selectClass}
              value={selectedMembershipId}
              disabled={candidates.pending}
              onChange={(event) => setMembershipId(event.target.value)}
            >
              <option value="" disabled>
                {candidates.pending
                  ? "Buscando miembros…"
                  : members.length === 0
                    ? "No hay coincidencias"
                    : "Selecciona un miembro"}
              </option>
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
                setResponsibility(
                  event.target.value as AssignmentResponsibility,
                )
              }
            >
              <option value="collaborator">Colaborador</option>
              <option value="reviewer">Revisor</option>
              <option value="primary">Responsable principal</option>
            </select>
          </Field>
          <Button
            type="submit"
            disabled={pending || candidates.pending || !selectedMembershipId}
          >
            <UserRoundPlus />
            {pending
              ? "Asignando…"
              : responsibility === "primary"
                ? "Cambiar principal"
                : "Asignar"}
          </Button>
        </div>
        <ErrorNotice
          error={candidates.error}
          fallback="No se pudieron buscar los miembros del despacho."
        />
        <CollectionPagination
          meta={candidates.result?.meta ?? null}
          itemLabel="miembros"
          onPageChange={candidates.setPageNumber}
        />
        <ErrorNotice
          error={error}
          fallback="No se pudo modificar la asignación."
        />
      </form>
    </div>
  );
}

export type LiveClientDetailSection =
  "overview" | "data" | "responsibles" | "access";

export function LiveClientDetailScreen({
  clientId,
  section = "overview",
}: {
  clientId: string;
  section?: LiveClientDetailSection;
}) {
  const { capabilities } = useAccountingContext();
  const requiredCapability: Record<LiveClientDetailSection, Capability> = {
    overview: "clients.view",
    data: "clients.manage",
    responsibles: "clients.assign",
    access: "clients.assign",
  };
  const required = requiredCapability[section];
  if (!hasCapability(capabilities, required)) {
    return <LiveForbiddenScreen capability={required} />;
  }
  return <LiveClientDetailContent clientId={clientId} section={section} />;
}

function LiveResponsiblesSection({
  detail,
  reloadDetail,
}: {
  detail: ClientDetail;
  reloadDetail: () => void;
}) {
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [assignmentPageNumber, setAssignmentPageNumber] = useState(1);
  const debouncedAssignmentSearch = useDebouncedValue(assignmentSearch.trim());
  const {
    assignments,
    error,
    loading,
    reload: reloadAssignments,
  } = useClientAssignments(detail.account.id, {
    search: debouncedAssignmentSearch,
    page: assignmentPageNumber,
  });
  const changeAssignmentSearch = useCallback((value: string) => {
    setAssignmentSearch(normalizeDomainSearch(value));
    setAssignmentPageNumber(1);
  }, []);
  const reloadAll = useCallback(() => {
    reloadAssignments();
    reloadDetail();
  }, [reloadAssignments, reloadDetail]);
  return (
    <div className="space-y-6">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Configuración
        </p>
        <h1 className="text-heading-lg font-bold">Responsables</h1>
        <p className="mt-1 text-body text-muted-foreground">
          Administra quién atiende, colabora o revisa la cuenta de{" "}
          {detail.account.name}.
        </p>
      </header>
      {loading ? (
        <LoadingState label="Cargando asignaciones protegidas…" />
      ) : error ? (
        <div className="space-y-3">
          <ErrorNotice
            error={error}
            fallback="No se pudieron cargar las asignaciones. Verifica tu sesión y vuelve a intentarlo."
          />
          <Button type="button" variant="outline" onClick={reloadAssignments}>
            <RefreshCw />
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          <DefinitionGrid
            items={[
              {
                label: "Responsable principal",
                value:
                  detail.primaryAssignment?.displayName ?? "Sin responsable",
              },
              {
                label: "Asignaciones activas",
                value: assignments?.meta.total ?? 0,
              },
            ]}
          />
          <Surface>
            <SurfaceHeader
              title="Asignaciones"
              description="Solo puede existir un responsable principal activo por cliente."
            />
            {assignments ? (
              <AssignmentManager
                assignmentPage={assignments}
                assignmentSearch={assignmentSearch}
                onAssignmentSearchChange={changeAssignmentSearch}
                onAssignmentPageChange={setAssignmentPageNumber}
                clientId={detail.account.id}
                reload={reloadAll}
              />
            ) : null}
          </Surface>
        </>
      )}
    </div>
  );
}

function LiveAccessSection({
  base,
  detail,
}: {
  base: string;
  detail: ClientDetail;
}) {
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [assignmentPageNumber, setAssignmentPageNumber] = useState(1);
  const debouncedAssignmentSearch = useDebouncedValue(assignmentSearch.trim());
  const { assignments, error, loading, reload } = useClientAssignments(
    detail.account.id,
    {
      search: debouncedAssignmentSearch,
      page: assignmentPageNumber,
    },
  );
  return (
    <div className="space-y-6">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Configuración
        </p>
        <h1 className="text-heading-lg font-bold">Accesos</h1>
        <p className="mt-1 text-body text-muted-foreground">
          Consulta qué miembros tienen acceso a {detail.account.name} y con qué
          perfil.
        </p>
      </header>
      {loading ? (
        <LoadingState label="Cargando accesos protegidos…" />
      ) : error ? (
        <div className="space-y-3">
          <ErrorNotice
            error={error}
            fallback="No se pudieron cargar los accesos. Verifica tu sesión y vuelve a intentarlo."
          />
          <Button type="button" variant="outline" onClick={reload}>
            <RefreshCw />
            Reintentar
          </Button>
        </div>
      ) : (
        <Surface>
          <SurfaceHeader
            title="Miembros con acceso"
            description="El acceso se deriva de las asignaciones activas del cliente."
            actions={
              <Button
                render={<Link href={`${base}/settings/responsibles`} />}
                variant="outline"
                size="sm"
              >
                Administrar asignaciones
              </Button>
            }
          />
          <FilterBar>
            <Field label="Buscar acceso">
              <Input
                type="search"
                maxLength={DOMAIN_SEARCH_MAX_LENGTH}
                value={assignmentSearch}
                onChange={(event) => {
                  setAssignmentSearch(
                    normalizeDomainSearch(event.target.value),
                  );
                  setAssignmentPageNumber(1);
                }}
                placeholder="Nombre o correo"
                className="w-72"
              />
            </Field>
          </FilterBar>
          <ProductTable
            caption="Miembros con acceso al cliente"
            rows={assignments?.items ?? []}
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
          <CollectionPagination
            meta={assignments?.meta ?? null}
            itemLabel="accesos"
            onPageChange={setAssignmentPageNumber}
          />
        </Surface>
      )}
    </div>
  );
}

function LiveClientDetailContent({
  clientId,
  section,
}: {
  clientId: string;
  section: LiveClientDetailSection;
}) {
  const { organization, capabilities, locale } = useAccountingContext();
  const router = useRouter();
  const [entitySearch, setEntitySearch] = useState("");
  const [entityPageNumber, setEntityPageNumber] = useState(1);
  const debouncedEntitySearch = useDebouncedValue(entitySearch.trim());
  const { detail, error, loading, reload } = useClientDetail(clientId, {
    legalEntityPage: entityPageNumber,
    legalEntitySearch: debouncedEntitySearch,
  });
  const canManage = capabilities.includes("clients.manage");
  const canManageEntities = capabilities.includes("fiscal_entities.manage");
  const canAssign = capabilities.includes("clients.assign");
  const canViewFiscalYears = capabilities.includes("fiscal_years.view");
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
              value: <StatusBadge status={account.status} locale={locale} />,
            },
            {
              label: "Entidades fiscales",
              value: detail.legalEntities.meta.total,
            },
            {
              label: "Responsable principal",
              value: detail.primaryAssignment?.displayName ?? "Sin responsable",
            },
            ...(canViewFiscalYears
              ? [
                  {
                    label: "Ejercicios en esta página",
                    value: detail.legalEntities.items.reduce(
                      (total, entity) => total + (entity.fiscalYearCount ?? 0),
                      0,
                    ),
                  },
                ]
              : []),
          ]}
        />
        {canManage || canAssign || canViewFiscalYears ? (
          <Surface>
            <SurfaceHeader
              title="Accesos rápidos"
              description="Abre directamente una sección disponible para tu membresía."
            />
            <div className="grid gap-3 p-5 md:grid-cols-3">
              {canManage ? (
                <Link
                  href={`${base}/settings/data`}
                  className="rounded-md border border-border p-4 transition-colors hover:bg-muted"
                >
                  <p className="font-semibold">Datos del cliente</p>
                  <p className="mt-1 text-body-sm text-muted-foreground">
                    Nombre de cuenta y entidades fiscales.
                  </p>
                </Link>
              ) : null}
              {canAssign ? (
                <Link
                  href={`${base}/settings/responsibles`}
                  className="rounded-md border border-border p-4 transition-colors hover:bg-muted"
                >
                  <p className="font-semibold">Responsables</p>
                  <p className="mt-1 text-body-sm text-muted-foreground">
                    Responsable principal, colaboradores y revisores.
                  </p>
                </Link>
              ) : null}
              {canViewFiscalYears ? (
                <Link
                  href={`${base}/fiscal-years${entityContextSuffix(entityPageNumber, debouncedEntitySearch)}`}
                  className="rounded-md border border-border p-4 transition-colors hover:bg-muted"
                >
                  <p className="font-semibold">Ejercicios</p>
                  <p className="mt-1 text-body-sm text-muted-foreground">
                    Ejercicios y períodos por entidad fiscal.
                  </p>
                </Link>
              ) : null}
            </div>
          </Surface>
        ) : null}
        <Surface>
          <SurfaceHeader
            title="Entidades fiscales"
            description="RFC asociados a esta cuenta cliente."
            actions={
              canViewFiscalYears ? (
                <Button
                  render={
                    <Link
                      href={`${base}/fiscal-years${entityContextSuffix(entityPageNumber, debouncedEntitySearch)}`}
                    />
                  }
                  variant="outline"
                  size="sm"
                >
                  Ver ejercicios
                </Button>
              ) : undefined
            }
          />
          <FilterBar>
            <Field label="Buscar entidad fiscal">
              <Input
                type="search"
                maxLength={DOMAIN_SEARCH_MAX_LENGTH}
                value={entitySearch}
                onChange={(event) => {
                  setEntitySearch(normalizeDomainSearch(event.target.value));
                  setEntityPageNumber(1);
                }}
                placeholder="Razón social o RFC"
                className="w-72"
              />
            </Field>
          </FilterBar>
          <ProductTable
            caption="Resumen de entidades fiscales"
            rows={detail.legalEntities.items}
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
                render: (entity) => (
                  <StatusBadge status={entity.status} locale={locale} />
                ),
              },
              {
                id: "years",
                header: "Ejercicios",
                render: (entity) => entity.fiscalYearCount ?? 0,
              },
            ]}
          />
          <CollectionPagination
            meta={detail.legalEntities.meta}
            itemLabel="entidades fiscales"
            onPageChange={setEntityPageNumber}
          />
        </Surface>
      </div>
    );
  }

  if (section === "responsibles") {
    return <LiveResponsiblesSection detail={detail} reloadDetail={reload} />;
  }

  if (section === "access") {
    return <LiveAccessSection base={base} detail={detail} />;
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
        <FilterBar>
          <Field label="Buscar entidad fiscal">
            <Input
              type="search"
              maxLength={DOMAIN_SEARCH_MAX_LENGTH}
              value={entitySearch}
              onChange={(event) => {
                setEntitySearch(normalizeDomainSearch(event.target.value));
                setEntityPageNumber(1);
              }}
              placeholder="Razón social o RFC"
              className="w-72"
            />
          </Field>
        </FilterBar>
        <ProductTable
          caption="Entidades fiscales"
          rows={detail.legalEntities.items}
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
              render: (entity) => (
                <StatusBadge status={entity.status} locale={locale} />
              ),
            },
            {
              id: "years",
              header: "Ejercicios",
              render: (entity) => (
                <Link
                  className="font-semibold text-primary hover:underline"
                  href={`${base}/legal-entities/${entity.id}/fiscal-years${entityContextSuffix(entityPageNumber, debouncedEntitySearch)}`}
                >
                  {entity.fiscalYearCount ?? 0} ejercicios
                </Link>
              ),
            },
            {
              id: "open",
              header: "Acción",
              render: (entity) => (
                <Button
                  render={
                    <Link
                      href={`${base}/legal-entities/${entity.id}/fiscal-years${entityContextSuffix(entityPageNumber, debouncedEntitySearch)}`}
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
        <CollectionPagination
          meta={detail.legalEntities.meta}
          itemLabel="entidades fiscales"
          onPageChange={setEntityPageNumber}
        />
        {canManageEntities ? (
          <AddLegalEntityForm clientId={clientId} reload={reload} />
        ) : null}
      </Surface>
    </div>
  );
}
