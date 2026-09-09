import { ZipCleanupService } from '../src/modules/cfdi/workers/zip-cleanup.service';
import type { FiscalTenantTransactionService } from '../src/database/rls/fiscal-tenant-transaction.service';
import type { ObjectStoragePort } from '../src/modules/object-storage/ports/object-storage.port';
import { FiscalMetricsService } from '../src/common/observability/fiscal-metrics.service';
import type { EntityManager } from 'typeorm';

function setup() {
  const candidate = { organization_id: 'tenant-id', object_id: 'object-id' };
  const query = jest.fn((sql: string) =>
    Promise.resolve(
      sql.startsWith('SELECT object_key')
        ? [
            {
              object_key: 'opaque',
              client_account_id: 'account',
              legal_entity_id: 'entity',
            },
          ]
        : [],
    ),
  );
  const manager = { query } as unknown as EntityManager;
  const maintenance = jest.fn().mockResolvedValue([candidate]);
  const transactions = {
    runWorkerMaintenance: maintenance,
    runAsWorker: jest.fn(
      (_scope: unknown, work: (m: EntityManager) => unknown) => work(manager),
    ),
  } as unknown as FiscalTenantTransactionService;
  const storage = {
    delete: jest.fn().mockResolvedValue(undefined),
    cleanupAbandonedWrite: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ObjectStoragePort>;
  const metrics = new FiscalMetricsService();
  const increment = jest.spyOn(metrics, 'increment');
  return {
    service: new ZipCleanupService(transactions, storage, metrics),
    storage,
    query,
    maintenance,
    increment,
    transactions,
  };
}
describe('durable ZIP object cleanup', () => {
  it('deletes only after a durable claim and records deleted state and audit', async () => {
    const s = setup();
    await s.service.reconcile();
    expect(s.storage.cleanupAbandonedWrite).toHaveBeenCalledWith('opaque');
    expect(s.storage.delete).toHaveBeenCalledWith('opaque');
    expect(
      s.query.mock.calls.filter(([sql]) =>
        sql.startsWith('UPDATE stored_objects'),
      ),
    ).toHaveLength(1);
    expect(
      s.query.mock.calls.filter(([sql]) =>
        sql.includes('INSERT INTO audit_events'),
      ),
    ).toHaveLength(1);
  });
  it('storage failure leaves claim durable for a later idempotent retry', async () => {
    const s = setup();
    s.storage.delete.mockRejectedValueOnce(new Error('unavailable'));
    await s.service.reconcile();
    expect(
      s.query.mock.calls.some(([sql]) =>
        sql.startsWith('UPDATE stored_objects'),
      ),
    ).toBe(false);
    expect(s.increment).toHaveBeenCalledWith('zip_cleanup_failures_total', {});
    await s.service.reconcile();
    expect(
      s.query.mock.calls.some(([sql]) =>
        sql.startsWith('UPDATE stored_objects'),
      ),
    ).toBe(true);
  });
  it('does not touch objects that maintenance excludes for active jobs, retention or hold', async () => {
    const s = setup();
    s.maintenance.mockResolvedValue([]);
    await s.service.reconcile();
    expect(s.storage.delete).not.toHaveBeenCalled();
    expect(s.transactions.runAsWorker).not.toHaveBeenCalled();
  });
  it('rechecks claim state under tenant RLS before byte deletion', async () => {
    const s = setup();
    s.query.mockResolvedValue([]);
    await s.service.reconcile();
    expect(s.storage.delete).not.toHaveBeenCalled();
    expect(s.transactions.runAsWorker).toHaveBeenCalledWith(
      { organizationId: 'tenant-id' },
      expect.any(Function),
    );
  });
});
