import { PassThrough, Readable } from 'node:stream';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import type { ObjectStoragePort } from '../src/modules/object-storage';
import { InstrumentedObjectStorageAdapter } from '../src/modules/object-storage/services/instrumented-object-storage.adapter';

describe('InstrumentedObjectStorageAdapter', () => {
  const result = {
    provider: 's3' as const,
    objectKey: 'objects/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sizeBytes: 1,
    sha256: 'a'.repeat(64),
  };

  function delegate(stream: Readable): ObjectStoragePort & {
    onApplicationShutdown: jest.Mock;
  } {
    return {
      putStream: jest.fn().mockResolvedValue(result),
      openReadStream: jest.fn().mockResolvedValue(stream),
      head: jest.fn().mockResolvedValue(result),
      delete: jest.fn().mockResolvedValue(undefined),
      createSignedReadUrl: jest.fn().mockResolvedValue({
        url: 'https://storage.invalid/signed',
        expiresAt: new Date(Date.now() + 30_000),
      }),
      health: jest.fn().mockResolvedValue({
        status: 'up',
        provider: 's3',
        durationMs: 1,
      }),
      onApplicationShutdown: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('measures reads through end-of-stream and delegates S3 shutdown', async () => {
    const metrics = new FiscalMetricsService();
    const inner = delegate(Readable.from([Buffer.from('x')]));
    const adapter = new InstrumentedObjectStorageAdapter(inner, 's3', metrics);
    const stream = await adapter.openReadStream(result.objectKey);
    for await (const chunk of stream) {
      void chunk;
      // Consume the object so duration and outcome describe actual I/O.
    }
    await adapter.onApplicationShutdown('SIGTERM');

    expect(inner.onApplicationShutdown).toHaveBeenCalledWith('SIGTERM');
    expect(metrics.render()).toContain(
      'object_storage_operation_duration_seconds_count{outcome="success",provider="s3",stage="read"} 1',
    );
  });

  it('records stream failures', async () => {
    const metrics = new FiscalMetricsService();
    const stream = new PassThrough();
    const adapter = new InstrumentedObjectStorageAdapter(
      delegate(stream),
      's3',
      metrics,
    );
    const opened = await adapter.openReadStream(result.objectKey);
    const consumed = new Promise<void>((resolve) => {
      opened.once('error', () => resolve());
    });
    stream.destroy(new Error('synthetic transport failure'));
    await consumed;

    expect(metrics.render()).toContain(
      'object_storage_failures_total{provider="s3",stage="read"} 1',
    );
  });
});
