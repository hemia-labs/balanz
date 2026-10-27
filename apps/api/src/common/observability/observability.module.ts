import { Global, Module } from '@nestjs/common';
import { FiscalEventLogger } from './fiscal-event-logger.service';
import { FiscalMetricsService } from './fiscal-metrics.service';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [FiscalEventLogger, FiscalMetricsService],
  exports: [FiscalEventLogger, FiscalMetricsService],
})
export class ObservabilityModule {}
