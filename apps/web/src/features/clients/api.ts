import { apiClient } from "@/lib/api-client";
import { normalizeDomainSearch } from "./entity-context";
import type {
  AccountAssignment,
  AssignmentResponsibility,
  ClientAccount,
  ClientDetail,
  ClientPage,
  CollectionPage,
  CreatedAssignment,
  CreatedClientAggregate,
  FiscalYear,
  LegalEntity,
  MemberCandidate,
  PeriodsResponse,
} from "./types";

export interface ClientListQuery {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
  sort?: "name" | "status" | "updatedAt";
  direction?: "asc" | "desc";
}

export interface CollectionQuery {
  search?: string;
  page?: number;
  limit?: number;
}

export interface ClientDetailQuery {
  includeArchived?: boolean;
  legalEntityId?: string;
  legalEntitySearch?: string;
  legalEntityPage?: number;
  legalEntityLimit?: number;
}

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const result = query.toString();
  return result ? `?${result}` : "";
}

export function getClients(query: ClientListQuery, signal?: AbortSignal) {
  return apiClient<ClientPage>(`/client-accounts${queryString({ ...query })}`, {
    signal,
  });
}

export function getClient(
  clientAccountId: string,
  query: ClientDetailQuery = {},
  signal?: AbortSignal,
) {
  return apiClient<ClientDetail>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}${queryString({
      includeArchived:
        query.includeArchived === undefined
          ? undefined
          : String(query.includeArchived),
      legalEntityId: query.legalEntityId,
      legalEntitySearch:
        normalizeDomainSearch(query.legalEntitySearch) || undefined,
      legalEntityPage: query.legalEntityPage,
      legalEntityLimit: query.legalEntityLimit,
    })}`,
    { signal },
  );
}

export function getPrimaryCandidates(
  query: CollectionQuery = {},
  signal?: AbortSignal,
) {
  return apiClient<CollectionPage<MemberCandidate>>(
    `/client-accounts/available-primary-members${queryString({
      ...query,
      search: normalizeDomainSearch(query.search) || undefined,
    })}`,
    { signal },
  );
}

export function createClient(
  input: {
    accountName: string;
    legalEntity: { legalName: string; rfc: string };
    primaryMembershipId: string;
    fiscalYear: number;
  },
  signal?: AbortSignal,
) {
  return apiClient<CreatedClientAggregate>("/client-accounts", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export function updateClient(
  clientAccountId: string,
  input: { name?: string; code?: string | null; expectedVersion: number },
) {
  return apiClient<ClientAccount>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function archiveClient(clientAccountId: string) {
  return apiClient<void>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}`,
    { method: "DELETE" },
  );
}

export function createLegalEntity(
  clientAccountId: string,
  input: { rfc: string; legalName: string },
) {
  return apiClient<LegalEntity>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}/legal-entities`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function updateLegalEntity(
  legalEntityId: string,
  input: { rfc?: string; legalName?: string; expectedVersion: number },
) {
  return apiClient<LegalEntity>(
    `/legal-entities/${encodeURIComponent(legalEntityId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export function archiveLegalEntity(legalEntityId: string) {
  return apiClient<void>(
    `/legal-entities/${encodeURIComponent(legalEntityId)}`,
    { method: "DELETE" },
  );
}

export function getAvailableMembers(
  clientAccountId: string,
  query: CollectionQuery = {},
  signal?: AbortSignal,
) {
  return apiClient<CollectionPage<MemberCandidate>>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}/available-members${queryString(
      {
        ...query,
        search: normalizeDomainSearch(query.search) || undefined,
      },
    )}`,
    { signal },
  );
}

export function getLegalEntities(
  clientAccountId: string,
  query: CollectionQuery & { includeArchived?: boolean } = {},
  signal?: AbortSignal,
) {
  return apiClient<CollectionPage<LegalEntity>>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}/legal-entities${queryString(
      {
        ...query,
        search: normalizeDomainSearch(query.search) || undefined,
        includeArchived:
          query.includeArchived === undefined
            ? undefined
            : String(query.includeArchived),
      },
    )}`,
    { signal },
  );
}

export function getAssignments(
  clientAccountId: string,
  query: CollectionQuery = {},
  signal?: AbortSignal,
) {
  return apiClient<CollectionPage<AccountAssignment>>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}/assignments${queryString(
      {
        ...query,
        search: normalizeDomainSearch(query.search) || undefined,
      },
    )}`,
    { signal },
  );
}

export function createAssignment(
  clientAccountId: string,
  input: { membershipId: string; responsibility: AssignmentResponsibility },
) {
  return apiClient<CreatedAssignment>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}/assignments`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function revokeAssignment(
  clientAccountId: string,
  assignmentId: string,
) {
  return apiClient<void>(
    `/client-accounts/${encodeURIComponent(clientAccountId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: "DELETE" },
  );
}

export function getFiscalYears(legalEntityId: string, signal?: AbortSignal) {
  return apiClient<FiscalYear[]>(
    `/legal-entities/${encodeURIComponent(legalEntityId)}/fiscal-years`,
    { signal },
  );
}

export function createFiscalYear(legalEntityId: string, year: number) {
  return apiClient<FiscalYear & { periodIds: string[] }>(
    `/legal-entities/${encodeURIComponent(legalEntityId)}/fiscal-years`,
    { method: "POST", body: JSON.stringify({ year }) },
  );
}

export function getPeriods(fiscalYearId: string, signal?: AbortSignal) {
  return apiClient<PeriodsResponse>(
    `/fiscal-years/${encodeURIComponent(fiscalYearId)}/periods`,
    { signal },
  );
}
