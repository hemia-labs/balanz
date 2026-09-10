import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { ObjectStoragePort } from '../object-storage/ports/object-storage.port';
import { OBJECT_STORAGE_PORT } from '../object-storage/object-storage.tokens';
import { EfirmaRepository, type CustodyRow } from './efirma.repository';
import { VaultCustodyAdapter } from './vault-custody.adapter';

@Injectable()
export class EfirmaCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly repository: EfirmaRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  onModuleInit() {
    if (!this.repository.config.enabled) return;
    this.timer = setInterval(() => {
      void this.reconcile().catch(() => undefined);
    }, 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcile(): Promise<void> {
    if (this.running || !this.repository.config.enabled) return;
    this.running = true;
    try {
      // Missing generation also invalidates access; do not delay cleanup until its file returns.
      const generation = await this.repository.generation().catch(() => null);
      const batch: { id: string; organization_id: string }[] =
        await this.repository.transactions.runWorkerMaintenance((manager) =>
          manager.query('SELECT * FROM efirma_reconciliation_batch()'),
        );
      for (const candidate of batch) {
        await this.reconcileOne(
          candidate.organization_id,
          candidate.id,
          generation,
        ).catch(() => {
          this.repository.metrics?.increment(
            'efirma_cleanup_failures_total',
            {},
          );
        });
      }
      const orphans: { id: string; organization_id: string }[] =
        await this.repository.transactions.runWorkerMaintenance((manager) =>
          manager.query('SELECT * FROM efirma_orphan_objects_batch()'),
        );
      for (const orphan of orphans) {
        try {
          const rows: { object_key: string }[] =
            await this.repository.transactions.runAsWorker(
              { organizationId: orphan.organization_id },
              (manager) =>
                manager.query(
                  `SELECT object_key FROM stored_objects WHERE id=$1 AND kind IN('credential_certificate','credential_private_key')
              AND retention_until<clock_timestamp()-interval '35 seconds'`,
                  [orphan.id],
                ),
            );
          if (!rows[0]) continue;
          if (await this.storage.head(rows[0].object_key))
            await this.storage.delete(rows[0].object_key);
          await this.repository.transactions.runAsWorker(
            { organizationId: orphan.organization_id },
            async (manager) => {
              await manager.query(
                `UPDATE stored_objects SET lifecycle_state='deleted',deleted_at=coalesce(deleted_at,clock_timestamp()) WHERE id=$1`,
                [orphan.id],
              );
            },
          );
        } catch {
          this.repository.metrics?.increment(
            'efirma_cleanup_failures_total',
            {},
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  async reconcileOne(
    organizationId: string,
    id: string,
    generation: string | null,
  ): Promise<void> {
    const run = <T>(work: (manager: EntityManager) => Promise<T>) =>
      this.repository.transactions.runAsWorker({ organizationId }, work);
    const claim = randomUUID();
    const row = await run(async (manager) => {
      const rows: CustodyRow[] = await manager.query(
        'SELECT * FROM efirma_sessions WHERE id=$1 FOR UPDATE',
        [id],
      );
      const current = rows[0];
      if (!current) return null;
      if (current.cleanup_completed_at) {
        await manager.query('SELECT purge_efirma_metadata($1)', [id]);
        return null;
      }
      if (
        ['preparing', 'ready', 'claimed', 'unwrapping'].includes(current.status)
      ) {
        const authorized = await this.repository
          .authorized(manager, current)
          .then(
            () => true,
            () => false,
          );
        let terminal: string | null = null;
        if (current.expires_at.getTime() <= Date.now()) terminal = 'expired';
        else if (current.generation !== generation || !authorized)
          terminal = 'revoked';
        else if (
          ['preparing', 'unwrapping'].includes(current.status) &&
          (!current.lease_until || current.lease_until.getTime() < Date.now())
        )
          terminal = 'requires_user_authorization';
        if (terminal) {
          await manager.query(
            `UPDATE efirma_sessions SET status=$2,terminal_at=clock_timestamp(),cleanup_requested_at=clock_timestamp()
            WHERE id=$1`,
            [id, terminal],
          );
          await this.repository.audit(
            manager,
            current,
            `efirma.custody.${terminal}`,
            randomUUID(),
          );
        }
      }
      // Wait for bounded external writes to finish, including their timeout margin.
      const claimed: CustodyRow[] = await manager.query(
        `WITH changed AS (UPDATE efirma_sessions SET cleanup_claim_id=$2,cleanup_lease_until=clock_timestamp()+interval '30 seconds'
        WHERE id=$1 AND cleanup_requested_at IS NOT NULL AND cleanup_completed_at IS NULL
          AND (lease_until IS NULL OR lease_until+interval '5 seconds'<clock_timestamp())
          AND (cleanup_lease_until IS NULL OR cleanup_lease_until<clock_timestamp()) RETURNING *) SELECT * FROM changed`,
        [id, claim],
      );
      return claimed[0] ?? null;
    });
    if (!row) return;
    const objects: { id: string; object_key: string }[] = await run((manager) =>
      manager.query(
        `SELECT id,object_key FROM stored_objects WHERE id=ANY($1::uuid[])
      AND organization_id=$2 AND legal_entity_id=$3 AND kind IN('credential_certificate','credential_private_key')`,
        [
          [row.certificate_object_id, row.private_key_object_id].filter(
            Boolean,
          ),
          organizationId,
          row.legal_entity_id,
        ],
      ),
    );
    for (const object of objects) {
      await this.storage.cleanupAbandonedWrite?.(object.object_key);
      await this.storage.delete(object.object_key);
      await run(async (manager) => {
        await manager.query(
          `UPDATE stored_objects SET lifecycle_state='deleted',deleted_at=coalesce(deleted_at,clock_timestamp())
          WHERE id=$1`,
          [object.id],
        );
      });
    }
    if (
      row.wrapping_accessor &&
      row.status !== 'consumed' &&
      (!row.wrapping_expires_at ||
        row.wrapping_expires_at.getTime() > Date.now())
    ) {
      await new VaultCustodyAdapter(
        this.repository.config.cleanupVault!,
      ).revoke(row.wrapping_accessor);
    }
    await run(async (manager) => {
      const done: CustodyRow[] = await manager.query(
        `WITH changed AS (UPDATE efirma_sessions SET certificate_object_id=NULL,private_key_object_id=NULL,
        wrapped_token_ciphertext=NULL,wrapping_accessor=NULL,wrapping_expires_at=NULL,cleanup_completed_at=clock_timestamp(),
        cleanup_claim_id=NULL,cleanup_lease_until=NULL,claim_id=NULL,lease_until=NULL
        WHERE id=$1 AND cleanup_claim_id=$2 AND cleanup_lease_until>clock_timestamp() RETURNING *) SELECT * FROM changed`,
        [id, claim],
      );
      if (done[0])
        await this.repository.audit(
          manager,
          done[0],
          'efirma.custody.cleaned',
          randomUUID(),
        );
    });
  }
}
