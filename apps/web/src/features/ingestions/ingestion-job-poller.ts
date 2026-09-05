import { ApiError, isAbortError } from "../../lib/api-client";
import { isTerminalIngestionStatus, retryAfterMilliseconds } from "./polling";
import type { IngestionItem, IngestionJob } from "./types";

export interface IngestionPollingState {
  job: IngestionJob | null;
  items: IngestionItem[];
  loading: boolean;
  error: unknown;
}

interface PollResponse {
  job: IngestionJob | null;
  notModified: boolean;
  etag: string | null;
  retryAfter: string | null;
}

function isTransientFailure(error: unknown) {
  return (
    error instanceof ApiError &&
    ((error.status === 0 &&
      (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT")) ||
      error.status === 408 ||
      error.status === 429 ||
      (error.status >= 500 && error.status <= 599))
  );
}

/** One cancellable polling session, including recovery of terminal items. */
export function startIngestionJobPolling({
  getJob,
  getItems,
  onChange,
}: {
  getJob: (options: {
    etag: string | null;
    signal: AbortSignal;
  }) => Promise<PollResponse>;
  getItems: (signal: AbortSignal) => Promise<IngestionItem[]>;
  onChange: (state: IngestionPollingState) => void;
}) {
  let etag: string | null = null;
  let state: IngestionPollingState = {
    job: null,
    items: [],
    loading: true,
    error: null,
  };
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let controller: AbortController | null = null;

  const publish = (next: IngestionPollingState) => {
    if (stopped) return;
    state = next;
    onChange(next);
  };
  const schedule = (delay: number) => {
    if (!stopped)
      timer = globalThis.setTimeout(() => void poll(), Math.max(500, delay));
  };
  const poll = async () => {
    controller = new AbortController();
    try {
      const response = await getJob({ etag, signal: controller.signal });
      if (stopped) return;
      if (!response.notModified && response.job) {
        etag = response.etag ?? etag;
        publish({ job: response.job, items: [], loading: false, error: null });
      }
      if (state.job && isTerminalIngestionStatus(state.job.status)) {
        const items = await getItems(controller.signal);
        publish({ ...state, items, loading: false, error: null });
        return;
      }
      // A 304 after reconnection is also a successful poll: clear its old error.
      failures = 0;
      publish({ ...state, loading: false, error: null });
      schedule(retryAfterMilliseconds(response.retryAfter));
    } catch (error) {
      if (stopped || isAbortError(error)) return;
      const denied =
        error instanceof ApiError && [401, 403, 404].includes(error.status);
      publish({
        ...state,
        ...(denied ? { job: null, items: [] } : {}),
        loading: false,
        error,
      });
      if (isTransientFailure(error)) {
        failures = Math.min(failures + 1, 5);
        schedule(Math.min(30_000, 2_000 * 2 ** (failures - 1)));
      }
    }
  };

  publish(state);
  void poll();
  return () => {
    stopped = true;
    if (timer !== null) globalThis.clearTimeout(timer);
    controller?.abort();
  };
}
