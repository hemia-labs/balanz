import { ApiError } from "../../lib/api-client";

/** Transfer the File handle, not its bytes; termination also cancels preparation. */
export function hashZipFile(
  file: File,
  signal: AbortSignal,
  createWorker: () => Worker,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ApiError(0, "Preparación cancelada.", "ABORTED"));
      return;
    }
    let worker: Worker;
    try {
      worker = createWorker();
    } catch {
      reject(
        new ApiError(
          0,
          "No se pudo preparar el ZIP. Intenta de nuevo.",
          "ZIP_HASH_FAILED",
        ),
      );
      return;
    }
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const fail = () => {
      cleanup();
      reject(
        new ApiError(
          0,
          "No se pudo preparar el ZIP. Intenta de nuevo.",
          "ZIP_HASH_FAILED",
        ),
      );
    };
    const abort = () => {
      cleanup();
      reject(new ApiError(0, "Preparación cancelada.", "ABORTED"));
    };
    const timeout = setTimeout(fail, 120_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ sha256?: string }>) => {
      if (!/^[0-9a-f]{64}$/.test(event.data?.sha256 ?? "")) {
        fail();
        return;
      }
      cleanup();
      resolve(event.data.sha256!);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail();
    };
    worker.onmessageerror = fail;
    try {
      worker.postMessage(file);
    } catch {
      fail();
    }
  });
}
