import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { PermissionKey } from '../../common/auth/permission-catalog';
import { hasRecentReauthentication } from '../../common/auth/authorization-contract';
import { AuditService } from '../audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../audit/entities/audit-event.entity';
import type { AuthSession } from '../sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { AuthorizationService } from '../sessions/authorization.service';
import { ClientAccountScopeService } from './client-account-scope.service';

export interface FiscalAuthorizationInput {
  permission: PermissionKey;
  clientAccountId: string;
  objectType: string;
  objectId?: string | null;
  requireReauthentication?: boolean;
}

@Injectable()
export class FiscalAuthorizationService {
  constructor(
    private readonly scope: ClientAccountScopeService,
    private readonly audit: AuditService,
    private readonly sessions: AuthorizationService,
  ) {}

  async authorizeWorker(
    sessionId: string,
    correlationId: string,
    input: FiscalAuthorizationInput,
  ): Promise<{ session: AuthSession; context: SessionAuthorizationContext }> {
    const resolved = await this.sessions.revalidateSession(sessionId);
    await this.authorize(
      resolved.session,
      resolved.context,
      { correlationId, ipAddress: null },
      input,
    );
    return resolved;
  }

  async authorize(
    session: AuthSession,
    context: SessionAuthorizationContext,
    request: RequestContext,
    input: FiscalAuthorizationInput,
  ): Promise<void> {
    if (
      !context.tenantActive ||
      !context.organizationId ||
      !context.membershipId
    ) {
      await this.denied(
        context,
        request,
        input,
        AuditDecision.DENY,
        'INACTIVE_TENANT',
      );
      throw new ForbiddenException('Active tenant required');
    }
    if (!context.mfaVerifiedAt || context.mfaStatus !== 'active') {
      await this.denied(
        context,
        request,
        input,
        AuditDecision.MFA_REQUIRED,
        'MFA_REQUIRED',
      );
      throw new UnauthorizedException('MFA_REQUIRED');
    }
    if (!context.permissions.includes(input.permission)) {
      await this.denied(
        context,
        request,
        input,
        AuditDecision.DENY,
        'INSUFFICIENT_PERMISSION',
      );
      throw new ForbiddenException('Insufficient permissions');
    }
    try {
      await this.scope.requireAccessibleAccount(input.clientAccountId, context);
    } catch (error) {
      await this.denied(
        context,
        request,
        input,
        AuditDecision.OUT_OF_SCOPE,
        'OUT_OF_SCOPE',
      );
      throw error;
    }
    if (
      input.requireReauthentication &&
      !hasRecentReauthentication(session.mfaVerifiedAt)
    ) {
      await this.denied(
        context,
        request,
        input,
        AuditDecision.REAUTHENTICATION_REQUIRED,
        'REAUTHENTICATION_REQUIRED',
      );
      throw new UnauthorizedException('REAUTHENTICATION_REQUIRED');
    }
  }

  private async denied(
    context: SessionAuthorizationContext,
    request: RequestContext,
    input: FiscalAuthorizationInput,
    decision: AuditDecision,
    reason: string,
  ): Promise<void> {
    await this.audit.recordDirect({
      organizationId: context.organizationId,
      actorType: AuditActorType.USER,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      servicePrincipal: null,
      supportGrantId: null,
      clientAccountId:
        decision === AuditDecision.OUT_OF_SCOPE ? null : input.clientAccountId,
      legalEntityId: null,
      action: 'AUTHORIZATION_EVALUATED',
      permissionKey: input.permission,
      decision,
      objectType: input.objectType,
      objectId: decision === AuditDecision.OUT_OF_SCOPE ? null : input.objectId,
      reason,
      correlationId: request.correlationId,
      ipAddress: request.ipAddress,
      metadata: {},
    });
  }
}
