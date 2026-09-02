import { Injectable } from '@nestjs/common';

type MetricKind = 'counter' | 'gauge' | 'histogram';

interface MetricDefinition {
  help: string;
  kind: MetricKind;
  labels: readonly string[];
  buckets?: readonly number[];
}

interface HistogramValue {
  count: number;
  sum: number;
  buckets: number[];
}

const DEFINITIONS = {
  ingestion_jobs_created_total: {
    help: 'Durable ingestion jobs created by source.',
    kind: 'counter',
    labels: ['source'],
  },
  ingestion_jobs_completed_total: {
    help: 'Durable ingestion jobs completed by source and result.',
    kind: 'counter',
    labels: ['source', 'result'],
  },
  ingestion_jobs_failed_total: {
    help: 'Durable ingestion job failures by source and result.',
    kind: 'counter',
    labels: ['source', 'result'],
  },
  ingestion_jobs_recovered_total: {
    help: 'Durable ingestion jobs recovered by source and outcome.',
    kind: 'counter',
    labels: ['source', 'outcome'],
  },
  ingestion_items_total: {
    help: 'Ingestion items observed by source and stage.',
    kind: 'counter',
    labels: ['source', 'stage'],
  },
  ingestion_items_by_result: {
    help: 'Ingestion item outcomes.',
    kind: 'counter',
    labels: ['result'],
  },
  ingestion_duration_seconds: {
    help: 'End-to-end durable job processing duration.',
    kind: 'histogram',
    labels: ['source', 'result'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 15, 30, 60, 120, 300],
  },
  ingestion_queue_age_seconds: {
    help: 'Age of the oldest claimable job in PostgreSQL.',
    kind: 'gauge',
    labels: ['source'],
  },
  ingestion_upload_bytes_total: {
    help: 'Bytes accepted by the foundational upload pipeline.',
    kind: 'counter',
    labels: ['source'],
  },
  ingestion_hash_conflicts_total: {
    help: 'Upload or object hash conflicts.',
    kind: 'counter',
    labels: ['source'],
  },
  ingestion_cross_tenant_denials_total: {
    help: 'Cross-tenant denials by safe stage.',
    kind: 'counter',
    labels: ['stage'],
  },
  ingestion_scanner_failures_total: {
    help: 'Malware scanner failures by safe result.',
    kind: 'counter',
    labels: ['result'],
  },
  ingestion_parser_failures_total: {
    help: 'Parser failures by safe result; parser remains unimplemented in Phase 0.',
    kind: 'counter',
    labels: ['result'],
  },
  worker_active_jobs: {
    help: 'Current number of locally active worker jobs.',
    kind: 'gauge',
    labels: ['source'],
  },
  worker_heartbeat_lag_seconds: {
    help: 'Worker heartbeat completion lag.',
    kind: 'gauge',
    labels: ['source'],
  },
  worker_lease_reclaims_total: {
    help: 'Expired lease recoveries performed by the reconciler.',
    kind: 'counter',
    labels: ['outcome'],
  },
  object_storage_failures_total: {
    help: 'Object storage failures by provider and operation stage.',
    kind: 'counter',
    labels: ['provider', 'stage'],
  },
  object_storage_operation_duration_seconds: {
    help: 'Object storage operation duration by provider and outcome.',
    kind: 'histogram',
    labels: ['provider', 'stage', 'outcome'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30],
  },
  ingestion_scanner_duration_seconds: {
    help: 'Malware scanner duration by safe result.',
    kind: 'histogram',
    labels: ['stage', 'result'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30, 60],
  },
  redis_wakeup_failures_total: {
    help: 'Best-effort Redis wakeup failures by safe stage.',
    kind: 'counter',
    labels: ['stage'],
  },
  ingestion_reconciliations_total: {
    help: 'Idempotent reconciliation actions by stage and outcome.',
    kind: 'counter',
    labels: ['stage', 'outcome'],
  },
  worker_shutdown_total: {
    help: 'Worker shutdown outcomes.',
    kind: 'counter',
    labels: ['outcome'],
  },
} as const satisfies Record<string, MetricDefinition>;

export type FiscalMetricName = keyof typeof DEFINITIONS;

