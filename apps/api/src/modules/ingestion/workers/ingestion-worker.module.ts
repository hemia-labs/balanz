import { SatPackageJobHandler } from '../../sat-download/sat-package.handler';
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

import { ManualZipJobHandler } from '../../cfdi/workers/manual-zip-job.handler';

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
      inject: [ManualXmlJobHandler, ManualZipJobHandler, SatPackageJobHandler],
      useFactory: (
        manualXml: ManualXmlJobHandler,
        manualZip: ManualZipJobHandler,
        satPackage: SatPackageJobHandler,
      ) => Object.freeze([manualXml, manualZip, satPackage]),
    },
    IngestionJobRegistry,
    IngestionWorkerRunner,
  ],
  exports: [IngestionJobRegistry, IngestionWorkerRunner],
})
export class IngestionWorkerModule {}
