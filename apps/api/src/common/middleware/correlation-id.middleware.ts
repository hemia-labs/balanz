import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { CorrelationIdService } from '../correlation/correlation-id.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly correlation: CorrelationIdService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.get('x-correlation-id');
    request.correlationId =
      supplied && UUID_PATTERN.test(supplied)
        ? supplied.toLowerCase()
        : randomUUID();
    response.setHeader('x-correlation-id', request.correlationId);
    this.correlation.run(request.correlationId, next);
  }
}
