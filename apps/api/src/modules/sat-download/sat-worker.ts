import { ObjectStorageError } from '../object-storage/object-storage.errors';
import { OpaqueObjectKeyFactory } from '../object-storage/services/opaque-object-key.factory';
import {
  Injectable,
  Inject,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { EfirmaRepository, digest } from '../efirma/efirma.repository';
import { EfirmaConsumerService } from '../efirma/efirma-consumer.service';
import { OBJECT_STORAGE_PORT } from '../object-storage/object-storage.tokens';
import type { ObjectStoragePort } from '../object-storage/ports/object-storage.port';
import type { FiscalPlatformConfig } from '../../config/fiscal-platform.config';
import { SatAdapter } from './sat-adapter';
import { classifyVerification, SatError } from './sat-contract';
import type { SatJobRow } from './sat.dtos';
import { hashStream } from '../cfdi/workers/zip-worker-persistence.service';
interface SatRequestRow {
  id: string;
  external_id: string | null;
  submission_state: string;
  sat_state: number | null;
}
interface PackageRow {
  id: string;
  external_id: string;
  status: string;
  object_id: string | null;
  download_attempts: number;
  downloaded_at: Date | null;
  ingestion_job_id: string | null;
  local_retry_count: number;
}
@Injectable()
export class SatWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly stopping = new AbortController();
  private readonly fiscal: FiscalPlatformConfig;
  constructor(
    private readonly custody: EfirmaRepository,
    private readonly consumer: EfirmaConsumerService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    private readonly configuration: ConfigService,
    @Inject('SAT_ADAPTER') private readonly adapter: SatAdapter | null,
  ) {
    this.fiscal =
      configuration.getOrThrow<FiscalPlatformConfig>('fiscalPlatform');
  }
  onModuleInit() {
    if (!this.adapter) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, 1000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.stopping.abort();
  }
  async tick() {
    if (this.running || !this.adapter) return;
    this.running = true;
    try {
      const rows: { id: string; organization_id: string }[] =
        await this.custody.transactions.runWorkerMaintenance((m) =>
          m.query('SELECT * FROM sat_jobs_batch()'),
        );
      for (const row of rows) {
        if (this.stopping.signal.aborted) break;
        await this.runJob(row.organization_id, row.id).catch(() => undefined);
      }
    } finally {
      this.running = false;
    }
  }
  async runJob(org: string, id: string) {
    if (!this.adapter) return;
    const run = <T>(fn: (m: EntityManager) => Promise<T>) =>
      this.custody.transactions.runAsWorker({ organizationId: org }, fn);
    const token = randomUUID();
    const claimed: SatJobRow[] = await run((m) =>
      m.query(
        `WITH changed AS (UPDATE sat_download_jobs SET lease_token=$2,lease_until=clock_timestamp()+interval '45 seconds',fence=fence+1 WHERE id=$1 AND terminal_at IS NULL AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING *) SELECT * FROM changed`,
        [id, token],
      ),
    );
    const job = claimed[0];
    if (!job) return;
    const fence = async (m: EntityManager) => {
      const r: SatJobRow[] = await m.query(
        `WITH changed AS (UPDATE sat_download_jobs SET lease_until=clock_timestamp()+interval '45 seconds' WHERE id=$1 AND lease_token=$2 AND fence=$3 AND lease_until>clock_timestamp() RETURNING *) SELECT * FROM changed`,
        [id, token, job.fence],
      );
      if (!r[0]) throw new SatError('SAT_LEASE_LOST');
      if (r[0].cancel_requested_at) throw new SatError('SAT_CANCELLED');
    };
    const check = () => run(fence);
    const state = async (
      status: string,
      error: string | null = null,
      terminal = false,
    ) =>
      run(async (m) => {
        await fence(m);
        await m.query(
          `UPDATE sat_download_jobs SET status=$2,error_code=$3,terminal_at=CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp(),next_attempt_at=clock_timestamp()+interval '5 seconds' WHERE id=$1`,
          [id, status, error, terminal],
        );
      });
    let operationFailure: unknown;
    let terminalResult: { status: string; error: string | null } | undefined;
    try {
      if (job.cancel_requested_at) throw new SatError('SAT_CANCELLED');
      const request = (
        await run((m) =>
          m.query<SatRequestRow[]>(
            'SELECT * FROM sat_requests WHERE job_id=$1',
            [id],
          ),
        )
      )[0];
      if (
        request.submission_state === 'sending' ||
        request.submission_state === 'unknown'
      ) {
        await run(async (m) => {
          await fence(m);
          await m.query(
            "UPDATE sat_requests SET submission_state='unknown' WHERE id=$1",
            [request.id],
          );
        });
        await state('external_submission_unknown', 'SAT_SUBMISSION_UNCERTAIN');
        return;
      }
      // Local ingestions survive lost custody and do not call Vault or SAT.
      await this.localPackages(run, fence, job, request.id);
      if (
        [
          'processing_local',
          'requires_user_authorization',
          'waiting_sat',
        ].includes(job.status)
      ) {
        await this.reconcileResults(run, fence, job, request.id);
        return;
      }
      if (!job.custody_id) {
        await state('requires_user_authorization');
        return;
      }
      const purpose =
        request.submission_state === 'accepted' ? 'sat.recover' : 'sat.submit';
      await this.consumer.withCredential(
        org,
        job.custody_id,
        async (key, certificate, authority) => {
          const current = (
            await run((m) =>
              m.query<{ expires_at: Date }[]>(
                'SELECT expires_at FROM efirma_sessions WHERE id=$1',
                [job.custody_id],
              ),
            )
          )[0];
          const guard = async () => {
            this.stopping.signal.throwIfAborted();
            await check();
            await authority();
          };
          const rfc = (
            await run((m) =>
              m.query<{ rfc: string }[]>(
                'SELECT rfc FROM legal_entities WHERE id=$1',
                [job.legal_entity_id],
              ),
            )
          )[0].rfc;
          await guard();
          let auth = await this.adapter!.authenticate(
            key,
            certificate,
            current.expires_at,
            this.stopping.signal,
          );
          try {
            if (purpose === 'sat.submit') {
              const attributes: Record<string, string> = {
                RfcSolicitante: rfc,
              };
              let op:
                | 'SolicitaDescargaEmitidos'
                | 'SolicitaDescargaRecibidos'
                | 'SolicitaDescargaFolio';
              if (job.direction === 'folio') {
                op = 'SolicitaDescargaFolio';
                attributes.Folio = job.folio!;
              } else {
                op =
                  job.direction === 'issued'
                    ? 'SolicitaDescargaEmitidos'
                    : 'SolicitaDescargaRecibidos';
                attributes[
                  job.direction === 'issued' ? 'RfcEmisor' : 'RfcReceptor'
                ] = rfc;
                const dates = (
                  await run((m) =>
                    m.query<{ from: string; to: string }[]>(
                      `SELECT to_char(date_from,'YYYY-MM-DD"T"HH24:MI:SS') AS "from",to_char(date_to,'YYYY-MM-DD"T"HH24:MI:SS') AS "to" FROM sat_download_jobs WHERE id=$1`,
                      [id],
                    ),
                  )
                )[0];
                attributes.FechaInicial = dates.from;
                attributes.FechaFinal = dates.to;
                attributes.TipoSolicitud =
                  job.content_type === 'xml' ? 'CFDI' : 'Metadata';
                attributes.TipoComprobante = job.document_type;
                if (job.document_status !== 'all')
                  attributes.EstadoComprobante =
                    job.document_status === 'active' ? 'Vigente' : 'Cancelado';
              }
              await guard();
              await run(async (m) => {
                await fence(m);
                const changed: { id: string }[] = await m.query(
                  "WITH changed AS (UPDATE sat_requests SET submission_state='sending',submission_started_at=clock_timestamp() WHERE id=$1 AND submission_state='not_sent' RETURNING id) SELECT * FROM changed",
                  [request.id],
                );
                if (!changed[0]) throw new SatError('SAT_SUBMISSION_UNCERTAIN');
              });
              try {
                let reply: Awaited<ReturnType<SatAdapter['submit']>>;
                try {
                  reply = await this.adapter!.submit(
                    op,
                    attributes,
                    key,
                    certificate,
                    auth,
                    this.stopping.signal,
                  );
                } catch (e) {
                  if (
                    !(e instanceof SatError) ||
                    e.code !== 'SAT_AUTH_REJECTED'
                  )
                    throw e;
                  await guard();
                  auth = await this.adapter!.authenticate(
                    key,
                    certificate,
                    current.expires_at,
                    this.stopping.signal,
                  );
                  await guard();
                  reply = await this.adapter!.submit(
                    op,
                    attributes,
                    key,
                    certificate,
                    auth,
                    this.stopping.signal,
                  );
                }
                await check();
                if (
                  reply.attributes.CodEstatus === '5000' &&
                  !/^[-a-zA-Z0-9_]{1,128}$/.test(
                    reply.attributes.IdSolicitud ?? '',
                  )
                )
                  throw new SatError('SAT_SUBMISSION_UNCERTAIN', true);
                const accepted =
                  reply.attributes.CodEstatus === '5000' &&
                  /^[-a-zA-Z0-9_]{1,128}$/.test(
                    reply.attributes.IdSolicitud ?? '',
                  );
                await run(async (m) => {
                  await fence(m);
                  await m.query(
                    'UPDATE sat_requests SET submission_state=$2,external_id=$3,sat_code=$4,submission_completed_at=clock_timestamp() WHERE id=$1',
                    [
                      request.id,
                      accepted ? 'accepted' : 'rejected',
                      accepted ? reply.attributes.IdSolicitud : null,
                      /^\d{3,5}$/.test(reply.attributes.CodEstatus ?? '')
                        ? reply.attributes.CodEstatus
                        : null,
                    ],
                  );
                });
                if (accepted) await state('waiting_sat');
                else
                  terminalResult = {
                    status: 'failed',
                    error: 'SAT_SUBMISSION_REJECTED',
                  };
              } catch (error) {
                await run(async (m) => {
                  await fence(m);
                  await m.query(
                    "UPDATE sat_requests SET submission_state='unknown' WHERE id=$1 AND submission_state='sending'",
                    [request.id],
                  );
                });
                await state(
                  'external_submission_unknown',
                  'SAT_SUBMISSION_UNCERTAIN',
                );
                throw error;
              }
            } else {
              await guard();
              const v = await this.adapter!.verify(
                request.external_id!,
                rfc,
                key,
                certificate,
                auth,
                this.stopping.signal,
              );
              await check();
              let classification = classifyVerification(v);
              const previousIds = await run((m) =>
                m.query<{ external_id: string }[]>(
                  'SELECT external_id FROM sat_packages WHERE request_id=$1',
                  [request.id],
                ),
              );
              if (
                previousIds.length &&
                (classification === 'empty' ||
                  (classification === 'packages' &&
                    (previousIds.length !== v.packages.length ||
                      previousIds.some(
                        (p) => !v.packages.includes(p.external_id),
                      ))))
              )
                classification = 'contradictory';
              await run(async (m) => {
                await fence(m);
                await m.query(
                  'UPDATE sat_requests SET sat_state=$2,sat_code=$3,sat_request_code=$4,cfdi_count=$5,verified_at=clock_timestamp() WHERE id=$1',
                  [
                    request.id,
                    [1, 2, 3, 4, 5, 6].includes(v.state) ? v.state : null,
                    /^\d{3,5}$/.test(v.code ?? '') ? v.code : null,
                    /^\d{3,5}$/.test(v.requestCode ?? '')
                      ? v.requestCode
                      : null,
                    Number.isSafeInteger(v.count) && v.count >= 0
                      ? v.count
                      : null,
                  ],
                );
                if (classification === 'packages')
                  for (const [i, external] of v.packages.entries())
                    await m.query(
                      `INSERT INTO sat_packages(id,organization_id,client_account_id,legal_entity_id,request_id,external_id,ordinal) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(request_id,external_id) DO NOTHING`,
                      [
                        randomUUID(),
                        org,
                        job.client_account_id,
                        job.legal_entity_id,
                        request.id,
                        external,
                        i + 1,
                      ],
                    );
              });
              if (classification === 'waiting') {
                await state('waiting_sat');
                return;
              }
              if (classification === 'empty') {
                terminalResult = { status: 'completed', error: null };
                return;
              }
              if (classification !== 'packages') {
                terminalResult = {
                  status: 'failed',
                  error:
                    classification === 'contradictory'
                      ? 'SAT_RESPONSE_CONTRADICTORY'
                      : 'SAT_VERIFICATION_REJECTED',
                };
                return;
              }
              const packages = await run((m) =>
                m.query<PackageRow[]>(
                  'SELECT * FROM sat_packages WHERE request_id=$1 ORDER BY ordinal',
                  [request.id],
                ),
              );
              for (const p of packages) {
                if (p.downloaded_at) continue;
                if (p.status !== 'pending') continue;
                await guard();
                if (p.download_attempts >= 2) {
                  await run(async (m) => {
                    await fence(m);
                    await m.query(
                      "UPDATE sat_packages SET status='budget_exhausted',error_code='SAT_DOWNLOAD_BUDGET' WHERE id=$1",
                      [p.id],
                    );
                  });
                  continue;
                }
                const objectId = randomUUID(),
                  objectKey = new OpaqueObjectKeyFactory().create();
                await run(async (m) => {
                  await fence(m);
                  if (p.object_id)
                    await m.query(
                      "UPDATE stored_objects SET cleanup_requested_at=clock_timestamp() WHERE id=$1 AND lifecycle_state='pending_upload'",
                      [p.object_id],
                    );
                  await m.query(
                    `INSERT INTO stored_objects(id,organization_id,client_account_id,legal_entity_id,kind,storage_provider,storage_container,object_key,encryption_class,declared_mime_type,retention_until) VALUES($1,$2,$3,$4,'sat_package',$5,$6,$7,'fiscal','application/zip',clock_timestamp()+interval '30 days')`,
                    [
                      objectId,
                      org,
                      job.client_account_id,
                      job.legal_entity_id,
                      this.fiscal.storage.driver,
                      this.fiscal.storage.driver === 's3'
                        ? this.fiscal.storage.s3.bucket!
                        : 'local-private',
                      objectKey,
                    ],
                  );
                  await m.query(
                    "UPDATE sat_packages SET status='downloading',object_id=$2,download_attempts=download_attempts+1,attempt_started_at=clock_timestamp(),retry_authorized=false WHERE id=$1",
                    [p.id, objectId],
                  );
                });
                try {
                  await guard();
                  const body = await this.adapter!.download(
                    p.external_id,
                    rfc,
                    key,
                    certificate,
                    auth,
                    this.stopping.signal,
                  );
                  const written = await this.storage.putStream({
                    objectKey,
                    body,
                    contentType: 'application/zip',
                    signal: this.stopping.signal,
                  });
                  await check();
                  await run(async (m) => {
                    await fence(m);
                    await m.query(
                      "UPDATE stored_objects SET lifecycle_state='uploaded',sha256=$2,size_bytes=$3,uploaded_at=clock_timestamp(),storage_etag=$4,storage_version_id=$5 WHERE id=$1",
                      [
                        objectId,
                        written.sha256,
                        written.sizeBytes,
                        written.etag ?? null,
                        written.versionId ?? null,
                      ],
                    );
                    await m.query(
                      "UPDATE sat_packages SET status='stored',downloaded_at=clock_timestamp() WHERE id=$1",
                      [p.id],
                    );
                  });
                } catch (error) {
                  const failure: unknown =
                    error instanceof ObjectStorageError &&
                    error.cause instanceof SatError
                      ? error.cause
                      : error;
                  const code =
                    failure instanceof SatError ||
                    failure instanceof ObjectStorageError
                      ? failure.code
                      : error instanceof Error && 'driverError' in error
                        ? 'SAT_PERSISTENCE_ERROR'
                        : 'SAT_DOWNLOAD_UNCERTAIN';
                  await run(async (m) => {
                    await fence(m);
                    await m.query(
                      "UPDATE sat_packages SET status=CASE WHEN $2='SAT_PACKAGE_EXPIRED' THEN 'expired' WHEN download_attempts>=2 OR $2='SAT_DOWNLOAD_BUDGET' THEN 'budget_exhausted' ELSE 'download_unknown' END,uncertain_attempts=uncertain_attempts+1,error_code=$2 WHERE id=$1 AND status='downloading'",
                      [p.id, code],
                    );
                  });
                }
              }
              await this.localPackages(run, fence, job, request.id);
              await state('processing_local');
            }
          } catch (e) {
            operationFailure = e;
            throw e;
          } finally {
            auth = '';
          }
        },
        { purpose, jobId: id, filterVersion: 1 },
      );
      if (terminalResult)
        await state(terminalResult.status, terminalResult.error, true);
    } catch (caught) {
      const error: unknown = operationFailure ?? caught;
      if (error instanceof SatError && error.code === 'SAT_CANCELLED') {
        await run(async (m) => {
          const cancelled: { id: string }[] = await m.query(
            `WITH changed AS (UPDATE sat_download_jobs SET status='cancelled',terminal_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND fence=$3 AND lease_until>clock_timestamp() RETURNING id) SELECT * FROM changed`,
            [id, token, job.fence],
          );
          if (!cancelled[0]) throw new SatError('SAT_LEASE_LOST');
          await m.query(
            `UPDATE ingestion_jobs i SET status='cancel_requested',cancel_requested_at=clock_timestamp() FROM sat_packages p JOIN sat_requests r ON r.id=p.request_id WHERE i.id=p.ingestion_job_id AND r.job_id=$1 AND i.status IN('queued','processing','failed_retryable')`,
            [id],
          );
        });
      } else
        await run(async (m) => {
          await fence(m);
          const req = await m.query<SatRequestRow[]>(
            'SELECT * FROM sat_requests WHERE job_id=$1',
            [id],
          );
          const unknown = ['sending', 'unknown'].includes(
            req[0].submission_state,
          );
          const technical =
            !unknown &&
            (error instanceof ObjectStorageError ||
              (error instanceof SatError &&
                [
                  'SAT_TRANSPORT_UNCERTAIN',
                  'SAT_HTTP_ERROR',
                  'SAT_PERSISTENCE_ERROR',
                  'SAT_OBJECT_UNAVAILABLE',
                ].includes(error.code)));
          if (technical) {
            await m.query(
              `UPDATE sat_download_jobs SET technical_retries=least(3,technical_retries+1),status=CASE WHEN technical_retries>=2 THEN 'failed' ELSE 'requires_user_authorization' END,error_code='SAT_TECHNICAL_FAILURE',terminal_at=CASE WHEN technical_retries>=2 THEN clock_timestamp() ELSE NULL END,next_attempt_at=clock_timestamp()+make_interval(secs=>(10*power(3,technical_retries))::integer),updated_at=clock_timestamp() WHERE id=$1 AND terminal_at IS NULL`,
              [id],
            );
            return;
          }
          await m.query(
            `UPDATE sat_download_jobs SET status=$2,error_code=$3,updated_at=clock_timestamp() WHERE id=$1 AND terminal_at IS NULL AND status NOT IN('waiting_sat','processing_local')`,
            [
              id,
              unknown
                ? 'external_submission_unknown'
                : 'requires_user_authorization',
              unknown
                ? 'SAT_SUBMISSION_UNCERTAIN'
                : error instanceof SatError
                  ? error.code
                  : error instanceof Error && 'driverError' in error
                    ? 'SAT_PERSISTENCE_ERROR'
                    : 'SAT_REQUIRES_USER_AUTHORIZATION',
            ],
          );
        });
    } finally {
      await run((m) =>
        m.query(
          'UPDATE sat_download_jobs SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND fence=$3',
          [id, token, job.fence],
        ),
      );
    }
  }
  private async localPackages(
    run: <T>(f: (m: EntityManager) => Promise<T>) => Promise<T>,
    fence: (m: EntityManager) => Promise<void>,
    job: SatJobRow,
    requestId: string,
  ) {
    const packages = await run((m) =>
      m.query<PackageRow[]>(
        'SELECT * FROM sat_packages WHERE request_id=$1 ORDER BY ordinal',
        [requestId],
      ),
    );
    for (const p of packages) {
      if (p.status === 'downloading') {
        await run(async (m) => {
          await fence(m);
          await m.query(
            "UPDATE sat_packages SET status=CASE WHEN download_attempts>=2 THEN 'budget_exhausted' ELSE 'download_unknown' END,uncertain_attempts=uncertain_attempts+1,error_code='SAT_DOWNLOAD_UNCERTAIN' WHERE id=$1 AND status='downloading'",
            [p.id],
          );
        });
        continue;
      }
      if (!p.downloaded_at || p.ingestion_job_id) continue;
      const objects = await run((m) =>
        m.query<{ object_key: string; sha256: string; size_bytes: string }[]>(
          "SELECT object_key,sha256,size_bytes FROM stored_objects WHERE id=$1 AND lifecycle_state IN('uploaded','available','quarantined')",
          [p.object_id],
        ),
      );
      const o = objects[0];
      if (!o) {
        await run(async (m) => {
          await fence(m);
          await m.query(
            "UPDATE sat_packages SET status='failed',error_code='SAT_OBJECT_UNAVAILABLE' WHERE id=$1",
            [p.id],
          );
        });
        continue;
      }
      try {
        const meta = await this.storage.head(o.object_key);
        if (!meta || meta.sizeBytes !== Number(o.size_bytes))
          throw new SatError('SAT_OBJECT_UNAVAILABLE');
        const integrity = await hashStream(
          await this.storage.openReadStream(o.object_key),
          50 * 1024 * 1024,
        );
        if (integrity.sha256 !== o.sha256)
          throw new SatError('SAT_OBJECT_INTEGRITY');
      } catch (error: unknown) {
        await run(async (m) => {
          await fence(m);
          await m.query(
            "UPDATE sat_packages SET status='failed',error_code=$2 WHERE id=$1",
            [
              p.id,
              error instanceof SatError && error.code === 'SAT_OBJECT_INTEGRITY'
                ? 'SAT_OBJECT_INTEGRITY'
                : 'SAT_OBJECT_UNAVAILABLE',
            ],
          );
        });
        continue;
      }
      await run(async (m) => {
        await fence(m);
        const ingestionId = randomUUID();
        await m.query(
          `INSERT INTO ingestion_jobs(id,organization_id,client_account_id,legal_entity_id,source_type,root_object_id,requested_by_membership_id,idempotency_key,request_fingerprint,status,correlation_id,idempotency_expires_at,next_attempt_at) VALUES($1,$2,$3,$4,'sat_package',$5,$6,$7,$8,'queued',$9,clock_timestamp()+interval '30 days',clock_timestamp()) ON CONFLICT(organization_id,legal_entity_id,idempotency_key) DO NOTHING`,
          [
            ingestionId,
            job.organization_id,
            job.client_account_id,
            job.legal_entity_id,
            p.object_id,
            job.membership_id,
            'sat-package:' + p.id + ':' + p.local_retry_count,
            digest(p.id + ':' + o.sha256),
            randomUUID(),
          ],
        );
        await m.query(
          `UPDATE sat_packages SET ingestion_job_id=(SELECT id FROM ingestion_jobs WHERE organization_id=$2 AND legal_entity_id=$3 AND idempotency_key=$4),status='processing' WHERE id=$1`,
          [
            p.id,
            job.organization_id,
            job.legal_entity_id,
            'sat-package:' + p.id + ':' + p.local_retry_count,
          ],
        );
      });
    }
  }
  private async reconcileResults(
    run: <T>(f: (m: EntityManager) => Promise<T>) => Promise<T>,
    fence: (m: EntityManager) => Promise<void>,
    job: SatJobRow,
    requestId: string,
  ) {
    await run(async (m) => {
      await fence(m);
      await m.query(
        `UPDATE sat_packages p SET status=CASE WHEN i.status='completed' THEN 'completed' WHEN i.status='completed_with_issues' THEN 'with_issues' ELSE 'failed' END,error_code=i.last_error_code FROM ingestion_jobs i WHERE i.id=p.ingestion_job_id AND p.request_id=$1 AND i.status IN('completed','completed_with_issues','failed_final','cancelled')`,
        [requestId],
      );
      const rows: { status: string }[] = await m.query(
        'SELECT status FROM sat_packages WHERE request_id=$1',
        [requestId],
      );
      const pending = rows.some((p) =>
        ['pending', 'downloading', 'stored', 'processing'].includes(p.status),
      );
      if (rows.some((p) => p.status === 'pending')) {
        await m.query(
          "UPDATE sat_download_jobs SET status='requires_user_authorization',error_code='SAT_REQUIRES_USER_AUTHORIZATION' WHERE id=$1",
          [job.id],
        );
      }
      if (!pending && rows.length) {
        const issues = rows.some((p) => p.status !== 'completed');
        await m.query(
          `UPDATE sat_download_jobs SET status=$2,terminal_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,
          [job.id, issues ? 'completed_with_issues' : 'completed'],
        );
      }
    });
  }
}
