"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "@/lib/api-client";
import { getIngestionItems, getIngestionJob } from "./api";
import { isTerminalIngestionStatus, retryAfterMilliseconds } from "./polling";
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
    if (!enabled || !jobId) {
      setState({ identity: "", job: null, items: [], loading: false, error: null });
      return;
    }
    const identity = `${organizationId}:${jobId}`;
    const requestId = ++requestIdentity.current;
    let etag: string | null = null;
    let currentJob: IngestionJob | null = null;
    let stopped = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let controller: AbortController | null = null;

    const schedule = (delay: number) => {
      if (!stopped)
        timer = globalThis.setTimeout(() => void poll(), Math.max(500, delay));
    };
    const poll = async () => {
      controller = new AbortController();
      try {
        const response = await getIngestionJob(jobId, {
          etag,
          signal: controller.signal,
        });
        if (stopped || requestId !== requestIdentity.current) return;
        if (!response.notModified && response.job) {
          currentJob = response.job;
          etag = response.etag ?? etag;
          setState({
            identity,
            job: currentJob,
            items: [],
            loading: false,
            error: null,
          });
        }
        if (currentJob && isTerminalIngestionStatus(currentJob.status)) {
          const items = await getIngestionItems(jobId, controller.signal);
          if (!stopped && requestId === requestIdentity.current)
            setState({
              identity,
              job: currentJob,
              items,
              loading: false,
              error: null,
            });
          return;
        }
        schedule(retryAfterMilliseconds(response.retryAfter));
      } catch (cause) {
        if (stopped || isAbortError(cause)) return;
        setState((current) => ({
          identity,
          job: current.identity === identity ? current.job : null,
          items: current.identity === identity ? current.items : [],
          loading: false,
          error: cause,
        }));
      }
    };

    setState({ identity, job: null, items: [], loading: true, error: null });
    void poll();
    return () => {
      stopped = true;
      requestIdentity.current += 1;
      if (timer) globalThis.clearTimeout(timer);
      controller?.abort();
    };
  }, [enabled, jobId, organizationId, revision]);

  const identity = jobId ? `${organizationId}:${jobId}` : "";
  const current = state.identity === identity;
  return {
    job: current ? state.job : null,
    items: current ? state.items : [],
    loading: current ? state.loading : Boolean(jobId && enabled),
    error: current ? state.error : null,
    reload,
  };
}
