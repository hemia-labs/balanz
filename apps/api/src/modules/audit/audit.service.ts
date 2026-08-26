import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { Repository } from 'typeorm';
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

  record(manager: EntityManager, event: AuditEventInput): Promise<AuditEvent> {
    const repository = manager.getRepository(AuditEvent);
    return repository.save(
      repository.create(this.withRequestCorrelation(event)),
    );
  }

  recordDirect(event: AuditEventInput): Promise<AuditEvent> {
    if (!this.repository) {
      throw new Error('Audit repository is not configured');
    }
    return this.repository.save(
      this.repository.create(this.withRequestCorrelation(event)),
    );
  }

  private withRequestCorrelation(event: AuditEventInput): AuditEventInput {
    return {
      ...event,
      correlationId: this.correlation?.current() ?? event.correlationId,
    };
  }
}
