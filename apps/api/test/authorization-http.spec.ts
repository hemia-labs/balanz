/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FiscalOperationsController } from '../src/modules/fiscal-operations/fiscal-operations.controller';
import { FiscalOperationsService } from '../src/modules/fiscal-operations/fiscal-operations.service';
import { PrivateObjectAccessService } from '../src/modules/fiscal-operations/private-object-access.service';
import { SessionGuard } from '../src/common/guards/session.guard';
import { TenantAccessGuard } from '../src/common/guards/tenant-access.guard';

class AuthorizedRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.authSession = { id: randomUUID(), mfaVerifiedAt: new Date() };
    request.tenantContext = {
      userId: randomUUID(),
      sessionId: randomUUID(),
      organizationId: randomUUID(),
      membershipId: randomUUID(),
      permissions: ['exports.generate'],
      assignedAccountIds: [randomUUID()],
      tenantActive: true,
    };
    return true;
  }
}

describe('TA-P0-003-04 HTTP authorization evidence', () => {
  let app: INestApplication;
  const operations = {
    createExport: jest.fn(),
    createSatDownload: jest.fn(),
  };
  const objects = { createAccessUrl: jest.fn(), consume: jest.fn() };
  const accountId = randomUUID();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FiscalOperationsController],
      providers: [
        { provide: FiscalOperationsService, useValue: operations },
        { provide: PrivateObjectAccessService, useValue: objects },
      ],
    })
      .overrideGuard(SessionGuard)
      .useClass(AuthorizedRequestGuard)
      .overrideGuard(TenantAccessGuard)
      .useClass(AuthorizedRequestGuard)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => app.close());

  it.each([
    ['MFA_REQUIRED', new UnauthorizedException('MFA_REQUIRED'), 401],
    ['DENY', new ForbiddenException('Insufficient permissions'), 403],
    ['OUT_OF_SCOPE', new NotFoundException('Resource not found'), 404],
    ['INVALID_STATE', new ConflictException('Invalid period state'), 409],
  ])(
    'returns %s as HTTP %s without a successful mutation',
    async (_case, error, status) => {
      operations.createExport.mockRejectedValueOnce(error);
      const response = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .send({ clientAccountId: accountId, massive: false })
        .expect(status);
      expect(response.body.statusCode).toBe(status);
      expect(operations.createExport).toHaveBeenCalledTimes(1);
    },
  );

  it('returns 201 only after the authorized service completes', async () => {
    operations.createExport.mockResolvedValueOnce({
      id: randomUUID(),
      status: 'queued',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/exports')
      .send({ clientAccountId: accountId, massive: false })
      .expect(201);
    expect(response.body).toMatchObject({ status: 'queued' });
  });
});
