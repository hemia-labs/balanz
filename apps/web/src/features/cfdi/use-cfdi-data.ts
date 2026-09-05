"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "@/lib/api-client";
import { getCfdi, getCfdis, type CfdiListQuery } from "./api";
import type { CfdiDetail, CfdiPage } from "./types";

export function useCfdiPage({
  organizationId,
  legalEntityId,
  query,
}: {
  organizationId: string;
  legalEntityId: string;
  query: CfdiListQuery;
}) {
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);
  const identity = `${organizationId}:${legalEntityId}:${JSON.stringify(query)}:${revision}`;
  const [state, setState] = useState<{
    identity: string;
    data: CfdiPage | null;
    loading: boolean;
    error: unknown;
  }>({ identity: "", data: null, loading: true, error: null });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setState({ identity, data: null, loading: true, error: null });
      void getCfdis(legalEntityId, query, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted && currentRequest === requestId.current)
            setState({ identity, data, loading: false, error: null });
        })
        .catch((cause) => {
          if (
            !controller.signal.aborted &&
            !isAbortError(cause) &&
            currentRequest === requestId.current
          )
            setState({ identity, data: null, loading: false, error: cause });
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [identity, legalEntityId, query]);
  const current = state.identity === identity;
  return {
    data: current ? state.data : null,
    loading: !current || state.loading,
    error: current ? state.error : null,
    reload,
  };
}

export function useCfdiDetail({
  organizationId,
  cfdiId,
}: {
  organizationId: string;
  cfdiId: string;
}) {
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);
  const identity = `${organizationId}:${cfdiId}:${revision}`;
  const [state, setState] = useState<{
    identity: string;
    data: CfdiDetail | null;
    loading: boolean;
    error: unknown;
  }>({ identity: "", data: null, loading: true, error: null });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setState({ identity, data: null, loading: true, error: null });
      void getCfdi(cfdiId, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted && currentRequest === requestId.current)
            setState({ identity, data, loading: false, error: null });
        })
        .catch((cause) => {
          if (
            !controller.signal.aborted &&
            !isAbortError(cause) &&
            currentRequest === requestId.current
          )
            setState({ identity, data: null, loading: false, error: cause });
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [cfdiId, identity]);
  const current = state.identity === identity;
  return {
    data: current ? state.data : null,
    loading: !current || state.loading,
    error: current ? state.error : null,
    reload,
  };
}
