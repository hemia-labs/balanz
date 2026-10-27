"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccountingContext } from "@/components/accounting-context";
import { isAbortError } from "@/lib/api-client";
import { getClient } from "./api";
import type { ClientDetail } from "./types";
import { DOMAIN_PAGE_LIMIT } from "./live-query-hooks";

export function useClientDetail(
  clientId: string,
  {
    legalEntityId,
    legalEntityPage = 1,
    legalEntityLimit = DOMAIN_PAGE_LIMIT,
    legalEntitySearch = "",
  }: {
    legalEntityId?: string;
    legalEntityPage?: number;
    legalEntityLimit?: number;
    legalEntitySearch?: string;
  } = {},
) {
  const { organization, registerClientName } = useAccountingContext();
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);
  const [state, setState] = useState<{
    organizationId: string | null;
    clientId: string | null;
    requestId: number;
    status: "loading" | "ready" | "error";
    detail: ClientDetail | null;
    error: unknown;
  }>({
    organizationId: null,
    clientId: null,
    requestId: 0,
    status: "loading",
    detail: null,
    error: null,
  });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const requestId = ++requestSequence.current;
    const organizationId = organization.id;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setState({
        organizationId,
        clientId,
        requestId,
        status: "loading",
        detail: null,
        error: null,
      });
      void getClient(
        clientId,
        {
          legalEntityId,
          legalEntityPage,
          legalEntityLimit,
          legalEntitySearch: legalEntitySearch || undefined,
        },
        controller.signal,
      )
        .then((nextDetail) => {
          if (controller.signal.aborted) return;
          setState((current) =>
            current.organizationId === organizationId &&
            current.clientId === clientId &&
            current.requestId === requestId
              ? {
                  organizationId,
                  clientId,
                  requestId,
                  status: "ready",
                  detail: nextDetail,
                  error: null,
                }
              : current,
          );
          registerClientName(nextDetail.account.id, nextDetail.account.name);
        })
        .catch((cause) => {
          if (controller.signal.aborted || isAbortError(cause)) return;
          setState((current) =>
            current.organizationId === organizationId &&
            current.clientId === clientId &&
            current.requestId === requestId
              ? {
                  organizationId,
                  clientId,
                  requestId,
                  status: "error",
                  detail: null,
                  error: cause,
                }
              : current,
          );
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [
    clientId,
    legalEntityId,
    legalEntityLimit,
    legalEntityPage,
    legalEntitySearch,
    organization.id,
    registerClientName,
    revision,
  ]);
  const belongsToContext =
    state.organizationId === organization.id && state.clientId === clientId;
  return {
    detail: belongsToContext && state.status === "ready" ? state.detail : null,
    error: belongsToContext && state.status === "error" ? state.error : null,
    loading: !belongsToContext || state.status === "loading",
    reload,
  };
}
