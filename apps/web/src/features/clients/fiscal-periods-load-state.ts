import type { PeriodsResponse } from "./types";

export interface FiscalPeriodsQueryKey {
  organizationId: string;
  clientId: string;
  legalEntityId: string;
  year: string;
}

export interface FiscalPeriodsRequest extends FiscalPeriodsQueryKey {
  requestId: number;
}

export interface FiscalPeriodsLoadState {
  request: FiscalPeriodsRequest | null;
  status: "idle" | "loading" | "ready" | "error";
  data: PeriodsResponse | null;
  error: unknown;
}

export const initialFiscalPeriodsLoadState: FiscalPeriodsLoadState = {
  request: null,
  status: "idle",
  data: null,
  error: null,
};

function isSameQuery(
  request: FiscalPeriodsRequest,
  query: FiscalPeriodsQueryKey,
) {
  return (
    request.organizationId === query.organizationId &&
    request.clientId === query.clientId &&
    request.legalEntityId === query.legalEntityId &&
    request.year === query.year
  );
}

function isSameRequest(
  current: FiscalPeriodsRequest | null,
  request: FiscalPeriodsRequest,
) {
  return Boolean(
    current &&
      current.requestId === request.requestId &&
      isSameQuery(current, request),
  );
}

export function startFiscalPeriodsLoad(
  request: FiscalPeriodsRequest,
): FiscalPeriodsLoadState {
  return {
    request,
    status: "loading",
    data: null,
    error: null,
  };
}

export function resolveFiscalPeriodsLoad(
  current: FiscalPeriodsLoadState,
  request: FiscalPeriodsRequest,
  data: PeriodsResponse,
): FiscalPeriodsLoadState {
  if (!isSameRequest(current.request, request)) return current;
  return { ...current, status: "ready", data, error: null };
}

export function rejectFiscalPeriodsLoad(
  current: FiscalPeriodsLoadState,
  request: FiscalPeriodsRequest,
  error: unknown,
): FiscalPeriodsLoadState {
  if (!isSameRequest(current.request, request)) return current;
  return { ...current, status: "error", data: null, error };
}

export function selectFiscalPeriodsLoad(
  current: FiscalPeriodsLoadState,
  query: FiscalPeriodsQueryKey,
): FiscalPeriodsLoadState {
  if (current.request && isSameQuery(current.request, query)) return current;
  return {
    request: null,
    status: "loading",
    data: null,
    error: null,
  };
}
