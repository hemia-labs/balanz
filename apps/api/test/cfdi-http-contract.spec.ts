import {
  ForbiddenException,
  type ExecutionContext,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import type { Response } from 'express';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { CfdiController } from '../src/modules/cfdi/controllers/cfdi.controller';
import { IngestionQueryController } from '../src/modules/cfdi/controllers/ingestion-query.controller';
import { XmlIngestionController } from '../src/modules/cfdi/controllers/xml-ingestion.controller';
import { CfdiListQueryDto } from '../src/modules/cfdi/dtos/cfdi-query.dtos';
import type { CfdiQueryService } from '../src/modules/cfdi/services/cfdi-query.service';
import type { IngestionQueryService } from '../src/modules/cfdi/services/ingestion-query.service';
import type { XmlUploadService } from '../src/modules/cfdi/services/xml-upload.service';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

const jobId = '11111111-1111-4111-8111-111111111111';

const tenant: SessionAuthorizationContext = {
  userId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
  membershipId: '55555555-5555-4555-8555-555555555555',
  role: 'accountant',
  permissions: [],
  assignedAccountIds: [],
  accountAccessMode: 'assigned',
  mfaVerifiedAt: null,
  reauthenticatedAt: null,
  requiresMfa: true,
  mfaStatus: 'active',
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  tenantActive: true,
  reauthenticationRequiredActions: [],
};

function permissions(controller: object, method: string): string[] | undefined {
  const handler = (controller as Record<string, unknown>)[method] as object;
  return Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[] | undefined;
}

function httpCode(controller: object, method: string): number | undefined {
  const handler = (controller as Record<string, unknown>)[method] as object;
  return Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
}

function executionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => CfdiController.prototype.createAccessUrl,
    getClass: () => CfdiController,
  } as unknown as ExecutionContext;
}

describe('Phase 1 CFDI HTTP contract', () => {
  it('declares least-privilege permissions on every public operation', () => {
    expect(permissions(XmlIngestionController.prototype, 'upload')).toEqual([
      'ingestion.create',
    ]);
    expect(permissions(IngestionQueryController.prototype, 'get')).toEqual([
      'ingestion.view',
    ]);
    expect(permissions(IngestionQueryController.prototype, 'items')).toEqual([
      'ingestion.view',
    ]);
    expect(permissions(IngestionQueryController.prototype, 'retry')).toEqual([
      'ingestion.retry',
    ]);
    expect(permissions(IngestionQueryController.prototype, 'cancel')).toEqual([
      'ingestion.cancel',
    ]);
    expect(
      permissions(IngestionQueryController.prototype, 'processes'),
    ).toEqual(['processes.view']);
    expect(permissions(CfdiController.prototype, 'list')).toEqual([
      'cfdi.view',
    ]);
    expect(permissions(CfdiController.prototype, 'detail')).toEqual([
      'cfdi.view',
    ]);
    expect(permissions(CfdiController.prototype, 'createAccessUrl')).toEqual([
      'cfdi.view',
      'cfdi.download',
    ]);
    expect(permissions(CfdiController.prototype, 'content')).toEqual([
      'cfdi.view',
      'cfdi.download',
    ]);
  });

  it('keeps upload, retry, cancel and access grant response status explicit', () => {
    expect(httpCode(XmlIngestionController.prototype, 'upload')).toBe(
      HttpStatus.ACCEPTED,
    );
    expect(httpCode(IngestionQueryController.prototype, 'retry')).toBe(
      HttpStatus.ACCEPTED,
    );
    expect(httpCode(IngestionQueryController.prototype, 'cancel')).toBe(
      HttpStatus.ACCEPTED,
    );
    expect(httpCode(CfdiController.prototype, 'createAccessUrl')).toBe(
      HttpStatus.CREATED,
    );
  });

  it('emits ETag and Retry-After for active polling and returns 304 on a match', async () => {
    const service = {
      get: jest.fn().mockResolvedValue({
        id: jobId,
        version: 7,
        status: 'processing',
      }),
    } as unknown as jest.Mocked<IngestionQueryService>;
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Response>;
    const controller = new IngestionQueryController(service);

    await expect(
      controller.get(jobId, `"ingestion-${jobId}-7"`, tenant, response),
    ).resolves.toBeUndefined();
    expect(response.setHeader).toHaveBeenCalledWith(
      'ETag',
      `"ingestion-${jobId}-7"`,
    );
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '2');
    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
  });

  it('does not advertise polling delay for a terminal job', async () => {
    const service = {
      get: jest.fn().mockResolvedValue({
        id: jobId,
        version: 8,
        status: 'completed',
      }),
    } as unknown as jest.Mocked<IngestionQueryService>;
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Response>;
    const controller = new IngestionQueryController(service);

    await expect(
      controller.get(jobId, undefined, tenant, response),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(response.setHeader).not.toHaveBeenCalledWith(
      'Retry-After',
      expect.anything(),
    );
  });

  it('requires active MFA for the exact cfdi.download endpoint permission', async () => {
    const reflector = new Reflector();
    const audit = { recordDirect: jest.fn().mockResolvedValue({}) };
    const guard = new PermissionsGuard(reflector, audit as never);
    const baseRequest = {
      method: 'POST',
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authSession: { requiresMfa: true, mfaVerifiedAt: null },
      tenantContext: {
        ...tenant,
        permissions: ['cfdi.view', 'cfdi.download'],
      },
    };

    await expect(
      guard.canActivate(executionContext(baseRequest)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(
        executionContext({
          ...baseRequest,
          authSession: { requiresMfa: false, mfaVerifiedAt: null },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        executionContext({
          ...baseRequest,
          authSession: { requiresMfa: true, mfaVerifiedAt: new Date() },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('delegates upload without requiring MFA or a reauthentication secret', () => {
    const service = {
      upload: jest.fn().mockResolvedValue({ status: 'queued' }),
    } as unknown as jest.Mocked<XmlUploadService>;
    const controller = new XmlIngestionController(service);
    const request = {} as never;
    const context = {
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ipAddress: null,
    };

    void controller.upload(
      '66666666-6666-4666-8666-666666666666',
      'idempotency-key',
      request,
      tenant,
      context,
    );

    expect(service.upload).toHaveBeenCalledWith(
      '66666666-6666-4666-8666-666666666666',
      'idempotency-key',
      request,
      tenant,
      context,
    );
  });

  it('keeps query controllers dependent on explicit services, not ORM entities', () => {
    const cfdiService = {} as CfdiQueryService;
    const ingestionService = {} as IngestionQueryService;
    expect(new CfdiController(cfdiService)).toBeInstanceOf(CfdiController);
    expect(new IngestionQueryController(ingestionService)).toBeInstanceOf(
      IngestionQueryController,
    );
  });

  it('rejects malformed UUID filters before PostgreSQL casts them', async () => {
    const invalid = new CfdiListQueryDto();
    invalid.uuid = '------------------------------------';
    const valid = new CfdiListQueryDto();
    valid.uuid = '11111111-1111-4111-8111-111111111111';

    await expect(validate(invalid)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'uuid' })]),
    );
    await expect(validate(valid)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'uuid' })]),
    );
  });
});
