import { Module } from '@nestjs/common';
import { CorrelationModule } from '../../../common/correlation/correlation.module';
import { ObservabilityModule } from '../../../common/observability/observability.module';
import { RedisModule } from '../../redis/redis.module';
import { IngestionModule } from '../ingestion.module';
import {
  INGESTION_JOB_HANDLERS,
  IngestionJobRegistry,
} from './ingestion-job.registry';
import { IngestionWorkerRunner } from './ingestion-worker.runner';

@Module({
  imports: [
    CorrelationModule,
    ObservabilityModule,
    RedisModule,
    IngestionModule,
  ],
  providers: [
    // Phase 0 intentionally has no production job handler. Integration tests
    // override this token with a handler for the real future manual_xml source.
    { provide: INGESTION_JOB_HANDLERS, useValue: Object.freeze([]) },
    IngestionJobRegistry,
    IngestionWorkerRunner,
  ],
  exports: [IngestionJobRegistry, IngestionWorkerRunner],
})
export class IngestionWorkerModule {}
