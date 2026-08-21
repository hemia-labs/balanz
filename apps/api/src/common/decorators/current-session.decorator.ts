import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthSession } from '../../modules/sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../../modules/sessions/session.types';

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthSession => {
    const request = context.switchToHttp().getRequest<Request>();
    return (request as Request & { authSession: AuthSession }).authSession;
  },
);

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionAuthorizationContext => {
    const request = context.switchToHttp().getRequest<Request>();
    return (request as Request & { tenantContext: SessionAuthorizationContext })
      .tenantContext;
  },
);

export const CurrentAuthorization = CurrentTenant;
