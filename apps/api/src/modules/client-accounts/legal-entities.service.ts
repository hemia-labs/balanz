import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
} from '../audit/entities/audit-event.entity';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { ClientAccountScopeService } from './client-account-scope.service';
import { constraintName, domainError } from './client-domain.errors';
import {
  CreateLegalEntityDto,
  UpdateLegalEntityDto,
} from './dtos/legal-entity.dtos';
import { LegalEntity, LegalEntityStatus } from './entities/legal-entity.entity';

@Injectable()
export class LegalEntitiesService {
  constructor(
    @InjectRepository(LegalEntity)
    private readonly legalEntities: Repository<LegalEntity>,
    private readonly dataSource: DataSource,
    private readonly scope: ClientAccountScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(
    clientAccountId: string,
    includeArchived: boolean,
    tenant: SessionAuthorizationContext,
  ) {
    if (includeArchived && !this.scope.canIncludeArchived(tenant)) {
      throw domainError(
        HttpStatus.FORBIDDEN,
        'ARCHIVED_ACCESS_FORBIDDEN',
        'Archived entities are not available',
      );
    }
    await this.scope.requireAccessibleAccount(
      clientAccountId,
      tenant,
      includeArchived,
    );
    const builder = this.legalEntities
      .createQueryBuilder('entity')
      .where('entity.organization_id = :organizationId', {
        organizationId: tenant.organizationId,
      })
      .andWhere('entity.client_account_id = :clientAccountId', {
        clientAccountId,
      });
    if (!includeArchived)
      builder.andWhere('entity.status <> :archived', {
        archived: LegalEntityStatus.ARCHIVED,
      });
    const entities = await builder
      .orderBy('entity.created_at', 'ASC')
      .getMany();
    return entities.map((entity) => this.response(entity));
  }

  async create(
    clientAccountId: string,
    dto: CreateLegalEntityDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    const account = await this.scope.requireAccessibleAccount(
      clientAccountId,
      tenant,
    );
    const id = randomUUID();
    try {
      return await this.dataSource.transaction(async (manager) => {
        const lockedAccount =
          await this.scope.requireAccessibleAccountWithManager(
            manager,
            account.id,
            tenant,
            false,
            true,
          );
        const entity = await manager.getRepository(LegalEntity).save(
          manager.getRepository(LegalEntity).create({
            id,
            organizationId: lockedAccount.organizationId,
            clientAccountId: lockedAccount.id,
            rfc: dto.rfc,
            legalName: dto.legalName,
            status: LegalEntityStatus.ACTIVE,
            version: 1,
            archivedAt: null,
          }),
        );
        await this.record(
          manager,
          tenant,
          request,
          'LEGAL_ENTITY_CREATED',
          entity,
          { version: 1 },
        );
        return this.response(entity);
      });
    } catch (error) {
      this.translateConstraint(error);
    }
  }

  async update(
    legalEntityId: string,
    dto: UpdateLegalEntityDto,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    const entity = await this.requireEntity(legalEntityId, tenant);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.scope.requireAccessibleAccountWithManager(
          manager,
          entity.clientAccountId,
          tenant,
          false,
          true,
        );
        const current = await manager.getRepository(LegalEntity).findOne({
          where: {
            id: entity.id,
            organizationId: entity.organizationId,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current || current.status === LegalEntityStatus.ARCHIVED) {
          throw domainError(
            HttpStatus.NOT_FOUND,
            'LEGAL_ENTITY_NOT_FOUND',
            'Legal entity not found',
          );
        }
        const values: Record<string, unknown> = {
          version: () => 'version + 1',
          updatedAt: () => 'now()',
        };
        if (dto.rfc !== undefined) values.rfc = dto.rfc;
        if (dto.legalName !== undefined) values.legalName = dto.legalName;
        const result = await manager
          .createQueryBuilder()
          .update(LegalEntity)
          .set(values)
          .where(
            'id = :id AND organization_id = :organizationId AND version = :version AND status <> :archived',
            {
              id: entity.id,
              organizationId: entity.organizationId,
              version: dto.expectedVersion,
              archived: LegalEntityStatus.ARCHIVED,
            },
          )
          .execute();
        if ((result.affected ?? 0) !== 1) {
          throw domainError(
            HttpStatus.CONFLICT,
            'STALE_LEGAL_ENTITY',
            'Legal entity changed; reload and try again',
          );
        }
        const updated = await manager
          .getRepository(LegalEntity)
          .findOneByOrFail({
            id: entity.id,
            organizationId: entity.organizationId,
          });
        await this.record(
          manager,
          tenant,
          request,
          'LEGAL_ENTITY_UPDATED',
          updated,
          { expectedVersion: dto.expectedVersion },
        );
        return this.response(updated);
      });
    } catch (error) {
      this.translateConstraint(error);
    }
  }

