import { AuditService } from '../src/modules/audit/audit.service';
import {
  AuditActorType,
  AuditDecision,
  AuditEvent,
} from '../src/modules/audit/entities/audit-event.entity';

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
});
