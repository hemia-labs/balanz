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
import { AuditService } from '../../modules/audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../../modules/audit/entities/audit-event.entity';

/**
 * Autorización por permisos. Debe correr DESPUÉS de un guard de autenticación
 * (SessionGuard) que haya poblado `request.authSession` y `request.tenantContext`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Sin @Permissions => endpoint sin restricción de permisos.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const tenantContext = (
      request as Request & {
        tenantContext?: {
          permissions: string[];
          organizationId?: string | null;
          userId?: string | null;
          membershipId?: string | null;
        };
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
        await this.auditDenial(
          request,
          tenantContext,
          required,
          AuditDecision.MFA_REQUIRED,
          'MFA_REQUIRED',
        );
        throw new UnauthorizedException('MFA_REQUIRED');
      }
      if (!authSession.requiresMfa) {
        await this.auditDenial(
          request,
          tenantContext,
          required,
          AuditDecision.DENY,
          'MFA_SETUP_REQUIRED',
        );
        throw new ForbiddenException('MFA_SETUP_REQUIRED');
      }
    }
    if (tenantContext) {
      if (!hasAllPermissions(tenantContext.permissions, required)) {
        await this.auditDenial(
          request,
          tenantContext,
          required,
          AuditDecision.DENY,
          'INSUFFICIENT_PERMISSION',
        );
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

  private auditDenial(
    request: Request,
    tenant:
      | {
          organizationId?: string | null;
          userId?: string | null;
          membershipId?: string | null;
        }
      | undefined,
    required: string[],
    decision: AuditDecision,
    reason: string,
  ) {
    if (!tenant?.organizationId || !request.correlationId) {
      return Promise.resolve();
    }
    const permissionKey =
      required.find((permission) =>
        MFA_SENSITIVE_PERMISSIONS.has(permission),
      ) ?? required[0];
    return this.audit.recordDirect({
      organizationId: tenant.organizationId,
      actorType: AuditActorType.USER,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      action: 'authorization.denied',
      permissionKey,
      decision,
      objectType: 'http_endpoint',
      objectId: null,
      reason,
      correlationId: request.correlationId,
      ipAddress: request.ip || null,
      metadata: { method: request.method },
    });
  }
}
