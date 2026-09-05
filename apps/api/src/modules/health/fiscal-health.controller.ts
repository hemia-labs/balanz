import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  applyReadinessStatus,
  type FiscalProcessName,
  FiscalReadinessService,
} from './fiscal-readiness.service';

export const FISCAL_PROCESS_NAME = Symbol('FISCAL_PROCESS_NAME');

@Controller()
export class FiscalHealthController {
  constructor(
    @Inject(FISCAL_PROCESS_NAME) private readonly process: FiscalProcessName,
    private readonly readiness: FiscalReadinessService,
  ) {}

  @Get('liveness')
  @Header('Cache-Control', 'no-store')
  liveness(@Res({ passthrough: true }) response: Response) {
    const result = this.readiness.liveness(this.process);
    response.status(result.status === 'down' ? 503 : 200);
    return result;
  }

  @Get('readiness')
  @Header('Cache-Control', 'no-store')
  async ready(@Res({ passthrough: true }) response: Response) {
    const result = await this.readiness.check(this.process);
    applyReadinessStatus(response, result);
    return result;
  }
}
