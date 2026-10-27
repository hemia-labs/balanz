import { ApiError } from "../../lib/api-client";
import type { XmlUploadAccepted } from "./types";

interface UploadHandle {
  promise: Promise<XmlUploadAccepted>;
  abort: () => void;
}

/** Retains the same key across uncertain transfers of the selected file. */
export function createXmlUploadSession() {
  let key: string | null = null;

  return {
    reset() {
      key = null;
    },
    start(transfer: (idempotencyKey: string) => UploadHandle): UploadHandle {
      key ??= crypto.randomUUID();
      const requestKey = key;
      let aborted = false;
      let current = transfer(requestKey);
      const promise = current.promise.catch((error: unknown) => {
        if (
          !aborted &&
          key === requestKey &&
          error instanceof ApiError &&
          error.status === 409 &&
          error.code === "INGESTION_UPLOAD_FAILED"
        ) {
          // One automatic recovery per submit, only after a confirmed terminal
          // failure. Abort, timeout and network errors keep their recovery key.
          key = crypto.randomUUID();
          current = transfer(key);
          return current.promise;
        }
        throw error;
      });
      return {
        promise,
        abort() {
          aborted = true;
          current.abort();
        },
      };
    },
  };
}
