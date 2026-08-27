import { ApiError } from "../../lib/api-client";

export const DOMAIN_SEARCH_MAX_LENGTH = 120;
export const COLLECTION_PAGE_MAX = 10_000;

export interface EntitySearchDraft {
  base: string;
  value: string;
}

export function normalizeDomainSearch(value: string | null | undefined) {
  return (value ?? "").slice(0, DOMAIN_SEARCH_MAX_LENGTH);
}

export function resolveEntitySearchDraft(
  draft: EntitySearchDraft,
  routeSearch: string,
) {
  return draft.base === routeSearch ? draft.value : routeSearch;
}

export function normalizeCollectionPage(value: string | null) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 && page <= COLLECTION_PAGE_MAX
    ? page
    : 1;
}

export function isLegalEntityRouteUnavailableError(
  error: unknown,
  legalEntityId: string | undefined,
) {
  if (!legalEntityId || !(error instanceof ApiError)) return false;
  if (error.code === "LEGAL_ENTITY_NOT_FOUND") return true;
  return (
    error.code === "VALIDATION_ERROR" &&
    Object.prototype.hasOwnProperty.call(error.fieldErrors, "legalEntityId")
  );
}

export function entityContextSuffix(page: number, search: string) {
  const query = new URLSearchParams();
  if (page > 1) query.set("entityPage", String(page));
  if (search.trim()) query.set("entitySearch", search.trim());
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export function fiscalEntitySelectorHref(clientBase: string) {
  return `${clientBase}/fiscal-years`;
}

export function legalEntityDetailQuery(
  legalEntityId: string | undefined,
  page: number,
  search: string,
) {
  if (legalEntityId) {
    return {
      legalEntityId,
      legalEntityPage: 1,
      legalEntityLimit: 1,
    };
  }
  return {
    legalEntityPage: page,
    legalEntityLimit: 10,
    legalEntitySearch: normalizeDomainSearch(search) || undefined,
  };
}
