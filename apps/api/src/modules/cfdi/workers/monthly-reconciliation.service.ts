import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { FiscalTenantTransactionService } from '../../../database/rls/fiscal-tenant-transaction.service';
import { CFDI_PARSER_PORT, type CfdiParserPort } from '../../cfdi-parser';
import { OBJECT_STORAGE_PORT } from '../../object-storage/object-storage.tokens';
import type { ObjectStoragePort } from '../../object-storage/ports/object-storage.port';
export interface MonthlyReconciliationClaim {
  cfdi_id: string;
  organization_id: string;
  lease_token: string;
  status: string;
}
/** Maintenance of fiscal participation, on the existing worker reconciliation cycle. */
@Injectable()
export class MonthlyReconciliationService {
  constructor(
    private readonly transactions: FiscalTenantTransactionService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    @Inject(CFDI_PARSER_PORT) private readonly parser: CfdiParserPort,
  ) {}
  async reconcile() {
    const claims = await this.transactions.runWorkerMaintenance((m) =>
      m.query<MonthlyReconciliationClaim[]>(
        'SELECT * FROM claim_monthly_reconciliation()',
      ),
    );
    for (const claim of claims) {
      try {
        if (claim.status === 'legacy' || claim.status === 'failed') {
          const [{ available }] = await this.transactions.runAsWorker(
            { organizationId: claim.organization_id },
            (m) =>
              m.query<{ available: boolean }[]>(
                'SELECT EXISTS(SELECT 1 FROM cfdi_period_intents WHERE cfdi_id=$1) AS available',
                [claim.cfdi_id],
              ),
          );
          if (!available) await this.recoverLegacy(claim);
        }
        await resolveMonthlyClaim(this.transactions, claim);
      } catch {
        await this.transactions.runAsWorker(
          { organizationId: claim.organization_id },
          (m) =>
            m.query(
              `UPDATE cfdi_period_reconciliations SET status='failed',error_code='PARTICIPATION_RECONCILIATION_FAILED',next_attempt_at=clock_timestamp()+interval '5 minutes',lease_token=NULL,lease_until=NULL WHERE cfdi_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,
              [claim.cfdi_id, claim.lease_token],
            ),
        );
      }
    }
    return claims.length;
  }
  private async recoverLegacy(claim: MonthlyReconciliationClaim) {
    const row = await this.transactions.runAsWorker(
      { organizationId: claim.organization_id },
      async (m) => {
        const [c] = await m.query<
          {
            client_account_id: string;
            legal_entity_id: string;
            normalized_uuid: string;
            issued_at: Date;
            object_key: string;
            sha256: string;
            size_bytes: string;
            timezone: string | null;
            malware_scan_status: string;
          }[]
        >(
          `SELECT c.client_account_id,c.legal_entity_id,c.normalized_uuid,c.issued_at,o.object_key,o.sha256,o.size_bytes,o.malware_scan_status,(SELECT min(pc.timezone) FROM period_cfdis pc WHERE pc.cfdi_id=c.id) AS timezone FROM cfdis c JOIN stored_objects o ON o.id=c.source_object_id WHERE c.id=$1 AND c.organization_id=$2`,
          [claim.cfdi_id, claim.organization_id],
        );
        if (
          !c ||
          c.malware_scan_status !== 'clean' ||
          Number(c.size_bytes) > 5 * 1024 * 1024
        )
          throw new Error('Original not available for bounded recovery');
        const dates = await m.query<
          { type: string; ordinal: number; date: Date }[]
        >(
          `SELECT 'payment' AS type,ordinal,payment_date AS date FROM cfdi_payments WHERE cfdi_id=$1 UNION ALL SELECT 'payroll',1,payment_date FROM cfdi_payrolls WHERE cfdi_id=$1`,
          [claim.cfdi_id],
        );
        return { ...c, dates };
      },
    );
    const signal = AbortSignal.timeout(15000);
    const stream = await this.storage.openReadStream(row.object_key, signal);
    const chunks: Buffer[] = [];
    let length = 0;
    const hash = createHash('sha256');
    try {
      for await (const part of stream) {
        const b = Buffer.isBuffer(part)
          ? part
          : Buffer.from(part as Uint8Array);
        length += b.length;
        if (length > 5 * 1024 * 1024) throw new Error('Recovery size limit');
        hash.update(b);
        chunks.push(b);
      }
    } finally {
      stream.destroy();
    }
    if (length !== Number(row.size_bytes) || hash.digest('hex') !== row.sha256)
      throw new Error('Original integrity mismatch');
    const parsed = await this.parser.parse(
      Readable.from(Buffer.concat(chunks)),
      { signal },
    );
    const d = parsed.document;
    if (d.stamp.uuid.toLowerCase() !== row.normalized_uuid.toLowerCase())
      throw new Error('Original identity mismatch');
    const candidates: {
      type: string;
      ordinal: number;
      literal: string;
      date: Date;
    }[] = [];
    if (['I', 'E', 'T'].includes(d.documentType))
      candidates.push({
        type: 'document_issue',
        ordinal: 1,
        literal: d.issuedAt,
        date: row.issued_at,
      });
    if (d.documentType === 'P')
      for (const [i, p] of (d.payments?.payments ?? []).entries()) {
        const date = row.dates.find(
          (x) => x.type === 'payment' && x.ordinal === i + 1,
        )?.date;
        if (!date) throw new Error('Persisted payment date missing');
        candidates.push({
          type: 'payment',
          ordinal: i + 1,
          literal: p.paidAt,
          date,
        });
      }
    if (d.documentType === 'N' && d.payroll) {
      const date = row.dates.find((x) => x.type === 'payroll')?.date;
      if (!date) throw new Error('Persisted payroll date missing');
      candidates.push({
        type: 'payroll',
        ordinal: 1,
        literal: d.payroll.paymentDate,
        date,
      });
    }
    await this.transactions.runAsWorker(
      { organizationId: claim.organization_id },
      async (m) => {
        const [valid] = await m.query<{ cfdi_id: string }[]>(
          'SELECT cfdi_id FROM cfdi_period_reconciliations WHERE cfdi_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE',
          [claim.cfdi_id, claim.lease_token],
        );
        if (!valid) return;
        for (const c of candidates)
          await m.query(
            `INSERT INTO cfdi_period_intents(id,organization_id,client_account_id,legal_entity_id,cfdi_id,participation_type,source_ordinal,literal_date,source_date,source_year,source_month,timezone,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'cfdi-period-participation/1.0.0') ON CONFLICT DO NOTHING`,
            [
              randomUUID(),
              claim.organization_id,
              row.client_account_id,
              row.legal_entity_id,
              claim.cfdi_id,
              c.type,
              c.ordinal,
              c.literal,
              c.date,
              Number(c.literal.slice(0, 4)),
              Number(c.literal.slice(5, 7)),
              row.timezone ?? 'historical-unrecorded',
            ],
          );
        await m.query(
          `UPDATE cfdi_period_reconciliations SET status='ready',error_code=NULL WHERE cfdi_id=$1 AND lease_token=$2`,
          [claim.cfdi_id, claim.lease_token],
        );
      },
    );
  }
}

export async function resolveMonthlyClaim(
  transactions: FiscalTenantTransactionService,
  claim: MonthlyReconciliationClaim,
) {
  await transactions.runAsWorker(
    { organizationId: claim.organization_id },
    async (m) => {
      const [row] = await m.query<
        {
          cfdi_id: string;
          client_account_id: string;
          legal_entity_id: string;
        }[]
      >(
        'SELECT cfdi_id,client_account_id,legal_entity_id FROM cfdi_period_reconciliations WHERE cfdi_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE',
        [claim.cfdi_id, claim.lease_token],
      );
      if (!row) return;
      await m.query(
        `INSERT INTO period_cfdis(id,organization_id,client_account_id,legal_entity_id,cfdi_id,period_id,participation_type,policy_version,timezone,source_date,source_ordinal,origin,created_by_membership_id)
 SELECT gen_random_uuid(),i.organization_id,i.client_account_id,i.legal_entity_id,i.cfdi_id,p.id,i.participation_type,i.policy_version,i.timezone,i.source_date,i.source_ordinal,'automatic',NULL FROM cfdi_period_intents i JOIN fiscal_years y ON y.organization_id=i.organization_id AND y.client_account_id=i.client_account_id AND y.legal_entity_id=i.legal_entity_id AND y.year=i.source_year JOIN periods p ON p.fiscal_year_id=y.id AND p.month=i.source_month WHERE i.cfdi_id=$1 ON CONFLICT DO NOTHING`,
        [claim.cfdi_id],
      );
      const [{ remaining }] = await m.query<{ remaining: string }[]>(
        `SELECT count(*)::text AS remaining FROM cfdi_period_intents i WHERE i.cfdi_id=$1 AND NOT EXISTS(SELECT 1 FROM period_cfdis p WHERE p.cfdi_id=i.cfdi_id AND p.participation_type=i.participation_type AND p.source_ordinal=i.source_ordinal)`,
        [claim.cfdi_id],
      );
      await m.query(
        `UPDATE cfdi_period_reconciliations SET status=$3::varchar,resolved_at=CASE WHEN $3::varchar='resolved' THEN clock_timestamp() ELSE NULL END,lease_token=NULL,lease_until=NULL,error_code=NULL,next_attempt_at=clock_timestamp()+interval '1 minute' WHERE cfdi_id=$1 AND lease_token=$2`,
        [
          claim.cfdi_id,
          claim.lease_token,
          Number(remaining) === 0 ? 'resolved' : 'ready',
        ],
      );
      if (Number(remaining) === 0)
        await m.query(
          `INSERT INTO audit_events(organization_id,actor_type,service_principal,client_account_id,legal_entity_id,action,decision,object_type,object_id,correlation_id) VALUES($1,'service','cfdi-worker',$2,$3,'monthly.participation_reconciled','ALLOW','cfdi',$4,$5)`,
          [
            claim.organization_id,
            row.client_account_id,
            row.legal_entity_id,
            claim.cfdi_id,
            randomUUID(),
          ],
        );
    },
  );
}
