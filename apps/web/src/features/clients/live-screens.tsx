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
import {
  Archive,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  UserRoundPlus,
  X,
} from "lucide-react";
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
import type { Capability } from "@/lib/accounting-types";
import { ApiError, apiErrorMessage, isAbortError } from "@/lib/api-client";
import { hasCapability } from "@/lib/permissions";
import {
  archiveClient,
  archiveLegalEntity,
  createAssignment,
  createClient,
  createFiscalYear,
  createLegalEntity,
  getAssignments,
  getAvailableMembers,
  getClient,
  getClients,
  getFiscalYears,
  getPeriods,
  getPrimaryCandidates,
  revokeAssignment,
  updateClient,
  updateLegalEntity,
  type CollectionQuery,
} from "./api";
import {
  initialFiscalPeriodsLoadState,
  rejectFiscalPeriodsLoad,
  resolveFiscalPeriodsLoad,
  selectFiscalPeriodsLoad,
  startFiscalPeriodsLoad,
  type FiscalPeriodsQueryKey,
} from "./fiscal-periods-load-state";
import {
  initialFiscalYearsLoadState,
  rejectFiscalYearsLoad,
  resolveFiscalYearsLoad,
  selectFiscalYearsLoad,
  startFiscalYearsLoad,
  type FiscalYearsQueryKey,
} from "./fiscal-years-load-state";
import {
  DOMAIN_SEARCH_MAX_LENGTH,
  entityContextSuffix,
  fiscalEntitySelectorHref,
  isLegalEntityRouteUnavailableError,
  legalEntityDetailQuery,
  normalizeCollectionPage,
  normalizeDomainSearch,
  resolveEntitySearchDraft,
} from "./entity-context";
import {
  clearClientListState,
  clientListQueryValue,
  clientSearchQuery,
  editClientSearchDraft,
  initialClientListLoadState,
  normalizeClientListSearch,
  rejectClientListLoad,
  resolveClientListLoad,
  resolveClientSearchDraft,
  selectClientListLoad,
  startClientListLoad,
} from "./client-list-query";
import {
  acquireSubmissionLock,
  releaseSubmissionLock,
} from "./submission-guard";
import type {
  AccountAssignment,
  AssignmentResponsibility,
  ClientDetail,
  CollectionPage,
  LegalEntity,
  MemberCandidate,
  PageMeta,
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

function useClientDetail(
  clientId: string,
  {
    legalEntityId,
    legalEntityPage = 1,
    legalEntityLimit = DOMAIN_PAGE_LIMIT,
    legalEntitySearch = "",
  }: {
    legalEntityId?: string;
    legalEntityPage?: number;
    legalEntityLimit?: number;
    legalEntitySearch?: string;
  } = {},
) {
  const { organization, registerClientName } = useAccountingContext();
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);
  const [state, setState] = useState<{
    organizationId: string | null;
    clientId: string | null;
    requestId: number;
    status: "loading" | "ready" | "error";
    detail: ClientDetail | null;
    error: unknown;
  }>({
    organizationId: null,
    clientId: null,
    requestId: 0,
    status: "loading",
    detail: null,
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
        detail: null,
        error: null,
      });
      void getClient(
        clientId,
        {
          legalEntityId,
          legalEntityPage,
          legalEntityLimit,
          legalEntitySearch: legalEntitySearch || undefined,
        },
        controller.signal,
      )
        .then((nextDetail) => {
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
                  detail: nextDetail,
                  error: null,
                }
              : current,
          );
          registerClientName(nextDetail.account.id, nextDetail.account.name);
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
                  detail: null,
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
  }, [
    clientId,
    legalEntityId,
    legalEntityLimit,
    legalEntityPage,
    legalEntitySearch,
    organization.id,
    registerClientName,
    revision,
  ]);
  const belongsToContext =
    state.organizationId === organization.id && state.clientId === clientId;
  return {
    detail:
      belongsToContext && state.status === "ready" ? state.detail : null,
    error: belongsToContext && state.status === "error" ? state.error : null,
    loading: !belongsToContext || state.status === "loading",
    reload,
  };
}

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
  const [name, setName] = useState("");
  const [rfc, setRfc] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [pending, setPending] = useState(false);
  const submissionLock = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const candidates = useMemberCandidatePage(getPrimaryCandidates, open);
  const members = candidates.result?.items ?? [];
  const selectedMembershipId = members.some(
    (member) => member.membershipId === membershipId,
  )
    ? membershipId
    : (members[0]?.membershipId ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!acquireSubmissionLock(submissionLock)) return;
    const normalizedRfc = rfc.trim().toUpperCase();
    if (!RFC_PATTERN.test(normalizedRfc)) {
      setError(
        new ApiError(
          400,
          "Revisa los campos señalados e intenta de nuevo.",
          "VALIDATION_ERROR",
          {
            "legalEntity.rfc": [
              "Ingresa un RFC válido de 12 o 13 caracteres, sin espacios ni guiones.",
            ],
          },
        ),
      );
      releaseSubmissionLock(submissionLock);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await createClient({
        accountName: name.trim(),
        legalEntity: { legalName: name.trim(), rfc: normalizedRfc },
        primaryMembershipId: selectedMembershipId,
        fiscalYear: year,
      });
      onClose();
      router.push(
        `${base}/clients/${created.clientAccountId}/legal-entities/${created.legalEntityId}/fiscal-years/${year}${entityContextSuffix(1, normalizedRfc)}`,
      );
    } catch (cause) {
      setError(cause);
    } finally {
      releaseSubmissionLock(submissionLock);
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
          <Field label="Buscar responsable">
            <Input
              type="search"
              maxLength={DOMAIN_SEARCH_MAX_LENGTH}
              value={candidates.search}
              onChange={(event) => candidates.setSearch(event.target.value)}
              placeholder="Nombre o correo"
            />
          </Field>
          <Field label="Responsable principal">
            <select
              required
              className={selectClass}
              value={selectedMembershipId}
              disabled={candidates.pending}
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
                {candidates.pending
                  ? "Buscando responsables…"
                  : members.length === 0
                    ? "No hay coincidencias"
                    : "Selecciona un responsable"}
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
          <div className="sm:col-span-2">
            <ErrorNotice
              error={candidates.error}
              fallback="No se pudieron buscar responsables."
            />
            <CollectionPagination
              meta={candidates.result?.meta ?? null}
              itemLabel="responsables"
              onPageChange={candidates.setPageNumber}
            />
          </div>
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
          <Button
            type="submit"
            disabled={
              pending || candidates.pending || !selectedMembershipId
            }
          >
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
  const queryKey = searchParams.toString();
  const routeSearch = normalizeClientListSearch(searchParams.get("search"));
  const [searchDraft, setSearchDraft] = useState({
    base: routeSearch,
    value: routeSearch,
  });
  const search = resolveClientSearchDraft(searchDraft, routeSearch);
  const debouncedSearch = useDebouncedValue(search);
  const requestSequence = useRef(0);
  const [loadState, setLoadState] = useState(initialClientListLoadState);
  const { page, loading, error } = selectClientListLoad(
    loadState,
    organization.id,
    queryKey,
  );
  const [creating, setCreating] = useState(false);
  const base = `/${pathname.split("/").filter(Boolean)[0] ?? "es"}/organizations/${encodeURIComponent(organization.slug)}`;
  const canCreate = [
    "clients.manage",
    "clients.assign",
    "fiscal_entities.manage",
    "fiscal_years.manage",
  ].every((permission) => capabilities.includes(permission as never));

  useEffect(() => {
    if (searchDraft.base !== routeSearch) return;
    const nextQuery = clientSearchQuery(queryKey, debouncedSearch);
    if (nextQuery === null) return;
    router.replace(`${pathname}?${nextQuery}`);
  }, [
    debouncedSearch,
    pathname,
    queryKey,
    routeSearch,
    router,
    searchDraft.base,
  ]);

  useEffect(() => {
    const request = {
      organizationId: organization.id,
      queryKey,
      requestId: ++requestSequence.current,
    };
    const controller = new AbortController();
    const params = new URLSearchParams(queryKey);
    const timer = globalThis.setTimeout(() => {
      setLoadState(startClientListLoad(request));
      void getClients(
        {
          search: params.get("search") || undefined,
          status: params.get("status") || undefined,
          page: normalizeCollectionPage(params.get("page")),
          limit: 25,
          sort:
            (params.get("sort") as "name" | "status" | "updatedAt") || "name",
          direction: (params.get("direction") as "asc" | "desc") || "asc",
        },
        controller.signal,
      )
        .then((nextPage) => {
          if (controller.signal.aborted) return;
          setLoadState((current) =>
            resolveClientListLoad(current, request, nextPage),
          );
        })
        .catch((cause) => {
          if (controller.signal.aborted || isAbortError(cause)) return;
          setLoadState((current) =>
            rejectClientListLoad(current, request, cause),
          );
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [organization.id, queryKey]);

  function setQuery(
    key: "page" | "status" | "sort" | "direction",
    value?: string,
  ) {
    const nextQuery = clientListQueryValue(queryKey, key, value);
    if (nextQuery !== null) router.replace(`${pathname}?${nextQuery}`);
  }

  function clearFilters() {
    const cleared = clearClientListState(routeSearch);
    setSearchDraft(cleared.searchDraft);
    router.replace(pathname);
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
              maxLength={DOMAIN_SEARCH_MAX_LENGTH}
              onChange={(event) =>
                setSearchDraft(
                  editClientSearchDraft(routeSearch, event.target.value),
                )
              }
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
          <Button variant="outline" onClick={clearFilters}>
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
            onChange={(event) =>
              onAssignmentSearchChange(event.target.value)
            }
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
      <form
        onSubmit={submit}
        className="space-y-4 border-t border-border p-5"
      >
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
            disabled={
              pending || candidates.pending || !selectedMembershipId
            }
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
  const debouncedAssignmentSearch = useDebouncedValue(
    assignmentSearch.trim(),
  );
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
          Administra quién atiende, colabora o revisa la cuenta de {detail.account.name}.
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

const DOMAIN_PAGE_LIMIT = 10;

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebounced(value), delay);
    return () => globalThis.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function CollectionPagination({
  meta,
  itemLabel,
  onPageChange,
}: {
  meta: PageMeta | null;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  if (!meta) return null;
  const first =
    meta.total === 0
      ? 0
      : Math.min((meta.page - 1) * meta.limit + 1, meta.total);
  const last = Math.min(meta.page * meta.limit, meta.total);
  const previousPage = Math.max(
    1,
    Math.min(meta.page - 1, meta.totalPages || 1),
  );
  return (
    <nav
      aria-label={`Paginación de ${itemLabel}`}
      className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-body-sm text-muted-foreground">
        {first}–{last} de {meta.total} {itemLabel}
      </p>
      {meta.totalPages > 1 || meta.page > 1 ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={meta.page <= 1}
            onClick={() => onPageChange(previousPage)}
          >
            Anterior
          </Button>
          <span className="flex min-h-9 items-center px-2 text-body-sm tabular-nums">
            Página {meta.page} de {Math.max(meta.totalPages, 1)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={meta.page >= meta.totalPages}
            onClick={() => onPageChange(meta.page + 1)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

type MemberCandidateLoader = (
  query: CollectionQuery,
  signal?: AbortSignal,
) => Promise<CollectionPage<MemberCandidate>>;

function useMemberCandidatePage(
  loader: MemberCandidateLoader,
  enabled: boolean,
  refreshKey: string | number = 0,
) {
  const [search, setSearchValue] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [result, setResult] = useState<CollectionPage<MemberCandidate> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const debouncedSearch = useDebouncedValue(search.trim());
  const searchPending = search.trim() !== debouncedSearch;
  const setSearch = useCallback((value: string) => {
    setSearchValue(normalizeDomainSearch(value));
    setPageNumber(1);
  }, []);
  const selectPage = useCallback((page: number) => {
    setResult(null);
    setPageNumber(page);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setResult(null);
      setLoading(true);
      setError(null);
      void loader(
        {
          search: debouncedSearch || undefined,
          page: pageNumber,
          limit: DOMAIN_PAGE_LIMIT,
        },
        controller.signal,
      )
        .then((next) => {
          if (!controller.signal.aborted) setResult(next);
        })
        .catch((cause) => {
          if (!controller.signal.aborted && !isAbortError(cause))
            setError(cause);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [debouncedSearch, enabled, loader, pageNumber, refreshKey]);
  return {
    search,
    setSearch,
    setPageNumber: selectPage,
    result,
    loading: loading || searchPending,
    pending: loading || searchPending,
    error,
  };
}

function useLegalEntityRouteQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const rawRouteSearch = searchParams.get("entitySearch") ?? "";
  const routeSearch = normalizeDomainSearch(rawRouteSearch);
  const page = normalizeCollectionPage(searchParams.get("entityPage"));
  const [draft, setDraft] = useState({ base: routeSearch, value: routeSearch });
  const currentSearch = resolveEntitySearchDraft(draft, routeSearch);
  const debouncedSearch = useDebouncedValue(currentSearch.trim());
  const setSearch = (value: string) =>
    setDraft({ base: routeSearch, value: normalizeDomainSearch(value) });
  useEffect(() => {
    if (draft.base !== routeSearch) return;
    const next = new URLSearchParams(queryKey);
    if (debouncedSearch) next.set("entitySearch", debouncedSearch);
    else next.delete("entitySearch");
    if (debouncedSearch !== routeSearch) next.delete("entityPage");
    if (next.toString() !== queryKey) {
      const serialized = next.toString();
      router.replace(serialized ? `${pathname}?${serialized}` : pathname);
    }
  }, [debouncedSearch, draft.base, pathname, queryKey, routeSearch, router]);
  const setPage = useCallback(
    (nextPage: number) => {
      const next = new URLSearchParams(queryKey);
      if (nextPage > 1) next.set("entityPage", String(nextPage));
      else next.delete("entityPage");
      const serialized = next.toString();
      router.replace(serialized ? `${pathname}?${serialized}` : pathname);
    },
    [pathname, queryKey, router],
  );
  return {
    page,
    routeSearch,
    search: currentSearch,
    setSearch,
    setPage,
    suffix: entityContextSuffix(page, routeSearch),
  };
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
  const debouncedAssignmentSearch = useDebouncedValue(
    assignmentSearch.trim(),
  );
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
              value: <StatusBadge status={account.status} />,
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
                    value: detail.fiscalYears.length,
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
                      href={`${base}/legal-entities/${entity.id}/fiscal-years/${year.year}${entityContextSuffix(entityPageNumber, debouncedEntitySearch)}`}
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

function LegalEntitySelector({
  detail,
  base,
  suffix,
  routeQuery,
}: {
  detail: ClientDetail;
  base: string;
  suffix: string;
  routeQuery: ReturnType<typeof useLegalEntityRouteQuery>;
}) {
  const available = detail.legalEntities.items;
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
        <FilterBar>
          <Field label="Buscar entidad fiscal">
            <Input
              type="search"
              maxLength={DOMAIN_SEARCH_MAX_LENGTH}
              value={routeQuery.search}
              onChange={(event) => routeQuery.setSearch(event.target.value)}
              placeholder="Razón social o RFC"
              className="w-72"
            />
          </Field>
        </FilterBar>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {available.length === 0 ? (
            <p className="text-body-sm text-muted-foreground sm:col-span-2">
              No hay entidades fiscales que coincidan con la búsqueda.
            </p>
          ) : (
            available.map((entity) => (
              <Link
                key={entity.id}
                href={`${base}/legal-entities/${entity.id}/fiscal-years${suffix}${routeQuery.suffix}`}
                className="rounded-md border border-border p-4 hover:bg-muted"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{entity.legalName}</p>
                  <StatusBadge
                    status={
                      entity.status === "active" ? "Activo" : "Suspendido"
                    }
                  />
                </div>
                <p className="identifier text-body-sm text-muted-foreground">
                  {entity.rfc}
                </p>
                {entity.status === "suspended" ? (
                  <p className="mt-2 text-caption text-muted-foreground">
                    Disponible en modo consulta.
                  </p>
                ) : null}
              </Link>
            ))
          )}
        </div>
        <CollectionPagination
          meta={detail.legalEntities.meta}
          itemLabel="entidades fiscales"
          onPageChange={routeQuery.setPage}
        />
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
  const routeQuery = useLegalEntityRouteQuery();
  const { detail, error, loading } = useClientDetail(
    clientId,
    legalEntityDetailQuery(
      legalEntityId,
      routeQuery.page,
      routeQuery.routeSearch,
    ),
  );
  const [yearsState, setYearsState] = useState(initialFiscalYearsLoadState);
  const requestSequence = useRef(0);
  const [revision, setRevision] = useState(0);
  const base = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${clientId}`;
  const availableEntities = useMemo(
    () => detail?.legalEntities.items ?? [],
    [detail],
  );
  const entity = legalEntityId
    ? availableEntities.find((item) => item.id === legalEntityId)
    : undefined;
  const yearsQuery = useMemo<FiscalYearsQueryKey | null>(
    () =>
      entity
        ? {
            organizationId: organization.id,
            clientId,
            legalEntityId: entity.id,
            revision,
          }
        : null,
    [clientId, entity, organization.id, revision],
  );
  useEffect(() => {
    if (
      !legalEntityId &&
      detail?.legalEntities.meta.total === 1 &&
      availableEntities.length === 1
    )
      router.replace(
        `${base}/legal-entities/${availableEntities[0].id}/fiscal-years${routeQuery.suffix}`,
      );
  }, [
    availableEntities,
    base,
    detail?.legalEntities.meta.total,
    legalEntityId,
    routeQuery.suffix,
    router,
  ]);
  useEffect(() => {
    const requestId = ++requestSequence.current;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      if (!yearsQuery) {
        setYearsState(initialFiscalYearsLoadState);
        return;
      }
      const request = { ...yearsQuery, requestId };
      setYearsState(startFiscalYearsLoad(request));
      void getFiscalYears(request.legalEntityId, controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return;
          setYearsState((current) =>
            resolveFiscalYearsLoad(current, request, items),
          );
        })
        .catch((cause) => {
          if (controller.signal.aborted || isAbortError(cause)) return;
          setYearsState((current) =>
            rejectFiscalYearsLoad(current, request, cause),
          );
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [yearsQuery]);
  if (loading) return <LoadingState label="Cargando ejercicios…" />;
  if (isLegalEntityRouteUnavailableError(error, legalEntityId)) {
    return <LegalEntityUnavailable base={base} error={error} />;
  }
  if (error || !detail)
    return (
      <ErrorNotice error={error} fallback="No se pudo cargar el cliente." />
    );
  if (!legalEntityId)
    return detail.legalEntities.meta.total === 1 &&
      availableEntities.length === 1 ? (
      <LoadingState label="Abriendo el único RFC…" />
    ) : (
      <LegalEntitySelector
        detail={detail}
        base={base}
        suffix=""
        routeQuery={routeQuery}
      />
    );
  if (!entity)
    return (
      <LegalEntityUnavailable
        base={base}
        error={new ApiError(
          404,
          "La entidad fiscal no está disponible.",
          "LEGAL_ENTITY_NOT_FOUND",
        )}
      />
    );
  const visibleYearsState = selectFiscalYearsLoad(yearsState, yearsQuery!);
  const yearsLoading =
    visibleYearsState.status === "idle" ||
    visibleYearsState.status === "loading";
  const yearsError =
    visibleYearsState.status === "error" ? visibleYearsState.error : null;
  const years =
    visibleYearsState.status === "ready" ? visibleYearsState.years : [];
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
      {entity.status === "suspended" ? (
        <WarningNotice>
          Este RFC está suspendido. Puedes consultar sus ejercicios y períodos,
          pero no crear ejercicios nuevos hasta que vuelva a estar activo.
        </WarningNotice>
      ) : null}
      {yearsLoading ? (
        <LoadingState label={`Cargando ejercicios de ${entity.rfc}…`} />
      ) : yearsError ? (
        <div className="space-y-3">
          <ErrorNotice
            error={yearsError}
            fallback="No se pudieron cargar los ejercicios."
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw />
            Reintentar
          </Button>
        </div>
      ) : (
        <Surface>
          <SurfaceHeader
            title="Ejercicios"
            description="Cada ejercicio pertenece a este RFC y contiene doce períodos."
            actions={
              entity.status === "active" &&
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
            emptyMessage="No hay ejercicios fiscales registrados para este RFC."
            columns={[
              {
                id: "year",
                header: "Año",
                render: (year) => (
                  <Link
                    className="font-semibold text-primary hover:underline"
                    href={`${base}/legal-entities/${entity.id}/fiscal-years/${year.year}${routeQuery.suffix}`}
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
                        href={`${base}/legal-entities/${entity.id}/fiscal-years/${year.year}${routeQuery.suffix}`}
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
      )}
    </div>
  );
}

function LegalEntityUnavailable({
  base,
  error,
}: {
  base: string;
  error: unknown;
}) {
  return (
    <div className="space-y-5">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Contexto fiscal
        </p>
        <h1 className="text-heading-lg font-bold">
          Entidad fiscal no disponible
        </h1>
        <p className="mt-1 text-body text-muted-foreground">
          El RFC del enlace no existe, está archivado o ya no está disponible
          para tu membresía.
        </p>
      </header>
      <ErrorNotice
        error={error}
        fallback="No se encontró la entidad fiscal solicitada."
      />
      <Button
        render={<Link href={fiscalEntitySelectorHref(base)} />}
        variant="outline"
      >
        Seleccionar otro RFC
      </Button>
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
  const routeQuery = useLegalEntityRouteQuery();
  const { detail, error, loading } = useClientDetail(
    clientId,
    legalEntityDetailQuery(
      legalEntityId,
      routeQuery.page,
      routeQuery.routeSearch,
    ),
  );
  const [periodsState, setPeriodsState] = useState(
    initialFiscalPeriodsLoadState,
  );
  const requestSequence = useRef(0);
  const base = `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${clientId}`;
  const availableEntities = useMemo(
    () => detail?.legalEntities.items ?? [],
    [detail],
  );
  const entity = legalEntityId
    ? availableEntities.find((item) => item.id === legalEntityId)
    : undefined;
  const periodsQuery = useMemo<FiscalPeriodsQueryKey | null>(
    () =>
      entity
        ? {
            organizationId: organization.id,
            clientId,
            legalEntityId: entity.id,
            year,
          }
        : null,
    [clientId, entity, organization.id, year],
  );
  useEffect(() => {
    if (
      !legalEntityId &&
      detail?.legalEntities.meta.total === 1 &&
      availableEntities.length === 1
    )
      router.replace(
        `${base}/legal-entities/${availableEntities[0].id}/fiscal-years/${year}${routeQuery.suffix}`,
      );
  }, [
    availableEntities,
    base,
    detail?.legalEntities.meta.total,
    legalEntityId,
    routeQuery.suffix,
    router,
    year,
  ]);
  useEffect(() => {
    const requestId = ++requestSequence.current;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      if (!periodsQuery) {
        setPeriodsState(initialFiscalPeriodsLoadState);
        return;
      }
      const request = { ...periodsQuery, requestId };
      setPeriodsState(startFiscalPeriodsLoad(request));
      void getFiscalYears(request.legalEntityId, controller.signal)
        .then((years) => {
          if (controller.signal.aborted) return null;
          const match = years.find((item) => String(item.year) === request.year);
          if (!match)
            throw new ApiError(
              404,
              "Ejercicio fiscal no encontrado",
              "FISCAL_YEAR_NOT_FOUND",
            );
          return getPeriods(match.id, controller.signal);
        })
        .then((data) => {
          if (!data || controller.signal.aborted) return;
          setPeriodsState((current) =>
            resolveFiscalPeriodsLoad(current, request, data),
          );
        })
        .catch((cause) => {
          if (controller.signal.aborted || isAbortError(cause)) return;
          setPeriodsState((current) =>
            rejectFiscalPeriodsLoad(current, request, cause),
          );
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [periodsQuery]);
  if (loading) return <LoadingState label="Cargando contexto fiscal…" />;
  if (isLegalEntityRouteUnavailableError(error, legalEntityId)) {
    return <LegalEntityUnavailable base={base} error={error} />;
  }
  if (error || !detail)
    return (
      <ErrorNotice error={error} fallback="No se pudo cargar el cliente." />
    );
  if (!legalEntityId)
    return detail.legalEntities.meta.total === 1 &&
      availableEntities.length === 1 ? (
      <LoadingState label="Abriendo el único RFC…" />
    ) : (
      <LegalEntitySelector
        detail={detail}
        base={base}
        suffix={`/${year}`}
        routeQuery={routeQuery}
      />
    );
  if (!entity)
    return (
      <LegalEntityUnavailable
        base={base}
        error={new ApiError(
          404,
          "La entidad fiscal no está disponible.",
          "LEGAL_ENTITY_NOT_FOUND",
        )}
      />
    );
  const visiblePeriodsState = selectFiscalPeriodsLoad(
    periodsState,
    periodsQuery!,
  );
  if (
    visiblePeriodsState.status === "idle" ||
    visiblePeriodsState.status === "loading"
  )
    return <LoadingState label="Cargando los doce períodos…" />;
  if (visiblePeriodsState.status === "error" || !visiblePeriodsState.data)
    return (
      <ErrorNotice
        error={visiblePeriodsState.error}
        fallback="No se pudieron cargar los períodos."
      />
    );
  const data = visiblePeriodsState.data;
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
                href={`${base}/legal-entities/${entity.id}/fiscal-years/${year}${routeQuery.suffix}`}
              />
            }
            variant="outline"
          >
            Volver al ejercicio
          </Button>
        </header>
        {entity.status === "suspended" ? (
          <WarningNotice>
            Este RFC está suspendido. El período permanece disponible en modo
            consulta, sin acciones de modificación.
          </WarningNotice>
        ) : null}
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
      {entity.status === "suspended" ? (
        <WarningNotice>
          Este RFC está suspendido. Puedes consultar sus períodos, pero no
          realizar cambios hasta que vuelva a estar activo.
        </WarningNotice>
      ) : null}
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
                  href={`${base}/legal-entities/${entity.id}/fiscal-years/${year}/periods/${String(period.month).padStart(2, "0")}/overview${routeQuery.suffix}`}
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

export function LiveForbiddenScreen({
  capability,
}: {
  capability: Capability;
}) {
  const { clientId, organization, locale } = useAccountingContext();
  const canReturnToClient = Boolean(
    clientId && capability !== "clients.view",
  );
  const destination = canReturnToClient
    ? `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${encodeURIComponent(clientId!)}/overview`
    : `/${locale}/organizations/${encodeURIComponent(organization.slug)}/home`;
  return (
    <div className="space-y-6">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Error 403
        </p>
        <h1 className="text-heading-lg font-bold">Acceso restringido</h1>
        <p className="mt-1 max-w-reading text-body text-muted-foreground">
          Tu membresía no incluye la capacidad necesaria para abrir esta
          sección.
        </p>
      </header>
      <Surface className="flex min-h-64 items-start gap-4 p-6">
        <div className="grid size-10 shrink-0 place-items-center rounded-md bg-warning-surface text-warning">
          <LockKeyhole className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-heading-sm font-emphasis">
            Revisa tu asignación o capacidad
          </h2>
          <p className="mt-2 max-w-reading text-body text-muted-foreground">
            Solicita acceso a una persona administradora del despacho si
            necesitas trabajar en esta sección. No se cargaron los datos
            restringidos.
          </p>
          <Button
            render={<Link href={destination} />}
            className="mt-5"
          >
            {canReturnToClient ? "Volver al cliente" : "Volver al inicio"}
          </Button>
        </div>
      </Surface>
    </div>
  );
}

export function LiveUnavailableScreen({
  title = "Funcionalidad fuera de esta entrega",
  description = "Esta vista no usa datos demo cuando el modo real está activo. El alcance actual cubre clientes, RFC, asignaciones, ejercicios y períodos.",
  returnHref,
  returnLabel = "Volver a clientes",
}: {
  title?: string;
  description?: string;
  returnHref?: string;
  returnLabel?: string;
} = {}) {
  const { organization, locale } = useAccountingContext();
  const destination =
    returnHref ??
    `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients`;
  return (
    <div className="space-y-4">
      <header className="border-l-2 border-brand-mark pl-4">
        <p className="text-caption font-semibold text-accent-foreground">
          Módulo real
        </p>
        <h1 className="text-heading-lg font-bold">{title}</h1>
      </header>
      <WarningNotice>{description}</WarningNotice>
      <Button
        render={<Link href={destination} />}
        variant="outline"
      >
        <RefreshCw />
        {returnLabel}
      </Button>
    </div>
  );
}