const SAFE_LABEL_NAME = /^(source|status|result|provider|outcome|stage)$/;
const SAFE_LABEL_VALUE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_VALUES_BY_LABEL: Readonly<Record<string, ReadonlySet<string>>> = {
  source: new Set(['manual_xml', 'manual_zip', 'sat_package']),
  provider: new Set(['local', 's3']),
  status: new Set([
    'awaiting_upload',
    'queued',
    'processing',
    'completed',
    'completed_with_issues',
    'failed_retryable',
    'failed_final',
    'cancel_requested',
    'cancelled',
    'up',
    'down',
    'degraded',
    'disabled',
  ]),
  result: new Set([
    'clean',
    'infected',
    'bypassed',
    'failed',
    'up',
    'down',
    'completed',
    'completed_with_issues',
    'failed_retryable',
    'failed_final',
    'lease_lost',
    'cancelled',
    'released',
    'incorporated',
    'duplicate',
    'foreign',
    'invalid',
    'unsupported',
    'internal_error',
  ]),
  outcome: new Set([
    'claimed',
    'retryable',
    'final',
    'cancelled',
    'observed',
    'success',
    'failed',
    'clean',
    'timeout',
  ]),
  stage: new Set([
    'put',
    'read',
    'head',
    'delete',
    'signed_url',
    'health',
    'scan',
    'publish',
    'subscribe',
    'claim',
    'worker',
    'handler',
    'leases',
    'expired_upload',
    'orphan_object',
    'confirmed_without_job',
    'orphan_job',
    'job_counters',
    'redundant_object',
    'retention',
    'scanning',
    'extracting',
    'parsing',
    'persisting',
  ]),
};

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function labelsText(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries
    .map(([name, value]) => `${name}="${escapeLabel(value)}"`)
    .join(',')}}`;
}

@Injectable()
export class FiscalMetricsService {
  private readonly scalarValues = new Map<string, number>();
  private readonly histogramValues = new Map<string, HistogramValue>();
  private readonly labelsByKey = new Map<string, Record<string, string>>();

  increment(
    name: FiscalMetricName,
    labels: Record<string, string>,
    amount = 1,
  ): void {
    const definition = DEFINITIONS[name];
    if (definition.kind !== 'counter') {
      throw new Error(`${name} is not a counter`);
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Counter increments must be finite and non-negative');
    }
    const key = this.metricKey(name, definition, labels);
    this.scalarValues.set(key, (this.scalarValues.get(key) ?? 0) + amount);
  }

  setGauge(
    name: FiscalMetricName,
    labels: Record<string, string>,
    value: number,
  ): void {
    const definition = DEFINITIONS[name];
    if (definition.kind !== 'gauge') throw new Error(`${name} is not a gauge`);
    if (!Number.isFinite(value)) throw new Error('Gauge values must be finite');
    const key = this.metricKey(name, definition, labels);
    this.scalarValues.set(key, value);
  }

  observe(
    name: FiscalMetricName,
    labels: Record<string, string>,
    value: number,
  ): void {
    const definition = DEFINITIONS[name];
    if (definition.kind !== 'histogram') {
      throw new Error(`${name} is not a histogram`);
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Histogram observations must be finite and non-negative');
    }
    const key = this.metricKey(name, definition, labels);
    const buckets: readonly number[] = definition.buckets ?? [];
    const stored: HistogramValue = this.histogramValues.get(key) ?? {
      count: 0,
      sum: 0,
      buckets: buckets.map(() => 0),
    };
    stored.count += 1;
    stored.sum += value;
    stored.buckets = stored.buckets.map((count, index) =>
      value <= (buckets.at(index) ?? Number.POSITIVE_INFINITY)
        ? count + 1
        : count,
    );
    this.histogramValues.set(key, stored);
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, definition] of Object.entries(DEFINITIONS) as Array<
      [FiscalMetricName, MetricDefinition]
    >) {
      lines.push(`# HELP ${name} ${definition.help}`);
      lines.push(`# TYPE ${name} ${definition.kind}`);

      if (definition.kind === 'histogram') {
        for (const [key, value] of this.histogramValues) {
          if (!key.startsWith(`${name}|`)) continue;
          const labels = this.labelsByKey.get(key) ?? {};
          (definition.buckets ?? []).forEach((upperBound, index) => {
            lines.push(
              `${name}_bucket${labelsText({ ...labels, le: String(upperBound) })} ${value.buckets[index]}`,
            );
          });
          lines.push(
            `${name}_bucket${labelsText({ ...labels, le: '+Inf' })} ${value.count}`,
          );
          lines.push(`${name}_sum${labelsText(labels)} ${value.sum}`);
          lines.push(`${name}_count${labelsText(labels)} ${value.count}`);
        }
      } else {
        for (const [key, value] of this.scalarValues) {
          if (!key.startsWith(`${name}|`)) continue;
          lines.push(
            `${name}${labelsText(this.labelsByKey.get(key) ?? {})} ${value}`,
          );
        }
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private metricKey(
    name: FiscalMetricName,
    definition: MetricDefinition,
    labels: Record<string, string>,
  ): string {
    const names = Object.keys(labels).sort();
    const expected = [...definition.labels].sort();
    if (
      names.length !== expected.length ||
      names.some((label, index) => label !== expected[index])
    ) {
      throw new Error(`${name} received an invalid label set`);
    }
    for (const [label, value] of Object.entries(labels)) {
      if (
        !SAFE_LABEL_NAME.test(label) ||
        !SAFE_LABEL_VALUE.test(value) ||
        !SAFE_VALUES_BY_LABEL[label]?.has(value)
      ) {
        throw new Error(`${name} received an unsafe metric label`);
      }
    }
    const normalized = Object.fromEntries(
      expected.map((label) => [label, labels[label]]),
    );
    const key = `${name}|${expected
      .map((label) => `${label}=${labels[label]}`)
      .join('|')}`;
    this.labelsByKey.set(key, normalized);
    return key;
  }
}
