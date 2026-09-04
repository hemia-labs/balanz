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
import { CfdiProcessingModule } from '../../cfdi/cfdi-processing.module';
import { ManualXmlJobHandler } from '../../cfdi/workers/manual-xml-job.handler';

@Module({
  imports: [
    CorrelationModule,
    ObservabilityModule,
    RedisModule,
    IngestionModule,
    CfdiProcessingModule,
  ],
  providers: [
    {
      provide: INGESTION_JOB_HANDLERS,
      inject: [ManualXmlJobHandler],
      useFactory: (manualXml: ManualXmlJobHandler) =>
        Object.freeze([manualXml]),
    },
    IngestionJobRegistry,
    IngestionWorkerRunner,
  ],
  exports: [IngestionJobRegistry, IngestionWorkerRunner],
})
export class IngestionWorkerModule {}