  async archive(
    legalEntityId: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ): Promise<void> {
    const existing = await this.requireEntity(legalEntityId, tenant);
    await this.dataSource.transaction(async (manager) => {
      await this.scope.requireAccessibleAccountWithManager(
        manager,
        existing.clientAccountId,
        tenant,
        false,
        true,
      );
      const activeEntities = await manager.getRepository(LegalEntity).find({
        where: {
          organizationId: existing.organizationId,
          clientAccountId: existing.clientAccountId,
          status: LegalEntityStatus.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      const target = activeEntities.find((entity) => entity.id === existing.id);
      if (!target) {
        throw domainError(
          HttpStatus.NOT_FOUND,
          'LEGAL_ENTITY_NOT_FOUND',
          'Legal entity not found',
        );
      }
      if (activeEntities.length <= 1) {
        throw domainError(
          HttpStatus.CONFLICT,
          'LAST_ACTIVE_LEGAL_ENTITY',
          'The last active legal entity cannot be archived',
        );
      }
      target.status = LegalEntityStatus.ARCHIVED;
      target.archivedAt = new Date();
      target.version += 1;
      const archived = await manager.getRepository(LegalEntity).save(target);
      await this.record(
        manager,
        tenant,
        request,
        'LEGAL_ENTITY_ARCHIVED',
        archived,
        { version: archived.version },
      );
    });
  }

  async requireEntity(
    legalEntityId: string,
    tenant: SessionAuthorizationContext,
    allowArchived = false,
  ): Promise<LegalEntity> {
    if (!tenant.organizationId) {
      throw domainError(
        HttpStatus.NOT_FOUND,
        'LEGAL_ENTITY_NOT_FOUND',
        'Legal entity not found',
      );
    }
    const entity = await this.legalEntities.findOneBy({
      id: legalEntityId,
      organizationId: tenant.organizationId,
    });
    if (
      !entity ||
      (entity.status === LegalEntityStatus.ARCHIVED && !allowArchived)
    ) {
      throw domainError(
        HttpStatus.NOT_FOUND,
        'LEGAL_ENTITY_NOT_FOUND',
        'Legal entity not found',
      );
    }
    await this.scope.requireAccessibleAccount(
      entity.clientAccountId,
      tenant,
      allowArchived,
    );
    return entity;
  }

  private response(entity: LegalEntity) {
    return {
      id: entity.id,
      clientAccountId: entity.clientAccountId,
      rfc: entity.rfc,
      legalName: entity.legalName,
      status: entity.status,
      version: entity.version,
      archivedAt: entity.archivedAt ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private record(
    manager: Parameters<AuditService['record']>[0],
    tenant: SessionAuthorizationContext,
    request: RequestContext,
    action: string,
    entity: LegalEntity,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(manager, {
      organizationId: entity.organizationId,
      actorType: AuditActorType.USER,
      actorUserId: tenant.userId,
      actorMembershipId: tenant.membershipId,
      servicePrincipal: null,
      supportGrantId: null,
      clientAccountId: entity.clientAccountId,
      legalEntityId: entity.id,
      action,
      permissionKey: 'fiscal_entities.manage',
      decision: AuditDecision.ALLOW,
      objectType: 'legal_entity',
      objectId: entity.id,
      reason: null,
      correlationId: request.correlationId,
      ipAddress: request.ipAddress,
      metadata,
    });
  }

  private translateConstraint(error: unknown): never {
    if (constraintName(error) === 'uq_legal_entities_active_rfc') {
      throw domainError(
        HttpStatus.CONFLICT,
        'LEGAL_ENTITY_RFC_CONFLICT',
        'RFC already exists in this organization',
      );
    }
    throw error;
  }
}
