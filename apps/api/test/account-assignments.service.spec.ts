import { AccountAssignmentsService } from '../src/modules/client-accounts/account-assignments.service';
import {
  AccountAssignmentStatus,
  AssignmentResponsibility,
} from '../src/modules/client-accounts/entities/account-assignment.entity';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

const tenant: SessionAuthorizationContext = {
  userId: 'user-1',
  sessionId: 'session-1',
  organizationId: 'org-1',
  membershipId: 'membership-actor',
  role: 'owner',
  permissions: ['clients.assign'],
  assignedAccountIds: [],
  accountAccessMode: 'tenant',
  mfaVerifiedAt: new Date(),
  requiresMfa: true,
  mfaStatus: 'active',
  expiresAt: new Date(Date.now() + 60_000),
  tenantActive: true,
};

describe('AccountAssignmentsService invariants', () => {
  it('rejects removing the last primary assignment', async () => {
    const assignment = {
      id: 'assignment-1',
      organizationId: 'org-1',
      clientAccountId: 'account-1',
      membershipId: 'membership-primary',
      status: AccountAssignmentStatus.ACTIVE,
      responsibility: AssignmentResponsibility.PRIMARY,
    };
    const assignmentRepository = {
      findOne: jest.fn().mockResolvedValue(assignment),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(assignmentRepository),
    };
    const dataSource = {
      transaction: jest.fn((work: (value: typeof manager) => unknown) =>
        work(manager),
      ),
    };
    const scope = {
      requireAccessibleAccount: jest.fn().mockResolvedValue({
        id: 'account-1',
        organizationId: 'org-1',
      }),
      requireAccessibleAccountWithManager: jest.fn().mockResolvedValue({
        id: 'account-1',
        organizationId: 'org-1',
      }),
    };
    const service = new AccountAssignmentsService(
      {} as never,
      {} as never,
      dataSource as never,
      scope as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.revoke('account-1', 'assignment-1', tenant, {
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
        ipAddress: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('maps the active-primary constraint to a stable 409', async () => {
    const dataSource = {
      transaction: jest.fn().mockRejectedValue({
        constraint: 'uq_account_assignments_active_primary',
      }),
    };
    const scope = {
      requireAccessibleAccount: jest.fn().mockResolvedValue({
        id: 'account-1',
        organizationId: 'org-1',
      }),
    };
    const service = new AccountAssignmentsService(
      {} as never,
      {} as never,
      dataSource as never,
      scope as never,
      {} as never,
      {} as never,
    );

    try {
      await service.create(
        'account-1',
        {
          membershipId: 'membership-2',
          responsibility: AssignmentResponsibility.PRIMARY,
        },
        tenant,
        {
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
          ipAddress: null,
        },
      );
      throw new Error('expected a conflict');
    } catch (error) {
      expect(error).toMatchObject({ status: 409 });
      expect((error as { response: unknown }).response).toEqual(
        expect.objectContaining({ code: 'PRIMARY_ASSIGNMENT_CONFLICT' }),
      );
    }
  });
});
