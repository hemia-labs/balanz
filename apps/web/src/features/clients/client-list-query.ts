import {
  normalizeCollectionPage,
  normalizeDomainSearch,
} from "./entity-context";
import type { ClientPage } from "./types";

export interface ClientSearchDraft {
  base: string;
  value: string;
}

export interface ClearedClientListState {
  query: string;
  searchDraft: ClientSearchDraft;
}

export interface ClientListRequestIdentity {
  organizationId: string;
  queryKey: string;
  requestId: number;
}

export interface ClientListLoadState {
  organizationId: string | null;
  queryKey: string | null;
  requestId: number;
  status: "loading" | "ready" | "error";
  page: ClientPage | null;
  error: unknown;
}

export const initialClientListLoadState: ClientListLoadState = {
  organizationId: null,
  queryKey: null,
  requestId: 0,
  status: "loading",
  page: null,
  error: null,
};

export function normalizeClientListSearch(value: string | null | undefined) {
  return normalizeDomainSearch((value ?? "").trim());
}

export function resolveClientSearchDraft(
  draft: ClientSearchDraft,
  routeSearch: string,
) {
  return draft.base === routeSearch ? draft.value : routeSearch;
}

export function editClientSearchDraft(routeSearch: string, value: string) {
  return {
    base: routeSearch,
    value: normalizeDomainSearch(value),
  } satisfies ClientSearchDraft;
}

/**
 * Applies a debounced search to the URL. Pagination is reset only when the
 * effective search actually changes; URL rerenders and page navigation are
 * therefore no-ops here.
 */
export function clientSearchQuery(
  currentQuery: string,
  requestedSearch: string,
) {
  const next = new URLSearchParams(currentQuery);
  const routeSearch = normalizeClientListSearch(next.get("search"));
  const search = normalizeClientListSearch(requestedSearch);

  if (search === routeSearch) return null;

  if (search) next.set("search", search);
  else next.delete("search");
  next.set("page", "1");
  return next.toString();
}

export function clientListQueryValue(
  currentQuery: string,
  key: "page" | "status" | "sort" | "direction",
  value?: string,
) {
  const next = new URLSearchParams(currentQuery);
  const previous = next.get(key) ?? "";
  const requested = value ?? "";
  if (previous === requested) return null;

  if (requested) next.set(key, requested);
  else next.delete(key);

  if (key === "page") {
    next.set("page", String(normalizeCollectionPage(requested)));
  } else {
    next.set("page", "1");
  }
  return next.toString();
}

export function clearClientListState(
  currentRouteSearch: string,
): ClearedClientListState {
  return {
    query: "",
    // Keep the current route as the draft base until navigation completes.
    // This prevents the old URL search from briefly reappearing in the input.
    searchDraft: { base: currentRouteSearch, value: "" },
  };
}

export function startClientListLoad(
  request: ClientListRequestIdentity,
): ClientListLoadState {
  return {
    ...request,
    status: "loading",
    page: null,
    error: null,
  };
}

function isCurrentClientListRequest(
  state: ClientListLoadState,
  request: ClientListRequestIdentity,
) {
  return (
    state.organizationId === request.organizationId &&
    state.queryKey === request.queryKey &&
    state.requestId === request.requestId
  );
}

export function resolveClientListLoad(
  state: ClientListLoadState,
  request: ClientListRequestIdentity,
  page: ClientPage,
): ClientListLoadState {
  return isCurrentClientListRequest(state, request)
    ? { ...state, status: "ready", page, error: null }
    : state;
}

export function rejectClientListLoad(
  state: ClientListLoadState,
  request: ClientListRequestIdentity,
  error: unknown,
): ClientListLoadState {
  return isCurrentClientListRequest(state, request)
    ? { ...state, status: "error", page: null, error }
    : state;
}

export function selectClientListLoad(
  state: ClientListLoadState,
  organizationId: string,
  queryKey: string,
) {
  const belongsToContext =
    state.organizationId === organizationId && state.queryKey === queryKey;
  return {
    page: belongsToContext && state.status === "ready" ? state.page : null,
    error: belongsToContext && state.status === "error" ? state.error : null,
    loading: !belongsToContext || state.status === "loading",
  };
}
