import type { IngestionJobStatus, XmlUploadAccepted } from "./types";

const RECOVERY_KEY = "balanz:xml-ingestion:v1";
export const INGESTION_RECOVERY_EVENT = "balanz:xml-ingestion-recovery";

export interface IngestionRecoveryScope {
  organizationId: string;
  clientAccountId: string;
  legalEntityId: string;
}

export interface IngestionRecovery extends IngestionRecoveryScope {
  version: 1;
  uploadId: string;
  objectId: string;
  jobId: string;
  status: IngestionJobStatus;
  correlationId: string;
  savedAt: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function notify() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(INGESTION_RECOVERY_EVENT));
}

function isRecovery(value: unknown): value is IngestionRecovery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<IngestionRecovery>;
  return (
    entry.version === 1 &&
    typeof entry.organizationId === "string" &&
    typeof entry.clientAccountId === "string" &&
    typeof entry.legalEntityId === "string" &&
    typeof entry.uploadId === "string" &&
    typeof entry.objectId === "string" &&
    typeof entry.jobId === "string" &&
    typeof entry.status === "string" &&
    typeof entry.correlationId === "string" &&
    typeof entry.savedAt === "string"
  );
}

export function saveIngestionRecovery(
  scope: IngestionRecoveryScope,
  accepted: XmlUploadAccepted,
  storage = browserStorage(),
) {
  if (!storage) return;
  const value: IngestionRecovery = {
    version: 1,
    ...scope,
    uploadId: accepted.uploadId,
    objectId: accepted.objectId,
    jobId: accepted.jobId,
    status: accepted.status,
    correlationId: accepted.correlationId,
    savedAt: new Date().toISOString(),
  };
  storage.setItem(RECOVERY_KEY, JSON.stringify(value));
  notify();
}

export function readIngestionRecovery(
  scope: IngestionRecoveryScope,
  storage = browserStorage(),
) {
  if (!storage) return null;
  const serialized = storage.getItem(RECOVERY_KEY);
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecovery(value)) throw new Error("invalid recovery");
    const matches =
      value.organizationId === scope.organizationId &&
      value.clientAccountId === scope.clientAccountId &&
      value.legalEntityId === scope.legalEntityId;
    if (!matches) {
      storage.removeItem(RECOVERY_KEY);
      return null;
    }
    return value;
  } catch {
    storage.removeItem(RECOVERY_KEY);
    return null;
  }
}

export function clearIngestionRecovery(storage = browserStorage()) {
  if (!storage) return;
  storage.removeItem(RECOVERY_KEY);
  notify();
}
