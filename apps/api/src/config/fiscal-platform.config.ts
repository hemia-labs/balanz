import { registerAs } from '@nestjs/config';
import { isAbsolute, resolve } from 'node:path';

export const FISCAL_RLS_ORGANIZATION_SETTING = 'app.organization_id' as const;
export const FISCAL_RLS_MEMBERSHIP_SETTING = 'app.membership_id' as const;

export type ObjectStorageDriver = 'local' | 's3';
export type S3EncryptionMode = 'none' | 'AES256' | 'aws:kms';
export type MalwareScannerMode = 'clamav' | 'bypass';

export interface FiscalPlatformConfig {
  environment: string;
  storage: {
    driver: ObjectStorageDriver;
    localRoot: string;
    localWindowsPresecured: boolean;
    signedUrlTtlSeconds: number;
    s3: {
      endpoint?: string;
      region: string;
      bucket?: string;
      forcePathStyle: boolean;
      encryption: S3EncryptionMode;
      kmsKeyId?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      requestTimeoutMs: number;
    };
  };
  scanner: {
    mode: MalwareScannerMode;
    host: string;
    port: number;
    connectTimeoutMs: number;
    scanTimeoutMs: number;
    maxStreamBytes: number;
  };
  worker: {
    concurrency: number;
    leaseSeconds: number;
    heartbeatSeconds: number;
    maxAttempts: number;
    maxRetries: number;
    backoffSeconds: readonly number[];
    backoffJitterPercent: number;
    pollIntervalMs: number;
    queueMetricsIntervalMs: number;
    reconcileIntervalMs: number;
    shutdownGraceMs: number;
    healthHost: string;
    healthPort: number;
  };
  redisWakeup: {
    enabled: boolean;
    channel: string;
    timeoutMs: number;
  };
  retention: {
    incompleteUploadHours: number;
    duplicateBytesHours: number;
    orphanGraceMinutes: number;
    invalidObjectDays: number;
    malwareQuarantineDays: number;
    completedObjectDays: number;
  };
  limits: {
    xmlBytes: number;
    directUploadXmlCount: number;
    zipBytes: number;
    xmlDepth: number;
    xmlNodes: number;
    xmlAttributes: number;
    xmlAttributesPerElement: number;
    xmlTextNodeBytes: number;
    xmlParsingMilliseconds: number;
    workerMemoryMiB: number;
    activeJobsPerUser: number;
    activeJobsPerTenant: number;
  };
  rls: {
    organizationSetting: typeof FISCAL_RLS_ORGANIZATION_SETTING;
    membershipSetting: typeof FISCAL_RLS_MEMBERSHIP_SETTING;
  };
  metrics: {
    enabled: boolean;
    path: string;
  };
  health: {
    timeoutMs: number;
    storageProbeIntervalMs: number;
  };
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return value === 'true';
}

function envNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  return Number(value);
}

function parseBackoff(value: string | undefined): readonly number[] {
  return (value || '10,30,120').split(',').map((entry) => Number(entry.trim()));
}

const WORKSPACE_ROOT = resolve(__dirname, '..', '..', '..', '..');

/** Relative storage paths are stable regardless of whether npm starts at root/API. */
export function resolveLocalStorageRoot(value?: string): string {
  const configured = value?.trim() || '.local/fiscal-object-storage';
  return isAbsolute(configured)
    ? resolve(configured)
    : resolve(WORKSPACE_ROOT, configured);
}

