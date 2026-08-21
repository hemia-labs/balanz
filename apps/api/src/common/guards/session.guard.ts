import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SessionsService } from '../../modules/sessions/sessions.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const resolved = await this.sessions.resolve(request);
    request.authSession = resolved.session;
    request.tenantContext = resolved.context;
    return true;
  }
}
