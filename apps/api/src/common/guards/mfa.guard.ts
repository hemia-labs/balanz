import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { MFA_SENSITIVE_PERMISSIONS } from '../../modules/sessions/authorization.service';

@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const sensitive = required?.some((permission) =>
      MFA_SENSITIVE_PERMISSIONS.has(permission),
    );
    if (!sensitive) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const session = (
      request as Request & {
        authSession?: { requiresMfa: boolean; mfaVerifiedAt?: Date | null };
      }
    ).authSession;
    if (!session) throw new UnauthorizedException('Session required');
    if (session.requiresMfa && !session.mfaVerifiedAt) {
      throw new UnauthorizedException('MFA_REQUIRED');
    }
    if (!session.requiresMfa)
      throw new ForbiddenException('MFA_SETUP_REQUIRED');
    return true;
  }
}
