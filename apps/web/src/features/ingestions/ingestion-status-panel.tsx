"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, RotateCcw, StopCircle, X } from "lucide-react";
import { PermissionGate } from "@/components/permission-gate";
import {
  ProgressValue,
  Surface,
  SurfaceHeader,
} from "@/components/product-patterns";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  ErrorNotice,
  LoadingState,
} from "@/features/clients/live-screen-primitives";
import { ApiError, apiErrorMessage } from "@/lib/api-client";
import { cancelIngestion, retryIngestion } from "./api";
import { ingestionProgress, isTerminalIngestionStatus } from "./polling";
import {
  clearIngestionRecovery,
  saveIngestionRecovery,
  type IngestionRecoveryScope,
} from "./recovery-store";
import type { IngestionItemResult, IngestionJob } from "./types";
import { useIngestionJob } from "./use-ingestion-job";
import { useIngestionRecovery } from "./use-ingestion-recovery";

const resultLabels: Record<IngestionItemResult, string> = {
  incorporated: "Incorporado",
  duplicate: "Duplicado",
  foreign: "RFC ajeno",
  invalid: "Inválido",
  unsupported: "No soportado",
  internal_error: "Error interno",
};

export function LatestIngestionPanel({
  scope,
  cfdiHref,
  onTerminal,
}: {
  scope: IngestionRecoveryScope;
  cfdiHref: (cfdiId: string) => string;
  onTerminal?: () => void;
}) {
  const { recovery } = useIngestionRecovery(scope);
  if (!recovery) return null;
  return (
    <IngestionStatusPanel
      key={recovery.jobId}
      organizationId={scope.organizationId}
      jobId={recovery.jobId}
      cfdiHref={cfdiHref}
      dismissible
      onTerminal={onTerminal}
      onRetried={(nextJobId, status) =>
        saveIngestionRecovery(scope, {
          uploadId: recovery.uploadId,
          objectId: recovery.objectId,
          jobId: nextJobId,
          status,
          links: {},
          correlationId: recovery.correlationId,
        })
      }
    />
  );
}

