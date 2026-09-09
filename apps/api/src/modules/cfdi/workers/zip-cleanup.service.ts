import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FiscalTenantTransactionService } from '../../../database/rls/fiscal-tenant-transaction.service';
import { FiscalMetricsService } from '../../../common/observability/fiscal-metrics.service';
import { OBJECT_STORAGE_PORT } from '../../object-storage/object-storage.tokens';
import type { ObjectStoragePort } from '../../object-storage/ports/object-storage.port';

@Injectable()
export class ZipCleanupService {
  constructor(
    private readonly transactions: FiscalTenantTransactionService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    private readonly metrics: FiscalMetricsService,
  ) {}
  async reconcile() {
    const candidates = await this.transactions.runWorkerMaintenance((manager) =>
      manager.query<Array<{ object_id: string; organization_id: string }>>(
        `SELECT * FROM claim_zip_cleanup()`,
      ),
    );
    for (const candidate of candidates) {
      try {
        const row = await this.transactions.runAsWorker(
          { organizationId: candidate.organization_id },
          async (manager) => {
            const rows = await manager.query<
              Array<{
                object_key: string;
                client_account_id: string;
                legal_entity_id: string;
              }>
            >(
              `SELECT object_key,client_account_id,legal_entity_id FROM stored_objects
            WHERE id=$1 AND organization_id=$2 AND cleanup_requested_at IS NOT NULL AND lifecycle_state='rejected'`,
              [candidate.object_id, candidate.organization_id],
            );
            return rows[0];
          },
        );
        if (!row) continue;
        await this.storage.cleanupAbandonedWrite?.(row.object_key);
        await this.storage.delete(row.object_key);
        await this.transactions.runAsWorker(
          { organizationId: candidate.organization_id },
          async (manager) => {
            await manager.query(
              `UPDATE stored_objects SET lifecycle_state='deleted',deleted_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
            WHERE id=$1 AND organization_id=$2 AND cleanup_requested_at IS NOT NULL AND lifecycle_state='rejected'`,
              [candidate.object_id, candidate.organization_id],
            );
            await manager.query(
              `INSERT INTO audit_events (organization_id,actor_type,service_principal,client_account_id,legal_entity_id,action,decision,object_type,object_id,correlation_id)
            VALUES ($1,'service','cfdi-worker',$2,$3,'ingestion.zip.object_deleted','ALLOW','stored_object',$4,$5)`,
              [
                candidate.organization_id,
                row.client_account_id,
                row.legal_entity_id,
                candidate.object_id,
                randomUUID(),
              ],
            );
          },
        );
      } catch {
        this.metrics.increment('zip_cleanup_failures_total', {});
      }
    }
  }
}
