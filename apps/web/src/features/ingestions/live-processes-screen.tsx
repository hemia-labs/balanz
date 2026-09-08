"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { PageHeader } from "@/components/page-header";
import {
  FeaturePendingNotice,
  Field,
  FilterBar,
  Surface,
  SurfaceHeader,
} from "@/components/product-patterns";
import { ProductTable } from "@/components/product-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  CollectionPagination,
  ErrorNotice,
  LoadingState,
  selectClass,
} from "@/features/clients/live-screen-primitives";
import { isAbortError } from "@/lib/api-client";
import { hasCapability } from "@/lib/permissions";
import { getProcesses, type ProcessListQuery } from "./api";
import { IngestionStatusPanel } from "./ingestion-status-panel";
import type { ProcessListItem, ProcessPage } from "./types";

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-MX");
}

export function LiveProcessesScreen() {
  const { capabilities, organization, locale } = useAccountingContext();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useMemo<ProcessListQuery>(
    () => ({
      page,
      limit: 20,
      status: status || undefined,
      source: "manual_xml",
      sort: "createdAt",
      direction: "desc",
    }),
    [page, status],
  );
  const identity = `${organization.id}:${JSON.stringify(query)}:${revision}`;
  const [state, setState] = useState<{
    identity: string;
    data: ProcessPage | null;
    loading: boolean;
    error: unknown;
  }>({ identity: "", data: null, loading: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setState({ identity, data: null, loading: true, error: null });
      void getProcesses(query, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted)
            setState({ identity, data, loading: false, error: null });
        })
        .catch((cause) => {
          if (!controller.signal.aborted && !isAbortError(cause))
            setState({ identity, data: null, loading: false, error: cause });
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [identity, query]);
  const current = state.identity === identity;
  const data = current ? state.data : null;
  const selected = data?.items.find((item) => item.id === selectedId) ?? null;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operación"
        title="Procesos"
        description="Seguimiento real de cargas XML durables. Los procesos continúan aunque cierres o recargues el navegador."
      />
      <FeaturePendingNotice>
        Sólo se muestran cargas XML manuales de Fase 1. ZIP y sincronización SAT no están disponibles.
      </FeaturePendingNotice>
      <Surface>
        <SurfaceHeader
          title="Historial de procesos XML"
          description="Consulta estados, etapas e intentos persistidos."
          actions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Actualizar
            </Button>
          }
        />
        <FilterBar>
          <Field label="Estado">
            <select
              className={selectClass}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="queued">En cola</option>
              <option value="processing">En proceso</option>
              <option value="completed">Completado</option>
              <option value="completed_with_issues">Con incidencias</option>
              <option value="failed_retryable">Reintentable</option>
              <option value="failed_final">Fallido</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </Field>
        </FilterBar>
        {!current || state.loading ? (
          <div className="p-5">
            <LoadingState label="Cargando procesos…" />
          </div>
        ) : state.error || !data ? (
          <div className="p-5">
            <ErrorNotice error={state.error} fallback="No se pudieron cargar los procesos." />
          </div>
        ) : (
          <>
            <ProcessTable rows={data.items} onSelect={setSelectedId} />
            <CollectionPagination
              meta={data.meta}
              itemLabel="procesos"
              onPageChange={setPage}
            />
          </>
        )}
      </Surface>
      {selected ? (
        <IngestionStatusPanel
          key={selected.id}
          organizationId={organization.id}
          jobId={selected.id}
          cfdiHref={
            selected.clientAccountId &&
            selected.legalEntityId &&
            hasCapability(capabilities, "cfdi.view")
              ? (cfdiId) =>
                  `/${locale}/organizations/${encodeURIComponent(organization.slug)}/clients/${encodeURIComponent(selected.clientAccountId!)}/legal-entities/${encodeURIComponent(selected.legalEntityId!)}/cfdi/${encodeURIComponent(cfdiId)}`
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function ProcessTable({
  rows,
  onSelect,
}: {
  rows: ProcessListItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <ProductTable
      caption="Procesos XML de la organización"
      rows={rows}
      rowKey={(process) => process.id}
      emptyMessage="No hay procesos XML que coincidan con el filtro."
      columns={[
        {
          id: "process",
          header: "Proceso",
          render: (process) => (
            <div>
              <button
                type="button"
                onClick={() => onSelect(process.id)}
                className="identifier font-semibold text-primary hover:underline"
              >
                {process.id}
              </button>
              <p className="text-caption text-muted-foreground">XML manual</p>
            </div>
          ),
        },
        {
          id: "status",
          header: "Estado",
          render: (process) => <StatusBadge status={process.status} />,
        },
        { id: "stage", header: "Etapa", render: (process) => process.stage ?? "—" },
        {
          id: "attempts",
          header: "Intentos",
          numeric: true,
          render: (process) => process.attemptCount,
        },
        {
          id: "updated",
          header: "Actualizado",
          render: (process) => dateTime(process.updatedAt ?? process.createdAt),
        },
        {
          id: "action",
          header: "Acción",
          render: (process) => (
            <Button type="button" size="sm" variant="outline" onClick={() => onSelect(process.id)}>
              Ver detalle
            </Button>
          ),
        },
      ]}
    />
  );
}
