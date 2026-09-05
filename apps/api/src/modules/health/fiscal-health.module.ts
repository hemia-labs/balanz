import { type DynamicModule, Module } from '@nestjs/common';
import { FiscalInfrastructureModule } from '../fiscal-platform/fiscal-infrastructure.module';
import { RedisModule } from '../redis/redis.module';
import { IngestionWorkerModule } from '../ingestion/workers/ingestion-worker.module';
import { IngestionWorkerRunner } from '../ingestion/workers/ingestion-worker.runner';
import {
  FISCAL_PROCESS_NAME,
  FiscalHealthController,
} from './fiscal-health.controller';
import {
  FISCAL_WORKER_RUNTIME,
  type FiscalProcessName,
  FiscalReadinessService,
} from './fiscal-readiness.service';

@Module({})
export class FiscalHealthModule {
  static register(process: FiscalProcessName): DynamicModule {
    return {
      module: FiscalHealthModule,
      imports: [
        FiscalInfrastructureModule,
        RedisModule,
        ...(process === 'worker' ? [IngestionWorkerModule] : []),
      ],
      controllers: [FiscalHealthController],
      providers: [
        FiscalReadinessService,
        { provide: FISCAL_PROCESS_NAME, useValue: process },
        process === 'worker'
          ? {
              provide: FISCAL_WORKER_RUNTIME,
              useExisting: IngestionWorkerRunner,
            }
          : { provide: FISCAL_WORKER_RUNTIME, useValue: null },
      ],
      exports: [FiscalReadinessService],
    };
  }
}
