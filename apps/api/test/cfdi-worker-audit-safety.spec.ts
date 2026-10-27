import type { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import type { CfdiParseResult } from '../src/modules/cfdi-parser';
import {
  CfdiWorkerPersistenceService,
  zonedDateTime,
} from '../src/modules/cfdi/workers/cfdi-worker-persistence.service';
import type { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import type { ClaimResult } from '../src/modules/ingestion/services/ingestion-job.repository';
import type { WorkerInput } from '../src/modules/cfdi/workers/cfdi-worker-persistence.service';
import { Readable } from 'node:stream';
import { CfdiQueryService } from '../src/modules/cfdi/services/cfdi-query.service';
import type { ClientAccountScopeService } from '../src/modules/client-accounts/client-account-scope.service';
import type { ObjectStoragePort } from '../src/modules/object-storage/ports/object-storage.port';
import type { SessionAuthorizationContext } from '../src/modules/sessions/session.types';

const XML_CANARY =
  '<cfdi:Comprobante Descripcion="SYNTHETIC_XML_AUDIT_CANARY" />';

const claim: ClaimResult = {
  jobId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  clientAccountId: '33333333-3333-4333-8333-333333333333',
  legalEntityId: '44444444-4444-4444-8444-444444444444',
  sourceType: 'manual_xml',
  uploadId: '55555555-5555-4555-8555-555555555555',
  rootObjectId: '66666666-6666-4666-8666-666666666666',
  requestedByMembershipId: '77777777-7777-4777-8777-777777777777',
  correlationId: '88888888-8888-4888-8888-888888888888',
  attemptCount: 1,
  queueAgeSeconds: 0,
  version: 2,
  recovered: false,
  workerId: 'worker:test',
  leaseToken: 'worker:test:lease',
};

const input: WorkerInput = {
  objectId: claim.rootObjectId!,
  objectKey: 'objects/aa/private-object-key',
  sha256: 'a'.repeat(64),
  sizeBytes: 128,
  lifecycleState: 'uploaded',
  scanStatus: 'clean',
  legalEntityRfc: 'AAA010101AAA',
  itemId: '99999999-9999-4999-8999-999999999999',
  itemStatus: 'processing',
  itemResult: null,
  hasIssues: false,
};

const parsedWithCanary = {
  parserVersion: 'balanz-cfdi-saxes/1.0.0',
  schemaVersion: 'sat-cfdi-4.0+tfd-1.1@synthetic',
  sizeBytes: 128,
  document: {
    version: '4.0',
    documentType: 'I',
    stamp: {
      uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      stampedAt: '2026-09-03T12:00:00',
    },
    issuer: { rfc: 'AAA010101AAA' },
    receiver: { rfc: 'BBB010101BBB' },
    concepts: [{ description: XML_CANARY }],
  },
} as unknown as CfdiParseResult;

describe('CfdiWorkerPersistenceService audit safety', () => {
  it.each([true, false])(
    'preserves the source but quarantines a distinct duplicate (same object: %s)',
    async (sameObject) => {
      const sourceId = sameObject
        ? input.objectId
        : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const stored = {
        object_key: input.objectKey,
        size_bytes: String(input.sizeBytes),
        lifecycle_state: 'available',
        malware_scan_status: 'clean',
        quarantine_reason_code: null as string | null,
        retention_until: null as Date | null,
        version: 8,
      };
      const before = { ...stored };
      const query = jest.fn((sql: string, parameters?: unknown[]) => {
        if (sql.includes('FROM legal_entities entity')) {
          return Promise.resolve([
            { rfc: input.legalEntityRfc, timezone: 'America/Mexico_City' },
          ]);
        }
        if (sql.includes('FROM cfdis cfdi')) {
          return Promise.resolve([
            { id: sourceId, source_object_id: sourceId, sha256: input.sha256 },
          ]);
        }
        if (sql.includes('UPDATE stored_objects')) {
          expect(parameters?.[1]).toBe(input.objectId);
          stored.lifecycle_state = 'quarantined';
          stored.quarantine_reason_code = 'CFDI_DUPLICATE';
          stored.retention_until = new Date('2030-01-01T00:00:00.000Z');
          stored.version += 1;
          return Promise.resolve([]);
        }
        if (sql.includes('FROM cfdi_access_grants')) {
          return Promise.resolve([
            {
              id: sourceId,
              client_account_id: claim.clientAccountId,
              legal_entity_id: claim.legalEntityId,
              object_id: input.objectId,
            },
          ]);
        }
        if (sql.includes('FROM stored_objects'))
          return Promise.resolve([stored]);
        if (sql.includes('SELECT id FROM'))
          return Promise.resolve([{ id: claim.jobId }]);
        if (
          sql.includes('pg_advisory_xact_lock') ||
          sql.includes('UPDATE ingestion_items') ||
          sql.includes('INSERT INTO audit_events')
        )
          return Promise.resolve([]);
        throw new Error(`Unexpected duplicate query: ${sql}`);
      });
      const manager = { query } as unknown as EntityManager;
      const run = (
        _scope: unknown,
        work: (manager: EntityManager) => Promise<unknown>,
      ) => work(manager);
      const transactions = {
        run,
        runAsWorker: run,
      } as unknown as FiscalTenantTransactionService;
      const config = {
        getOrThrow: () => ({
          retention: {
            duplicateBytesHours: 24,
            invalidObjectDays: 30,
            malwareQuarantineDays: 30,
          },
          storage: { signedUrlTtlSeconds: 60 },
        }),
        get: () => 'api/v1',
      } as unknown as ConfigService;
      const service = new CfdiWorkerPersistenceService(transactions, config);

      // Another retry was queued before the first one published this source.
      await expect(
        service.publishParsed(claim, input, parsedWithCanary),
      ).resolves.toEqual({
        completion: 'completed',
        result: 'duplicate',
      });
      if (!sameObject) {
        expect(stored.lifecycle_state).toBe('quarantined');
        expect(stored.quarantine_reason_code).toBe('CFDI_DUPLICATE');
        expect(stored.retention_until).not.toBeNull();
        return;
      }
      expect(stored).toEqual(before);
      const stream = Readable.from('<xml/>');
      const storage = { openReadStream: jest.fn().mockResolvedValue(stream) };
      const access = new CfdiQueryService(
        transactions,
        {
          requireAccessibleAccountWithManager: jest.fn().mockResolvedValue({}),
        } as unknown as ClientAccountScopeService,
        storage as unknown as ObjectStoragePort,
        config,
      );
      await expect(
        access.consumeAccessGrant(
          sourceId,
          'a'.repeat(43),
          {
            organizationId: claim.organizationId,
            membershipId: claim.requestedByMembershipId,
            sessionId: claim.jobId,
          } as SessionAuthorizationContext,
          { correlationId: claim.correlationId, ipAddress: '127.0.0.1' },
        ),
      ).resolves.toEqual({ stream, sizeBytes: input.sizeBytes });
      expect(storage.openReadStream).toHaveBeenCalledWith(input.objectKey);
    },
  );

  it('publishes an allowlisted audit event without XML or object-key data', async () => {
    const calls: Array<{ sql: string; parameters?: unknown[] }> = [];
    const manager = {
      query: jest.fn((sql: string, parameters?: unknown[]) => {
        calls.push({ sql, parameters });
        if (
          sql.includes('SELECT id FROM ingestion_jobs') ||
          sql.includes('SELECT id FROM published')
        ) {
          return Promise.resolve([{ id: claim.jobId }]);
        }
        return Promise.resolve([]);
      }),
    } as unknown as jest.Mocked<EntityManager>;
    const transactions = {
      runAsWorker: jest.fn(
        async (
          _scope: unknown,
          work: (transactionManager: EntityManager) => Promise<unknown>,
        ) => work(manager),
      ),
    } as unknown as FiscalTenantTransactionService;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        retention: {
          duplicateBytesHours: 24,
          invalidObjectDays: 30,
          malwareQuarantineDays: 30,
        },
      }),
    } as unknown as ConfigService;
    const service = new CfdiWorkerPersistenceService(transactions, config);

    await expect(
      service.publishRejected(
        claim,
        input,
        'invalid',
        'XML_MALFORMED',
        parsedWithCanary,
      ),
    ).resolves.toEqual({
      completion: 'completed_with_issues',
      result: 'invalid',
    });

    const auditCalls = calls.filter(({ sql }) =>
      sql.includes('INSERT INTO audit_events'),
    );
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]?.parameters).toEqual([
      claim.organizationId,
      claim.clientAccountId,
      claim.legalEntityId,
      input.itemId,
      claim.correlationId,
      'invalid',
    ]);
    const serializedAudit = JSON.stringify(auditCalls);
    expect(serializedAudit).not.toContain(XML_CANARY);
    expect(serializedAudit).not.toContain(input.objectKey);
    expect(serializedAudit).not.toContain('<?xml');
    expect(serializedAudit).not.toContain('<cfdi:');
  });
});

describe('CFDI source-date validation', () => {
  it.each([
    '2026-99-99T12:30:00',
    '2026-02-30T12:30:00',
    '2026-01-01T24:00:00',
  ])('rejects a calendar value that Date.UTC would normalize: %s', (value) => {
    expect(() => zonedDateTime(value, 'America/Mexico_City')).toThrow(
      'XML_MALFORMED',
    );
  });

  it('preserves a valid wall-clock value in the configured timezone', () => {
    expect(
      zonedDateTime('2026-09-03T12:30:00', 'America/Mexico_City').toISOString(),
    ).toBe('2026-09-03T18:30:00.000Z');
  });
});
