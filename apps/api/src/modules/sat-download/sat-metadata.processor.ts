import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { parseMetadata, type MetadataRow } from './metadata-parser';
import { SatError } from './sat-contract';
import type { ClaimResult } from '../ingestion/services/ingestion-job.repository';
import type { ArchiveEntry } from '../cfdi/workers/zip-extractor';
import {
  ZipWorkerPersistenceService,
  hashStream,
} from '../cfdi/workers/zip-worker-persistence.service';
@Injectable()
export class SatMetadataProcessor {
  constructor(private readonly persistence: ZipWorkerPersistenceService) {}
  async process(
    job: ClaimResult,
    entry: ArchiveEntry,
    stream: Readable,
    signal: AbortSignal,
  ) {
    if (!entry.metadataText === true) {
      await hashStream(stream);
      return;
    }
    const scope = await this.persistence.run(job, async (m) => {
      await this.persistence.fence(m, job);
      const rows: { id: string; rfc: string }[] = await m.query(
        'SELECT p.id,e.rfc FROM sat_packages p JOIN legal_entities e ON e.id=p.legal_entity_id AND e.organization_id=p.organization_id WHERE p.ingestion_job_id=$1',
        [job.jobId],
      );
      return rows[0];
    });
    if (!scope) throw new SatError('SAT_METADATA_SCOPE');
    const previous = await this.persistence.run(job, (m) =>
      m.query<{ technical_status: string }[]>(
        'SELECT technical_status FROM ingestion_items WHERE ingestion_job_id=$1 AND ordinal=$2',
        [job.jobId, entry.ordinal],
      ),
    );
    if (previous[0]?.technical_status === 'terminal') {
      await hashStream(stream);
      return;
    }
    let error: string | null = null,
      rows: MetadataRow[] = [];
    const flush = async () => {
      if (!rows.length) return;
      const batch = rows;
      rows = [];
      await this.persistence.run(job, async (m) => {
        await this.persistence.fence(m, job, true);
        for (const row of batch) {
          if (row.effect === 'N') throw new SatError('SAT_PAYROLL_UNSUPPORTED');
          if (row.issuer !== scope.rfc && row.receiver !== scope.rfc)
            throw new SatError('SAT_METADATA_FOREIGN');
          await m.query(
            `INSERT INTO sat_metadata_observations(id,organization_id,client_account_id,legal_entity_id,package_id,cfdi_uuid,issuer_rfc,receiver_rfc,issued_at,certified_at,total,effect,sat_status,cancelled_at,row_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(package_id,cfdi_uuid) DO NOTHING`,
            [
              randomUUID(),
              job.organizationId,
              job.clientAccountId,
              job.legalEntityId,
              scope.id,
              row.uuid,
              row.issuer,
              row.receiver,
              row.issuedAt,
              row.certifiedAt,
              row.total,
              row.effect,
              row.status,
              row.cancelledAt,
              row.sha256,
            ],
          );
          const stored: { row_sha256: string }[] = await m.query(
            'SELECT row_sha256 FROM sat_metadata_observations WHERE package_id=$1 AND cfdi_uuid=$2',
            [scope.id, row.uuid],
          );
          if (stored[0]?.row_sha256 !== row.sha256)
            throw new SatError('SAT_METADATA_CONFLICT');
        }
      });
    };
    try {
      for await (const row of parseMetadata(
        stream.iterator({ destroyOnReturn: false }),
      )) {
        signal.throwIfAborted();
        rows.push(row);
        if (rows.length === 100) await flush();
      }
      await flush();
    } catch (e) {
      error = e instanceof SatError ? e.code : 'SAT_METADATA_INVALID';
      rows = [];
      await hashStream(stream);
    }
    await this.persistence.run(job, async (m) => {
      await this.persistence.fence(m, job, true);
      await m.query(
        `UPDATE ingestion_items SET technical_status='terminal',product_result=$3,error_code=$4,processed_at=clock_timestamp() WHERE ingestion_job_id=$1 AND ordinal=$2`,
        [job.jobId, entry.ordinal, error ? 'invalid' : 'incorporated', error],
      );
      await m.query(
        `UPDATE ingestion_jobs SET pending_items=(SELECT count(*) FROM ingestion_items WHERE ingestion_job_id=$1 AND technical_status='pending'),incorporated_items=(SELECT count(*) FROM ingestion_items WHERE ingestion_job_id=$1 AND product_result='incorporated'),invalid_items=(SELECT count(*) FROM ingestion_items WHERE ingestion_job_id=$1 AND product_result='invalid'),unsupported_items=(SELECT count(*) FROM ingestion_items WHERE ingestion_job_id=$1 AND product_result='unsupported'),counters_reconciled_at=clock_timestamp() WHERE id=$1`,
        [job.jobId],
      );
    });
  }
}
