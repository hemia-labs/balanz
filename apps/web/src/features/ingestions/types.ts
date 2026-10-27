import type { CollectionPage, PageMeta } from "../clients/types";

export type IngestionJobStatus =
  | "awaiting_upload"
  | "queued"
  | "processing"
  | "completed"
  | "completed_with_issues"
  | "failed_retryable"
  | "failed_final"
  | "cancel_requested"
  | "cancelled";

export type IngestionItemResult =
  | "incorporated"
  | "duplicate"
  | "foreign"
  | "invalid"
  | "unsupported"
  | "internal_error";

export interface XmlUploadAccepted {
  uploadId: string;
  objectId: string;
  jobId: string;
  status: IngestionJobStatus;
  links: {
    ingestion?: string;
    items?: string;
  };
  correlationId: string;
}

export interface IngestionJob {
  id: string;
  uploadId: string | null;
  objectId: string | null;
  legalEntityId: string | null;
  clientAccountId: string | null;
  sourceType: string;
  status: IngestionJobStatus;
  stage: string | null;
  progress: number | null;
  attemptCount: number;
  automaticRetryCount: number;
  nextAttemptAt: string | null;
  counters: {
    total: number;
    pending: number;
    processing: number;
    incorporated: number;
    duplicate: number;
    foreign: number;
    invalid: number;
    unsupported: number;
    internalError: number;
  };
  cancelRequestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastErrorCode: string | null;
  correlationId: string | null;
}

export interface IngestionItem {
  id: string;
  objectId: string | null;
  cfdiId: string | null;
  ordinal: number;
  filename: string | null;
  technicalStatus: string;
  result: IngestionItemResult | null;
  errorCode: string | null;
  errorDetail: string | null;
  attemptCount: number;
  parserVersion: string | null;
  schemaVersion: string | null;
  parsedCfdiVersion: string | null;
  documentType: string | null;
  observedAt: string | null;
  processedAt: string | null;
  updatedAt: string | null;
  version: number;
}

export interface ProcessListItem extends IngestionJob {
  requestedBy: string | null;
  itemCount: number;
  terminalItemCount: number;
  results: Partial<Record<IngestionItemResult, number>>;
}

