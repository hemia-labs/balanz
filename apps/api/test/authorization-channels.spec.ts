/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FiscalOperationsService } from '../src/modules/fiscal-operations/fiscal-operations.service';
import { PrivateObjectAccessService } from '../src/modules/fiscal-operations/private-object-access.service';
import {
  FiscalOperationStatus,
  FiscalOperationType,
} from '../src/modules/fiscal-operations/entities/fiscal-operation.entity';
import { PrivateObjectStatus } from '../src/modules/fiscal-operations/entities/private-object.entity';
import type { AuthSession } from '../src/modules/sessions/entities/auth-session.entity';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

describe('TA-P0-003-04 channel authorization', () => {
  const organizationId = randomUUID();
  const membershipId = randomUUID();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const accountId = randomUUID();
  const operationId = randomUUID();
  const objectId = randomUUID();
  const correlationId = randomUUID();
  const session = { id: sessionId, mfaVerifiedAt: new Date() } as AuthSession;
  const context = {
    userId,
    sessionId,
    organizationId,
    membershipId,
    role: 'accountant',
    permissions: ['sat.download', 'exports.generate'],
    assignedAccountIds: [accountId],
    accountAccessMode: 'assigned',
    mfaVerifiedAt: new Date(),
    requiresMfa: true,
    mfaStatus: 'active',
    expiresAt: new Date(Date.now() + 60_000),
    tenantActive: true,
    reauthenticationRequiredActions: ['sat.download', 'exports.generate'],
  } as SessionAuthorizationContext;
  const request = { correlationId, ipAddress: '127.0.0.1' };

  it('does not persist an export when authorization denies the endpoint', async () => {
    const authorization = {
      authorize: jest.fn().mockRejectedValue(new ForbiddenException()),
    };
    const dataSource = { transaction: jest.fn() };
    const operations = { findOne: jest.fn(), update: jest.fn() };
    const service = new FiscalOperationsService(
      operations as never,
      {} as never,
      dataSource as never,
      authorization as never,
      {} as never,
    );

    await expect(
      service.createExport(
        { clientAccountId: accountId, massive: false },
        session,
        context,
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(operations.update).not.toHaveBeenCalled();
  });

  it('revalidates the worker immediately before claiming an operation', async () => {
    const operation = {
      id: operationId,
      sourceSessionId: sessionId,
      clientAccountId: accountId,
      type: FiscalOperationType.EXPORT,
      status: FiscalOperationStatus.QUEUED,
      request: { massive: true },
      expiresAt: new Date(Date.now() + 60_000),
    };
    const operations = {
      findOne: jest.fn().mockResolvedValue(operation),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const authorization = {
      authorizeWorker: jest.fn().mockResolvedValue({ context }),
    };
    const service = new FiscalOperationsService(
      operations as never,
      {} as never,
      {} as never,
      authorization as never,
      {} as never,
    );

    await expect(
      service.authorizeWorker(operationId, correlationId),
    ).resolves.toMatchObject({ operation, authorization: context });
    expect(authorization.authorizeWorker).toHaveBeenCalledWith(
      sessionId,
      correlationId,
      expect.objectContaining({
        permission: 'exports.generate',
        clientAccountId: accountId,
        requireReauthentication: true,
      }),
    );
    expect(
      authorization.authorizeWorker.mock.invocationCallOrder[0],
    ).toBeLessThan(operations.update.mock.invocationCallOrder[0]);
    expect(operations.update).toHaveBeenCalledWith(
      { id: operationId, status: FiscalOperationStatus.QUEUED },
      { status: FiscalOperationStatus.PROCESSING },
    );
  });

  it('expires a stale worker job without executing or delivering it', async () => {
    const operations = {
      findOne: jest.fn().mockResolvedValue({
        id: operationId,
        status: FiscalOperationStatus.QUEUED,
        expiresAt: new Date(Date.now() - 1),
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const authorization = { authorizeWorker: jest.fn() };
    const service = new FiscalOperationsService(
      operations as never,
      {} as never,
      {} as never,
      authorization as never,
      {} as never,
    );
    await expect(
      service.authorizeWorker(operationId, correlationId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(authorization.authorizeWorker).not.toHaveBeenCalled();
    expect(operations.update).toHaveBeenCalledWith(operationId, {
      status: FiscalOperationStatus.EXPIRED,
    });
  });

  it('does not enumerate or mutate a private object from another tenant', async () => {
    const objects = { findOne: jest.fn().mockResolvedValue(null) };
    const authorization = { authorize: jest.fn() };
    const dataSource = { transaction: jest.fn() };
    const service = new PrivateObjectAccessService(
      objects as never,
      dataSource as never,
      authorization as never,
      {} as never,
    );
    await expect(
      service.createAccessUrl(objectId, session, context, request),
    ).rejects.toMatchObject({ status: 404, message: 'Object not found' });
    expect(objects.findOne).toHaveBeenCalledWith({
      where: {
        id: objectId,
        organizationId,
        status: PrivateObjectStatus.AVAILABLE,
      },
    });
    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('creates a short-lived object URL without auditing its token', async () => {
    const object = {
      id: objectId,
      organizationId,
      clientAccountId: accountId,
      permissionKey: 'exports.generate',
      status: PrivateObjectStatus.AVAILABLE,
    };
    const objects = { findOne: jest.fn().mockResolvedValue(object) };
    const grantRepository = { save: jest.fn().mockResolvedValue({}) };
    const manager = {
      getRepository: jest.fn().mockReturnValue(grantRepository),
    };
    const dataSource = {
      transaction: jest.fn((work: (value: unknown) => unknown) =>
        work(manager),
      ),
    };
    const authorization = { authorize: jest.fn().mockResolvedValue(undefined) };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new PrivateObjectAccessService(
      objects as never,
      dataSource as never,
      authorization as never,
      audit as never,
    );

    const result = await service.createAccessUrl(
      objectId,
      session,
      context,
      request,
    );
    const rawToken = new URL(
      result.url,
      'https://local.invalid',
    ).searchParams.get('token');
    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 5 * 60 * 1000,
    );
    expect(grantRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId,
        organizationId,
        membershipId,
        sessionId,
        tokenHash: expect.not.stringMatching(rawToken!),
      }),
    );
    const auditInput = audit.record.mock.calls[0][1];
    expect(auditInput).toMatchObject({
      permissionKey: 'exports.generate',
      decision: 'ALLOW',
      organizationId,
      actorMembershipId: membershipId,
      objectId,
      correlationId,
    });
    expect(JSON.stringify(auditInput)).not.toContain(rawToken);
    expect(JSON.stringify(auditInput)).not.toMatch(/storageKey|xml|secret/i);
  });
});
