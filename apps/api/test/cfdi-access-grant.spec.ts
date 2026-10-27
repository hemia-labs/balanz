import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import type { EntityManager } from 'typeorm';
import type { RequestContext } from '../src/common/decorators/request-context.decorator';
import type { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import type { ClientAccountScopeService } from '../src/modules/client-accounts/client-account-scope.service';
import { CfdiQueryService } from '../src/modules/cfdi/services/cfdi-query.service';
import type { ObjectStoragePort } from '../src/modules/object-storage/ports/object-storage.port';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

const organizationId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const cfdiId = '55555555-5555-4555-8555-555555555555';
const clientAccountId = '66666666-6666-4666-8666-666666666666';
const legalEntityId = '77777777-7777-4777-8777-777777777777';
const objectId = '88888888-8888-4888-8888-888888888888';
const grantId = '99999999-9999-4999-8999-999999999999';

const tenant: SessionAuthorizationContext = {
  userId,
  sessionId,
  organizationId,
  membershipId,
  role: 'accountant',
  permissions: ['cfdi.view', 'cfdi.download'],
  assignedAccountIds: [clientAccountId],
  accountAccessMode: 'assigned',
  mfaVerifiedAt: new Date('2030-01-01T00:00:00.000Z'),
  reauthenticatedAt: null,
  requiresMfa: true,
  mfaStatus: 'active',
  expiresAt: new Date('2030-01-01T01:00:00.000Z'),
  tenantActive: true,
  reauthenticationRequiredActions: [],
};

const request: RequestContext = {
  correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ipAddress: '127.0.0.1',
};

describe('CFDI one-time access grant', () => {
  it('consumes exactly one grant despite the PostgreSQL UPDATE tuple returned by TypeORM', async () => {
    const rawToken = 'a'.repeat(43);
    const query = jest.fn((sql: string): unknown => {
      if (
        sql.includes('FROM cfdi_access_grants') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: grantId,
            client_account_id: clientAccountId,
            legal_entity_id: legalEntityId,
            object_id: objectId,
          },
        ];
      }
      if (sql.includes('FROM stored_objects')) {
        return [
          {
            object_key: 'cfdi/opaque-object-key',
            size_bytes: '7',
            lifecycle_state: 'available',
            malware_scan_status: 'clean',
          },
        ];
      }
      if (/^\s*UPDATE cfdi_access_grants/.test(sql)) {
        return [[{ id: grantId }], 1];
      }
      if (/^\s*WITH consumed AS/.test(sql)) {
        return [{ id: grantId }];
      }
      if (sql.includes('INSERT INTO audit_events')) return [];
      throw new Error(`Unexpected SQL in access-grant regression: ${sql}`);
    });
    const manager = { query } as unknown as EntityManager;
    const transactions = {
      run: jest.fn(
        (_scope: unknown, work: (manager: EntityManager) => Promise<unknown>) =>
          work(manager),
      ),
    } as unknown as FiscalTenantTransactionService;
    const accountScope = {
      requireAccessibleAccountWithManager: jest.fn().mockResolvedValue({}),
    } as unknown as ClientAccountScopeService;
    const stream = Readable.from('<xml/>');
    const storage = {
      openReadStream: jest.fn().mockResolvedValue(stream),
    } as unknown as ObjectStoragePort;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        storage: { signedUrlTtlSeconds: 60 },
      }),
      get: jest.fn().mockReturnValue('api/v1'),
    } as unknown as ConfigService;
    const service = new CfdiQueryService(
      transactions,
      accountScope,
      storage,
      config,
    );

    await expect(
      service.consumeAccessGrant(cfdiId, rawToken, tenant, request),
    ).resolves.toEqual({ stream, sizeBytes: 7 });
    expect(storage.openReadStream).toHaveBeenCalledWith(
      'cfdi/opaque-object-key',
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.any(Array),
    );
  });
});
