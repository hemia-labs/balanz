import { Injectable, Logger } from '@nestjs/common';
import { assertCanonicalFiscalErrorCode } from './fiscal-error-code';

export type FiscalLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface FiscalEvent {
  event: string;
  service: 'api' | 'worker';
  correlationId?: string;
  organizationId?: string;
  jobId?: string;
  itemId?: string;
  objectId?: string;
  stage?: string;
  durationMs?: number;
  result?: string;
  errorCode?: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;
const UUID_TOKEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_EVENTS = new Set([
  'ingestion_claim_cycle_failed',
  'ingestion_claim_released_during_shutdown',
  'ingestion_job_infrastructure_failure',
  'ingestion_job_started',
  'ingestion_job_finished',
  'ingestion_reconciliation_finished',
]);
const SAFE_STAGES = new Set(['claim', 'worker', 'handler', 'leases']);
const SAFE_RESULTS = new Set([
  'failed',
  'released',
  'lease_lost',
  'recovered',
  'claimed',
  'completed',
  'completed_with_issues',
  'cancelled',
  'failed_retryable',
  'failed_final',
  'success',
]);
/** Emits only an allowlisted event schema; arbitrary SDK/user text is rejected. */
@Injectable()
export class FiscalEventLogger {
  private readonly logger = new Logger('FiscalIngestion');

  write(level: FiscalLogLevel, event: FiscalEvent): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      event: this.allowlistedToken(event.event, 'event', SAFE_EVENTS),
      service: event.service,
      correlation_id: this.optionalUuid(event.correlationId, 'correlationId'),
      organization_id: this.optionalUuid(
        event.organizationId,
        'organizationId',
      ),
      job_id: this.optionalUuid(event.jobId, 'jobId'),
      item_id: this.optionalUuid(event.itemId, 'itemId'),
      object_id: this.optionalUuid(event.objectId, 'objectId'),
      stage:
        event.stage === undefined
          ? undefined
          : this.allowlistedToken(event.stage, 'stage', SAFE_STAGES),
      duration_ms:
        event.durationMs === undefined
          ? undefined
          : this.safeDuration(event.durationMs),
      result:
        event.result === undefined
          ? undefined
          : this.allowlistedToken(event.result, 'result', SAFE_RESULTS),
      error_code:
        event.errorCode === undefined
          ? undefined
          : this.canonicalErrorCode(event.errorCode),
    };
    const serialized = JSON.stringify(payload);
    if (level === 'error') this.logger.error(serialized);
    else if (level === 'warn') this.logger.warn(serialized);
    else if (level === 'debug') this.logger.debug(serialized);
    else this.logger.log(serialized);
  }

  private optionalUuid(value: string | undefined, field: string) {
    if (value === undefined) return undefined;
    if (!UUID_TOKEN.test(value)) {
      throw new Error(`${field} must be a canonical UUID log identifier`);
    }
    return value.toLowerCase();
  }

  private allowlistedToken(
    value: string,
    field: string,
    allowed: ReadonlySet<string>,
  ): string {
    if (!SAFE_TOKEN.test(value) || !allowed.has(value)) {
      throw new Error(`${field} must be a safe structured-log token`);
    }
    return value;
  }

  private safeDuration(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('durationMs must be finite and non-negative');
    }
    return value;
  }

  private canonicalErrorCode(value: string): string {
    assertCanonicalFiscalErrorCode(value);
    return value;
  }
}
