"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { PageHeader } from "@/components/page-header";
import {
  Surface,
  SurfaceHeader,
  Field,
  WarningNotice,
} from "@/components/product-patterns";
import { ProductTable } from "@/components/product-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ErrorNotice,
  LoadingState,
  selectClass,
} from "@/features/clients/live-screen-primitives";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatExactMoney } from "@/features/cfdi/exact-decimal";
import { MonthlyEditorSession } from "./editor-session";
import { MonthlySections } from "./monthly-sections";
import { MonthlyDocumentPanel } from "./monthly-document-panel";
import type {
  MonthlyItem,
  Overview,
  ItemPage,
  Category,
  BulkResult,
} from "./types";
export type MonthlyWrite = <T extends { version: number }>(
  path: string,
  input: object,
  key?: string,
) => Promise<T>;
import { label } from "./labels";
export function MonthlyScreen({
  periodId,
  clientName,
  initialTab,
}: {
  periodId: string;
  clientName: string;
  initialTab?: string;
}) {
  const { organization } = useAccountingContext();
  const organizationId = organization.id;
  const base = "/periods/" + encodeURIComponent(periodId);
  const editor = useRef<MonthlyEditorSession | null>(null);
  const active = useRef(true);
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState<Overview | null>(null);
  const [page, setPage] = useState<ItemPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({
    view: "all",
    page: "1",
    limit: "25",
    ...(initialTab === "payroll"
      ? { documentType: "N" }
      : initialTab === "payments"
        ? { documentType: "P" }
        : {}),
  });
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<MonthlyItem | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [saveState, setSaveState] = useState("Guardado");
  const [reason, setReason] = useState("");
  const [bulkAction, setBulkAction] = useState("review");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkResult | null>(null);
  const [bulkInput, setBulkInput] = useState<object | null>(null);
  const [tab, setTab] = useState(
    initialTab === "close" || initialTab === "incidents"
      ? initialTab
      : "documents",
  );
  const query = JSON.stringify(filters);
  const reload = useCallback(() => setRevision((x) => x + 1), []);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      editor.current?.invalidate();
      editor.current = null;
    };
  }, [organizationId, periodId]);
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams(
      JSON.parse(query) as Record<string, string>,
    );
    void Promise.all([
      apiClient<Overview>(base + "/monthly", { signal: abort.signal }),
      apiClient<ItemPage>(base + "/monthly/items?" + params, {
        signal: abort.signal,
      }),
      apiClient<{ items: Category[] }>(base + "/monthly/categories", {
        signal: abort.signal,
      }),
    ])
      .then(([overview, items, cats]) => {
        if (abort.signal.aborted || !active.current) return;
        setData(overview);
        setPage(items);
        setCategories(cats.items);
        if (!overview.permissions.includes("payroll.view"))
          setSelected((x) => (x?.documentType === "N" ? null : x));
        setError(null);
        if (
          editor.current &&
          editing &&
          (!overview.lease.expiresAt ||
            Date.parse(overview.lease.expiresAt) <= Date.now() ||
            !overview.lease.ownSession)
        ) {
          editor.current.invalidate();
          setEditing(false);
          setSaveState("Otra persona está editando");
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          setError(cause);
          if (
            cause instanceof ApiError &&
            [401, 403, 404].includes(cause.status)
          ) {
            editor.current?.invalidate();
            setEditing(false);
            setData(null);
            setPage(null);
            setSelected(null);
            setSelection({});
            setCategories([]);
          }
        }
      });
    return () => abort.abort();
  }, [base, query, revision, organizationId, editing]);
  useEffect(() => {
    const timer = setInterval(() => reload(), 15000);
    return () => clearInterval(timer);
  }, [reload]);
  const write: MonthlyWrite = useCallback(
    async <T extends { version: number }>(
      path: string,
      input: object,
      key = crypto.randomUUID(),
    ): Promise<T> => {
      const instance = editor.current;
      if (!instance || !editing)
        throw new Error("Obtén acceso de edición antes de guardar.");
      setSaveState("Guardando");
      try {
        const result = await instance.enqueue(
          (version) =>
            apiClient<T>(base + path, {
              method: "POST",
              headers: { "Idempotency-Key": key },
              body: JSON.stringify({
                ...input,
                expectedVersion: version,
                instanceToken: instance.instanceToken,
              }),
            }),
          !path.startsWith("/monthly/lease/"),
        );
        if (!active.current) throw new Error("Contexto finalizado");
        setSaveState("Guardado");
        reload();
        return result;
      } catch (cause) {
        if (active.current) {
          setSaveState(!navigator.onLine ? "Sin conexión" : "Error al guardar");
          setError(cause);
          if (
            cause instanceof ApiError &&
            [401, 403, 404, 409].includes(cause.status)
          ) {
            instance.invalidate();
            setEditing(false);
            if ([401, 403, 404].includes(cause.status)) {
              setSelected(null);
              setData(null);
              setPage(null);
              setCategories([]);
              setSelection({});
            }
          }
        }
        throw cause;
      }
    },
    [base, editing, reload],
  );
  useEffect(() => {
    if (!editing) return;
    const timer = setInterval(() => {
      const instance = editor.current;
      if (instance?.shouldRenew())
        void write("/monthly/lease/renew", {}).catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, [editing, write]);
  async function acquire(takeover = false, takeoverReason?: string) {
    try {
      const token =
        crypto.randomUUID().replaceAll("-", "") +
        crypto.randomUUID().replaceAll("-", "");
      const result = await apiClient<{ version: number }>(
        base + "/monthly/lease" + (takeover ? "/takeover" : ""),
        {
          method: "POST",
          body: JSON.stringify({
            instanceToken: token,
            ...(takeover ? { reason: takeoverReason } : {}),
          }),
        },
      );
      if (!active.current) return;
      editor.current?.invalidate();
      editor.current = new MonthlyEditorSession(token);
      editor.current.version = result.version;
      setEditing(true);
      setSaveState("Guardado");
      setError(null);
      reload();
    } catch (cause) {
      setError(cause);
    }
  }
  async function navigateDocument(direction: -1 | 1) {
    if (!page || !selected) return;
    const index = page.items.findIndex((x) => x.id === selected.id);
    const neighbor = page.items[index + direction];
    if (neighbor) {
      setSelected(neighbor);
      return;
    }
    const target = page.meta.page + direction;
    if (target < 1 || target > page.meta.totalPages) return;
    const params = new URLSearchParams({ ...filters, page: String(target) });
    try {
      const next = await apiClient<ItemPage>(base + "/monthly/items?" + params);
      if (!active.current) return;
      setPage(next);
      setFilters((x) => ({ ...x, page: String(target) }));
      setSelected(
        direction === 1 ? next.items[0] : (next.items.at(-1) ?? null),
      );
    } catch (cause) {
      setError(cause);
    }
  }
  const filter = (key: string, value: string) => {
    setFilters((x) => {
      const next: Record<string, string> = { ...x, page: "1" };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setSelection({});
    setBulkPreview(null);
  };
  async function bulk(preview: boolean) {
    try {
      const input = preview
        ? {
            selection: Object.entries(selection).map(([id, version]) => ({
              id,
              version,
            })),
            action: bulkAction,
            reason: reason || undefined,
            categoryId: bulkCategory || null,
          }
        : { ...bulkInput, previewId: bulkPreview?.previewId };
      const result = await write<BulkResult>(
        "/monthly/bulk/" + (preview ? "preview" : "execute"),
        input,
      );
      if (preview) setBulkInput(input);
      setBulkPreview(result);
      if (!preview) setSelection({});
    } catch {}
  }
  if (!data || !page)
    return error ? (
      <ErrorNotice
        error={error}
        fallback="No se pudo completar la operación mensual."
      />
    ) : (
      <LoadingState label="Cargando revisión mensual…" />
    );
  const can = (permission: string) => data.permissions.includes(permission);
  const closed = ["closed", "changes_detected"].includes(data.period.status);
  const disabled = !editing || closed;
  const selectedCount = Object.keys(selection).length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Revisión mensual"
        description={
          clientName +
          " · RFC " +
          data.period.rfc +
          " · " +
          data.period.year +
          " / " +
          String(data.period.month).padStart(2, "0")
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <strong>{label(data.period.status)}</strong>
        <span role="status" aria-live="polite">
          {saveState}
        </span>
        {editing ? (
          <Button
            variant="outline"
            onClick={() =>
              void write("/monthly/lease/release", {})
                .then(() => {
                  editor.current?.invalidate();
                  setEditing(false);
                })
                .catch(() => undefined)
            }
          >
            Terminar edición
          </Button>
        ) : can("periods.review") ? (
          <Button onClick={() => void acquire()}>Editar mes</Button>
        ) : null}
        <Button variant="outline" onClick={reload}>
          Actualizar
        </Button>
        {data.lease.membershipId && !editing ? (
          <span>
            {data.lease.name ?? "Otra persona"} está editando. Puedes consultar.
          </span>
        ) : null}
      </div>
      {error ? (
        <ErrorNotice
          error={error}
          fallback="No se pudo completar la operación mensual."
        />
      ) : null}
      {data.period.legacyClosed ? (
        <WarningNotice>
          Cierre heredado sin snapshot. No se puede reconstruir retroactivamente
          su contenido.
        </WarningNotice>
      ) : null}
      <Surface>
        <SurfaceHeader
          title="Avance de revisión"
          description={
            data.counts.reviewed +
            " de " +
            data.counts.participations +
            " participaciones revisadas · " +
            data.counts.documents +
            " documentos incorporados visibles"
          }
        />
        <div className="flex flex-wrap gap-2 p-4">
          {[
            ["all", "Todos", data.counts.participations],
            ["pending", "Por revisar", data.counts.pending],
            ["incidents", "Con incidencias", data.counts.incidents],
            ["excluded", "Excluidos", data.counts.excluded],
            ["news", "Novedades", ""],
          ].map(([value, title, count]) => (
            <Button
              key={value}
              variant={filters.view === value ? "default" : "outline"}
              onClick={() => {
                filter("view", String(value));
                setTab("documents");
              }}
            >
              {title} {count}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 border-t border-border p-4">
          {data.amounts.map((x) => (
            <span key={x.currency + x.documentType + x.direction}>
              {x.documentType === "I" ? "Ingresos" : "Egresos"}{" "}
              {x.direction === "issued" ? "emitidos" : "recibidos"}:{" "}
              <strong>{formatExactMoney(x.total, x.currency)}</strong>
            </span>
          ))}
          <p className="text-body-sm text-muted-foreground">
            P y T no aumentan los importes facturados. Monedas e
            ingresos/egresos se mantienen separados.
          </p>
        </div>
      </Surface>
      <div
        className="flex flex-wrap gap-2"
        role="navigation"
        aria-label="Secciones de revisión"
      >
        {[
          ["documents", "Documentos"],
          ["incidents", "Incidencias"],
          ["checklist", "Checklist"],
          ["sources", "Fuentes"],
          ["close", "Cierre y novedades"],
          ["settings", "Categorías y edición"],
        ].map(([key, title]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "outline"}
            onClick={() => setTab(key)}
          >
            {title}
          </Button>
        ))}
      </div>
      {tab === "documents" ? (
        <Surface>
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <Field label="UUID o contraparte">
              <Input
                value={filters.search ?? ""}
                maxLength={100}
                onChange={(e) => filter("search", e.target.value)}
              />
            </Field>
            <Field label="Dirección">
              <select
                className={selectClass}
                value={filters.direction ?? ""}
                onChange={(e) => filter("direction", e.target.value)}
              >
                <option value="">Todas</option>
                <option value="issued">Emitidos</option>
                <option value="received">Recibidos</option>
              </select>
            </Field>
            <Field label="Tipo">
              <select
                className={selectClass}
                value={filters.documentType ?? ""}
                onChange={(e) => filter("documentType", e.target.value)}
              >
                <option value="">Todos</option>
                {[
                  "I",
                  "E",
                  "P",
                  "T",
                  ...(can("payroll.view") ? ["N"] : []),
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            {[
              ["dateFrom", "Desde", "date"],
              ["dateTo", "Hasta", "date"],
              ["currency", "Moneda", "text"],
              ["amountFrom", "Importe mínimo", "text"],
              ["amountTo", "Importe máximo", "text"],
            ].map(([key, title, type]) => (
              <Field key={key} label={title}>
                <Input
                  type={type}
                  value={filters[key] ?? ""}
                  onChange={(e) => filter(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
          {selectedCount ? (
            <div className="space-y-3 border-y border-border p-4">
              <p>
                {selectedCount} participaciones seleccionadas; sólo se
                modificarán estas ocurrencias de este mes.
              </p>
              <div className="flex flex-wrap gap-3">
                <select
                  aria-label="Acción masiva"
                  className={selectClass}
                  value={bulkAction}
                  onChange={(e) => {
                    setBulkAction(e.target.value);
                    setBulkPreview(null);
                  }}
                >
                  {[
                    ["review", "Marcar revisadas"],
                    ["unreview", "Dejar por revisar"],
                    ["exclude", "Excluir"],
                    ["include", "Incluir"],
                    ["category", "Asignar categoría"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Motivo de la acción"
                  placeholder="Motivo de exclusión"
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setBulkPreview(null);
                  }}
                />
                {bulkAction === "category" ? (
                  <select
                    aria-label="Categoría del lote"
                    className={selectClass}
                    value={bulkCategory}
                    onChange={(e) => {
                      setBulkCategory(e.target.value);
                      setBulkPreview(null);
                    }}
                  >
                    <option value="">Sin categoría</option>
                    {categories
                      .filter((x) => !x.archived)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                  </select>
                ) : null}
                <Button
                  disabled={disabled || !can("cfdi.bulk_action")}
                  onClick={() => void bulk(true)}
                >
                  Vista previa
                </Button>
              </div>
            </div>
          ) : null}
          {bulkPreview ? (
            <div className="space-y-2 border-b border-border p-4" role="status">
              <p>
                {bulkPreview.previewId
                  ? "Vista previa: " +
                    bulkPreview.results.filter((x) => x.status === "eligible")
                      .length +
                    " aplicables"
                  : bulkPreview.applied + " aplicadas"}{" "}
                · {bulkPreview.failed} con impedimentos
              </p>
              {bulkPreview.results
                .filter((x) => x.status === "failed")
                .map((x) => (
                  <p key={x.id}>
                    {page.items.find((i) => i.id === x.id)?.uuid ?? x.id}:{" "}
                    {x.code}
                  </p>
                ))}
              {bulkPreview.previewId ? (
                <Button disabled={disabled} onClick={() => void bulk(false)}>
                  Aplicar selección confirmada
                </Button>
              ) : null}
            </div>
          ) : null}
          <ProductTable
            caption="Participaciones del mes"
            rows={page.items}
            rowKey={(x) => x.id}
            emptyMessage="Sin CFDI incorporados para esta selección. Esto no acredita ausencia de operaciones."
            columns={[
              {
                id: "select",
                header: "Seleccionar",
                render: (x) => (
                  <input
                    type="checkbox"
                    aria-label={
                      "Seleccionar " +
                      x.uuid +
                      " participación " +
                      x.sourceOrdinal
                    }
                    checked={x.id in selection}
                    disabled={
                      disabled || (!(x.id in selection) && selectedCount >= 100)
                    }
                    onChange={(e) => {
                      setSelection((old) => {
                        const next = { ...old };
                        if (e.target.checked) next[x.id] = x.version;
                        else delete next[x.id];
                        return next;
                      });
                      setBulkPreview(null);
                    }}
                  />
                ),
              },
              {
                id: "uuid",
                header: "Documento",
                render: (x) => (
                  <Button variant="link" onClick={() => setSelected(x)}>
                    {x.uuid}
                  </Button>
                ),
              },
              {
                id: "counterparty",
                header: "Contraparte",
                render: (x) =>
                  x.direction === "issued"
                    ? (x.receiverName ?? x.receiverRfc)
                    : (x.issuerName ?? x.issuerRfc),
              },
              {
                id: "type",
                header: "Tipo / participación",
                render: (x) => x.documentType + " · " + x.sourceOrdinal,
              },
              {
                id: "date",
                header: "Fecha",
                render: (x) => x.literalDate.slice(0, 10),
              },
              {
                id: "amount",
                header: "Importe del documento",
                numeric: true,
                render: (x) => formatExactMoney(x.total, x.currency),
              },
              {
                id: "review",
                header: "Revisión",
                render: (x) => label(x.reviewStatus),
              },
              {
                id: "inclusion",
                header: "Inclusión",
                render: (x) => label(x.inclusion),
              },
            ]}
          />
          <div className="flex items-center justify-between gap-4 border-t border-border p-4">
            <Button
              variant="outline"
              disabled={page.meta.page <= 1}
              onClick={() =>
                setFilters((x) => ({ ...x, page: String(page.meta.page - 1) }))
              }
            >
              Anterior página
            </Button>
            <span>
              {page.meta.total} participaciones · Página {page.meta.page} de{" "}
              {Math.max(1, page.meta.totalPages)}
            </span>
            <Button
              variant="outline"
              disabled={page.meta.page >= page.meta.totalPages}
              onClick={() =>
                setFilters((x) => ({ ...x, page: String(page.meta.page + 1) }))
              }
            >
              Siguiente página
            </Button>
          </div>
        </Surface>
      ) : (
        <MonthlySections
          onEvidence={setTab}
          onInspect={(uuid) => {
            filter("search", uuid);
            setTab("documents");
          }}
          key={tab}
          tab={tab}
          base={base}
          data={data}
          categories={categories}
          disabled={disabled}
          editing={editing}
          write={write}
          reload={reload}
          acquire={acquire}
          afterReauth={() => {
            // Existing MFA rotates the cookie token, preserving the session ID.
            // Keep this instance; the next write still checks lease expiry and authority.
            reload();
          }}
        />
      )}
      {selected ? (
        <MonthlyDocumentPanel
          key={organizationId + ":" + selected.id}
          row={selected}
          categories={categories}
          disabled={disabled}
          organizationId={organizationId}
          onClose={() => setSelected(null)}
          onPrevious={() => void navigateDocument(-1)}
          onNext={() => void navigateDocument(1)}
          hasPrevious={
            page.meta.page > 1 ||
            page.items.findIndex((x) => x.id === selected.id) > 0
          }
          hasNext={
            page.meta.page < page.meta.totalPages ||
            page.items.findIndex((x) => x.id === selected.id) <
              page.items.length - 1
          }
          historyPath={base + "/monthly/decisions/" + selected.id + "/history"}
          onSave={(draft, decisionVersion) =>
            write<{ version: number; decisionVersion: number }>(
              "/monthly/decisions/" + selected.id,
              { ...draft, categoryLabel: undefined, decisionVersion },
            )
          }
        />
      ) : null}
    </div>
  );
}
