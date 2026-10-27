import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class OnboardingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const session = request.authSession;
    if (!session) throw new UnauthorizedException('Session required');
    if (!request.tenantContext) {
      throw new UnauthorizedException('Session context required');
    }
    return true;
  }
}