export function IngestionStatusPanel({
  organizationId,
  jobId,
  cfdiHref,
  dismissible = false,
  onTerminal,
  onRetried,
}: {
  organizationId: string;
  jobId: string;
  cfdiHref?: (cfdiId: string) => string;
  dismissible?: boolean;
  onTerminal?: () => void;
  onRetried?: (jobId: string, status: IngestionJob["status"]) => void;
}) {
  const [page, setPage] = useState(1);
  const [activeJobId, setActiveJobId] = useState(jobId);
  const { job, items, loading, error, reload } = useIngestionJob({
    organizationId,
    jobId: activeJobId,
    page,
  });
  const [action, setAction] = useState<"retry" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const terminal = job ? isTerminalIngestionStatus(job.status) : false;
  const notifiedTerminal = useRef<string | null>(null);
  const retryIdempotencyKey = useRef<string | null>(null);
  useEffect(() => {
    retryIdempotencyKey.current = null;
  }, [activeJobId]);
  useEffect(() => {
    if (!job || !terminal) return;
    const identity = `${job.id}:${job.status}`;
    if (notifiedTerminal.current === identity) return;
    notifiedTerminal.current = identity;
    onTerminal?.();
  }, [job, onTerminal, terminal]);
  const runAction = async (kind: "retry" | "cancel") => {
    setAction(kind);
    setActionError(null);
    try {
      if (kind === "retry") {
        retryIdempotencyKey.current ??= crypto.randomUUID();
        const retried = await retryIngestion(
          activeJobId,
          retryIdempotencyKey.current,
        );
        setPage(1);
        setActiveJobId(retried.id);
        onRetried?.(retried.id, retried.status);
      } else {
        await cancelIngestion(activeJobId);
        reload();
      }
    } catch (cause) {
      setActionError(cause);
    } finally {
      setAction(null);
    }
  };

  if (loading && !job) return <LoadingState label="Recuperando carga…" />;
  return (
    <Surface>
      <SurfaceHeader
        title={job?.sourceType === "manual_zip" ? "Carga ZIP" : "Carga XML"}
        description={`Proceso ${activeJobId}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={reload}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Actualizar estado
            </Button>
            {dismissible && terminal ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearIngestionRecovery();
                  onTerminal?.();
                }}
              >
                <X className="size-4" aria-hidden="true" />
                Ocultar
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="space-y-4 p-5">
        <ErrorNotice
          error={error}
          fallback="No se pudo consultar el proceso."
        />
        <ErrorNotice
          error={actionError}
          fallback="No se pudo actualizar el proceso."
        />
        {job ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <StatusBadge status={job.status} />
                <p className="text-caption text-muted-foreground">
                  {job.stage
                    ? `Etapa: ${{ scanning: "Revisando seguridad", extracting: "Extrayendo archivos", parsing: "Validando XML", persisting: "Guardando resultados" }[job.stage] ?? job.stage}`
                    : "Esperando la siguiente etapa"}
                  {job.correlationId
                    ? ` · Correlación ${job.correlationId}`
                    : ""}
                </p>
              </div>
              <ProgressValue
                value={
                  job.sourceType === "manual_zip"
                    ? terminal
                      ? 100
                      : job.counters.total
                        ? Math.round(
                            ((job.counters.total -
                              job.counters.pending -
                              job.counters.processing) /
                              job.counters.total) *
                              100,
                          )
                        : 0
                    : (job.progress ?? ingestionProgress(job.status, job.stage))
                }
                label="Procesamiento"
              />
            </div>
            {job.lastErrorCode ? (
              <p role="alert" className="text-body-sm text-destructive">
                {apiErrorMessage(
                  new ApiError(
                    422,
                    "No se pudo completar el proceso. Revisa los resultados o intenta de nuevo.",
                    job.lastErrorCode,
                  ),
                  "No se pudo completar el proceso. Revisa los resultados o intenta de nuevo.",
                )}
                <span className="block text-caption text-muted-foreground">
                  Código: {job.lastErrorCode}
                </span>
              </p>
            ) : null}
            <div
              className="flex flex-wrap gap-4 text-body-sm"
              aria-label="Conteos por resultado"
            >
              <span>Total: {job.counters.total}</span>
              {Object.entries(resultLabels).map(([result, label]) => (
                <span key={result}>
                  {label}:{" "}
                  {result === "internal_error"
                    ? job.counters.internalError
                    : job.counters[
                        result as Exclude<IngestionItemResult, "internal_error">
                      ]}
                </span>
              ))}
            </div>
            {job.status === "completed_with_issues" ? (
              <p role="status" className="text-body-sm">
                Carga terminada con incidencias. Los CFDI válidos se
                conservaron; revisa los resultados de cada entrada.
              </p>
            ) : null}
            {items.length ? (
              <ul className="grid gap-3" aria-label="Resultados de la carga">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <div>
                      <p className="text-body-sm font-semibold">
                        {item.ordinal}. {item.filename ?? "Entrada"} ·{" "}
                        {item.result
                          ? resultLabels[item.result]
                          : "Resultado pendiente"}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {item.errorCode
                          ? apiErrorMessage(
                              new ApiError(
                                422,
                                item.errorDetail ??
                                  "No se pudo incorporar esta entrada. Revisa el archivo antes de reintentar.",
                                item.errorCode,
                              ),
                              "No se pudo incorporar esta entrada. Revisa el archivo antes de reintentar.",
                            )
                          : (item.errorDetail ??
                            `Parser ${item.parserVersion ?? "—"}`)}
                        {item.errorCode ? (
                          <span className="block">
                            Código: {item.errorCode}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    {item.cfdiId && cfdiHref ? (
                      <Button
                        render={<Link href={cfdiHref(item.cfdiId)} />}
                        size="sm"
                        variant="outline"
                      >
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Ver CFDI
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : terminal ? (
              <p className="text-body-sm text-muted-foreground">
                El proceso terminó sin elementos visibles.
              </p>
            ) : null}
            {job.counters.total > 25 ? (
              <nav
                className="flex items-center gap-3"
                aria-label="Páginas de entradas"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Anterior
                </Button>
                <span className="text-body-sm">
                  Página {page} de {Math.ceil(job.counters.total / 25)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    page >= Math.ceil(job.counters.total / 25) || loading
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  Siguiente
                </Button>
              </nav>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {job.status === "failed_final" ||
              (job.sourceType === "manual_zip" &&
                ["cancelled", "completed_with_issues"].includes(job.status)) ? (
                <PermissionGate capability="ingestion.retry">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={action !== null}
                    onClick={() => void runAction("retry")}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {action === "retry"
                      ? "Reintentando…"
                      : job.sourceType === "manual_zip"
                        ? "Reintentar paquete completo"
                        : "Reintentar"}
                  </Button>
                </PermissionGate>
              ) : null}
              {!terminal && job.status !== "cancel_requested" ? (
                <PermissionGate capability="ingestion.cancel">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={action !== null}
                    onClick={() => void runAction("cancel")}
                  >
                    <StopCircle className="size-4" aria-hidden="true" />
                    {action === "cancel" ? "Cancelando…" : "Cancelar proceso"}
                  </Button>
                </PermissionGate>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Surface>
  );
}
