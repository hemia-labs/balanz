"use client";

import { FilterBar } from "@/components/filter-bar";
import { CollectionPagination } from "@/components/collection-pagination";
import { ClientRowActions } from "./client-row-actions";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { ControlledDialog } from "@/components/overlay-dialog";
import { PageHeader } from "@/components/page-header";
import { Field, Surface } from "@/components/product-patterns";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { ApiError, isAbortError } from "@/lib/api-client";
import { createClient, getClients, getPrimaryCandidates } from "./api";
import {
  DOMAIN_SEARCH_MAX_LENGTH,
  entityContextSuffix,
  normalizeCollectionPage,
} from "./entity-context";
import {
  clearClientListState,
  clientListQueryValue,
  clientSearchQuery,
  editClientSearchDraft,
  initialClientListLoadState,
  normalizeClientListSearch,
  rebaseClientSearchDraft,
  rejectClientListLoad,
  resolveClientListLoad,
  resolveClientSearchDraft,
  selectClientListLoad,
  shouldSyncClientSearch,
  startClientListLoad,
} from "./client-list-query";
import {
  acquireSubmissionLock,
  releaseSubmissionLock,
} from "./submission-guard";
import {
  ErrorNotice,
  roleLabels,
  selectClass,
} from "./live-screen-primitives";
import { useDebouncedValue, useMemberCandidatePage } from "./live-query-hooks";

function apiFieldError(error: unknown, ...fields: string[]) {
  if (!(error instanceof ApiError)) return undefined;
  for (const field of fields) {
    const message = error.fieldErrors[field]?.[0];
    if (message) return message;
  }
  return undefined;
}

const RFC_PATTERN = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;

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
    <ControlledDialog
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
            disabled={pending || candidates.pending || !selectedMembershipId}
          >
            {pending ? "Creando…" : "Crear cliente"}
          </Button>
        </div>
      </form>
    </ControlledDialog>
  );
}

export function LiveClientsScreen() {
  const { organization, capabilities, locale } = useAccountingContext();
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
  const [refreshCount, setRefreshCount] = useState(0);
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
    const timer = globalThis.setTimeout(() => {
      setSearchDraft((current) =>
        rebaseClientSearchDraft(current, routeSearch),
      );
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [routeSearch]);

  useEffect(() => {
    if (
      !shouldSyncClientSearch(
        searchDraft,
        routeSearch,
        debouncedSearch,
        search,
      )
    )
      return;
    const nextQuery = clientSearchQuery(queryKey, debouncedSearch);
    if (nextQuery === null) return;
    router.replace(`${pathname}?${nextQuery}`);
  }, [
    debouncedSearch,
    pathname,
    queryKey,
    routeSearch,
    router,
    search,
    searchDraft,
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
          search: normalizeClientListSearch(params.get("search")) || undefined,
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
  }, [organization.id, queryKey, refreshCount]);

  function setQuery(
    key: "page" | "status" | "sort" | "direction",
    value?: string,
  ) {
    const nextQuery = clientListQueryValue(queryKey, key, value);
    if (nextQuery !== null) router.replace(`${pathname}?${nextQuery}`);
  }

  function clearFilters() {
    const cleared = clearClientListState(routeSearch, queryKey);
    setSearchDraft(cleared.searchDraft);
    router.replace(cleared.query ? `${pathname}?${cleared.query}` : pathname);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Consulta cuentas, entidades fiscales, responsables y el ejercicio más reciente."
        actions={canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            Nuevo cliente
          </Button>
        ) : null}
      />
      <Surface>
        <FilterBar
          search={{
            label: "Buscar clientes por nombre o código",
            placeholder: "Buscar por nombre o código",
            value: search,
            maxLength: DOMAIN_SEARCH_MAX_LENGTH,
            onChange: (value) => setSearchDraft(editClientSearchDraft(routeSearch, value)),
          }}
          filters={[{
            id: "status",
            label: "Estado",
            value: searchParams.get("status") ?? "",
            defaultValue: "",
            options: [
              { value: "", label: "Activos y suspendidos" },
              { value: "active", label: "Activo" },
              { value: "suspended", label: "Suspendido" },
            ],
            onChange: (value) => setQuery("status", value),
          }]}
          canClear={Boolean(search || routeSearch || searchParams.get("status"))}
          onClear={clearFilters}
        />
        <DataTable
          sorting={{
            key: searchParams.get("sort") ?? "name",
            direction: searchParams.get("direction") === "desc" ? "desc" : "asc",
            onChange: (key, direction) => {
              const next = new URLSearchParams(queryKey);
              next.set("sort", key);
              next.set("direction", direction);
              next.set("page", "1");
              router.replace(`${pathname}?${next}`);
            },
          }}
          loading={loading}
          loadingMessage="Cargando clientes…"
          error={error ? <ErrorNotice error={error} fallback="No se pudo cargar la cartera." /> : undefined}
          emptyMessage={routeSearch || searchParams.get("status") ? "No hay clientes que coincidan con los filtros." : "Todavía no hay clientes registrados."}
          caption="Directorio de clientes"
          rows={page?.items ?? []}
          rowKey={(row) => row.account.id}
          columns={[
            {
              id: "client",
              header: "Cliente",
              sortKey: "name",
              wrap: true,
              render: (row) => (
                <div>
                  <Link
                    href={`${base}/clients/${row.account.id}/overview`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {row.account.name}
                  </Link>
                  <p className="identifier text-caption text-muted-foreground">
                    {row.primaryLegalEntity ? `RFC principal: ${row.primaryLegalEntity.rfc}` : "Sin RFC activo"}
                  </p>
                </div>
              ),
            },
            {
              id: "responsible",
              header: "Responsable",
              wrap: true,
              render: (row) =>
                row.primaryAssignment?.displayName ?? "Sin responsable",
            },
            {
              id: "year",
              header: "Ejercicio reciente",
              render: (row) => <span className="tabular-nums">{row.latestFiscalYear?.year ?? "Sin ejercicio"}</span>,
            },
            {
              id: "period",
              header: "Estado del período",
              render: (row) => (
                <StatusBadge
                  status={row.currentPeriod?.status ?? "Sin período"}
                  locale={locale}
                />
              ),
            },
            {
              id: "status",
              header: "Estado de cuenta",
              sortKey: "status",
              render: (row) => (
                <StatusBadge status={row.account.status} locale={locale} />
              ),
            },
            {
              id: "updated",
              header: "Actualización",
              sortKey: "updatedAt",
              render: (row) => (
                <time dateTime={row.account.updatedAt} className="tabular-nums">
                  {new Date(row.account.updatedAt).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" })}
                </time>
              ),
            },
            {
              id: "action",
              header: "Acciones",
              align: "end",
              render: (row) => (
                <ClientRowActions
                  key={`${organization.id}:${row.account.id}`}
                  account={row.account}
                  base={base}
                  canManage={capabilities.includes("clients.manage")}
                  canAssign={capabilities.includes("clients.assign")}
                  onArchived={() => {
                    setRefreshCount((value) => value + 1);
                  }}
                />
              ),
            },
          ]}
        />
        {!loading && !error && page ? (
          <CollectionPagination
            meta={page.meta}
            itemLabel="clientes"
            onPageChange={(page) => setQuery("page", String(page))}
          />
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
