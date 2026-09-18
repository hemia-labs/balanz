"use client";
import { useEffect, useRef, useState } from "react";
import { ControlledDialog } from "@/components/overlay-dialog";
import { Field } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ErrorNotice,
  LoadingState,
  selectClass,
} from "@/features/clients/live-screen-primitives";
import { apiClient } from "@/lib/api-client";
import { useCfdiDetail } from "@/features/cfdi/use-cfdi-data";
import { DetailTabContent } from "@/features/cfdi/live-cfdi-screens";
import type { MonthlyItem, Category, Decision } from "./types";
import { label } from "./labels";
const decisionOf = (row: MonthlyItem): Decision => ({
  reviewStatus: row.reviewStatus,
  inclusion: row.inclusion,
  exclusionReason: row.exclusionReason,
  categoryId: row.categoryId,
  categoryLabel: row.categoryLabel,
  taxStatus: row.taxStatus,
  taxNote: row.taxNote,
  vatStatus: row.vatStatus,
  vatNote: row.vatNote,
  comment: row.comment,
});
export function MonthlyDocumentPanel({
  row,
  categories,
  disabled,
  organizationId,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  onSave,
  historyPath,
}: {
  row: MonthlyItem;
  categories: Category[];
  disabled: boolean;
  organizationId: string;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  historyPath: string;
  onSave: (
    draft: Decision,
    version: number,
  ) => Promise<{ version: number; decisionVersion: number }>;
}) {
  const { data, error } = useCfdiDetail({
    organizationId,
    cfdiId: row.cfdiId,
    resourcePath:
      historyPath.split("/decisions/")[0] + "/items/" + row.id + "/document",
  });
  const [draft, setDraft] = useState<Decision>(() => decisionOf(row));
  const draftRef = useRef(draft);
  const decisionVersion = useRef(row.version);
  const [state, setState] = useState("Guardado");
  const [saveError, setSaveError] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  const authorityEpoch = useRef(0);
  useEffect(() => {
    authorityEpoch.current++;
    if (disabled && timer.current) clearTimeout(timer.current);
  }, [disabled]);
  const [tab, setTab] = useState<
    "data" | "concepts" | "relations" | "payments-payroll"
  >("data");
  const [exit, setExit] = useState<(() => void) | null>(null);
  const [history, setHistory] = useState<
    {
      id: string;
      version: number;
      comment: string | null;
      reviewStatus: string;
      actorMembershipId: string;
      createdAt: string;
    }[]
  >([]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void apiClient<{ items: typeof history }>(historyPath, {
      signal: abort.signal,
    })
      .then((x) => {
        if (!abort.signal.aborted) setHistory(x.items);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [historyPath, state]);
  const save = () => {
    if (timer.current) clearTimeout(timer.current);
    const snapshot = draftRef.current;
    const epoch = authorityEpoch.current;
    setState("Guardando");
    const next = saving.current
      .catch(() => undefined)
      .then(() => {
        if (!alive.current || disabled || epoch !== authorityEpoch.current)
          throw new Error("Vuelve a obtener edición antes de guardar.");
        return onSave(snapshot, decisionVersion.current);
      })
      .then((result) => {
        if (!alive.current) return;
        decisionVersion.current = result.decisionVersion;
        if (draftRef.current === snapshot) {
          setDirty(false);
          setState("Guardado");
        }
        setSaveError(null);
      })
      .catch((cause) => {
        if (alive.current) {
          setState(navigator.onLine ? "Error al guardar" : "Sin conexión");
          setSaveError(cause);
        }
        throw cause;
      });
    saving.current = next;
    return next;
  };
  function update(patch: Partial<Decision>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch(() => undefined), 700);
  }
  function leave(action: () => void) {
    if (dirty) setExit(() => action);
    else action();
  }
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  return (
    <>
      <ControlledDialog
        open
        side
        onClose={() => leave(onClose)}
        title={row.uuid}
        description={
          "Participación " +
          row.sourceOrdinal +
          " de este mes. Abrir el documento no lo marca revisado."
        }
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!hasPrevious}
              onClick={() => leave(onPrevious)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={!hasNext}
              onClick={() => leave(onNext)}
            >
              Siguiente
            </Button>
            <span role="status">{state}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              ["data", "concepts", "relations", "payments-payroll"] as const
            ).map((x) => (
              <Button variant="outline" key={x} onClick={() => setTab(x)}>
                {
                  {
                    data: "Datos",
                    concepts: "Conceptos",
                    relations: "Relaciones",
                    "payments-payroll": "Pagos",
                  }[x]
                }
              </Button>
            ))}
          </div>
          {data ? (
            <DetailTabContent tab={tab} cfdi={data} />
          ) : error ? (
            <ErrorNotice
              error={error}
              fallback="No se pudo completar la operación mensual."
            />
          ) : (
            <LoadingState label="Cargando documento…" />
          )}
          <p className="text-body-sm text-muted-foreground">
            Las facturas relacionadas se consultan como referencia; esta acción
            no cambia sus participaciones ni las de otros meses.
          </p>
          <details>
            <summary>Referencias observadas</summary>
            {row.relations.map((r) => (
              <p key={r.type + r.id}>
                {r.type === "payment_observed"
                  ? "Complemento de pago incorporado"
                  : r.type === "payment_reference"
                    ? "Factura referida por el pago"
                    : "Relación CFDI"}
                : {r.uuid} ·{" "}
                {r.incorporation === "present"
                  ? "Incorporado"
                  : r.incorporation === "unknown"
                    ? "Información restringida"
                    : "No incorporado en Balanz; no acredita inexistencia"}
              </p>
            ))}
          </details>
          <fieldset disabled={disabled} className="space-y-4">
            <legend className="font-semibold">
              Decisión de esta participación
            </legend>
            <Field label="Revisión">
              <select
                className={selectClass}
                value={draft.reviewStatus}
                onChange={(e) =>
                  update({
                    reviewStatus: e.target.value as Decision["reviewStatus"],
                  })
                }
              >
                <option value="pending">Por revisar</option>
                <option value="reviewed">Revisada</option>
              </select>
            </Field>
            <Field label="Inclusión">
              <select
                className={selectClass}
                value={draft.inclusion}
                onChange={(e) =>
                  update({ inclusion: e.target.value as Decision["inclusion"] })
                }
              >
                <option value="included">Incluida</option>
                <option value="excluded">Excluida</option>
              </select>
            </Field>
            {draft.inclusion === "excluded" ? (
              <Field label="Motivo obligatorio de exclusión">
                <Input
                  value={draft.exclusionReason ?? ""}
                  maxLength={1000}
                  onChange={(e) => update({ exclusionReason: e.target.value })}
                />
              </Field>
            ) : null}
            <Field label="Categoría opcional">
              <select
                className={selectClass}
                value={draft.categoryId ?? ""}
                onChange={(e) => update({ categoryId: e.target.value || null })}
              >
                <option value="">Sin categoría</option>
                {categories
                  .filter((x) => !x.archived || x.id === draft.categoryId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                      {x.archived ? " (archivada)" : ""}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Comentario opcional">
              <textarea
                className={selectClass}
                rows={3}
                value={draft.comment ?? ""}
                maxLength={2000}
                onChange={(e) => update({ comment: e.target.value })}
              />
            </Field>
            <details>
              <summary>Tratamiento fiscal e IVA opcionales</summary>
              <p>No calcula deducibilidad, acreditamiento ni impuestos.</p>
              {(["tax", "vat"] as const).map((kind) => (
                <div key={kind} className="space-y-2">
                  <Field
                    label={
                      kind === "tax" ? "Tratamiento fiscal" : "Tratamiento IVA"
                    }
                  >
                    <select
                      className={selectClass}
                      value={
                        draft[(kind + "Status") as "taxStatus" | "vatStatus"]
                      }
                      onChange={(e) =>
                        update({ [kind + "Status"]: e.target.value })
                      }
                    >
                      {["pendiente", "no_aplica", "documentado"].map((x) => (
                        <option key={x} value={x}>
                          {x.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Nota manual">
                    <Input
                      maxLength={1000}
                      value={
                        draft[(kind + "Note") as "taxNote" | "vatNote"] ?? ""
                      }
                      onChange={(e) =>
                        update({ [kind + "Note"]: e.target.value })
                      }
                    />
                  </Field>
                </div>
              ))}
            </details>
            <Button
              disabled={!dirty}
              onClick={() => void save().catch(() => undefined)}
            >
              Guardar ahora
            </Button>
          </fieldset>
          {saveError ? (
            <ErrorNotice
              error={saveError}
              fallback="No se pudo completar la operación mensual."
            />
          ) : null}
          <details>
            <summary>Historial de decisiones</summary>
            {history.map((x) => (
              <p key={x.id}>
                Versión {x.version} · {label(x.reviewStatus)} ·{" "}
                {new Date(x.createdAt).toLocaleString("es-MX")}
                {x.comment ? " · " + x.comment : ""}
              </p>
            ))}
          </details>
        </div>
      </ControlledDialog>
      <ControlledDialog
        open={!!exit}
        onClose={() => setExit(null)}
        title="Cambios pendientes"
        description="El texto no enviado se conserva sólo mientras esta pantalla permanece abierta."
      >
        <div className="flex gap-3">
          <Button
            disabled={disabled}
            onClick={() =>
              void save()
                .then(() => {
                  exit?.();
                  setExit(null);
                })
                .catch(() => undefined)
            }
          >
            Guardar y continuar
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              exit?.();
              setExit(null);
            }}
          >
            Descartar y continuar
          </Button>
        </div>
      </ControlledDialog>
    </>
  );
}
