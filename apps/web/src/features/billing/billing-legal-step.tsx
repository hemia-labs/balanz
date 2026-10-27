"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/product-patterns";
import { ControlledDialog } from "@/components/overlay-dialog";
import { ApiError } from "@/lib/api-client";
import { BillingCheckoutAction } from "./billing-checkout-action";
import {
  canConfirmLegalDocuments,
  canReuseLegalAcceptance,
} from "./legal-consent";
import {
  prepareLegalAcceptance,
  acceptLegalDocuments,
  type LegalDocuments,
  type LegalAcceptance,
  type PlanChangeQuote,
} from "./api";
function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Inicia sesión nuevamente para continuar.";
    if (error.status === 403)
      return "Necesitas autorización para contratar y MFA completado.";
    if (error.status === 409)
      return "La solicitud venció o los documentos cambiaron. Consulta y revisa los documentos nuevamente.";
    if (error.status === 429) return "Espera un momento antes de reintentar.";
  }
  return "No se pudo completar la operación. Puedes reintentar la misma solicitud.";
}
export function BillingLegalStep({
  organizationId,
  userId,
  planCode,
  planPriceCode,
  changePlan = false,
  expectedSubscriptionId,
  expectedAmountDueNow,
  onReviewQuote,
}: {
  organizationId: string;
  userId: string;
  planCode: string;
  planPriceCode: string;
  changePlan?: boolean;
  expectedSubscriptionId?: string;
  expectedAmountDueNow?: string;
  onReviewQuote: (quote?: PlanChangeQuote) => void;
}) {
  const acceptanceStorageKey = `balanz:billing-legal-acceptance:v1:${organizationId}:${userId}`;
  const [documents, setDocuments] = useState<LegalDocuments>();
  const [checked, setChecked] = useState<string[]>([]);
  const [readingDocument, setReadingDocument] =
    useState<LegalDocuments["documents"][number]>();
  const allConfirmed = canConfirmLegalDocuments(
    documents?.documents.map((document) => document.documentVersionId) ?? [],
    checked,
  );
  const [result, setResult] = useState<LegalAcceptance>();
  const [startCheckoutAutomatically, setStartCheckoutAutomatically] =
    useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const loadingDocuments = !result && (busy || (!documents && !error));
  const attempt = useRef<{ prepare: string; accept: string } | undefined>(
    undefined,
  );
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const prepare = useCallback(
    async (renew = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError("");
      if (!attempt.current || renew)
        attempt.current = {
          prepare: crypto.randomUUID(),
          accept: crypto.randomUUID(),
        };
      pending.current = new AbortController();
      try {
        const value = await prepareLegalAcceptance(
          attempt.current.prepare,
          pending.current.signal,
        );
        if (mounted.current) {
          setDocuments(value);
          setChecked([]);
          setReadingDocument(undefined);
          setStale(false);
          try {
            const saved: unknown = JSON.parse(
              sessionStorage.getItem(acceptanceStorageKey) ?? "null",
            );
            if (canReuseLegalAcceptance(saved, value)) {
              setResult(saved as LegalAcceptance);
            }
          } catch {
            // A fresh document review remains available when stored consent cannot be recovered.
          }
        }
      } catch (c) {
        if (mounted.current) {
          setError(errorMessage(c));
          if (c instanceof ApiError && c.status === 409) setStale(true);
        }
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [acceptanceStorageKey],
  );
  useEffect(() => {
    let active = true;
    mounted.current = true;
    queueMicrotask(() => {
      if (active) void prepare();
    });
    return () => {
      active = false;
      mounted.current = false;
      pending.current?.abort();
    };
  }, [acceptanceStorageKey, prepare]);
  async function accept() {
    if (!documents || !attempt.current || !allConfirmed || inFlight.current)
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    pending.current = new AbortController();
    try {
      const value = await acceptLegalDocuments(
        documents,
        attempt.current.accept,
        pending.current.signal,
      );
      if (mounted.current) {
        try {
          sessionStorage.setItem(
            acceptanceStorageKey,
            JSON.stringify({
              ...value,
              acceptedDocuments: documents.documents.map((document) => ({
                documentVersionId: document.documentVersionId,
                contentHash: document.contentHash,
              })),
            }),
          );
        } catch {
          setError(
            "La aceptación quedó registrada, pero el navegador no pudo guardar su referencia para recuperarla al volver.",
          );
        }
        setResult(value);
        setStartCheckoutAutomatically(true);
      }
    } catch (c) {
      if (mounted.current) {
        setError(errorMessage(c));
        if (c instanceof ApiError && c.status === 409) {
          setStale(true);
          setChecked([]);
          setReadingDocument(undefined);
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Surface>
        <section
          className="space-y-5 p-5"
          aria-label="Documentos legales"
          aria-busy={loadingDocuments}
        >
          {result ? (
            <div role="status" className="space-y-3">
              <p className="text-body font-semibold">Aceptación registrada</p>
              {documents ? (
                <ul className="space-y-3">
                  {documents.documents.map((document) => (
                    <li
                      key={document.documentVersionId}
                      className="flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1 py-2 text-body-sm"
                    >
                      <label className="flex min-h-11 items-center gap-3">
                        <input
                          type="checkbox"
                          checked
                          disabled
                          aria-label={`He leído y acepto ${document.title}, versión ${document.version}`}
                          className="size-5 shrink-0 accent-primary"
                        />
                        <span>He leído y acepto</span>
                      </label>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto min-h-11 cursor-pointer whitespace-normal p-0 text-left text-primary underline underline-offset-4"
                        aria-haspopup="dialog"
                        onClick={() => setReadingDocument(document)}
                      >
                        {document.title}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {error ? <p role="alert" className="text-body-sm text-destructive">{error}</p> : null}
            </div>
          ) : (
            <>
              {error ? (
                <p role="alert" className="text-body-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {loadingDocuments ? (
                <div className="space-y-5">
                  <span role="status" className="sr-only">
                    {documents
                      ? "Registrando aceptación…"
                      : "Consultando documentos vigentes…"}
                  </span>
                  {Array.from(
                    { length: documents?.documents.length ?? 2 },
                    (_, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className="size-5 shrink-0 animate-pulse rounded bg-muted motion-reduce:animate-none"
                        />
                        <div
                          aria-hidden="true"
                          className="h-4 w-48 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none"
                        />
                      </div>
                    ),
                  )}
                </div>
              ) : null}
              {documents && !loadingDocuments ? (
                <fieldset disabled={busy || stale} className="space-y-4">
                  <legend className="sr-only">
                    Confirmación de los documentos requeridos
                  </legend>
                  {documents.documents.map((d) => (
                    <div
                      key={d.documentVersionId}
                      className="flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1 py-2 text-body-sm"
                    >
                      <label className="flex min-h-11 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          aria-label={`He leído y acepto ${d.title}, versión ${d.version}`}
                          className="size-5 shrink-0 accent-primary focus-visible:outline focus-visible:outline-ring"
                          checked={checked.includes(d.documentVersionId)}
                          onChange={(e) =>
                            setChecked((c) =>
                              e.target.checked
                                ? [...c, d.documentVersionId]
                                : c.filter((id) => id !== d.documentVersionId),
                            )
                          }
                        />
                        <span>He leído y acepto</span>
                      </label>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto min-h-11 cursor-pointer whitespace-normal p-0 text-left text-primary underline underline-offset-4"
                        disabled={busy || stale}
                        aria-haspopup="dialog"
                        onClick={() => setReadingDocument(d)}
                      >
                        {d.title}
                      </Button>
                    </div>
                  ))}
                </fieldset>
              ) : null}
              {(!documents || stale) && !busy && (stale || error) ? (
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void prepare(stale)}
                >
                  {stale
                    ? "Consultar documentos nuevamente"
                    : "Reintentar consulta"}
                </Button>
              ) : null}
            </>
          )}
        </section>
      </Surface>
      {!result && documents ? (
        loadingDocuments ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Procesando aceptación de documentos"
            className="h-11 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none"
          />
        ) : (
          <Button
            className="min-h-11 w-full"
            disabled={busy || stale || !allConfirmed}
            onClick={() => void accept()}
          >
            Continuar
          </Button>
        )
      ) : null}
      {result ? (
        <BillingCheckoutAction
          key={result.legalAcceptanceId}
          organizationId={organizationId}
          userId={userId}
          planCode={planCode}
          planPriceCode={planPriceCode}
          legalAcceptanceId={result.legalAcceptanceId}
          startImmediately={startCheckoutAutomatically}
          changePlan={changePlan}
          expectedSubscriptionId={expectedSubscriptionId}
          expectedAmountDueNow={expectedAmountDueNow}
          onReviewQuote={onReviewQuote}
        />
      ) : null}
      <ControlledDialog
        fullScreen
        open={Boolean(readingDocument)}
        onClose={() => setReadingDocument(undefined)}
        title={readingDocument?.title ?? "Documento legal"}
        description={`Versión ${readingDocument?.version ?? ""}. Revisa el contenido antes de aceptar.`}
        headerActions={readingDocument?.artifacts.source?.url ? (
          <a
            href={readingDocument.artifacts.source.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-body-sm font-medium text-primary transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Download className="size-4" aria-hidden="true" />
            Descargar original
          </a>
        ) : null}
      >
        {readingDocument && (
          readingDocument.artifacts.html?.url || readingDocument.artifacts.pdf?.url ? (
            <iframe
              title={`${readingDocument.title}, versión ${readingDocument.version}`}
              src={readingDocument.artifacts.html?.url ?? readingDocument.artifacts.pdf?.url}
              sandbox=""
              referrerPolicy="no-referrer"
              className="min-h-0 w-full flex-1 border-0 bg-background"
            />
          ) : (
            <p className="m-auto p-5 text-body-sm text-muted-foreground">
              No hay una vista previa disponible para este documento.
            </p>
          )
        )}
      </ControlledDialog>
    </>
  );
}
