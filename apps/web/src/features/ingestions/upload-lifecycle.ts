export interface AbortableUpload {
  abort: () => void;
}

/**
 * Keeps an upload tied to the UI scope that started it. Invalidating the
 * lifecycle aborts the transport and makes already-queued promise callbacks
 * stale, so they cannot publish results after a tenant or route change.
 */
export function createUploadLifecycle() {
  let version = 0;
  let current: AbortableUpload | null = null;

  return {
    begin(upload: AbortableUpload) {
      current?.abort();
      version += 1;
      current = upload;
      return version;
    },
    isCurrent(candidate: number) {
      return candidate === version;
    },
    release(candidate: number) {
      if (candidate === version) current = null;
    },
    abortCurrent() {
      current?.abort();
    },
    invalidate() {
      version += 1;
      const upload = current;
      current = null;
      upload?.abort();
    },
  };
}
