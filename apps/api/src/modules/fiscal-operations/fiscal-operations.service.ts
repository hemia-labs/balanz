import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { PermissionKey } from '../../common/auth/permission-catalog';
import { AuditService } from '../audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../audit/entities/audit-event.entity';
import { FiscalAuthorizationService } from '../client-accounts/fiscal-authorization.service';
import {
  LegalEntity,
  LegalEntityStatus,
} from '../client-accounts/entities/legal-entity.entity';
import type { AuthSession } from '../sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import type {
  CreateExportDto,
  CreateSatDownloadJobDto,
} from './dtos/fiscal-operation.dtos';
import {
  FiscalOperation,
  FiscalOperationStatus,
  FiscalOperationType,
} from './entities/fiscal-operation.entity';

@Injectable()
export class FiscalOperationsService {
  constructor(
    @InjectRepository(FiscalOperation)
    private readonly operations: Repository<FiscalOperation>,
    @InjectRepository(LegalEntity)
    private readonly legalEntities: Repository<LegalEntity>,
    private readonly dataSource: DataSource,
    private readonly authorization: FiscalAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async createSatDownload(
    dto: CreateSatDownloadJobDto,
    session: AuthSession,
    context: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    if (!context.organizationId) throw new NotFoundException('RFC not found');
    await this.authorization.authorize(session, context, request, {
      permission: 'sat.download',
      clientAccountId: dto.clientAccountId,
      objectType: 'fiscal_operation',
      requireReauthentication: true,
    });
    const entity = await this.legalEntities.findOne({
      where: {
        organizationId: context.organizationId,
        clientAccountId: dto.clientAccountId,
        rfc: dto.rfc,
        status: LegalEntityStatus.ACTIVE,
      },
    });
    if (!entity) throw new NotFoundException('RFC not found');
    return this.create(
      FiscalOperationType.SAT_DOWNLOAD,
      'sat.download',
      dto.clientAccountId,
      { rfc: dto.rfc },
      true,
      session,
      context,
      request,
    );
  }

  createExport(
    dto: CreateExportDto,
    session: AuthSession,
    context: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    return this.create(
      FiscalOperationType.EXPORT,
      'exports.generate',
      dto.clientAccountId,
      { massive: dto.massive },
      dto.massive,
      session,
      context,
      request,
    );
  }

  /** Entry point for a queue consumer. It revalidates all mutable conditions. */
  async authorizeWorker(operationId: string, correlationId: string) {
    const operation = await this.operations.findOne({
      where: { id: operationId },
    });
    if (!operation || operation.status !== FiscalOperationStatus.QUEUED) {
      throw new NotFoundException('Operation not found');
    }
    if (operation.expiresAt.getTime() <= Date.now()) {
      await this.operations.update(operation.id, {
        status: FiscalOperationStatus.EXPIRED,
      });
      throw new NotFoundException('Operation not found');
    }
    const permission = this.permissionFor(operation.type);
    const resolved = await this.authorization.authorizeWorker(
      operation.sourceSessionId,
      correlationId,
      {
        permission,
        clientAccountId: operation.clientAccountId,
        objectType: 'fiscal_operation',
        objectId: operation.id,
        requireReauthentication:
          operation.type === FiscalOperationType.SAT_DOWNLOAD ||
          operation.request.massive === true,
      },
    );
    const claimed = await this.operations.update(
      { id: operation.id, status: FiscalOperationStatus.QUEUED },
      { status: FiscalOperationStatus.PROCESSING },
    );
    if (claimed.affected !== 1) {
      throw new NotFoundException('Operation not found');
    }
    return { operation, authorization: resolved.context };
  }

  private async create(
    type: FiscalOperationType,
    permission: PermissionKey,
    clientAccountId: string,
    payload: Record<string, unknown>,
    requireReauthentication: boolean,
    session: AuthSession,
    context: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    await this.authorization.authorize(session, context, request, {
      permission,
      clientAccountId,
      objectType: 'fiscal_operation',
      requireReauthentication,
    });
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(FiscalOperation);
      const operation = await repository.save(
        repository.create({
          organizationId: context.organizationId!,
          clientAccountId,
          requestedByMembershipId: context.membershipId!,
          sourceSessionId: session.id,
          type,
          status: FiscalOperationStatus.QUEUED,
          request: payload,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        }),
      );
      await this.audit.record(manager, {
        organizationId: context.organizationId,
        actorType: AuditActorType.USER,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        servicePrincipal: null,
        supportGrantId: null,
        clientAccountId,
        legalEntityId: null,
        action:
          type === FiscalOperationType.SAT_DOWNLOAD
            ? 'SAT_DOWNLOAD_QUEUED'
            : 'EXPORT_QUEUED',
        permissionKey: permission,
        decision: AuditDecision.ALLOW,
        objectType: 'fiscal_operation',
        objectId: operation.id,
        reason: null,
        correlationId: request.correlationId,
        ipAddress: request.ipAddress,
        metadata: { type, massive: payload.massive === true },
      });
      return {
        id: operation.id,
        status: operation.status,
        expiresAt: operation.expiresAt,
      };
    });
  }

  private permissionFor(type: FiscalOperationType): PermissionKey {
    return type === FiscalOperationType.SAT_DOWNLOAD
      ? 'sat.download'
      : 'exports.generate';
  }
}
