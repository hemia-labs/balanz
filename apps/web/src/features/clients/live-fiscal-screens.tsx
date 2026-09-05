"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus, RefreshCw } from "lucide-react";
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
import { ApiError, isAbortError } from "@/lib/api-client";
import { createFiscalYear, getFiscalYears, getPeriods } from "./api";
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
  CollectionPagination,
  ErrorNotice,
  LoadingState,
  selectClass,
} from "./live-screen-primitives";
import { useDebouncedValue } from "./live-query-hooks";
import { useClientDetail } from "./use-client-detail";
import type { ClientDetail, FiscalYear, LegalEntity } from "./types";

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

function CreateYearForm({
  entity,
  existingYears,
  onCreated,
}: {
  entity: LegalEntity;
  existingYears: number[];
  onCreated: (year: FiscalYear) => void;
}) {
  const currentYear = new Date().getFullYear();
  const availableYearsFor = (years: number[]) => {
    const registered = new Set(years);
    const preferred = [currentYear, currentYear + 1];
    for (let candidate = currentYear - 1; candidate >= 2000; candidate -= 1)
      preferred.push(candidate);
    return preferred.filter((candidate) => !registered.has(candidate));
  };
  const availableYears = availableYearsFor(existingYears);
  const [year, setYear] = useState<number | null>(
    () => availableYears[0] ?? null,
  );
  const selectedYear =
    year !== null && availableYears.includes(year)
      ? year
      : (availableYears[0] ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [createdYear, setCreatedYear] = useState<number | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selectedYear === null) return;
    setPending(true);
    setError(null);
    setCreatedYear(null);
    try {
      const created = await createFiscalYear(entity.id, selectedYear);
      setCreatedYear(created.year);
      setYear(availableYearsFor([...existingYears, created.year])[0] ?? null);
      onCreated(created);
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-labelledby="create-fiscal-year-title"
      className="border-b border-border bg-muted/35 px-5 py-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-reading">
          <h3 id="create-fiscal-year-title" className="font-semibold">
            Crear un ejercicio fiscal
          </h3>
          <p
            id="create-fiscal-year-help"
            className="mt-1 text-body-sm text-muted-foreground"
          >
            Selecciona el año y después crea el ejercicio para el RFC{" "}
            <span className="identifier">{entity.rfc}</span>. Se agregarán
            automáticamente sus 12 períodos mensuales.
          </p>
        </div>
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field label="Año fiscal">
            <select
              required
              value={selectedYear ?? ""}
              onChange={(event) => {
                setYear(Number(event.target.value));
                setCreatedYear(null);
                setError(null);
              }}
              aria-describedby="create-fiscal-year-help"
              className={`${selectClass} w-full sm:w-36`}
              disabled={availableYears.length === 0 || pending}
            >
              {availableYears.length === 0 ? (
                <option value="">Sin años disponibles</option>
              ) : (
                availableYears.map((availableYear) => (
                  <option key={availableYear} value={availableYear}>
                    {availableYear}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Button
            type="submit"
            disabled={pending || selectedYear === null}
            className="w-full sm:w-auto sm:self-end"
          >
            <Plus aria-hidden="true" />
            {pending ? "Creando ejercicio…" : "Crear ejercicio"}
          </Button>
        </form>
      </div>
      {availableYears.length === 0 ? (
        <p className="mt-3 text-body-sm text-muted-foreground" role="status">
          No hay años disponibles dentro del rango permitido.
        </p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorNotice error={error} fallback="No se pudo crear el ejercicio." />
        </div>
      ) : null}
      {createdYear !== null ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 rounded-md border border-success/30 bg-success-surface p-3 text-body-sm text-success"
        >
          Ejercicio {createdYear} creado con sus 12 períodos mensuales.
        </p>
      ) : null}
    </section>
  );
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

function LegalEntitySelector({
  detail,
  base,
  suffix,
  locale,
  routeQuery,
}: {
  detail: ClientDetail;
  base: string;
  suffix: string;
  locale: string;
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
                  <StatusBadge status={entity.status} locale={locale} />
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
  const [yearsPage, setYearsPage] = useState(1);
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
            page: yearsPage,
            revision,
          }
        : null,
    [clientId, entity, organization.id, revision, yearsPage],
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
      void getFiscalYears(
        request.legalEntityId,
        { page: request.page, limit: 25 },
        controller.signal,
      )
        .then((page) => {
          if (controller.signal.aborted) return;
          setYearsState((current) =>
            resolveFiscalYearsLoad(current, request, page),
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
        locale={locale}
        routeQuery={routeQuery}
      />
    );
  if (!entity)
    return (
      <LegalEntityUnavailable
        base={base}
        error={
          new ApiError(
            404,
            "La entidad fiscal no está disponible.",
            "LEGAL_ENTITY_NOT_FOUND",
          )
        }
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
            title="Ejercicios registrados"
            description="Consulta los ejercicios fiscales asociados a este RFC."
          />
          {entity.status === "active" &&
          capabilities.includes("fiscal_years.manage") ? (
            <CreateYearForm
              entity={entity}
              existingYears={years.map((year) => year.year)}
              onCreated={() => {
                setYearsPage(1);
                setRevision((value) => value + 1);
              }}
            />
          ) : null}
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
                render: (year) => (
                  <StatusBadge status={year.status} locale={locale} />
                ),
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
          {visibleYearsState.meta ? (
            <CollectionPagination
              meta={visibleYearsState.meta}
              itemLabel="ejercicios"
              onPageChange={setYearsPage}
            />
          ) : null}
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
      void getFiscalYears(
        request.legalEntityId,
        { year: Number(request.year), limit: 1 },
        controller.signal,
      )
        .then((page) => {
          if (controller.signal.aborted) return null;
          const match = page.items.find(
            (item) => String(item.year) === request.year,
          );
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
        locale={locale}
        routeQuery={routeQuery}
      />
    );
  if (!entity)
    return (
      <LegalEntityUnavailable
        base={base}
        error={
          new ApiError(
            404,
            "La entidad fiscal no está disponible.",
            "LEGAL_ENTITY_NOT_FOUND",
          )
        }
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
        error={
          new ApiError(
            404,
            "Período fiscal no encontrado",
            "FISCAL_PERIOD_NOT_FOUND",
          )
        }
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
              value: (
                <StatusBadge
                  status={selectedPeriod.status}
                  locale={locale}
                />
              ),
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
              render: (period) => (
                <StatusBadge status={period.status} locale={locale} />
              ),
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
