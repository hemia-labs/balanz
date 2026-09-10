import { Injectable, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  EfirmaRepository,
  digest,
  type SatCustodyBinding,
} from '../efirma/efirma.repository';
import { EfirmaPreparationService } from '../efirma/efirma-preparation.service';
import type { ReceivedCredentials } from '../efirma/receive-credentials';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { CreateSatJobDto, type SatJobRow } from './sat.dtos';
const JOB_COLUMNS = `*,to_char(date_from,'YYYY-MM-DD"T"HH24:MI:SS') AS date_from_local,to_char(date_to,'YYYY-MM-DD"T"HH24:MI:SS') AS date_to_local`;
export function satHttp(code: string, status = 409): never {
  throw new HttpException(
    { code, message: 'No fue posible completar la operación SAT.' },
    status,
  );
}
export function satEnabled() {
  if (process.env.SAT_ENABLED !== 'true') satHttp('SAT_DISABLED', 503);
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.SAT_QA_ISOLATED !== 'true' ||
    process.env.EFIRMA_ENABLED !== 'true'
  )
    satHttp('SAT_ACTIVATION_NOT_AUTHORIZED', 503);
}
@Injectable()
export class SatService {
  constructor(
    readonly custody: EfirmaRepository,
    private readonly preparation: EfirmaPreparationService,
  ) {}
  async authorize(
    manager: EntityManager,
    tenant: SessionAuthorizationContext,
    entity: string,
  ) {
    if (!tenant.permissions.includes('sat.download'))
      satHttp('SAT_SCOPE_DENIED', 403);
    return this.custody.entity(manager, tenant, entity);
  }
  async create(
    tenant: SessionAuthorizationContext,
    input: CreateSatJobDto,
    key: string,
    correlation: string,
  ) {
    satEnabled();
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(key))
      satHttp('SAT_IDEMPOTENCY_REQUIRED', 400);
    if (
      input.direction === 'folio'
        ? !input.folio ||
          input.contentType !== 'xml' ||
          !!input.dateFrom ||
          !!input.dateTo
        : !!input.folio ||
          !input.dateFrom ||
          !input.dateTo ||
          !Number.isFinite(Date.parse(input.dateFrom)) ||
          !Number.isFinite(Date.parse(input.dateTo)) ||
          input.dateFrom > input.dateTo
    )
      satHttp('SAT_FILTER_INVALID', 400);
    if (
      input.direction === 'received' &&
      input.contentType === 'xml' &&
      input.documentStatus !== 'active'
    )
      satHttp('SAT_RECEIVED_XML_ACTIVE_REQUIRED', 400);
    const fingerprint = digest(
      JSON.stringify([
        'sat_request_v1',
        input.direction,
        input.contentType,
        input.dateFrom ?? null,
        input.dateTo ?? null,
        input.folio?.toUpperCase() ?? null,
        input.documentType,
        input.documentStatus,
      ]),
    );
    return this.custody.run(tenant, async (m) => {
      const entity = await this.authorize(m, tenant, input.legalEntityId);
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        tenant.organizationId + ':sat:' + tenant.membershipId + ':' + key,
      ]);
      const old: (SatJobRow & { request_fingerprint: string })[] =
        await m.query(
          'SELECT ' +
            JOB_COLUMNS +
            ' FROM sat_download_jobs WHERE organization_id=$1 AND membership_id=$2 AND legal_entity_id=$3 AND idempotency_key=$4',
          [
            tenant.organizationId,
            tenant.membershipId,
            input.legalEntityId,
            key,
          ],
        );
      if (old[0]) {
        if (old[0].request_fingerprint !== fingerprint)
          satHttp('SAT_IDEMPOTENCY_CONFLICT');
        return this.dto(old[0]);
      }
      const rows: SatJobRow[] = await m.query(
        `INSERT INTO sat_download_jobs(id,organization_id,client_account_id,legal_entity_id,user_id,membership_id,idempotency_key,request_fingerprint,direction,content_type,date_from,date_to,folio,document_type,document_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${JOB_COLUMNS}`,
        [
          randomUUID(),
          tenant.organizationId,
          entity.client_account_id,
          input.legalEntityId,
          tenant.userId,
          tenant.membershipId,
          key,
          fingerprint,
          input.direction,
          input.contentType,
          input.dateFrom ?? null,
          input.dateTo ?? null,
          input.folio ?? null,
          input.documentType,
          input.documentStatus,
        ],
      );
      const row = rows[0];
      await m.query(
        'INSERT INTO sat_requests(id,organization_id,client_account_id,legal_entity_id,job_id) VALUES($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          row.organization_id,
          row.client_account_id,
          row.legal_entity_id,
          row.id,
        ],
      );
      await this.audit(m, row, 'sat.created', correlation);
      return this.dto(row);
    });
  }
  async load(
    m: EntityManager,
    tenant: SessionAuthorizationContext,
    id: string,
    lock = false,
  ) {
    const rows: SatJobRow[] = await m.query(
      'SELECT ' +
        JOB_COLUMNS +
        ' FROM sat_download_jobs WHERE id=$1 ' +
        (lock ? 'FOR UPDATE' : ''),
      [id],
    );
    if (!rows[0]) satHttp('SAT_NOT_FOUND', 404);
    await this.authorize(m, tenant, rows[0].legal_entity_id);
    return rows[0];
  }
  async list(
    tenant: SessionAuthorizationContext,
    entity: string,
    page: number,
    limit: number,
  ) {
    satEnabled();
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      satHttp('SAT_PAGE_INVALID', 400);
    return this.custody.run(tenant, async (m) => {
      await this.authorize(m, tenant, entity);
      const rows: SatJobRow[] = await m.query(
        'SELECT ' +
          JOB_COLUMNS +
          ' FROM sat_download_jobs WHERE legal_entity_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',
        [entity, limit, (page - 1) * limit],
      );
      return {
        items: rows.map((r) => this.dto(r)),
        page,
        hasMore: rows.length === limit,
      };
    });
  }
  async get(tenant: SessionAuthorizationContext, id: string) {
    satEnabled();
    return this.custody.run(tenant, async (m) => {
      const row = await this.load(m, tenant, id);
      const requests: Record<string, unknown>[] = await m.query(
        'SELECT external_id,submission_state,sat_state,sat_code,sat_request_code,cfdi_count,verified_at FROM sat_requests WHERE job_id=$1',
        [id],
      );
      const observations: { count: number }[] = await m.query(
        'SELECT count(*)::int count FROM sat_metadata_observations o JOIN sat_packages p ON p.id=o.package_id JOIN sat_requests r ON r.id=p.request_id WHERE r.job_id=$1',
        [id],
      );
      const counters: {
        total: number;
        retrieved: number;
        processed: number;
        incorporated: number;
        issues: number;
      }[] = await m.query(
        `SELECT count(*)::int total,count(*) FILTER(WHERE p.downloaded_at IS NOT NULL)::int retrieved,count(*) FILTER(WHERE p.status IN('completed','with_issues'))::int processed,coalesce(sum(CASE WHEN r.job_id IN(SELECT id FROM sat_download_jobs WHERE content_type='xml') THEN i.incorporated_items ELSE 0 END),0)::int incorporated,coalesce(sum(i.invalid_items+i.unsupported_items+i.foreign_items+i.internal_error_items),0)::int issues FROM sat_packages p JOIN sat_requests r ON r.id=p.request_id LEFT JOIN ingestion_jobs i ON i.id=p.ingestion_job_id WHERE r.job_id=$1`,
        [id],
      );
      return {
        ...this.dto(row),
        request: requests[0],
        counters: {
          ...counters[0],
          metadataObservations: observations[0].count,
        },
      };
    });
  }
  async packages(
    tenant: SessionAuthorizationContext,
    id: string,
    after: number,
    limit: number,
  ) {
    satEnabled();
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      satHttp('SAT_PAGE_INVALID', 400);
    return this.custody.run(tenant, async (m) => {
      await this.load(m, tenant, id);
      const rows: Record<string, unknown>[] = await m.query(
        `SELECT p.id,p.ordinal,p.status,p.external_id,p.download_attempts,p.uncertain_attempts,p.error_code,p.ingestion_job_id,p.generated_at,p.official_expires_at,p.first_observed_at FROM sat_packages p JOIN sat_requests r ON r.id=p.request_id WHERE r.job_id=$1 AND p.ordinal>$2 ORDER BY p.ordinal LIMIT $3`,
        [id, after, limit],
      );
      return {
        items: rows,
        nextAfter: rows.length === limit ? rows.at(-1)!.ordinal : null,
      };
    });
  }
  async items(
    tenant: SessionAuthorizationContext,
    id: string,
    packageId: string,
    after: number,
    limit: number,
  ) {
    satEnabled();
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      satHttp('SAT_PAGE_INVALID', 400);
    return this.custody.run(tenant, async (m) => {
      await this.load(m, tenant, id);
      const rows: {
        id: string;
        ordinal: number;
        result: string | null;
        cfdiId: string | null;
      }[] = await m.query(
        `SELECT i.id,i.ordinal,i.safe_filename AS "filename",i.product_result AS result,i.error_code AS "errorCode",CASE WHEN $5::boolean THEN i.cfdi_id ELSE NULL END AS "cfdiId" FROM ingestion_items i JOIN sat_packages p ON p.ingestion_job_id=i.ingestion_job_id JOIN sat_requests r ON r.id=p.request_id WHERE r.job_id=$1 AND p.id=$2 AND i.ordinal>$3 ORDER BY i.ordinal LIMIT $4`,
        [id, packageId, after, limit, tenant.permissions.includes('cfdi.view')],
      );
      return {
        items: rows,
        nextAfter: rows.length === limit ? rows.at(-1)!.ordinal : null,
      };
    });
  }
  async binding(
    tenant: SessionAuthorizationContext,
    id: string,
  ): Promise<SatCustodyBinding> {
    satEnabled();
    return this.custody.run(tenant, async (m) => {
      const row = await this.load(m, tenant, id, true);
      if (
        row.user_id !== tenant.userId ||
        row.membership_id !== tenant.membershipId ||
        row.terminal_at ||
        row.cancel_requested_at ||
        ![
          'authorization_pending',
          'requires_user_authorization',
          'waiting_sat',
        ].includes(row.status)
      )
        satHttp('SAT_AUTHORIZATION_NOT_ALLOWED');
      if (
        row.error_code === 'SAT_TECHNICAL_FAILURE' &&
        (row.technical_retries >= 3 ||
          row.next_attempt_at.getTime() > Date.now())
      )
        satHttp('SAT_RETRY_BACKOFF');
      const requests: { submission_state: string }[] = await m.query(
        'SELECT submission_state FROM sat_requests WHERE job_id=$1',
        [id],
      );
      if (
        ['sending', 'unknown', 'rejected'].includes(
          requests[0].submission_state,
        )
      )
        satHttp('SAT_SUBMISSION_UNRESOLVED');
      return {
        jobId: id,
        filterVersion: 1,
        purpose:
          requests[0].submission_state === 'accepted'
            ? 'sat.recover'
            : 'sat.submit',
      };
    });
  }
  async prepare(
    tenant: SessionAuthorizationContext,
    id: string,
    key: string,
    input: ReceivedCredentials,
    correlation: string,
  ) {
    try {
      satEnabled();
      const previous = await this.custody.run(tenant, async (m) => {
        await this.load(m, tenant, id);
        return m.query<{ purpose: 'sat.submit' | 'sat.recover' }[]>(
          'SELECT purpose FROM efirma_sessions WHERE sat_job_id=$1 AND user_id=$2 AND auth_session_id=$3 AND idempotency_key=$4',
          [id, tenant.userId, tenant.sessionId, key],
        );
      });
      const binding: SatCustodyBinding = previous[0]
        ? { jobId: id, filterVersion: 1, purpose: previous[0].purpose }
        : await this.binding(tenant, id);
      const job = await this.custody.run(tenant, (m) =>
        this.load(m, tenant, id),
      );
      const result = await this.preparation.prepare(
        tenant,
        job.legal_entity_id,
        key,
        input,
        correlation,
        binding,
      );
      if (result.status === 'ready')
        await this.custody.run(tenant, async (m) => {
          const row = await this.load(m, tenant, id, true);
          if (row.custody_id === result.id) return;
          if (
            row.cancel_requested_at ||
            row.terminal_at ||
            (![
              'authorization_pending',
              'requires_user_authorization',
              'waiting_sat',
            ].includes(row.status) &&
              row.custody_id !== result.id)
          )
            satHttp('SAT_AUTHORIZATION_NOT_ALLOWED');
          await m.query(
            `UPDATE sat_download_jobs SET custody_id=$2,status=$3,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,
            [
              id,
              result.id,
              binding.purpose === 'sat.submit' ? 'submitting' : 'recovering',
            ],
          );
        });
      return { ...result, processId: id };
    } finally {
      input.dispose();
    }
  }
  async cancel(
    tenant: SessionAuthorizationContext,
    id: string,
    correlation: string,
  ) {
    satEnabled();
    return this.custody.run(tenant, async (m) => {
      const row = await this.load(m, tenant, id, true);
      if (!row.terminal_at) {
        await m.query(
          'UPDATE sat_download_jobs SET cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),next_attempt_at=clock_timestamp() WHERE id=$1',
          [id],
        );
        await this.audit(m, row, 'sat.cancel_requested', correlation);
      }
      return { id, cancelRequested: true };
    });
  }
  async retry(
    tenant: SessionAuthorizationContext,
    id: string,
    packageId: string | undefined,
    correlation: string,
  ) {
    satEnabled();
    return this.custody.run(tenant, async (m) => {
      const row = await this.load(m, tenant, id, true);
      if (
        row.cancel_requested_at ||
        row.status === 'external_submission_unknown'
      )
        satHttp('SAT_RETRY_NOT_ALLOWED');
      if (packageId) {
        const available: { id: string }[] = await m.query(
          `SELECT o.id FROM stored_objects o JOIN sat_packages p ON p.object_id=o.id JOIN sat_requests r ON r.id=p.request_id WHERE p.id=$1 AND r.job_id=$2 AND o.cleanup_requested_at IS NULL AND o.lifecycle_state IN('uploaded','available','quarantined') AND o.malware_scan_status<>'infected' FOR UPDATE OF o`,
          [packageId, id],
        );
        const downloaded: { downloaded_at: Date | null }[] = await m.query(
          'SELECT downloaded_at FROM sat_packages WHERE id=$1',
          [packageId],
        );
        if (downloaded[0]?.downloaded_at && !available[0])
          satHttp('SAT_PACKAGE_RETRY_NOT_ALLOWED');
        const p: { id: string; downloaded_at: Date | null }[] = await m.query(
          `WITH changed AS (UPDATE sat_packages p SET local_retry_count=local_retry_count+CASE WHEN downloaded_at IS NOT NULL THEN 1 ELSE 0 END,ingestion_job_id=CASE WHEN downloaded_at IS NOT NULL THEN NULL ELSE ingestion_job_id END,retry_authorized=true,status=CASE WHEN downloaded_at IS NOT NULL THEN 'stored' ELSE 'pending' END,error_code=NULL FROM sat_requests r WHERE p.id=$1 AND p.request_id=r.id AND r.job_id=$2 AND p.local_retry_count<10 AND p.status IN('failed','download_unknown') AND (p.downloaded_at IS NOT NULL OR p.download_attempts<2) RETURNING p.id,p.downloaded_at) SELECT * FROM changed`,
          [packageId, id],
        );
        if (!p[0]) satHttp('SAT_PACKAGE_RETRY_NOT_ALLOWED');
        await m.query(
          `UPDATE sat_download_jobs SET status=$2,terminal_at=NULL,next_attempt_at=clock_timestamp(),error_code=NULL WHERE id=$1`,
          [
            id,
            p[0].downloaded_at
              ? 'processing_local'
              : 'requires_user_authorization',
          ],
        );
      } else {
        if (row.technical_retries >= 3) satHttp('SAT_RETRY_BUDGET_EXHAUSTED');
        if (
          row.error_code !== 'SAT_TECHNICAL_FAILURE' ||
          row.status !== 'requires_user_authorization'
        )
          satHttp('SAT_RETRY_NOT_ALLOWED');
        if (row.next_attempt_at.getTime() > Date.now())
          satHttp('SAT_RETRY_BACKOFF');
        // The failed attempt already consumed its budget. Retrying requires fresh authorization.
        await m.query(
          'UPDATE sat_download_jobs SET error_code=NULL,updated_at=clock_timestamp() WHERE id=$1',
          [id],
        );
      }
      await this.audit(m, row, 'sat.retry_requested', correlation);
      return { id };
    });
  }
  dto(row: SatJobRow) {
    return {
      id: row.id,
      legalEntityId: row.legal_entity_id,
      status: row.status,
      contentType: row.content_type,
      direction: row.direction,
      filters: {
        version: row.filter_version,
        dateFrom: row.date_from_local,
        dateTo: row.date_to_local,
        folio: row.folio,
        documentType: row.document_type,
        documentStatus: row.document_status,
      },
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cancelRequested: !!row.cancel_requested_at,
      links: {
        self: '/sat-download-jobs/' + row.id,
        packages: '/sat-download-jobs/' + row.id + '/packages',
      },
    };
  }
  async audit(
    m: EntityManager,
    row: SatJobRow,
    action: string,
    correlation: string,
  ) {
    await m.query(
      `INSERT INTO audit_events(organization_id,actor_type,actor_user_id,actor_membership_id,client_account_id,legal_entity_id,action,permission_key,decision,object_type,object_id,correlation_id,metadata) VALUES($1,'user',$2,$3,$4,$5,$6,'sat.download','ALLOW','sat_download_job',$7,$8,'{}'::jsonb)`,
      [
        row.organization_id,
        row.user_id,
        row.membership_id,
        row.client_account_id,
        row.legal_entity_id,
        action,
        row.id,
        correlation,
      ],
    );
  }
}
