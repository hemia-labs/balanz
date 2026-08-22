import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { hasAllPermissions } from '../utils/permissions.util';
import { MFA_SENSITIVE_PERMISSIONS } from '../../modules/sessions/authorization.service';

/**
 * Autorización por permisos. Debe correr DESPUÉS de un guard de autenticación
 * (JwtAuthGuard) que haya poblado `request.user`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Sin @Permissions => endpoint sin restricción de permisos.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const tenantContext = (
      request as Request & {
        tenantContext?: { permissions: string[] };
      }
    ).tenantContext;
    const authSession = (
      request as Request & {
        authSession?: { requiresMfa: boolean; mfaVerifiedAt?: Date | null };
      }
    ).authSession;
    if (
      authSession &&
      required.some((permission) => MFA_SENSITIVE_PERMISSIONS.has(permission))
    ) {
      if (authSession.requiresMfa && !authSession.mfaVerifiedAt) {
        throw new UnauthorizedException('MFA_REQUIRED');
      }
      if (!authSession.requiresMfa) {
        throw new ForbiddenException('MFA_SETUP_REQUIRED');
      }
    }
    if (tenantContext) {
      if (!hasAllPermissions(tenantContext.permissions, required)) {
        throw new ForbiddenException('Insufficient permissions');
      }
      return true;
    }

    const user = request.user;

    if (!user || !Array.isArray(user.permissions)) {
      throw new ForbiddenException('Missing permissions');
    }

    if (!hasAllPermissions(user.permissions, required)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
