"use client";

import { useEffect, useRef, useState } from "react";
import { FileUp, StopCircle } from "lucide-react";
import { ControlledDialog } from "@/components/overlay-dialog";
import { ProgressValue } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/features/clients/live-screen-primitives";
import type { IngestionRecoveryScope } from "./recovery-store";
import { saveIngestionRecovery } from "./recovery-store";
import type { XmlUploadAccepted } from "./types";
import { createUploadLifecycle } from "./upload-lifecycle";
import { createXmlUploadSession } from "./upload-session";
import {
  validateXmlSelection,
  xmlFileRejectionMessage,
} from "./upload-validation";
import { uploadXml } from "./xml-upload-transport";

import {
  uploadZip,
  validateZipSelection,
  readZipIntent,
  clearZipIntent,
  confirmZipUpload,
} from "./zip-upload-transport";

export function ZipUploadDialog(props: {
  scope: IngestionRecoveryScope;
  disabled?: boolean;
  onAccepted?: (accepted: XmlUploadAccepted) => void;
}) {
  return <XmlUploadDialog {...props} format="zip" />;
}

export function XmlUploadDialog({
  scope,
  disabled = false,
  onAccepted,
  format = "xml",
}: {
  scope: IngestionRecoveryScope;
  format?: "xml" | "zip";
  disabled?: boolean;
  onAccepted?: (accepted: XmlUploadAccepted) => void;
}) {
  const zip = format === "zip";
  const label = zip ? "ZIP" : "XML";
  const [pendingZip, setPendingZip] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<unknown>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "transferring" | "accepted">(
    "idle",
  );
  const [accepted, setAccepted] = useState<XmlUploadAccepted | null>(null);
  const lifecycle = useRef(createUploadLifecycle());
  const uploadSession = useRef(createXmlUploadSession());
  const scopeIdentity = `${scope.organizationId}:${scope.clientAccountId}:${scope.legalEntityId}`;

  useEffect(
    () => () => {
      lifecycle.current.invalidate();
    },
    [scopeIdentity],
  );

  const reset = () => {
    setFile(null);
    setSelectionError(null);
    setRequestError(null);
    setProgress(0);
    setStatus("idle");
    setAccepted(null);
    uploadSession.current.reset();
  };
  const close = () => {
    lifecycle.current.invalidate();
    setOpen(false);
    reset();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const rejection = zip
      ? validateZipSelection(file ? [file] : [])
      : validateXmlSelection(file ? [file] : []);
    if (rejection) {
      setSelectionError(
        zip
          ? rejection
          : xmlFileRejectionMessage[
              rejection as keyof typeof xmlFileRejectionMessage
            ],
      );
      return;
    }
    setSelectionError(null);
    setRequestError(null);
    setStatus("transferring");
    setProgress(0);
    const upload = uploadSession.current.start((idempotencyKey) =>
      zip
        ? uploadZip({
            scope,
            file: file!,
            createHashWorker: () =>
              new Worker(new URL("./zip-hash.worker.ts", import.meta.url)),
            onProgress: ({ percent }) => setProgress(percent),
          })
        : uploadXml({
            legalEntityId: scope.legalEntityId,
            file: file!,
            idempotencyKey,
            onProgress: ({ percent }) => setProgress(percent),
          }),
    );
    const request = lifecycle.current.begin(upload);
    try {
      const result = await upload.promise;
      if (!lifecycle.current.isCurrent(request)) return;
      saveIngestionRecovery(scope, result);
      if (zip) {
        clearZipIntent();
        setPendingZip(null);
      }
      setAccepted(result);
      setProgress(100);
      setStatus("accepted");
      onAccepted?.(result);
    } catch (cause) {
      if (!lifecycle.current.isCurrent(request)) return;
      setStatus("idle");
      if (zip) setPendingZip(readZipIntent(scope)?.uploadId ?? null);
      if ((cause as { code?: string })?.code !== "ABORTED")
        setRequestError(cause);
    } finally {
      lifecycle.current.release(request);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={zip ? "outline" : "default"}
        disabled={disabled}
        onClick={() => {
          setPendingZip(zip ? (readZipIntent(scope)?.uploadId ?? null) : null);
          setOpen(true);
        }}
      >
        <FileUp className="size-4" aria-hidden="true" />
        Cargar {label}
      </Button>
      <ControlledDialog
        open={open}
        onClose={close}
        title={`Cargar un ${label}`}
        description="El archivo se transfiere de forma privada y continúa procesándose aunque cierres esta ventana."
      >
        {zip && pendingZip && status !== "accepted" ? (
          <div className="space-y-2 px-5 pt-5">
            <p className="text-body-sm">
              Hay una carga ZIP pendiente. Recupera el proceso si el archivo ya
              se transfirió, o vuelve a seleccionar el mismo archivo.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={status === "transferring"}
              onClick={() => {
                const handle = {
                  abort: () => controller.abort(),
                  promise: Promise.resolve(),
                };
                const controller = new AbortController();
                const attempt = lifecycle.current.begin(handle);
                setStatus("transferring");
                setRequestError(null);
                void confirmZipUpload(pendingZip, controller.signal)
                  .then((result) => {
                    if (!lifecycle.current.isCurrent(attempt)) return;
                    saveIngestionRecovery(scope, result);
                    clearZipIntent();
                    setPendingZip(null);
                    setAccepted(result);
                    setStatus("accepted");
                    onAccepted?.(result);
                  })
                  .catch((cause) => {
                    if (lifecycle.current.isCurrent(attempt)) {
                      setRequestError(cause);
                      setStatus("idle");
                    }
                  })
                  .finally(() => lifecycle.current.release(attempt));
              }}
            >
              Recuperar carga ZIP
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={status === "transferring"}
              onClick={() => {
                clearZipIntent();
                setPendingZip(null);
                uploadSession.current.reset();
              }}
            >
              Iniciar otra carga
            </Button>
          </div>
        ) : null}
        <form className="space-y-5 px-5 py-5" onSubmit={submit}>
          {status === "accepted" && accepted ? (
            <div
              role="status"
              className="space-y-3 rounded-md border border-success/30 bg-success-surface p-4 text-body-sm"
            >
              <p className="font-semibold">Carga aceptada (202)</p>
              <p className="text-muted-foreground">
                El proceso durable quedó en estado {accepted.status}. Puedes
                cerrar o recargar el navegador.
              </p>
              <p className="identifier text-caption">
                Proceso {accepted.jobId}
              </p>
            </div>
          ) : (
            <>
              <label className="grid gap-2 text-body-sm font-semibold">
                Archivo {label}
                <input
                  type="file"
                  accept={
                    zip
                      ? ".zip,application/zip"
                      : ".xml,application/xml,text/xml"
                  }
                  disabled={status === "transferring"}
                  className="min-h-11 rounded-md border border-input bg-card px-3 py-2 text-body-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:font-semibold"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    const rejection = zip
                      ? validateZipSelection(files)
                      : validateXmlSelection(files);
                    setFile(rejection ? null : (files[0] ?? null));
                    setSelectionError(
                      rejection
                        ? zip
                          ? rejection
                          : xmlFileRejectionMessage[
                              rejection as keyof typeof xmlFileRejectionMessage
                            ]
                        : null,
                    );
                    setRequestError(null);
                    uploadSession.current.reset();
                  }}
                />
              </label>
              <p className="text-caption text-muted-foreground">
                {zip
                  ? "Un ZIP de hasta 50 MiB y 2,000 archivos. Cada XML tiene su propio resultado; los errores individuales conservan los CFDI válidos."
                  : "Un solo archivo .xml, máximo 5 MiB. El servidor validará el tipo real y su contenido."}
              </p>
              {selectionError ? (
                <p role="alert" className="text-body-sm text-destructive">
                  {selectionError}
                </p>
              ) : null}
              <ErrorNotice
                error={requestError}
                fallback={`No se pudo cargar el ${label}.`}
              />
              {status === "transferring" ? (
                <ProgressValue value={progress} label="Transferencia" />
              ) : null}
            </>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            {status === "transferring" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => lifecycle.current.abortCurrent()}
              >
                <StopCircle className="size-4" aria-hidden="true" />
                Cancelar transferencia
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={close}>
                {status === "accepted" ? "Cerrar" : "Cancelar"}
              </Button>
            )}
            {status !== "accepted" ? (
              <Button
                type="submit"
                disabled={!file || status === "transferring"}
              >
                {status === "transferring"
                  ? "Transfiriendo…"
                  : `Cargar ${label}`}
              </Button>
            ) : null}
          </div>
        </form>
      </ControlledDialog>
    </>
  );
}
