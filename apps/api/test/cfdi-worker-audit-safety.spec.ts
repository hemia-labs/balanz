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
