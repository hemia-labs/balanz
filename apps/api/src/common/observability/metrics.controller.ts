import { Controller, Get, Header } from '@nestjs/common';
import { FiscalMetricsService } from './fiscal-metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: FiscalMetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metricsText(): string {
    return this.metrics.render();
  }
}
