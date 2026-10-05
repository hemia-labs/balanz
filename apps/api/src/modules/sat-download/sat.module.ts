import { ConfigService } from '@nestjs/config';
import type { EfirmaConfig } from '../../config/efirma.config';
import { assertRealPilot } from '../../config/efirma-real-pilot';
import { FiscalMetricsService } from '../../common/observability/fiscal-metrics.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionsModule } from '../sessions/sessions.module';
import {
  EfirmaApiModule,
  EfirmaWorkerModule,
  EfirmaPersistenceModule,
} from '../efirma/efirma.module';
import { SatAdapter, PRODUCTION_ENDPOINTS } from './sat-adapter';
import { SatController } from './sat.controller';
import { SatService, satEnabled } from './sat.service';
import { SatWorker } from './sat-worker';
@Module({
  imports: [
    EfirmaApiModule,
    EfirmaPersistenceModule,
    AuthModule,
    SessionsModule,
  ],
  providers: [SatService],
  controllers: [SatController],
})
export class SatApiModule {}
@Module({
  imports: [EfirmaWorkerModule, EfirmaPersistenceModule],
  providers: [
    {
      provide: 'SAT_ADAPTER',
      inject: [FiscalMetricsService, ConfigService],
      useFactory: (
        metrics: FiscalMetricsService,
        configuration: ConfigService,
      ) => {
        if (process.env.SAT_ENABLED !== 'true') return null;
        satEnabled();
        const custody = configuration.getOrThrow<EfirmaConfig>('efirma');
        if (custody.runtimeMode === 'real_pilot') {
          assertRealPilot(custody);
          return new SatAdapter(
            { ...PRODUCTION_ENDPOINTS, isolated: false },
            metrics,
          );
        }
        const local = process.env.SAT_CONTROLLED_ENDPOINT;
        if (!local) throw new Error('SAT_CONTROLLED_ENDPOINT_REQUIRED');
        return new SatAdapter(
          {
            ...(Object.fromEntries(
              Object.keys(PRODUCTION_ENDPOINTS).map((k) => [
                k,
                local + '/' + k,
              ]),
            ) as typeof PRODUCTION_ENDPOINTS),
            isolated: true,
          },
          metrics,
        );
      },
    },
    SatWorker,
  ],
  exports: [SatWorker],
})
export class SatWorkerModule {}