export default registerAs('fiscalPlatform', (): FiscalPlatformConfig => {
  const environment = process.env.NODE_ENV || 'development';
  const wakeupPrefix =
    process.env.REDIS_WAKEUP_PREFIX || 'balanz:ingestion:wakeup';

  return {
    environment,
    storage: {
      driver: (process.env.OBJECT_STORAGE_DRIVER ||
        (environment === 'production' ? 's3' : 'local')) as ObjectStorageDriver,
      localRoot: resolveLocalStorageRoot(process.env.OBJECT_STORAGE_LOCAL_ROOT),
      localWindowsPresecured: envBoolean(
        process.env.OBJECT_STORAGE_LOCAL_WINDOWS_PRESECURED,
        false,
      ),
      signedUrlTtlSeconds: envNumber(
        process.env.OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS,
        60,
      ),
      s3: {
        endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
        region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2',
        bucket: process.env.S3_BUCKET?.trim() || undefined,
        forcePathStyle: envBoolean(process.env.S3_FORCE_PATH_STYLE, false),
        encryption: (process.env.S3_SSE_MODE ||
          (environment === 'production'
            ? 'aws:kms'
            : 'AES256')) as S3EncryptionMode,
        kmsKeyId: process.env.S3_KMS_KEY_ID?.trim() || undefined,
        accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() || undefined,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
        requestTimeoutMs: envNumber(process.env.S3_REQUEST_TIMEOUT_MS, 10_000),
      },
    },
    scanner: {
      mode: (process.env.MALWARE_SCANNER_MODE ||
        'clamav') as MalwareScannerMode,
      host: process.env.CLAMAV_HOST || '127.0.0.1',
      port: envNumber(process.env.CLAMAV_PORT, 3310),
      connectTimeoutMs: envNumber(process.env.CLAMAV_CONNECT_TIMEOUT_MS, 2_000),
      scanTimeoutMs: envNumber(process.env.CLAMAV_SCAN_TIMEOUT_MS, 30_000),
      maxStreamBytes: envNumber(
        process.env.CLAMAV_MAX_STREAM_BYTES,
        50 * 1024 * 1024,
      ),
    },
    worker: {
      concurrency: envNumber(process.env.WORKER_CONCURRENCY, 4),
      leaseSeconds: envNumber(process.env.WORKER_LEASE_SECONDS, 90),
      heartbeatSeconds: envNumber(process.env.WORKER_HEARTBEAT_SECONDS, 20),
      maxAttempts: envNumber(process.env.WORKER_MAX_ATTEMPTS, 4),
      maxRetries: envNumber(process.env.WORKER_MAX_RETRIES, 3),
      backoffSeconds: parseBackoff(process.env.WORKER_BACKOFF_SECONDS),
      backoffJitterPercent: envNumber(
        process.env.WORKER_BACKOFF_JITTER_PERCENT,
        20,
      ),
      pollIntervalMs: envNumber(process.env.WORKER_POLL_INTERVAL_MS, 5_000),
      queueMetricsIntervalMs: envNumber(
        process.env.WORKER_QUEUE_METRICS_INTERVAL_MS,
        30_000,
      ),
      reconcileIntervalMs: envNumber(
        process.env.WORKER_RECONCILE_INTERVAL_MS,
        60_000,
      ),
      shutdownGraceMs: envNumber(process.env.WORKER_SHUTDOWN_GRACE_MS, 30_000),
      healthHost: process.env.WORKER_HEALTH_HOST || '127.0.0.1',
      healthPort: envNumber(process.env.WORKER_HEALTH_PORT, 3002),
    },
    redisWakeup: {
      enabled:
        envBoolean(process.env.REDIS_ENABLED, true) &&
        envBoolean(process.env.REDIS_WAKEUP_ENABLED, true),
      channel: `${wakeupPrefix}:${environment}`,
      timeoutMs: envNumber(process.env.REDIS_WAKEUP_TIMEOUT_MS, 500),
    },
    retention: {
      incompleteUploadHours: envNumber(
        process.env.INGESTION_INCOMPLETE_UPLOAD_HOURS,
        24,
      ),
      duplicateBytesHours: envNumber(
        process.env.INGESTION_DUPLICATE_BYTES_HOURS,
        24,
      ),
      orphanGraceMinutes: envNumber(
        process.env.INGESTION_ORPHAN_GRACE_MINUTES,
        60,
      ),
      invalidObjectDays: envNumber(
        process.env.INGESTION_INVALID_OBJECT_DAYS,
        7,
      ),
      malwareQuarantineDays: envNumber(
        process.env.INGESTION_MALWARE_QUARANTINE_DAYS,
        7,
      ),
      completedObjectDays: envNumber(
        process.env.INGESTION_COMPLETED_OBJECT_DAYS,
        30,
      ),
    },
    limits: {
      xmlBytes: envNumber(process.env.INGESTION_XML_MAX_BYTES, 5 * 1024 * 1024),
      directUploadXmlCount: envNumber(
        process.env.INGESTION_DIRECT_XML_MAX_COUNT,
        1,
      ),
      zipBytes: envNumber(
        process.env.INGESTION_ZIP_MAX_BYTES,
        50 * 1024 * 1024,
      ),
      xmlDepth: envNumber(process.env.INGESTION_XML_MAX_DEPTH, 64),
      xmlNodes: envNumber(process.env.INGESTION_XML_MAX_NODES, 200_000),
      xmlAttributes: envNumber(
        process.env.INGESTION_XML_MAX_ATTRIBUTES,
        100_000,
      ),
      xmlAttributesPerElement: envNumber(
        process.env.INGESTION_XML_MAX_ATTRIBUTES_PER_ELEMENT,
        128,
      ),
      xmlTextNodeBytes: envNumber(
        process.env.INGESTION_XML_MAX_TEXT_NODE_BYTES,
        1024 * 1024,
      ),
      xmlParsingMilliseconds: envNumber(
        process.env.INGESTION_XML_PARSE_TIMEOUT_MS,
        5_000,
      ),
      workerMemoryMiB: envNumber(process.env.WORKER_MEMORY_TARGET_MIB, 256),
      activeJobsPerUser: envNumber(
        process.env.INGESTION_ACTIVE_JOBS_PER_USER,
        2,
      ),
      activeJobsPerTenant: envNumber(
        process.env.INGESTION_ACTIVE_JOBS_PER_TENANT,
        4,
      ),
    },
    rls: {
      organizationSetting: FISCAL_RLS_ORGANIZATION_SETTING,
      membershipSetting: FISCAL_RLS_MEMBERSHIP_SETTING,
    },
    metrics: {
      enabled: envBoolean(process.env.METRICS_ENABLED, true),
      path: process.env.METRICS_PATH || '/metrics',
    },
    health: {
      timeoutMs: envNumber(process.env.HEALTH_CHECK_TIMEOUT_MS, 2_000),
      storageProbeIntervalMs: envNumber(
        process.env.HEALTH_STORAGE_PROBE_INTERVAL_MS,
        30_000,
      ),
    },
  };
});
