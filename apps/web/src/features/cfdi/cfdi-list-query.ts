import type { CfdiType } from "./types";

export interface CfdiListQuery {
  page?: number;
  limit?: number;
  documentType?: CfdiType;
  uuid?: string;
  issuedFrom?: string;
  issuedTo?: string;
  counterpartyRfc?: string;
  sort?: "issuedAt" | "total" | "createdAt";
  direction?: "asc" | "desc";
}

/** Serializes only the allowlisted query fields accepted by CfdiListQueryDto. */
export function cfdiListQueryString(query: CfdiListQuery) {
  const values: Record<string, string | number | undefined> = {
    page: query.page,
    limit: Math.min(query.limit ?? 20, 100),
    documentType: query.documentType,
    uuid: query.uuid?.trim() || undefined,
    issuedFrom: query.issuedFrom,
    issuedTo: query.issuedTo,
    counterpartyRfc: query.counterpartyRfc?.trim().toUpperCase() || undefined,
    sort: query.sort,
    direction: query.direction,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
