import { AuditService } from '../src/modules/audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
  AuditEvent,
} from '../src/modules/audit/entities/audit-event.entity';
import { CorrelationIdService } from '../src/common/correlation/correlation-id.service';

describe('AuditService', () => {
  it('records registration metadata without credentials or tokens', async () => {
    const repository = {
      create: jest.fn((value: Partial<AuditEvent>) => value),
      save: jest.fn((value: Partial<AuditEvent>) => Promise.resolve(value)),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };

    const event = {
      organizationId: 'organization-1',
      actorType: AuditActorType.USER,
      actorUserId: 'user-1',
      actorMembershipId: 'membership-1',
      action: 'auth.register.created',
      decision: AuditDecision.ALLOW,
      objectType: 'organization',
      objectId: 'organization-1',
      correlationId: '19b403ac-8d5f-4dc1-8e09-17f62cbf4d2b',
      metadata: { schemaVersion: 1, subscriptionType: 'trial' },
    };

    await new AuditService().record(manager as never, event);

    expect(repository.create).toHaveBeenCalledWith(event);
  });

  it('uses the request correlation ID instead of an operation-local fallback', async () => {
    const repository = {
      create: jest.fn((value: Partial<AuditEvent>) => value),
      save: jest.fn((value: Partial<AuditEvent>) => Promise.resolve(value)),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };
    const correlation = new CorrelationIdService();
    const requestId = '550e8400-e29b-41d4-a716-446655440000';
    const service = new AuditService(undefined, correlation);

    await new Promise<void>((resolve, reject) => {
      correlation.run(requestId, () => {
        void service
          .record(manager as never, {
            organizationId: null,
            actorType: AuditActorType.SYSTEM,
            action: 'test',
            decision: AuditDecision.ALLOW,
            objectType: 'test',
            correlationId: '19b403ac-8d5f-4dc1-8e09-17f62cbf4d2b',
            metadata: {},
          })
          .then(() => resolve())
          .catch(reject);
      });
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: requestId }),
    );
  });
});
