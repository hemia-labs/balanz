import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class TenantAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.authSession) return false;
    const tenant = request.tenantContext;
    if (!tenant) throw new UnauthorizedException('Session context required');
    if (!tenant.tenantActive) {
      throw new ForbiddenException('Active tenant required');
    }
    return true;
  }
}
