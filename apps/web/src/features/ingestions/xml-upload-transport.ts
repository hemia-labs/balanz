import {
  ApiError,
  apiErrorFromPayload,
  apiUrl,
  registerPendingApiAbort,
  reportApiUnauthorized,
} from "@/lib/api-client";
import {
  normalizeXmlUploadAccepted,
  type XmlUploadAccepted,
} from "./types";
import { transferProgress } from "./upload-validation";

export interface XmlUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface XmlUploadHandle {
  promise: Promise<XmlUploadAccepted>;
  abort: () => void;
}

function responsePayload(xhr: XMLHttpRequest) {
  if (!xhr.responseText) return null;
  try {
    return JSON.parse(xhr.responseText) as unknown;
  } catch {
    return null;
  }
}

export function uploadXml({
  legalEntityId,
  file,
  idempotencyKey,
  onProgress,
}: {
  legalEntityId: string;
  file: File;
  idempotencyKey: string;
  onProgress?: (progress: XmlUploadProgress) => void;
}): XmlUploadHandle {
  const path = `/legal-entities/${encodeURIComponent(legalEntityId)}/ingestions/xml`;
  const xhr = new XMLHttpRequest();
  let userAborted = false;
  let settled = false;
  let unregister: () => void = () => undefined;
  const promise = new Promise<XmlUploadAccepted>((resolve, reject) => {
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      unregister();
      callback();
    };
    xhr.open("POST", apiUrl(path));
    xhr.withCredentials = true;
    xhr.timeout = 120_000;
    xhr.setRequestHeader("Idempotency-Key", idempotencyKey);
    xhr.upload.addEventListener("progress", (event) => {
      onProgress?.(
        transferProgress(event.loaded, event.total, event.lengthComputable),
      );
    });
    xhr.addEventListener("load", () => {
      const payload = responsePayload(xhr);
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = apiErrorFromPayload(xhr.status, payload);
        reportApiUnauthorized(error, path, "POST");
        finish(() => reject(error));
        return;
      }
      if (xhr.status !== 202) {
        finish(() =>
          reject(
            new ApiError(
              xhr.status,
              "La API no confirmó la creación asíncrona con 202.",
              "UNEXPECTED_UPLOAD_STATUS",
            ),
          ),
        );
        return;
      }
      const accepted = normalizeXmlUploadAccepted(payload);
      if (
        !accepted.uploadId ||
        !accepted.objectId ||
        !accepted.jobId ||
        !accepted.correlationId
      ) {
        finish(() =>
          reject(
            new ApiError(
              502,
              "La respuesta de carga no contiene sus identificadores.",
              "INVALID_API_RESPONSE",
            ),
          ),
        );
        return;
      }
      finish(() => resolve(accepted));
    });
    xhr.addEventListener("error", () =>
      finish(() =>
        reject(
          new ApiError(
            0,
            "No se pudo transferir el archivo.",
            "NETWORK_ERROR",
          ),
        ),
      ),
    );
    xhr.addEventListener("timeout", () =>
      finish(() =>
        reject(
          new ApiError(
            0,
            "La transferencia tardó demasiado.",
            "TIMEOUT",
          ),
        ),
      ),
    );
    xhr.addEventListener("abort", () =>
      finish(() =>
        reject(
          new ApiError(
            0,
            userAborted ? "La carga fue cancelada." : "La carga se interrumpió.",
            "ABORTED",
          ),
        ),
      ),
    );
    unregister = registerPendingApiAbort(() => xhr.abort());
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
  return {
    promise,
    abort: () => {
      userAborted = true;
      xhr.abort();
    },
  };
}
