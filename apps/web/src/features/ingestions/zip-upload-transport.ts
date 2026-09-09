import {
  ApiError,
  apiClientResponse,
  apiUrl,
  registerPendingApiAbort,
  reportApiUnauthorized,
  apiErrorFromPayload,
} from "../../lib/api-client";
import { normalizeXmlUploadAccepted, type XmlUploadAccepted } from "./types";
import { transferProgress, type UploadFileLike } from "./upload-validation";
import type { IngestionRecoveryScope } from "./recovery-store";

export const ZIP_RECOVERY_KEY = "balanz:zip-upload:v1";
export const ZIP_MAX_BYTES = 50 * 1024 * 1024;
interface ZipIntent extends IngestionRecoveryScope {
  intentId: string;
  uploadId: string | null;
}
interface UploadGrant {
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}
interface InitializedZip {
  uploadId: string;
  upload: UploadGrant | null;
}
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const browserStorage = () =>
  typeof window === "undefined" ? null : window.localStorage;

export function validateZipSelection(files: readonly UploadFileLike[]) {
  if (files.length !== 1) return "Selecciona un solo archivo ZIP.";
  if (
    !/^(?![. ])[^\\/:*?"<>|\x00-\x1f\x7f]+\.zip$/i.test(files[0].name) ||
    files[0].name.length > 240
  )
    return "Selecciona un archivo con nombre seguro y extensión .zip.";
  if (files[0].size < 22 || files[0].size > ZIP_MAX_BYTES)
    return "El ZIP debe contener datos y no superar 50 MiB.";
  return null;
}
export function readZipIntent(
  scope: IngestionRecoveryScope,
  storage: StorageLike | null = browserStorage(),
): ZipIntent | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(
      storage.getItem(ZIP_RECOVERY_KEY) ?? "null",
    ) as ZipIntent | null;
    if (!value) return null;
    if (
      value.organizationId !== scope.organizationId ||
      value.clientAccountId !== scope.clientAccountId ||
      value.legalEntityId !== scope.legalEntityId ||
      !/^[0-9a-f-]{36}$/i.test(value.intentId) ||
      (value.uploadId !== null && !/^[0-9a-f-]{36}$/i.test(value.uploadId))
    )
      throw new Error("invalid intent");
    return { ...scope, intentId: value.intentId, uploadId: value.uploadId };
  } catch {
    storage.removeItem(ZIP_RECOVERY_KEY);
    return null;
  }
}
export function clearZipIntent(storage = browserStorage()) {
  storage?.removeItem(ZIP_RECOVERY_KEY);
}
function saveZipIntent(value: ZipIntent) {
  browserStorage()?.setItem(
    ZIP_RECOVERY_KEY,
    JSON.stringify({
      organizationId: value.organizationId,
      clientAccountId: value.clientAccountId,
      legalEntityId: value.legalEntityId,
      intentId: value.intentId,
      uploadId: value.uploadId,
    }),
  );
}
function unwrap<T>(value: unknown): T {
  const body = value as { data?: unknown };
  return (body?.data ?? value) as T;
}

export async function confirmZipUpload(
  uploadId: string,
  signal?: AbortSignal,
): Promise<XmlUploadAccepted> {
  const response = await apiClientResponse<unknown>(
    `/ingestion-uploads/${encodeURIComponent(uploadId)}/zip/confirm`,
    {
      method: "POST",
      headers: { "Idempotency-Key": `zip-confirm:${uploadId}` },
      body: "{}",
      signal,
    },
    120_000,
  );
  const accepted = normalizeXmlUploadAccepted(response.data);
  if (
    response.status !== 202 ||
    !accepted.jobId ||
    !accepted.uploadId ||
    !accepted.objectId ||
    !accepted.correlationId
  )
    throw new ApiError(
      502,
      "La API no confirmó el proceso ZIP.",
      "INVALID_API_RESPONSE",
    );
  return accepted;
}

