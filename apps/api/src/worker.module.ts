import { Module } from '@nestjs/common';
import { CorrelationModule } from './common/correlation/correlation.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { PlatformConfigModule } from './config/platform-config.module';
import { DatabaseModule } from './database/database.module';
import { FiscalHealthModule } from './modules/health/fiscal-health.module';
import { IngestionWorkerModule } from './modules/ingestion/workers/ingestion-worker.module';

@Module({
  imports: [
    PlatformConfigModule.forRuntime('worker'),
    CorrelationModule,
    ObservabilityModule,
    DatabaseModule.forRuntime('worker'),
    IngestionWorkerModule,
    FiscalHealthModule.register('worker'),
  ],
})
export class WorkerModule {}
