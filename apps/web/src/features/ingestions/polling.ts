import type { IngestionJobStatus } from "./types";

const TERMINAL_STATUSES = new Set<IngestionJobStatus>([
  "completed",
  "completed_with_issues",
  "failed_final",
  "cancelled",
]);

export function isTerminalIngestionStatus(status: string) {
  return TERMINAL_STATUSES.has(status as IngestionJobStatus);
}

export function retryAfterMilliseconds(
  value: string | null,
  now = Date.now(),
  fallback = 2_000,
) {
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.max(500, Math.min(30_000, seconds * 1_000));
  const target = Date.parse(value);
  if (!Number.isFinite(target)) return fallback;
  return Math.max(500, Math.min(30_000, target - now));
}

export function ingestionProgress(status: string, stage: string | null) {
  if (status === "completed" || status === "completed_with_issues") return 100;
  if (status === "cancelled" || status === "failed_final") return 100;
  if (status === "awaiting_upload") return 5;
  if (status === "queued" || status === "failed_retryable") return 20;
  const stages: Record<string, number> = {
    scanning: 35,
    extracting: 50,
    parsing: 65,
    persisting: 85,
  };
  return stage ? (stages[stage] ?? 30) : 30;
}
