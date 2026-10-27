import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestContext {
  correlationId: string;
  ipAddress: string | null;
}

export const CurrentRequestContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext => {
    const request = context.switchToHttp().getRequest<Request>();
    return {
      correlationId: request.correlationId,
      ipAddress: request.ip || null,
    };
  },
);
