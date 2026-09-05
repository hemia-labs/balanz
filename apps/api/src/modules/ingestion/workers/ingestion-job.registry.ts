import { Inject, Injectable } from '@nestjs/common';
import type { IngestionJobSourceType } from '../entities/ingestion-job.entity';
import type { ClaimResult } from '../services/ingestion-job.repository';

export const INGESTION_JOB_HANDLERS = Symbol('INGESTION_JOB_HANDLERS');

export type IngestionJobHandlerResult = 'completed' | 'completed_with_issues';

export interface IngestionJobHandler {
  /** A canonical real ingestion source; production Phase 0 registers none. */
  readonly source: IngestionJobSourceType;
  handle(
    job: ClaimResult,
    signal: AbortSignal,
  ): Promise<IngestionJobHandlerResult>;
}

@Injectable()
export class IngestionJobRegistry {
  private readonly bySource: ReadonlyMap<
    IngestionJobSourceType,
    IngestionJobHandler
  >;

  constructor(
    @Inject(INGESTION_JOB_HANDLERS)
    handlers: readonly IngestionJobHandler[],
  ) {
    const bySource = new Map<IngestionJobSourceType, IngestionJobHandler>();
    for (const handler of handlers) {
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(handler.source)) {
        throw new Error('Ingestion handler source is not canonical');
      }
      if (bySource.has(handler.source)) {
        throw new Error(`Duplicate ingestion handler: ${handler.source}`);
      }
      bySource.set(handler.source, handler);
    }
    this.bySource = bySource;
  }

  supportedSources(): readonly IngestionJobSourceType[] {
    return [...this.bySource.keys()].sort();
  }

  get(source: IngestionJobSourceType): IngestionJobHandler | undefined {
    return this.bySource.get(source);
  }
}
