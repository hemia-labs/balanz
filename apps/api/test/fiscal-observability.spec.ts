import { Logger } from '@nestjs/common';
import { FiscalEventLogger } from '../src/common/observability/fiscal-event-logger.service';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';

describe('Fiscal Phase 0 observability', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders the locked metric names and bounded labels', () => {
    const metrics = new FiscalMetricsService();
    metrics.increment('ingestion_jobs_created_total', {
      source: 'manual_xml',
    });
    metrics.observe(
      'object_storage_operation_duration_seconds',
      { provider: 's3', stage: 'put', outcome: 'success' },
      0.25,
    );

    const output = metrics.render();
    expect(output).toContain(
      'ingestion_jobs_created_total{source="manual_xml"} 1',
    );
    expect(output).toContain(
      '# TYPE object_storage_operation_duration_seconds histogram',
    );
  });

  it.each([
    'ingestion_jobs_created_total',
    'ingestion_jobs_completed_total',
    'ingestion_jobs_failed_total',
    'ingestion_jobs_recovered_total',
    'ingestion_items_total',
    'ingestion_items_by_result',
    'ingestion_duration_seconds',
    'ingestion_queue_age_seconds',
    'ingestion_upload_bytes_total',
    'ingestion_hash_conflicts_total',
    'ingestion_cross_tenant_denials_total',
    'ingestion_scanner_failures_total',
    'ingestion_parser_failures_total',
    'worker_active_jobs',
    'worker_heartbeat_lag_seconds',
    'worker_lease_reclaims_total',
    'object_storage_failures_total',
    'redis_wakeup_failures_total',
    'redis_wakeup_published_total',
    'redis_wakeup_received_total',
  ])('exports canonical metric %s', (name) => {
    expect(new FiscalMetricsService().render()).toContain(`# HELP ${name} `);
  });

  it.each([
    '550e8400-e29b-41d4-a716-446655440000',
    'XAXX010101000',
    'client-name',
  ])('rejects identifiers or business data as metric labels: %s', (source) => {
    const metrics = new FiscalMetricsService();
    expect(() =>
      metrics.increment('ingestion_jobs_created_total', { source }),
    ).toThrow('unsafe metric label');
  });

  it('emits only the structured allowlist and refuses arbitrary secret text', () => {
    const emitted: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message) => {
      emitted.push(String(message));
    });
    const logger = new FiscalEventLogger();
    logger.write('info', {
      event: 'ingestion_job_started',
      service: 'worker',
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      jobId: '2f1b3648-aa67-4565-b60e-6d8ef121b49f',
      stage: 'claim',
      result: 'claimed',
    });

    expect(emitted).toHaveLength(1);
    expect(JSON.parse(emitted[0])).toMatchObject({
      event: 'ingestion_job_started',
      service: 'worker',
      stage: 'claim',
      result: 'claimed',
    });
    expect(emitted[0]).not.toContain('password');
    expect(() =>
      logger.write('error', {
        event: 'leaked secret=value',
        service: 'worker',
      }),
    ).toThrow('event must be a safe structured-log token');
  });

  it('emits a canonical durable handler error code without a secondary logging failure', () => {
    const emitted: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      emitted.push(String(message));
    });
    const logger = new FiscalEventLogger();

    expect(() =>
      logger.write('error', {
        event: 'ingestion_job_finished',
        service: 'worker',
        stage: 'handler',
        result: 'failed_final',
        errorCode: 'MALWARE_DETECTED',
      }),
    ).not.toThrow();

    expect(emitted).toHaveLength(1);
    expect(JSON.parse(emitted[0])).toMatchObject({
      event: 'ingestion_job_finished',
      error_code: 'MALWARE_DETECTED',
    });
  });

  it.each([
    ['event', { event: 'eyJhbGciOiJIUzI1NiJ9' }],
    ['stage', { event: 'ingestion_job_started', stage: 'XAXX010101000' }],
    [
      'error code',
      { event: 'ingestion_job_finished', errorCode: 'SUPER_SECRET_123' },
    ],
    ['identifier', { event: 'ingestion_job_started', jobId: 'XAXX010101000' }],
  ])('rejects token-shaped business/secret data in %s', (_field, override) => {
    const logger = new FiscalEventLogger();
    expect(() =>
      logger.write('error', {
        service: 'worker',
        ...override,
      }),
    ).toThrow();
  });
});
