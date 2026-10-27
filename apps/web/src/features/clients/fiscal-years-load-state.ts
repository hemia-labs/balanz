import type { CollectionPage, FiscalYear, PageMeta } from "./types";

export type FiscalYearsLoadStatus = "idle" | "loading" | "ready" | "error";

export interface FiscalYearsQueryKey {
  organizationId: string;
  clientId: string;
  legalEntityId: string;
  page: number;
  revision: number;
}

export interface FiscalYearsRequest extends FiscalYearsQueryKey {
  requestId: number;
}

export interface FiscalYearsLoadState {
  request: FiscalYearsRequest | null;
  status: FiscalYearsLoadStatus;
  years: FiscalYear[];
  meta: PageMeta | null;
  error: unknown;
}

export const initialFiscalYearsLoadState: FiscalYearsLoadState = {
  request: null,
  status: "idle",
  years: [],
  meta: null,
  error: null,
};

function isSameQuery(request: FiscalYearsRequest, query: FiscalYearsQueryKey) {
  return (
    request.organizationId === query.organizationId &&
    request.clientId === query.clientId &&
    request.legalEntityId === query.legalEntityId &&
    request.page === query.page &&
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
    meta: null,
    error: null,
  };
}

export function resolveFiscalYearsLoad(
  current: FiscalYearsLoadState,
  request: FiscalYearsRequest,
  page: CollectionPage<FiscalYear>,
): FiscalYearsLoadState {
  if (!isSameRequest(current.request, request)) return current;
  return {
    ...current,
    status: "ready",
    years: page.items,
    meta: page.meta,
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
    meta: null,
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
    meta: null,
    error: null,
  };
}