export function uploadZip({
  scope,
  file,
  onProgress,
}: {
  scope: IngestionRecoveryScope;
  file: File;
  onProgress?: (progress: {
    loaded: number;
    total: number;
    percent: number;
  }) => void;
}) {
  const controller = new AbortController();
  let xhr: XMLHttpRequest | null = null;
  const abort = () => {
    controller.abort();
    xhr?.abort();
  };
  const unregister = registerPendingApiAbort(abort);
  const promise = (async () => {
    const rejection = validateZipSelection([file]);
    if (rejection) throw new ApiError(400, rejection, "ZIP_SELECTION_INVALID");
    const intent = readZipIntent(scope) ?? {
      ...scope,
      intentId: crypto.randomUUID(),
      uploadId: null,
    };
    saveZipIntent(intent);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    controller.signal.throwIfAborted();
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const response = await apiClientResponse<unknown>(
      `/legal-entities/${encodeURIComponent(scope.legalEntityId)}/ingestions/zip/init`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `zip-init:${intent.intentId}` },
        signal: controller.signal,
        body: JSON.stringify({
          filename: file.name,
          sizeBytes: file.size,
          sha256,
          mimeType: "application/zip",
        }),
      },
    );
    controller.signal.throwIfAborted();
    const init = unwrap<InitializedZip>(response.data);
    if (!init.uploadId)
      throw new ApiError(
        502,
        "La carga no devolvió un identificador.",
        "INVALID_API_RESPONSE",
      );
    intent.uploadId = init.uploadId;
    saveZipIntent(intent);
    // Recover an already uploaded/confirmed object before sending bytes again.
    try {
      return await confirmZipUpload(init.uploadId, controller.signal);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.code !== "UPLOAD_NOT_CONFIRMABLE" ||
        !init.upload
      )
        throw error;
    }
    const grant = init.upload!;
    await new Promise<void>((resolve, reject) => {
      xhr = new XMLHttpRequest();
      const local = grant.url.startsWith("/");
      // The local endpoint is constructed from the durable ID, never a client key.
      const path = `/ingestion-uploads/${encodeURIComponent(init.uploadId)}/zip/content`;
      xhr.open("PUT", local ? apiUrl(path) : grant.url);
      xhr.withCredentials = local;
      xhr.timeout = 120_000;
      for (const [key, value] of Object.entries(grant.headers))
        xhr.setRequestHeader(key, value);
      xhr.upload.addEventListener("progress", (event) =>
        onProgress?.(
          transferProgress(event.loaded, event.total, event.lengthComputable),
        ),
      );
      xhr.addEventListener("load", () => {
        if (
          (xhr!.status >= 200 && xhr!.status < 300) ||
          xhr!.status === 412 ||
          xhr!.status === 409
        ) {
          resolve();
          return;
        }
        let body: unknown = null;
        try {
          body = JSON.parse(xhr!.responseText);
        } catch {
          /* S3 error bodies are never displayed. */
        }
        const error = local
          ? apiErrorFromPayload(xhr!.status, body)
          : new ApiError(
              xhr!.status,
              "No se pudo transferir el ZIP.",
              "ZIP_TRANSFER_FAILED",
            );
        if (local) reportApiUnauthorized(error, path, "PUT");
        reject(error);
      });
      xhr.addEventListener("error", () =>
        reject(
          new ApiError(0, "No se pudo transferir el ZIP.", "NETWORK_ERROR"),
        ),
      );
      xhr.addEventListener("timeout", () =>
        reject(new ApiError(0, "La transferencia tardó demasiado.", "TIMEOUT")),
      );
      xhr.addEventListener("abort", () =>
        reject(new ApiError(0, "Transferencia cancelada.", "ABORTED")),
      );
      if (controller.signal.aborted) {
        reject(new ApiError(0, "Transferencia cancelada.", "ABORTED"));
        return;
      }
      xhr.send(file);
    });
    controller.signal.throwIfAborted();
    return confirmZipUpload(init.uploadId, controller.signal);
  })().finally(unregister);
  return { promise, abort };
}
