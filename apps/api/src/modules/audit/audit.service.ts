import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  Repository,
  type QueryDeepPartialEntity,
} from 'typeorm';
import { AuditEvent } from './entities/audit-event.entity';
import { CorrelationIdService } from '../../common/correlation/correlation-id.service';

export type AuditEventInput = Omit<AuditEvent, 'id' | 'occurredAt'>;

@Injectable()
export class AuditService {
  constructor(
    @Optional()
    @InjectRepository(AuditEvent)
    private readonly repository?: Repository<AuditEvent>,
    @Optional()
    private readonly correlation?: CorrelationIdService,
  ) {}

  async record(manager: EntityManager, event: AuditEventInput): Promise<void> {
    await this.insert(
      manager.getRepository(AuditEvent),
      this.withRequestCorrelation(event),
    );
  }

  async recordDirect(event: AuditEventInput): Promise<void> {
    if (!this.repository) {
      throw new Error('Audit repository is not configured');
    }
    await this.insert(this.repository, this.withRequestCorrelation(event));
  }

  private async insert(
    repository: Repository<AuditEvent>,
    event: AuditEventInput,
  ): Promise<void> {
    const value = repository.create(event);

    await repository
      .createQueryBuilder()
      .insert()
      .into(AuditEvent)
      // TypeORM's deep-partial type does not model JSON columns typed as
      // Record<string, unknown>, although the entity value is valid here.
      .values(value as unknown as QueryDeepPartialEntity<AuditEvent>)
      .updateEntity(false)
      .execute();
  }

  private withRequestCorrelation(event: AuditEventInput): AuditEventInput {
    return {
      ...event,
      correlationId: this.correlation?.current() ?? event.correlationId,
    };
  }
}
