"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getIngestionItems, getIngestionJob } from "./api";
import { startIngestionJobPolling } from "./ingestion-job-poller";
import type { IngestionItem, IngestionJob } from "./types";

export function useIngestionJob({
  organizationId,
  jobId,
  enabled = true,
}: {
  organizationId: string;
  jobId: string | null;
  enabled?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const requestIdentity = useRef(0);
  const [state, setState] = useState<{
    identity: string;
    job: IngestionJob | null;
    items: IngestionItem[];
    loading: boolean;
    error: unknown;
  }>({ identity: "", job: null, items: [], loading: false, error: null });
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !jobId) return;
    const identity = `${organizationId}:${jobId}`;
    const requestId = ++requestIdentity.current;
    const stop = startIngestionJobPolling({
      getJob: (options) => getIngestionJob(jobId, options),
      getItems: (signal) => getIngestionItems(jobId, signal),
      onChange: (next) => {
        if (requestId === requestIdentity.current)
          setState({ identity, ...next });
      },
    });
    return () => {
      requestIdentity.current += 1;
      stop();
    };
  }, [enabled, jobId, organizationId, revision]);

  const identity = jobId ? `${organizationId}:${jobId}` : "";
  const current = enabled && Boolean(jobId) && state.identity === identity;
  return {
    job: current ? state.job : null,
    items: current ? state.items : [],
    loading: current ? state.loading : Boolean(jobId && enabled),
    error: current ? state.error : null,
    reload,
  };
}
