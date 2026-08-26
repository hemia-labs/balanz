import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionsService } from '../../modules/sessions/sessions.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const resolved = await this.sessions.resolve(request);
    if (
      resolved.session.requiresMfa &&
      !resolved.session.mfaVerifiedAt &&
      !this.isMfaCompletionOrLogout(request)
    ) {
      throw new UnauthorizedException('MFA_REQUIRED');
    }
    request.authSession = resolved.session;
    request.tenantContext = resolved.context;
    return true;
  }

  private isMfaCompletionOrLogout(request: Request): boolean {
    const path = request.path || request.url;
    return (
      path.endsWith('/auth/login/mfa') ||
      (request.method === 'DELETE' && path.endsWith('/auth/session'))
    );
  }
}
