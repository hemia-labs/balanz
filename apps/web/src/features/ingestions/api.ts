import {
  apiClient,
  apiClientResponse,
  type ApiResponse,
} from "@/lib/api-client";
import {
  normalizeIngestionItems,
  normalizeIngestionJob,
  normalizeProcessPage,
  type IngestionItem,
  type IngestionJob,
  type ProcessPage,
} from "./types";

export interface IngestionPollResponse {
  job: IngestionJob | null;
  notModified: boolean;
  etag: string | null;
  retryAfter: string | null;
}

export interface ProcessListQuery {
  page?: number;
  limit?: number;
  status?: string;
  source?: "manual_xml";
  sort?: "createdAt" | "updatedAt" | "status";
  direction?: "asc" | "desc";
}

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const result = query.toString();
  return result ? `?${result}` : "";
}

export async function getIngestionJob(
  ingestionJobId: string,
  options: { etag?: string | null; signal?: AbortSignal } = {},
): Promise<IngestionPollResponse> {
  const headers = new Headers();
  if (options.etag) headers.set("If-None-Match", options.etag);
  const response = await apiClientResponse<unknown>(
    `/ingestions/${encodeURIComponent(ingestionJobId)}`,
    { headers, signal: options.signal },
  );
  return {
    job: response.status === 304 ? null : normalizeIngestionJob(response.data),
    notModified: response.status === 304,
    etag: response.headers.get("etag"),
    retryAfter: response.headers.get("retry-after"),
  };
}

export async function getIngestionItems(
  ingestionJobId: string,
  signal?: AbortSignal,
): Promise<IngestionItem[]> {
  const value = await apiClient<unknown>(
    `/ingestions/${encodeURIComponent(ingestionJobId)}/items?limit=100`,
    { signal },
  );
  return normalizeIngestionItems(value);
}

export async function retryIngestion(
  ingestionJobId: string,
  idempotencyKey: string,
) {
  const value = await apiClient<unknown>(
    `/ingestions/${encodeURIComponent(ingestionJobId)}/retry`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({}),
    },
  );
  return normalizeIngestionJob(value);
}

export async function cancelIngestion(ingestionJobId: string) {
  const value = await apiClient<unknown>(
    `/ingestions/${encodeURIComponent(ingestionJobId)}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return normalizeIngestionJob(value);
}

export async function getProcesses(
  query: ProcessListQuery,
  signal?: AbortSignal,
): Promise<ProcessPage> {
  const value = await apiClient<unknown>(
    `/processes${queryString({
      page: query.page,
      limit: Math.min(query.limit ?? 20, 100),
      status: query.status,
      source: query.source,
      sort: query.sort,
      direction: query.direction,
    })}`,
    { signal },
  );
  return normalizeProcessPage(value);
}

export type { ApiResponse };
