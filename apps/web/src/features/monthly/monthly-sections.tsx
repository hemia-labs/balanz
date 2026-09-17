"use client";
import { useEffect, useState } from "react";
import {
  Surface,
  SurfaceHeader,
  Field,
  WarningNotice,
} from "@/components/product-patterns";
import { ProductTable } from "@/components/product-table";
import { ControlledDialog } from "@/components/overlay-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ErrorNotice,
  selectClass,
} from "@/features/clients/live-screen-primitives";
import { apiClient } from "@/lib/api-client";
import { reauthenticateSession } from "@/features/auth/api";
import type { MonthlyWrite } from "./monthly-screen";
import { label } from "./labels";
import type {
  MonthlyItem,
  Overview,
  Checklist,
  Incident,
  Category,
  CloseSummary,
  Changes,
  Source,
} from "./types";
interface CloseView {
  version: number;
  closedAt: string;
  actorMembershipId: string;
  sourceExceptionReason: string | null;
  meta: { page: number; limit: number; total: number };
  snapshot: {
    participations: MonthlyItem[];
    scopeStatement: string;
    checklist: Checklist[];
    incidents: Incident[];
    sources: Source[];
  };
}
export function MonthlySections({
  tab,
  base,
  data,
  categories,
  disabled,
  editing,
  write,
  reload,
  acquire,
  afterReauth,
  onInspect,
  onEvidence,
}: {
  tab: string;
  base: string;
  data: Overview;
  categories: Category[];
  disabled: boolean;
  editing: boolean;
  write: MonthlyWrite;
  reload: () => void;
  acquire: (takeover: boolean, reason: string) => Promise<void>;
  afterReauth: () => void;
  onInspect: (uuid: string) => void;
  onEvidence: (tab: string) => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const [checklist, setChecklist] = useState<Checklist[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentPage, setIncidentPage] = useState(1);
  const [incidentTotal, setIncidentTotal] = useState(0);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [template, setTemplate] = useState<{
    version: number;
    keys: string[];
  } | null>(null);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [closes, setCloses] = useState<
    { id: string; version: number; closedAt: string }[]
  >([]);
  const [reason, setReason] = useState("");
  const [totp, setTotp] = useState("");
  const [closeSummary, setCloseSummary] = useState<CloseSummary | null>(null);
  const [scopeException, setScopeException] = useState("");
  const [categoryLabel, setCategoryLabel] = useState("");
  const [revision, setRevision] = useState(0);
  const [closingView, setClosingView] = useState<CloseView | null>(null);
  const can = (p: string) => data.permissions.includes(p);
  const closed = ["closed", "changes_detected"].includes(data.period.status);
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      if (tab === "incidents") {
        const candidates = await apiClient<{
          items: { id: string; name: string }[];
        }>(base + "/monthly/assignees", { signal: abort.signal });
        if (!abort.signal.aborted) setAssignees(candidates.items);
      }
      if (tab === "settings") {
        const current = await apiClient<{ version: number; keys: string[] }>(
          base + "/monthly/checklist-template",
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) setTemplate(current);
      }
      if (tab === "checklist")
        setChecklist(
          (
            await apiClient<{ items: Checklist[] }>(
              base + "/monthly/checklist",
              { signal: abort.signal },
            )
          ).items,
        );
      if (tab === "incidents") {
        const result = await apiClient<{
          items: Incident[];
          meta: { total: number };
        }>(base + "/monthly/incidents?page=" + incidentPage, {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setIncidents(result.items);
          setIncidentTotal(result.meta.total);
        }
      }
      if (tab === "close") {
        const [news, history] = await Promise.all([
          apiClient<Changes>(base + "/monthly/news", { signal: abort.signal }),
          apiClient<{
            items: { id: string; version: number; closedAt: string }[];
          }>(base + "/monthly/closes", { signal: abort.signal }),
        ]);
        if (!abort.signal.aborted) {
          setChanges(news);
          setCloses(history.items);
        }
      }
    };
    void load().catch((cause) => {
      if (!abort.signal.aborted) setError(cause);
    });
    return () => abort.abort();
  }, [base, tab, revision, incidentPage]);
  const refresh = () => {
    setRevision((x) => x + 1);
    reload();
  };
  return (
    <>
      {error ? (
        <ErrorNotice
          error={error}
          fallback="No se pudo completar la operación mensual."
        />
      ) : null}
      {tab === "close" || tab === "settings" ? (
        <div className="space-y-3 border border-border p-4">
          <p>
            Confirma tu identidad con un código nuevo antes de cerrar, reabrir o
            retomar la edición. Esta confirmación es temporal y no modifica la
            revisión guardada.
          </p>
          <Field label="Código de autenticación para acciones sensibles">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
            />
          </Field>
          <Button
            variant="outline"
            onClick={() =>
              void reauthenticateSession(totp)
                .then(() => {
                  setTotp("");
                  afterReauth();
                })
                .catch(setError)
            }
          >
            Confirmar identidad
          </Button>
        </div>
      ) : null}
      {tab === "sources" ? (
        <Surface>
          <SurfaceHeader
            title="Fuentes y alcance"
            description="La revisión interna y la recuperación SAT son dimensiones distintas. Una solicitud terminada acredita únicamente sus filtros."
          />
          <div className="space-y-4 p-4">
            {data.sources.length ? (
              data.sources.map((s) => (
                <div
                  key={s.kind + s.id}
                  className="border-b border-border pb-3"
                >
                  <strong>
                    {s.kind === "sat" ? "Solicitud SAT" : "Ingesta"} ·{" "}
                    {label(s.status)}
                  </strong>
                  <p>
                    {s.scope === "unclarified"
                      ? "Alcance por aclarar"
                      : s.scope === "filters"
                        ? "Dentro de los filtros declarados"
                        : "Vinculada a la revisión"}
                  </p>
                  {s.dateFrom ? (
                    <p>
                      {s.dateFrom} — {s.dateTo}
                    </p>
                  ) : null}
                  {s.observedAt ? (
                    <p>
                      Observado:{" "}
                      {new Date(s.observedAt).toLocaleString("es-MX")}
                    </p>
                  ) : null}
                  {s.scope === "unclarified" ? (
                    <Button
                      disabled={disabled}
                      variant="outline"
                      onClick={() =>
                        void write("/monthly/sources", {
                          kind: s.kind,
                          sourceId: s.id,
                          reason:
                            "Vinculada como intención de trabajo de este mes",
                        })
                          .then(refresh)
                          .catch(setError)
                      }
                    >
                      Vincular a este trabajo
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <p>
                No hay evidencia de fuentes asociadas. Los XML incorporados no
                prueban cobertura SAT completa.
              </p>
            )}
            <WarningNotice>
              Los XML no se presentan como vigentes ante SAT sin una observación
              identificada. Vincular una fuente no cambia el mes de pertenencia
              de sus documentos.
            </WarningNotice>
          </div>
        </Surface>
      ) : null}
      {tab === "checklist" ? (
        <Surface>
          <SurfaceHeader
            title="Comprobaciones del mes"
            description="Las comprobaciones automáticas no se atribuyen al usuario. Las confirmaciones humanas requieren criterio y motivo."
          />
          <div className="space-y-4 p-4">
            {checklist.map((x) => (
              <div
                key={x.key}
                className="space-y-2 border-b border-border pb-4"
              >
                <strong>
                  {label(x.key)} · {x.passed ? "Cumplido" : "Pendiente"}
                </strong>
                <p>
                  {x.kind === "automatic"
                    ? "Comprobación del sistema"
                    : "Confirmación de una persona"}
                  {x.reason ? " · " + x.reason : ""}
                </p>
                {x.kind === "human" ? (
                  <div className="flex gap-3">
                    <Input
                      aria-label={"Motivo para " + label(x.key)}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Button
                      disabled={
                        disabled || !can("checklist.complete") || !reason.trim()
                      }
                      onClick={() =>
                        void write("/monthly/checklist", {
                          key: x.key,
                          confirmed: !x.passed,
                          itemVersion: x.version ?? 0,
                          reason,
                        })
                          .then(refresh)
                          .catch(setError)
                      }
                    >
                      {x.passed ? "Volver a pendiente" : "Confirmar"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-body-sm">
                    <Button
                      variant="outline"
                      onClick={() =>
                        onEvidence(
                          x.key === "sources_settled"
                            ? "sources"
                            : x.key === "integrity_resolved"
                              ? "incidents"
                              : x.key === "snapshot_ready"
                                ? "close"
                                : "documents",
                        )
                      }
                    >
                      Consultar evidencia
                    </Button>{" "}
                    {x.key === "sources_settled"
                      ? "consulta Fuentes"
                      : x.key === "integrity_resolved"
                        ? "consulta Incidencias"
                        : x.key === "snapshot_ready"
                          ? "el conjunto admite un snapshot de cierre"
                          : "consulta Documentos"}
                    .
                  </p>
                )}
              </div>
            ))}
          </div>
        </Surface>
      ) : null}
      {tab === "incidents" ? (
        <Surface>
          <SurfaceHeader
            title="Incidencias y aclaraciones"
            description="El seguimiento conserva la evidencia original. Revisar un rechazo no incorpora un archivo inválido."
          />
          <div className="space-y-4 p-4">
            {incidents.length ? (
              incidents.map((x) => (
                <IncidentEditor
                  key={x.id + ":" + x.version}
                  incident={x}
                  onInspect={() =>
                    x.cfdiUuid ? onInspect(x.cfdiUuid) : onEvidence("sources")
                  }
                  historyPath={base + "/monthly/incidents/" + x.id + "/history"}
                  assignees={assignees}
                  disabled={disabled || !can("incidents.manage")}
                  onSave={(input) =>
                    write("/monthly/incidents/" + x.id, input).then(refresh)
                  }
                />
              ))
            ) : (
              <p>No hay incidencias vinculadas visibles.</p>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={incidentPage <= 1}
                onClick={() => setIncidentPage((x) => x - 1)}
              >
                Anterior
              </Button>
              <span>
                Página {incidentPage} · {incidentTotal} incidencias
              </span>
              <Button
                variant="outline"
                disabled={incidentPage * 25 >= incidentTotal}
                onClick={() => setIncidentPage((x) => x + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </Surface>
      ) : null}
      {tab === "close" ? (
        <Surface>
          <SurfaceHeader
            title="Cierre interno y novedades"
            description="El cierre corresponde al control interno del despacho; no representa la presentación de una declaración fiscal."
          />
          <div className="space-y-4 p-4">
            {changes ? (
              <div>
                <p>
                  {changes.added.length} participaciones nuevas ·{" "}
                  {changes.changed.length} modificadas ·{" "}
                  {changes.removed.length} retiradas
                </p>
                {changes.sourcesChanged ? (
                  <p>Hay cambios en las fuentes desde el cierre.</p>
                ) : null}
                {changes.sourceChanges?.map((x) => (
                  <p key={x.id}>
                    {x.kind === "sat" ? "Solicitud SAT" : "Ingesta"}:{" "}
                    {x.before ? label(x.before) : "Sin evidencia anterior"} →{" "}
                    {label(x.after)}
                    {x.observedAt
                      ? " · Observado " +
                        new Date(x.observedAt).toLocaleString("es-MX")
                      : ""}
                  </p>
                ))}
                {changes.incidentChanges?.map((x) => (
                  <p key={x.id}>
                    Incidencia {x.code}: {x.before ? label(x.before) : "Nueva"}{" "}
                    → {label(x.after)}
                  </p>
                ))}
                {changes.incidentsChanged ? (
                  <p>Hay cambios en incidencias desde el cierre.</p>
                ) : null}
                {[...changes.added, ...changes.changed].map((x) => (
                  <Button
                    key={x.id}
                    variant="outline"
                    onClick={() => onInspect(x.uuid)}
                  >
                    Revisar {x.uuid}
                  </Button>
                ))}
              </div>
            ) : null}
            <Field label="Excepción de fuentes pendientes, si corresponde">
              <Input
                value={scopeException}
                onChange={(e) => {
                  setScopeException(e.target.value);
                  setCloseSummary(null);
                }}
                maxLength={1000}
              />
            </Field>
            {closed ? (
              <>
                <Field label="Motivo de reapertura">
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={1000}
                  />
                </Field>
                <Button
                  disabled={
                    !editing || !can("periods.reopen") || !reason.trim()
                  }
                  onClick={() =>
                    void write("/reopen", { reason })
                      .then(refresh)
                      .catch(setError)
                  }
                >
                  Reabrir revisión
                </Button>
              </>
            ) : (
              <Button
                disabled={disabled || !can("periods.ready")}
                onClick={() =>
                  void write<CloseSummary>("/monthly/prepare-close", {
                    sourceExceptionReason: scopeException || undefined,
                  })
                    .then(setCloseSummary)
                    .catch(setError)
                }
              >
                Preparar cierre
              </Button>
            )}
            {closeSummary ? (
              <div className="space-y-3 border border-border p-4">
                <h3 className="font-semibold">
                  Confirmar revisión de {closeSummary.documents} documentos
                </h3>
                <p>
                  {closeSummary.participations} participaciones;{" "}
                  {closeSummary.excluded} excluidas.
                </p>
                {closeSummary.documents === 0 ? (
                  <p>
                    Sin CFDI incorporados. No equivale a declarar ausencia de
                    operaciones.
                  </p>
                ) : null}
                {closeSummary.sourceExceptionReason ? (
                  <WarningNotice>
                    Se conservará esta limitación de fuentes:{" "}
                    {closeSummary.sourceExceptionReason}
                  </WarningNotice>
                ) : null}
                <p>{closeSummary.scopeStatement}</p>
                <p>
                  Las decisiones quedarán congeladas. Para cambiar la revisión
                  será necesario reabrir.
                </p>
                <Button
                  disabled={disabled || !can("periods.close")}
                  onClick={() =>
                    void write("/close", {
                      sourceExceptionReason: scopeException || undefined,
                    })
                      .then(() => {
                        setCloseSummary(null);
                        refresh();
                      })
                      .catch(setError)
                  }
                >
                  Cerrar revisión del mes
                </Button>
              </div>
            ) : null}
            {closes.map((x) => (
              <div key={x.id}>
                <Button
                  variant="link"
                  onClick={() =>
                    void apiClient<CloseView>(
                      base + "/monthly/closes/" + x.version,
                    )
                      .then(setClosingView)
                      .catch(setError)
                  }
                >
                  Consultar cierre {x.version}
                </Button>{" "}
                · {new Date(x.closedAt).toLocaleString("es-MX")}
              </div>
            ))}
          </div>
        </Surface>
      ) : null}
      {tab === "settings" ? (
        <Surface>
          <SurfaceHeader
            title="Categorías y edición"
            description="Las categorías son opcionales. Administrar el catálogo no clasifica documentos automáticamente."
          />
          <div className="space-y-4 p-4">
            {can("cfdi.categories.manage") ? (
              <div className="flex gap-3">
                <Input
                  aria-label="Nueva categoría"
                  value={categoryLabel}
                  onChange={(e) => setCategoryLabel(e.target.value)}
                  maxLength={80}
                />
                <Button
                  disabled={!categoryLabel.trim()}
                  onClick={() =>
                    void apiClient(base + "/monthly/categories", {
                      method: "POST",
                      body: JSON.stringify({
                        label: categoryLabel,
                        archived: false,
                        expectedVersion: 0,
                      }),
                    })
                      .then(() => {
                        setCategoryLabel("");
                        reload();
                      })
                      .catch(setError)
                  }
                >
                  Crear categoría
                </Button>
              </div>
            ) : null}
            {categories.map((x) => (
              <CategoryEditor
                key={x.id + ":" + x.version}
                category={x}
                disabled={!can("cfdi.categories.manage")}
                onSave={(input) =>
                  apiClient(base + "/monthly/categories/" + x.id, {
                    method: "POST",
                    body: JSON.stringify(input),
                  }).then(reload)
                }
              />
            ))}
            {can("checklist.configure") && template ? (
              <fieldset className="space-y-3">
                <legend className="font-semibold">
                  Plantilla de checklist de la organización
                </legend>
                <p>
                  Los requisitos mínimos se conservan. Esta versión se aplica a
                  períodos que todavía no iniciaron su mesa.
                </p>
                {["client_clarifications", "professional_review"].map((key) => (
                  <label className="flex gap-2" key={key}>
                    <input
                      type="checkbox"
                      checked={template.keys.includes(key)}
                      onChange={(e) =>
                        setTemplate({
                          ...template,
                          keys: e.target.checked
                            ? [...template.keys, key]
                            : template.keys.filter((x) => x !== key),
                        })
                      }
                    />
                    {label(key)}
                  </label>
                ))}
                <Button
                  variant="outline"
                  onClick={() =>
                    void apiClient<{ version: number }>(
                      base + "/monthly/checklist-template",
                      {
                        method: "POST",
                        body: JSON.stringify({
                          keys: template.keys,
                          expectedVersion: template.version,
                        }),
                      },
                    )
                      .then((result) =>
                        setTemplate({ ...template, version: result.version }),
                      )
                      .catch(setError)
                  }
                >
                  Guardar plantilla
                </Button>
              </fieldset>
            ) : null}
            {can("periods.takeover") ? (
              <>
                <Field label="Motivo para retomar edición">
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Button
                  variant="outline"
                  disabled={!reason.trim()}
                  onClick={() => void acquire(true, reason)}
                >
                  Retomar edición de otra instancia
                </Button>
              </>
            ) : null}
          </div>
        </Surface>
      ) : null}
      <ControlledDialog
        open={!!closingView}
        onClose={() => setClosingView(null)}
        title={"Cierre " + (closingView?.version ?? "")}
        description="Consulta de la revisión congelada; no modifica decisiones actuales."
      >
        {closingView ? (
          <>
            <p>{closingView.snapshot.scopeStatement}</p>
            <p>
              Cerrado: {new Date(closingView.closedAt).toLocaleString("es-MX")}{" "}
              · Responsable: {closingView.actorMembershipId}
            </p>
            {closingView.sourceExceptionReason ? (
              <WarningNotice>
                Alcance incompleto aceptado: {closingView.sourceExceptionReason}
              </WarningNotice>
            ) : null}
            <ProductTable
              caption="Participaciones del cierre"
              rows={closingView.snapshot.participations}
              rowKey={(x) => x.id}
              columns={[
                { id: "uuid", header: "UUID", render: (x) => x.uuid },
                {
                  id: "ordinal",
                  header: "Participación",
                  render: (x) => x.sourceOrdinal,
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
                {
                  id: "category",
                  header: "Categoría al cierre",
                  render: (x) => x.categoryLabel ?? "Sin categoría",
                },
              ]}
            />
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={closingView.meta.page <= 1}
                onClick={() =>
                  void apiClient<CloseView>(
                    base +
                      "/monthly/closes/" +
                      closingView.version +
                      "?page=" +
                      (closingView.meta.page - 1),
                  )
                    .then(setClosingView)
                    .catch(setError)
                }
              >
                Anterior
              </Button>
              <span>
                Página {closingView.meta.page} · {closingView.meta.total}{" "}
                participaciones
              </span>
              <Button
                variant="outline"
                disabled={
                  closingView.meta.page * closingView.meta.limit >=
                  closingView.meta.total
                }
                onClick={() =>
                  void apiClient<CloseView>(
                    base +
                      "/monthly/closes/" +
                      closingView.version +
                      "?page=" +
                      (closingView.meta.page + 1),
                  )
                    .then(setClosingView)
                    .catch(setError)
                }
              >
                Siguiente
              </Button>
            </div>
            <details>
              <summary>Checklist y alcance congelados</summary>
              {closingView.snapshot.checklist.map((x) => (
                <p key={x.key}>
                  {label(x.key)}: {x.passed ? "Cumplido" : "Pendiente"} ·{" "}
                  {x.reason ??
                    (x.kind === "automatic"
                      ? "Comprobación del sistema"
                      : "Sin confirmación")}
                </p>
              ))}
            </details>
            <details>
              <summary>Fuentes al corte</summary>
              {closingView.snapshot.sources.map((x) => (
                <p key={x.kind + x.id}>
                  {x.kind === "sat" ? "SAT" : "Ingesta"} · {label(x.status)} ·{" "}
                  {x.dateFrom ?? "Sin fecha declarada"} — {x.dateTo ?? ""}
                </p>
              ))}
            </details>
            <details>
              <summary>Incidencias al corte</summary>
              {closingView.snapshot.incidents.map((x) => (
                <p key={x.id}>
                  {x.code} · {label(x.state)} · {x.reason} {x.comment}
                </p>
              ))}
            </details>
          </>
        ) : null}
      </ControlledDialog>
    </>
  );
}
function CategoryEditor({
  category,
  disabled,
  onSave,
}: {
  category: Category;
  disabled: boolean;
  onSave: (x: object) => Promise<unknown>;
}) {
  const [name, setName] = useState(category.label);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        <Input
          aria-label="Nombre de categoría"
          value={name}
          disabled={disabled}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={disabled || !name.trim() || name === category.label}
          onClick={() =>
            void onSave({
              label: name,
              archived: category.archived,
              expectedVersion: category.version,
            }).catch(setError)
          }
        >
          Renombrar
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() =>
            void onSave({
              label: name,
              archived: !category.archived,
              expectedVersion: category.version,
            }).catch(setError)
          }
        >
          {category.archived ? "Reactivar" : "Archivar"}
        </Button>
      </div>
      {error ? (
        <ErrorNotice
          error={error}
          fallback="No se pudo completar la operación mensual."
        />
      ) : null}
    </div>
  );
}
function IncidentEditor({
  incident: x,
  historyPath,
  onInspect,
  assignees,
  disabled,
  onSave,
}: {
  incident: Incident;
  historyPath: string;
  onInspect: () => void;
  assignees: { id: string; name: string }[];
  disabled: boolean;
  onSave: (x: object) => Promise<unknown>;
}) {
  const [error, setError] = useState<unknown>(null);
  const [state, setState] = useState(x.state);
  const [reason, setReason] = useState(x.reason ?? "");
  const [responsible, setResponsible] = useState(
    x.responsibleMembershipId ?? "",
  );
  const [comment, setComment] = useState(x.comment ?? "");
  const [history, setHistory] = useState<
    {
      version: number;
      state: string;
      reason: string;
      comment: string | null;
      actorMembershipId: string;
      createdAt: string;
    }[]
  >([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  useEffect(() => {
    if (!historyPage) return;
    const abort = new AbortController();
    void apiClient<{ items: typeof history; meta: { total: number } }>(
      historyPath + "?page=" + historyPage,
      { signal: abort.signal },
    )
      .then((r) => {
        if (!abort.signal.aborted) {
          setHistory(r.items);
          setHistoryTotal(r.meta.total);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e);
      });
    return () => abort.abort();
  }, [historyPath, historyPage]);

  return (
    <div className="space-y-3 border-b border-border pb-4">
      <h3 className="font-semibold">
        {x.code} · {label(x.state)}
      </h3>
      <Button
        variant="outline"
        onClick={() => setHistoryPage((p) => (p ? 0 : 1))}
      >
        {historyPage ? "Ocultar historial" : "Consultar historial de gestión"}
      </Button>
      {historyPage ? (
        <div>
          {history.map((h) => (
            <p key={h.version}>
              Versión {h.version} · {label(h.state)} · {h.reason} {h.comment} ·{" "}
              {assignees.find((a) => a.id === h.actorMembershipId)?.name ??
                "Miembro del despacho"}{" "}
              · {new Date(h.createdAt).toLocaleString("es-MX")}
            </p>
          ))}
          <Button
            variant="outline"
            disabled={historyPage <= 1}
            onClick={() => setHistoryPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            disabled={historyPage * 25 >= historyTotal}
            onClick={() => setHistoryPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
      <Button variant="outline" onClick={onInspect}>
        {x.cfdiUuid ? "Revisar documento" : "Consultar fuente"}
      </Button>
      <p>La evidencia original sigue {label(x.originalStatus)}.</p>
      <select
        aria-label="Seguimiento de incidencia"
        className={selectClass}
        disabled={disabled}
        value={state}
        onChange={(e) => setState(e.target.value)}
      >
        {["open", "client_clarification", "resolved", "reviewed_rejection"].map(
          (v) => (
            <option key={v} value={v}>
              {label(v)}
            </option>
          ),
        )}
      </select>
      <Field label="Responsable">
        <select
          className={selectClass}
          disabled={disabled}
          value={responsible}
          onChange={(e) => setResponsible(e.target.value)}
        >
          <option value="">Sin asignar</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Motivo o resolución">
        <Input
          disabled={disabled}
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Field label="Comentario">
        <Input
          disabled={disabled}
          value={comment}
          maxLength={2000}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
      <Button
        disabled={disabled || !reason.trim()}
        onClick={() =>
          void onSave({
            state,
            reason,
            comment,
            responsibleMembershipId: responsible || null,
            incidentVersion: x.version,
          }).catch(setError)
        }
      >
        Guardar seguimiento
      </Button>
      {error ? (
        <ErrorNotice
          error={error}
          fallback="No se pudo completar la operación mensual."
        />
      ) : null}
    </div>
  );
}
