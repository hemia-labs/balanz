import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { isPermissionKey } from '../../common/auth/permission-catalog';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../audit/entities/audit-event.entity';
import { FiscalAuthorizationService } from '../client-accounts/fiscal-authorization.service';
import type { AuthSession } from '../sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { ObjectAccessGrant } from './entities/object-access-grant.entity';
import {
  PrivateObject,
  PrivateObjectStatus,
} from './entities/private-object.entity';

@Injectable()
export class PrivateObjectAccessService {
  constructor(
    @InjectRepository(PrivateObject)
    private readonly objects: Repository<PrivateObject>,
    private readonly dataSource: DataSource,
    private readonly authorization: FiscalAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async createAccessUrl(
    objectId: string,
    session: AuthSession,
    context: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    const object = await this.findVisibleObject(objectId, context);
    if (!isPermissionKey(object.permissionKey))
      throw new NotFoundException('Object not found');
    await this.authorization.authorize(session, context, request, {
      permission: object.permissionKey,
      clientAccountId: object.clientAccountId,
      objectType: 'private_object',
      objectId: object.id,
    });
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ObjectAccessGrant).save({
        objectId: object.id,
        organizationId: object.organizationId,
        membershipId: context.membershipId!,
        sessionId: session.id,
        tokenHash: this.hash(rawToken),
        expiresAt,
        usedAt: null,
      });
      await this.audit.record(manager, {
        organizationId: object.organizationId,
        actorType: AuditActorType.USER,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        servicePrincipal: null,
        supportGrantId: null,
        clientAccountId: object.clientAccountId,
        legalEntityId: null,
        action: 'OBJECT_ACCESS_URL_CREATED',
        permissionKey: object.permissionKey,
        decision: AuditDecision.ALLOW,
        objectType: 'private_object',
        objectId: object.id,
        reason: null,
        correlationId: request.correlationId,
        ipAddress: request.ipAddress,
        metadata: { expiresAt: expiresAt.toISOString() },
      });
    });
    return {
      url: `/objects/${object.id}/content?token=${rawToken}`,
      expiresAt,
    };
  }

  async consume(
    objectId: string,
    rawToken: string,
    session: AuthSession,
    context: SessionAuthorizationContext,
    request: RequestContext,
  ): Promise<string> {
    const object = await this.findVisibleObject(objectId, context);
    if (!isPermissionKey(object.permissionKey))
      throw new NotFoundException('Object not found');
    await this.authorization.authorize(session, context, request, {
      permission: object.permissionKey,
      clientAccountId: object.clientAccountId,
      objectType: 'private_object',
      objectId: object.id,
    });
    return this.dataSource.transaction(async (manager) => {
      const grant = await manager.getRepository(ObjectAccessGrant).findOne({
        where: {
          objectId,
          tokenHash: this.hash(rawToken),
          sessionId: session.id,
          membershipId: context.membershipId!,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!grant || grant.usedAt || grant.expiresAt.getTime() <= Date.now()) {
        throw new NotFoundException('Object not found');
      }
      grant.usedAt = new Date();
      await manager.getRepository(ObjectAccessGrant).save(grant);
      await this.audit.record(manager, {
        organizationId: object.organizationId,
        actorType: AuditActorType.USER,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        servicePrincipal: null,
        supportGrantId: null,
        clientAccountId: object.clientAccountId,
        legalEntityId: null,
        action: 'PRIVATE_OBJECT_ACCESSED',
        permissionKey: object.permissionKey,
        decision: AuditDecision.ALLOW,
        objectType: 'private_object',
        objectId: object.id,
        reason: null,
        correlationId: request.correlationId,
        ipAddress: request.ipAddress,
        metadata: {},
      });
      return object.storageKey;
    });
  }

  private async findVisibleObject(
    objectId: string,
    context: SessionAuthorizationContext,
  ): Promise<PrivateObject> {
    if (!context.organizationId)
      throw new NotFoundException('Object not found');
    const object = await this.objects.findOne({
      where: {
        id: objectId,
        organizationId: context.organizationId,
        status: PrivateObjectStatus.AVAILABLE,
      },
    });
    if (!object) throw new NotFoundException('Object not found');
    return object;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
