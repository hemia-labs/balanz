import { apiClient, apiResourceUrl } from "@/lib/api-client";
import {
  normalizeCfdiDetail,
  normalizeCfdiPage,
  type CfdiDetail,
  type CfdiPage,
} from "./types";
import {
  cfdiListQueryString,
  type CfdiListQuery,
} from "./cfdi-list-query";

export type { CfdiListQuery } from "./cfdi-list-query";

export interface CfdiAccessUrl {
  url: string;
  expiresAt: string | null;
}

export async function getCfdis(
  legalEntityId: string,
  query: CfdiListQuery,
  signal?: AbortSignal,
): Promise<CfdiPage> {
  const value = await apiClient<unknown>(
    `/legal-entities/${encodeURIComponent(legalEntityId)}/cfdis${cfdiListQueryString(query)}`,
    { signal },
  );
  return normalizeCfdiPage(value);
}

export async function getCfdi(
  cfdiId: string,
  signal?: AbortSignal,
): Promise<CfdiDetail> {
  const value = await apiClient<unknown>(
    `/cfdis/${encodeURIComponent(cfdiId)}`,
    { signal },
  );
  return normalizeCfdiDetail(value);
}

export async function createCfdiAccessUrl(
  cfdiId: string,
): Promise<CfdiAccessUrl> {
  const response = await apiClient<unknown>(
    `/cfdis/${encodeURIComponent(cfdiId)}/access-url`,
    { method: "POST", body: JSON.stringify({}) },
  );
  const root =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : {};
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;
  return {
    url:
      typeof data.url === "string"
        ? apiResourceUrl(data.url)
        : typeof data.accessUrl === "string"
          ? apiResourceUrl(data.accessUrl)
          : "",
    expiresAt:
      typeof data.expiresAt === "string"
        ? data.expiresAt
        : typeof data.expires_at === "string"
          ? data.expires_at
          : null,
  };
}
