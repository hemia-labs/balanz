import type { Readable } from 'node:stream';
import type { FiscalMetricsService } from '../../../common/observability/fiscal-metrics.service';
import type {
  ObjectStorageHealth,
  ObjectStorageObjectMetadata,
  ObjectStoragePort,
  ObjectStorageProvider,
  ObjectStorageWriteInput,
  ObjectStorageWriteResult,
  SignedObjectReadUrl,
} from '../ports/object-storage.port';

type StorageStage =
  'put' | 'read' | 'head' | 'delete' | 'signed_url' | 'health';

export class InstrumentedObjectStorageAdapter implements ObjectStoragePort {
  constructor(
    private readonly delegate: ObjectStoragePort,
    private readonly provider: ObjectStorageProvider,
    private readonly metrics: FiscalMetricsService,
  ) {}

  putStream(input: ObjectStorageWriteInput): Promise<ObjectStorageWriteResult> {
    return this.measure('put', () => this.delegate.putStream(input));
  }

  async openReadStream(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<Readable> {
    const startedAt = Date.now();
    try {
      const stream = await this.delegate.openReadStream(objectKey, signal);
      let recorded = false;
      let ended = false;
      const recordOnce = (outcome: 'success' | 'failed') => {
        if (recorded) return;
        recorded = true;
        this.record('read', outcome, startedAt);
      };

      stream.once('end', () => {
        ended = true;
        recordOnce('success');
      });
      stream.once('error', () => recordOnce('failed'));
      stream.once('close', () => {
        if (!ended) recordOnce('failed');
      });
      return stream;
    } catch (error) {
      this.record('read', 'failed', startedAt);
      throw error;
    }
  }

  head(objectKey: string): Promise<ObjectStorageObjectMetadata | null> {
    return this.measure('head', () => this.delegate.head(objectKey));
  }

  delete(objectKey: string): Promise<void> {
    return this.measure('delete', () => this.delegate.delete(objectKey));
  }

  createSignedReadUrl(
    objectKey: string,
    ttlSeconds?: number,
  ): Promise<SignedObjectReadUrl> {
    return this.measure('signed_url', () =>
      this.delegate.createSignedReadUrl(objectKey, ttlSeconds),
    );
  }

  async health(signal?: AbortSignal): Promise<ObjectStorageHealth> {
    const startedAt = Date.now();
    const result = await this.delegate.health(signal);
    this.record(
      'health',
      result.status === 'up' ? 'success' : 'failed',
      startedAt,
    );
    return result;
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    const lifecycleDelegate = this.delegate as ObjectStoragePort & {
      onApplicationShutdown?: (signal?: string) => void | Promise<void>;
    };
    await lifecycleDelegate.onApplicationShutdown?.(signal);
  }

  private async measure<T>(
    stage: StorageStage,
    work: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await work();
      this.record(stage, 'success', startedAt);
      return result;
    } catch (error) {
      this.record(stage, 'failed', startedAt);
      throw error;
    }
  }

  private record(
    stage: StorageStage,
    outcome: string,
    startedAt: number,
  ): void {
    const labels = { provider: this.provider, stage, outcome };
    if (outcome === 'failed') {
      this.metrics.increment('object_storage_failures_total', {
        provider: this.provider,
        stage,
      });
    }
    this.metrics.observe(
      'object_storage_operation_duration_seconds',
      labels,
      (Date.now() - startedAt) / 1_000,
    );
  }
}
