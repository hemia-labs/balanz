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
import {
  validateXmlSelection,
  xmlFileRejectionMessage,
} from "./upload-validation";
import { uploadXml } from "./xml-upload-transport";

export function XmlUploadDialog({
  scope,
  disabled = false,
  onAccepted,
}: {
  scope: IngestionRecoveryScope;
  disabled?: boolean;
  onAccepted?: (accepted: XmlUploadAccepted) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<unknown>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<
    "idle" | "transferring" | "accepted"
  >("idle");
  const [accepted, setAccepted] = useState<XmlUploadAccepted | null>(null);
  const lifecycle = useRef(createUploadLifecycle());
  const idempotencyKey = useRef<string | null>(null);
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
    idempotencyKey.current = null;
  };
  const close = () => {
    lifecycle.current.invalidate();
    setOpen(false);
    reset();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const rejection = validateXmlSelection(file ? [file] : []);
    if (rejection) {
      setSelectionError(xmlFileRejectionMessage[rejection]);
      return;
    }
    setSelectionError(null);
    setRequestError(null);
    setStatus("transferring");
    setProgress(0);
    idempotencyKey.current ??= crypto.randomUUID();
    const upload = uploadXml({
      legalEntityId: scope.legalEntityId,
      file: file!,
      idempotencyKey: idempotencyKey.current,
      onProgress: ({ percent }) => setProgress(percent),
    });
    const request = lifecycle.current.begin(upload);
    try {
      const result = await upload.promise;
      if (!lifecycle.current.isCurrent(request)) return;
      saveIngestionRecovery(scope, result);
      setAccepted(result);
      setProgress(100);
      setStatus("accepted");
      onAccepted?.(result);
    } catch (cause) {
      if (!lifecycle.current.isCurrent(request)) return;
      setStatus("idle");
      if ((cause as { code?: string })?.code !== "ABORTED")
        setRequestError(cause);
    } finally {
      lifecycle.current.release(request);
    }
  };

  return (
    <>
      <Button type="button" disabled={disabled} onClick={() => setOpen(true)}>
        <FileUp className="size-4" aria-hidden="true" />
        Cargar XML
      </Button>
      <ControlledDialog
        open={open}
        onClose={close}
        title="Cargar un XML"
        description="El archivo se transfiere de forma privada y continúa procesándose aunque cierres esta ventana."
      >
        <form className="space-y-5 px-5 py-5" onSubmit={submit}>
          {status === "accepted" && accepted ? (
            <div role="status" className="space-y-3 rounded-md border border-success/30 bg-success-surface p-4 text-body-sm">
              <p className="font-semibold">Carga aceptada (202)</p>
              <p className="text-muted-foreground">
                El proceso durable quedó en estado {accepted.status}. Puedes cerrar o recargar el navegador.
              </p>
              <p className="identifier text-caption">Proceso {accepted.jobId}</p>
            </div>
          ) : (
            <>
              <label className="grid gap-2 text-body-sm font-semibold">
                Archivo XML
                <input
                  type="file"
                  accept=".xml,application/xml,text/xml"
                  disabled={status === "transferring"}
                  className="min-h-11 rounded-md border border-input bg-card px-3 py-2 text-body-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:font-semibold"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    const rejection = validateXmlSelection(files);
                    setFile(rejection ? null : (files[0] ?? null));
                    setSelectionError(
                      rejection ? xmlFileRejectionMessage[rejection] : null,
                    );
                    setRequestError(null);
                    idempotencyKey.current = null;
                  }}
                />
              </label>
              <p className="text-caption text-muted-foreground">
                Un solo archivo .xml, máximo 5 MiB. El servidor validará el tipo real y su contenido.
              </p>
              {selectionError ? (
                <p role="alert" className="text-body-sm text-destructive">
                  {selectionError}
                </p>
              ) : null}
              <ErrorNotice
                error={requestError}
                fallback="No se pudo cargar el XML."
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
              <Button type="submit" disabled={!file || status === "transferring"}>
                {status === "transferring" ? "Transfiriendo…" : "Cargar XML"}
              </Button>
            ) : null}
          </div>
        </form>
      </ControlledDialog>
    </>
  );
}
