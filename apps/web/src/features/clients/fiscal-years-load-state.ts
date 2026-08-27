import type { FiscalYear } from "./types";

export type FiscalYearsLoadStatus = "idle" | "loading" | "ready" | "error";

export interface FiscalYearsQueryKey {
  organizationId: string;
  clientId: string;
  legalEntityId: string;
  revision: number;
}

export interface FiscalYearsRequest extends FiscalYearsQueryKey {
  requestId: number;
}

export interface FiscalYearsLoadState {
  request: FiscalYearsRequest | null;
  status: FiscalYearsLoadStatus;
  years: FiscalYear[];
  error: unknown;
}

export const initialFiscalYearsLoadState: FiscalYearsLoadState = {
  request: null,
  status: "idle",
  years: [],
  error: null,
};

function isSameQuery(
  request: FiscalYearsRequest,
  query: FiscalYearsQueryKey,
) {
  return (
    request.organizationId === query.organizationId &&
    request.clientId === query.clientId &&
    request.legalEntityId === query.legalEntityId &&
    request.revision === query.revision
  );
}

function isSameRequest(
  current: FiscalYearsRequest | null,
  request: FiscalYearsRequest,
) {
  return Boolean(
    current &&
      current.requestId === request.requestId &&
      isSameQuery(current, request),
  );
}

export function startFiscalYearsLoad(
  request: FiscalYearsRequest,
): FiscalYearsLoadState {
  return {
    request,
    status: "loading",
    years: [],
    error: null,
  };
}

export function resolveFiscalYearsLoad(
  current: FiscalYearsLoadState,
  request: FiscalYearsRequest,
  years: FiscalYear[],
): FiscalYearsLoadState {
  if (!isSameRequest(current.request, request)) return current;
  return {
    ...current,
    status: "ready",
    years,
    error: null,
  };
}

export function rejectFiscalYearsLoad(
  current: FiscalYearsLoadState,
  request: FiscalYearsRequest,
  error: unknown,
): FiscalYearsLoadState {
  if (!isSameRequest(current.request, request)) return current;
  return {
    ...current,
    status: "error",
    years: [],
    error,
  };
}

export function selectFiscalYearsLoad(
  current: FiscalYearsLoadState,
  query: FiscalYearsQueryKey,
): FiscalYearsLoadState {
  if (current.request && isSameQuery(current.request, query)) return current;
  return {
    request: null,
    status: "loading",
    years: [],
    error: null,
  };
}