export type ProcessPage = CollectionPage<ProcessListItem>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unwrapped(value: unknown) {
  const root = record(value);
  return root.data && typeof root.data === "object" ? record(root.data) : root;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function finiteInteger(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;
}

function boundedProgress(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function normalizeStatus(value: unknown): IngestionJobStatus {
  const status = text(value, "queued") as IngestionJobStatus;
  return status;
}

export function normalizeXmlUploadAccepted(value: unknown): XmlUploadAccepted {
  const body = unwrapped(value);
  const links = record(body.links);
  return {
    uploadId: text(body.uploadId ?? body.upload_id),
    objectId: text(body.objectId ?? body.object_id),
    jobId: text(body.jobId ?? body.job_id),
    status: normalizeStatus(body.status),
    links: {
      ingestion: optionalText(links.ingestion) ?? undefined,
      items: optionalText(links.items) ?? undefined,
    },
    correlationId: text(body.correlationId ?? body.correlation_id),
  };
}

export function normalizeIngestionJob(value: unknown): IngestionJob {
  const body = unwrapped(value);
  const attempts = record(body.attempts);
  const counters = record(body.counters);
  return {
    id: text(body.id ?? body.jobId ?? body.job_id),
    uploadId: optionalText(body.uploadId ?? body.upload_id),
    objectId: optionalText(
      body.objectId ?? body.object_id ?? body.rootObjectId ?? body.root_object_id,
    ),
    legalEntityId: optionalText(body.legalEntityId ?? body.legal_entity_id),
    clientAccountId: optionalText(
      body.clientAccountId ?? body.client_account_id,
    ),
    sourceType: text(
      body.source ?? body.sourceType ?? body.source_type,
      "manual_xml",
    ),
    status: normalizeStatus(body.status),
    stage: optionalText(body.stage),
    progress: boundedProgress(body.progress ?? body.progressPercent),
    attemptCount: finiteInteger(
      attempts.total ?? body.attemptCount ?? body.attempt_count,
    ),
    automaticRetryCount: finiteInteger(
      attempts.automaticRetries ??
        body.automaticRetryCount ??
        body.automatic_retry_count,
    ),
    nextAttemptAt: optionalText(
      attempts.nextAttemptAt ?? body.nextAttemptAt ?? body.next_attempt_at,
    ),
    counters: {
      total: finiteInteger(counters.total ?? body.itemCount),
      pending: finiteInteger(counters.pending),
      processing: finiteInteger(counters.processing),
      incorporated: finiteInteger(counters.incorporated),
      duplicate: finiteInteger(counters.duplicate),
      foreign: finiteInteger(counters.foreign),
      invalid: finiteInteger(counters.invalid),
      unsupported: finiteInteger(counters.unsupported),
      internalError: finiteInteger(
        counters.internalError ?? counters.internal_error,
      ),
    },
    cancelRequestedAt: optionalText(
      body.cancelRequestedAt ?? body.cancel_requested_at,
    ),
    startedAt: optionalText(body.startedAt ?? body.started_at),
    completedAt: optionalText(body.completedAt ?? body.completed_at),
    createdAt: optionalText(body.createdAt ?? body.created_at),
    updatedAt: optionalText(body.updatedAt ?? body.updated_at),
    lastErrorCode: optionalText(
      body.errorCode ?? body.lastErrorCode ?? body.last_error_code,
    ),
    correlationId: optionalText(body.correlationId ?? body.correlation_id),
  };
}

export function normalizeIngestionItem(value: unknown): IngestionItem {
  const body = record(value);
  const error = record(body.error);
  const parser = record(body.parser);
  return {
    id: text(body.id ?? body.itemId ?? body.item_id),
    objectId: optionalText(body.objectId ?? body.object_id),
    cfdiId: optionalText(body.cfdiId ?? body.cfdi_id),
    ordinal: finiteInteger(body.ordinal),
    filename: optionalText(body.filename ?? body.safeFilename ?? body.safe_filename),
    technicalStatus: text(body.technicalStatus ?? body.status, "pending"),
    result: optionalText(body.result ?? body.productResult) as IngestionItemResult | null,
    errorCode: optionalText(error.code ?? body.errorCode ?? body.error_code),
    errorDetail: optionalText(
      error.detail ?? body.safeErrorDetail ?? body.safe_error_detail,
    ),
    attemptCount: finiteInteger(body.attemptCount ?? body.attempt_count),
    parserVersion: optionalText(
      parser.version ?? body.parserVersion ?? body.parser_version,
    ),
    schemaVersion: optionalText(
      parser.schemaVersion ?? body.schemaVersion ?? body.schema_version,
    ),
    parsedCfdiVersion: optionalText(
      parser.cfdiVersion ?? body.parsedCfdiVersion ?? body.parsed_cfdi_version,
    ),
    documentType: optionalText(body.documentType ?? body.document_type),
    observedAt: optionalText(
      body.observedAt ?? body.createdAt ?? body.created_at,
    ),
    processedAt: optionalText(body.processedAt ?? body.processed_at),
    updatedAt: optionalText(body.updatedAt ?? body.updated_at),
    version: finiteInteger(body.version),
  };
}

function normalizePageMeta(value: unknown, itemCount: number): PageMeta {
  const meta = record(value);
  const page = Math.max(1, finiteInteger(meta.page, 1));
  const limit = Math.max(1, Math.min(100, finiteInteger(meta.limit, 20)));
  const total = finiteInteger(meta.total, itemCount);
  return {
    page,
    limit,
    total,
    totalPages: Math.max(
      total === 0 ? 0 : 1,
      finiteInteger(meta.totalPages ?? meta.total_pages, Math.ceil(total / limit)),
    ),
  };
}

export function normalizeIngestionItems(value: unknown): IngestionItem[] {
  const body = unwrapped(value);
  const values = Array.isArray(value)
    ? value
    : Array.isArray(body.items)
      ? body.items
      : [];
  return values.map(normalizeIngestionItem);
}

export function normalizeProcessPage(value: unknown): ProcessPage {
  const body = unwrapped(value);
  const values = Array.isArray(body.items) ? body.items : [];
  const items = values.map((entry) => {
    const raw = record(entry);
    const job = normalizeIngestionJob(raw);
    const counters = job.counters;
    const resultCounts: Partial<Record<IngestionItemResult, number>> = {};
    for (const result of [
      "incorporated",
      "duplicate",
      "foreign",
      "invalid",
      "unsupported",
      "internal_error",
    ] as const) {
      const count = finiteInteger(
        result === "internal_error" ? counters.internalError : counters[result],
      );
      if (count) resultCounts[result] = count;
    }
    return {
      ...job,
      requestedBy: optionalText(raw.requestedBy ?? raw.requested_by),
      itemCount: counters.total,
      terminalItemCount: finiteInteger(
        raw.terminalItemCount ??
          raw.terminal_item_count ??
          counters.incorporated +
            counters.duplicate +
            counters.foreign +
            counters.invalid +
            counters.unsupported +
            counters.internalError,
      ),
      results: resultCounts,
    };
  });
  return { items, meta: normalizePageMeta(body.meta, items.length) };
}
