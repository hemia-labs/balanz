import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { FiscalTenantTransactionService } from '../../database/rls/fiscal-tenant-transaction.service';
import { AuthorizationService } from '../sessions/authorization.service';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { hasRecentReauthentication } from '../../common/auth/authorization-contract';
import { ClientAccountScopeService } from './client-account-scope.service';
import {
  permissionDefinition,
  isPermissionKey,
} from '../../common/auth/permission-catalog';
import {
  DEFAULT_CHECKLIST,
  DECISION_POLICY,
  MONTHLY_SCHEMA,
  HUMAN_CHECKLIST,
  fingerprint,
  monthlyError,
  validateDecision,
  decisionPermissions,
  monthlyChanges,
  type Decision,
  type Participation,
  type MonthlySnapshot,
  type SourceEvidence,
  type IncidentEvidence,
  type ChecklistEvidence,
} from './monthly.contract';
import {
  MonthlyQueryDto,
  type MonthlyWriteDto,
  type LeaseDto,
  type DecisionDto,
  type BulkDto,
  type ChecklistDto,
  type IncidentDto,
  type SourceLinkDto,
  type CloseDto,
  type CategoryDto,
  type TemplateDto,
} from './monthly.dtos';
interface PeriodRow {
  id: string;
  organization_id: string;
  client_account_id: string;
  legal_entity_id: string;
  month: number;
  year: number;
  status: string;
  lock_version: number;
  rfc: string;
  entity_status: string;
}
interface Workspace {
  id: string;
  version: number;
  template_keys: string[];
  lease_session_id: string | null;
  lease_membership_id: string | null;
  lease_instance_hash: string | null;
  lease_until: Date | null;
  prepared_fingerprint: string | null;
  latest_close_id: string | null;
}
interface CloseRow {
  id: string;
  version: number;
  snapshot: MonthlySnapshot;
  closed_at: Date;
  total?: number;
  source_exception_reason?: string | null;
  actor_membership_id?: string;
}
interface Work {
  m: EntityManager;
  t: SessionAuthorizationContext;
  p: PeriodRow;
  w: Workspace | null;
}
const decisionColumns = `coalesce(d.review_status,'pending') AS "reviewStatus",coalesce(d.inclusion,'included') AS inclusion,d.exclusion_reason AS "exclusionReason",d.category_id AS "categoryId",d.category_label AS "categoryLabel",coalesce(d.tax_status,'pendiente') AS "taxStatus",d.tax_note AS "taxNote",coalesce(d.vat_status,'pendiente') AS "vatStatus",d.vat_note AS "vatNote",d.comment,coalesce(d.version,0) AS version,d.id AS "decisionId"`;
const participationSql = `SELECT pc.id,c.id AS "cfdiId",c.normalized_uuid AS uuid,c.document_type AS "documentType",CASE WHEN c.issuer_rfc=le.rfc THEN 'issued' ELSE 'received' END AS direction,
 c.issuer_rfc AS "issuerRfc",c.issuer_name AS "issuerName",c.receiver_rfc AS "receiverRfc",c.receiver_name AS "receiverName",pc.source_date::text AS "sourceDate",coalesce((SELECT i.literal_date FROM cfdi_period_intents i WHERE i.cfdi_id=c.id AND i.participation_type=pc.participation_type AND i.source_ordinal=pc.source_ordinal),(pc.source_date AT TIME ZONE CASE WHEN pc.timezone='historical-unrecorded' THEN 'UTC' ELSE pc.timezone END)::text) AS "literalDate",
 (SELECT jsonb_build_object('id',obs.id,'packageId',obs.package_id,'status',obs.sat_status,'observedAt',obs.observed_at::text) FROM sat_metadata_observations obs WHERE obs.organization_id=c.organization_id AND obs.legal_entity_id=c.legal_entity_id AND obs.cfdi_uuid=c.normalized_uuid ORDER BY obs.observed_at DESC,obs.id DESC LIMIT 1) AS "satObservation",
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'uuid',r.related_uuid,'type',r.relation_type,'incorporation',CASE WHEN linked.document_type='N' AND NOT $3::boolean THEN 'unknown' WHEN linked.id IS NULL THEN 'not_observed' ELSE 'present' END) ORDER BY r.relation_type,r.relation_group_ordinal,r.ordinal,r.id) FROM (
 SELECT id,organization_id,legal_entity_id,cfdi_id,relation_group_ordinal,ordinal,relation_type::text,related_uuid FROM cfdi_relations WHERE cfdi_id=c.id
 UNION ALL SELECT pd.id,pd.organization_id,pd.legal_entity_id,pd.cfdi_id,p.ordinal,pd.ordinal,'payment_reference',pd.related_uuid FROM cfdi_payment_documents pd JOIN cfdi_payments p ON p.id=pd.payment_id WHERE pd.cfdi_id=c.id AND p.ordinal=pc.source_ordinal
 UNION ALL SELECT pd.id,pd.organization_id,pd.legal_entity_id,c.id,p.ordinal,pd.ordinal,'payment_observed',payment_cfdi.normalized_uuid FROM cfdi_payment_documents pd JOIN cfdi_payments p ON p.id=pd.payment_id JOIN cfdis payment_cfdi ON payment_cfdi.id=pd.cfdi_id WHERE pd.organization_id=c.organization_id AND pd.legal_entity_id=c.legal_entity_id AND pd.related_uuid=c.normalized_uuid
 ) r LEFT JOIN cfdis linked ON linked.organization_id=r.organization_id AND linked.legal_entity_id=r.legal_entity_id AND linked.normalized_uuid=r.related_uuid WHERE r.cfdi_id=c.id),'[]'::jsonb) AS relations,pc.source_ordinal AS "sourceOrdinal",pc.participation_type AS "participationType",pc.policy_version AS "policyVersion",pc.timezone,c.currency,c.total::text AS total,c.source_object_id AS "sourceObjectId",o.sha256 AS sha256,
 EXISTS(SELECT 1 FROM incidents i WHERE i.cfdi_id=c.id AND i.status='open' AND coalesce((SELECT e.state FROM monthly_incident_events e WHERE e.period_id=pc.period_id AND e.incident_id=i.id ORDER BY e.version DESC LIMIT 1),'open') NOT IN('resolved','reviewed_rejection') AND NOT(i.code='FISCAL_PERIOD_NOT_CONFIGURED' AND EXISTS(SELECT 1 FROM cfdi_period_reconciliations r WHERE r.cfdi_id=c.id AND r.status='resolved'))) AS "hasIncidents",${decisionColumns}
 FROM period_cfdis pc JOIN cfdis c ON c.id=pc.cfdi_id JOIN legal_entities le ON le.id=c.legal_entity_id JOIN stored_objects o ON o.id=c.source_object_id
 LEFT JOIN LATERAL(SELECT * FROM monthly_decisions x WHERE x.participation_id=pc.id ORDER BY x.version DESC LIMIT 1)d ON true
 WHERE pc.organization_id=$1 AND pc.period_id=$2 AND ($3::boolean OR c.document_type<>'N')`;
function publicParticipation(row: Participation) {
  const { sourceObjectId, sha256, ...item } = row;
  void sourceObjectId;
  void sha256;
  return item;
}
@Injectable()
export class MonthlyService {
  constructor(
    private readonly db: DataSource,
    private readonly transactions: FiscalTenantTransactionService,
    private readonly authorization: AuthorizationService,
    private readonly accounts: ClientAccountScopeService,
  ) {}
  private permission(t: SessionAuthorizationContext, key: string) {
    if (!t.permissions.includes(key)) monthlyError('MONTHLY_SCOPE_DENIED', 403);
    if (isPermissionKey(key)) {
      const def = permissionDefinition(key);
      if (def.requiresMfa && (!t.mfaVerifiedAt || t.mfaStatus !== 'active'))
        monthlyError('MFA_REQUIRED', 401);
      if (
        def.requiresReauthentication &&
        !hasRecentReauthentication(t.reauthenticatedAt)
      )
        monthlyError('REAUTHENTICATION_REQUIRED', 401);
    }
  }
  private async run<T>(
    tenant: SessionAuthorizationContext,
    periodId: string,
    write: boolean,
    fn: (c: Work) => Promise<T>,
  ): Promise<T> {
    const { context: t } = await this.authorization.revalidateSession(
      tenant.sessionId,
    );
    if (
      !t.tenantActive ||
      !t.organizationId ||
      !t.membershipId ||
      t.organizationId !== tenant.organizationId ||
      t.membershipId !== tenant.membershipId
    )
      monthlyError('MONTHLY_SCOPE_DENIED', 403);
    this.permission(t, 'cfdi.view');
    this.permission(t, 'periods.view');
    return this.db
      .transaction('REPEATABLE READ', async (m) => {
        await this.transactions.apply(m, {
          organizationId: t.organizationId!,
          membershipId: t.membershipId!,
        });
        const [p] = await m.query<PeriodRow[]>(
          `SELECT p.*,fy.year,le.rfc,le.status AS entity_status FROM periods p JOIN fiscal_years fy ON fy.id=p.fiscal_year_id JOIN legal_entities le ON le.id=p.legal_entity_id WHERE p.organization_id=$1 AND p.id=$2 ${write ? 'FOR UPDATE OF p' : ''}`,
          [t.organizationId, periodId],
        );
        if (
          !p ||
          !['active', 'suspended'].includes(p.entity_status) ||
          (write && p.entity_status !== 'active')
        )
          monthlyError('MONTHLY_NOT_FOUND', 404);
        await this.accounts.requireAccessibleAccountWithManager(
          m,
          p.client_account_id,
          t,
        );
        const [w] = await m.query<Workspace[]>(
          'SELECT * FROM monthly_workspaces WHERE period_id=$1',
          [p.id],
        );
        if (write) {
          const [active] = await m.query<{ id: string }[]>(
            `SELECT id FROM auth_sessions WHERE id=$1 AND organization_id=$2 AND membership_id=$3 AND status='active' AND expires_at>clock_timestamp() FOR SHARE`,
            [t.sessionId, t.organizationId, t.membershipId],
          );
          if (!active) monthlyError('MONTHLY_SCOPE_DENIED', 403);
        }
        const permitted = await m.query<{ key: string }[]>(
          'SELECT key FROM unnest($1::text[]) allowed(key) WHERE monthly_permission($2,key)',
          [t.permissions, t.organizationId],
        );
        const current = { ...t, permissions: permitted.map((x) => x.key) };
        this.permission(current, 'cfdi.view');
        this.permission(current, 'periods.view');
        return fn({ m, t: current, p, w: w ?? null });
      })
      .catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'driverError' in error
        ) {
          const detail = error.driverError;
          if (
            typeof detail === 'object' &&
            detail !== null &&
            'code' in detail &&
            ['40001', '40P01'].includes(String(detail.code))
          )
            monthlyError('MONTHLY_VERSION_CONFLICT');
        }
        throw error;
      });
  }
  private async initialize(c: Work) {
    if (c.w) return c.w;
    const [template] = await c.m.query<{ id: string; item_keys: string[] }[]>(
      'SELECT id,item_keys FROM monthly_checklist_templates WHERE organization_id=$1 ORDER BY version DESC LIMIT 1',
      [c.t.organizationId],
    );
    const [w] = await c.m.query<Workspace[]>(
      `INSERT INTO monthly_workspaces(id,organization_id,client_account_id,legal_entity_id,period_id,template_id,template_keys) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        randomUUID(),
        ...this.scope(c),
        template?.id ?? null,
        template?.item_keys ?? DEFAULT_CHECKLIST,
      ],
    );
    c.w = w;
    return w;
  }
  private scope(c: Work) {
    return [
      c.p.organization_id,
      c.p.client_account_id,
      c.p.legal_entity_id,
      c.p.id,
    ];
  }
  private lease(c: Work, input: MonthlyWriteDto, allowClosed = false) {
    const w = c.w;
    if (
      !w ||
      w.lease_session_id !== c.t.sessionId ||
      w.lease_membership_id !== c.t.membershipId ||
      w.lease_instance_hash !== fingerprint(input.instanceToken) ||
      !w.lease_until ||
      w.lease_until.getTime() <= Date.now()
    )
      monthlyError('MONTHLY_LEASE_LOST');
    if (w.version !== input.expectedVersion)
      monthlyError('MONTHLY_VERSION_CONFLICT');
    if (!allowClosed && ['closed', 'changes_detected'].includes(c.p.status))
      monthlyError('MONTHLY_CLOSED');
  }
  private async changed(c: Work) {
    await c.m.query(
      'UPDATE monthly_workspaces SET version=version+1,prepared_fingerprint=NULL WHERE period_id=$1',
      [c.p.id],
    );
    await c.m.query(
      `UPDATE periods SET lock_version=lock_version+1,status=CASE WHEN status IN('not_started','ready_to_close') THEN 'preparation' ELSE status END WHERE id=$1 AND organization_id=$2`,
      [c.p.id, c.p.organization_id],
    );
    if (c.w) c.w.version++;
    return c.w!.version;
  }
  private async audit(
    c: Work,
    action: string,
    objectId: string,
    reason: string | null = null,
    decision: 'ALLOW' | 'DENY' = 'ALLOW',
  ) {
    await c.m.query(
      `INSERT INTO audit_events(organization_id,actor_type,actor_user_id,actor_membership_id,client_account_id,legal_entity_id,action,decision,object_type,object_id,reason,correlation_id) VALUES($1,'user',$2,$3,$4,$5,$6,$10,'monthly_workspace',$7,$8,$9)`,
      [
        c.p.organization_id,
        c.t.userId,
        c.t.membershipId,
        c.p.client_account_id,
        c.p.legal_entity_id,
        action,
        objectId,
        reason,
        randomUUID(),
        decision,
      ],
    );
  }
  private async replay(
    c: Work,
    key: string,
    operation: string,
    value: unknown,
  ) {
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(key))
      monthlyError('MONTHLY_IDEMPOTENCY_REQUIRED', 400);
    const [old] = await c.m.query<
      { fingerprint: string; response: Record<string, unknown> }[]
    >(
      'SELECT fingerprint,response FROM monthly_operations WHERE period_id=$1 AND actor_membership_id=$2 AND idempotency_key=$3',
      [c.p.id, c.t.membershipId, key],
    );
    const hash = fingerprint([operation, value]);
    if (old && old.fingerprint !== hash)
      monthlyError('MONTHLY_IDEMPOTENCY_CONFLICT');
    return { old: old?.response, hash };
  }
  private async remember(
    c: Work,
    key: string,
    operation: string,
    hash: string,
    response: object,
  ) {
    await c.m.query(
      `INSERT INTO monthly_operations(id,organization_id,client_account_id,legal_entity_id,period_id,actor_membership_id,idempotency_key,operation,fingerprint,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        ...this.scope(c),
        c.t.membershipId,
        key,
        operation,
        hash,
        JSON.stringify(response),
      ],
    );
  }
  async acquire(
    t: SessionAuthorizationContext,
    id: string,
    input: LeaseDto,
    takeover = false,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, takeover ? 'periods.takeover' : 'periods.review');
      const w = await this.initialize(c);
      if (takeover && !input.reason?.trim())
        monthlyError('MONTHLY_REASON_REQUIRED', 400);
      const mine =
        w.lease_session_id === c.t.sessionId &&
        w.lease_membership_id === c.t.membershipId &&
        w.lease_instance_hash === fingerprint(input.instanceToken);
      if (
        !mine &&
        w.lease_until &&
        w.lease_until.getTime() > Date.now() &&
        !takeover
      )
        monthlyError('MONTHLY_ALREADY_EDITING');
      await c.m.query(
        `UPDATE monthly_workspaces SET lease_session_id=$2,lease_membership_id=$3,lease_instance_hash=$4,lease_until=LEAST(clock_timestamp()+interval '120 seconds',$5::timestamptz) WHERE period_id=$1`,
        [
          id,
          c.t.sessionId,
          c.t.membershipId,
          fingerprint(input.instanceToken),
          c.t.expiresAt,
        ],
      );
      await this.audit(
        c,
        takeover ? 'monthly.lease_taken_over' : 'monthly.lease_acquired',
        id,
        input.reason ?? null,
      );
      return { version: w.version, leaseSeconds: 120 };
    });
  }
  async renew(
    t: SessionAuthorizationContext,
    id: string,
    input: MonthlyWriteDto,
    release = false,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'periods.review');
      this.lease(c, input, true);
      await c.m.query(
        release
          ? `UPDATE monthly_workspaces SET lease_session_id=NULL,lease_membership_id=NULL,lease_instance_hash=NULL,lease_until=NULL WHERE period_id=$1`
          : `UPDATE monthly_workspaces SET lease_until=LEAST(clock_timestamp()+interval '120 seconds',$2::timestamptz) WHERE period_id=$1`,
        release ? [id] : [id, c.t.expiresAt],
      );
      return { version: c.w!.version, released: release };
    });
  }
  private async participations(c: Work) {
    return c.m.query<Participation[]>(
      participationSql + ' ORDER BY pc.source_date,pc.id',
      [c.p.organization_id, c.p.id, c.t.permissions.includes('payroll.view')],
    );
  }
  async list(t: SessionAuthorizationContext, id: string, q: MonthlyQueryDto) {
    return this.run(t, id, false, async (c) => {
      const values: unknown[] = [
        c.p.organization_id,
        id,
        c.t.permissions.includes('payroll.view'),
      ];
      const where: string[] = [];
      const add = (sql: string, v: unknown) => {
        values.push(v);
        where.push(sql.replace('?', '$' + values.length));
      };
      if (q.direction) add('direction=?', q.direction);
      if (q.documentType) add('"documentType"=?', q.documentType);
      if (q.currency) add('currency=?', q.currency);
      if (q.search)
        add(
          `(uuid::text||' '||"issuerRfc"||' '||"receiverRfc"||' '||coalesce("issuerName",'')||' '||coalesce("receiverName",'')) ILIKE ?`,
          '%' + q.search.replace(/[%_]/g, '\\$&') + '%',
        );
      if (q.dateFrom) add('left("literalDate",10)::date>=?::date', q.dateFrom);
      if (q.dateTo) add('left("literalDate",10)::date<=?::date', q.dateTo);
      if (q.amountFrom) add('total::numeric>=?::numeric', q.amountFrom);
      if (q.amountTo) add('total::numeric<=?::numeric', q.amountTo);
      if (q.view === 'pending') where.push(`"reviewStatus"='pending'`);
      if (q.view === 'excluded') where.push(`inclusion='excluded'`);
      if (q.view === 'incidents') where.push('"hasIncidents"');
      if (q.view === 'news') {
        const changes = await this.newsInternal(c);
        add(
          'id=ANY(?::uuid[])',
          [...changes.added, ...changes.changed].map((x) => x.id),
        );
      }
      const base =
        'WITH items AS (' +
        participationSql +
        ') SELECT * FROM items' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '');
      const [{ total }] = await c.m.query<{ total: string }[]>(
        'SELECT count(*)::text AS total FROM (' + base + ') filtered',
        values,
      );
      values.push(q.limit, (q.page - 1) * q.limit);
      const rows = await c.m.query<Participation[]>(
        base +
          ` ORDER BY "sourceDate",id LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      // Private object IDs/hashes belong to internal snapshots, never the table DTO.
      const items = rows.map(publicParticipation);
      return {
        items,
        meta: {
          page: q.page,
          limit: q.limit,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / q.limit),
        },
      };
    });
  }
  async overview(t: SessionAuthorizationContext, id: string) {
    return this.run(t, id, false, async (c) => {
      const [{ documents, participations, pending, excluded, incidents }] =
        await c.m.query<
          {
            documents: string;
            participations: string;
            pending: string;
            excluded: string;
            incidents: string;
          }[]
        >(
          `WITH items AS (${participationSql}) SELECT count(DISTINCT "cfdiId")::text AS documents,count(*)::text AS participations,count(*) FILTER(WHERE "reviewStatus"='pending')::text AS pending,count(*) FILTER(WHERE inclusion='excluded')::text AS excluded,count(*) FILTER(WHERE "hasIncidents")::text AS incidents FROM items`,
          [c.p.organization_id, id, c.t.permissions.includes('payroll.view')],
        );
      const amounts = await c.m.query<
        {
          currency: string;
          documentType: string;
          direction: string;
          total: string;
        }[]
      >(
        `WITH items AS (${participationSql}) SELECT currency,"documentType",direction,sum(total::numeric)::text AS total FROM items WHERE "documentType" IN('I','E') GROUP BY currency,"documentType",direction ORDER BY currency,"documentType",direction`,
        [c.p.organization_id, id, c.t.permissions.includes('payroll.view')],
      );
      let effectiveStatus = c.p.status;
      if (
        c.w &&
        ['ready_to_close', 'closed', 'changes_detected'].includes(c.p.status) &&
        c.t.permissions.includes('incidents.view') &&
        c.t.permissions.includes('processes.view')
      ) {
        const [{ restricted }] = await c.m.query<{ restricted: boolean }[]>(
          "SELECT EXISTS(SELECT 1 FROM period_cfdis pc JOIN cfdis c ON c.id=pc.cfdi_id WHERE pc.period_id=$1 AND c.document_type='N') AS restricted",
          [id],
        );
        if (!restricted || c.t.permissions.includes('payroll.view')) {
          if (c.p.status === 'ready_to_close') {
            if (
              fingerprint(await this.snapshot(c)) !== c.w.prepared_fingerprint
            )
              effectiveStatus = 'preparation';
          } else if (c.w.latest_close_id) {
            const n = await this.newsInternal(c);
            if (
              n.added.length ||
              n.changed.length ||
              n.removed.length ||
              n.sourcesChanged ||
              n.incidentsChanged
            )
              effectiveStatus = 'changes_detected';
          }
        }
      }
      const [editorName] = c.w?.lease_membership_id
        ? await c.m.query<{ name: string }[]>(
            "SELECT u.first_name||' '||u.last_name AS name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.organization_id=$2",
            [c.w.lease_membership_id, c.p.organization_id],
          )
        : [];
      return {
        period: {
          id,
          legalEntityId: c.p.legal_entity_id,
          clientAccountId: c.p.client_account_id,
          rfc: c.p.rfc,
          year: c.p.year,
          month: c.p.month,
          status: effectiveStatus,
          version: c.w?.version ?? 0,
          legacyClosed: c.p.status === 'closed' && !c.w?.latest_close_id,
        },
        counts: {
          documents: Number(documents),
          participations: Number(participations),
          pending: Number(pending),
          reviewed: Number(participations) - Number(pending),
          excluded: Number(excluded),
          incidents: Number(incidents),
        },
        amounts,
        lease: {
          membershipId: c.w?.lease_membership_id ?? null,
          name: editorName?.name ?? null,
          expiresAt: c.w?.lease_until ?? null,
          ownSession: c.w?.lease_session_id === c.t.sessionId,
        },
        sources: await this.sources(c),
        permissions: c.t.permissions.filter(
          (x) =>
            x.startsWith('cfdi.') ||
            x.startsWith('periods.') ||
            x.startsWith('checklist.') ||
            x.startsWith('incidents.') ||
            x === 'exceptions.accept' ||
            x === 'payroll.view',
        ),
      };
    });
  }
  private async sources(c: Work): Promise<SourceEvidence[]> {
    if (!c.t.permissions.includes('processes.view'))
      return [
        {
          id: c.p.id,
          kind: 'ingestion',
          status: 'unavailable',
          scope: 'unclarified',
          pending: true,
          dateFrom: null,
          dateTo: null,
          observedAt: null,
        },
      ];
    const ingest = await c.m.query<SourceEvidence[]>(
      `SELECT j.id,'ingestion' AS kind,j.status,CASE WHEN l.id IS NULL THEN 'unclarified' ELSE 'linked' END AS scope,j.status NOT IN('completed','completed_with_issues','failed_final','cancelled') AS pending,NULL::text AS "dateFrom",NULL::text AS "dateTo",j.updated_at::text AS "observedAt" FROM ingestion_jobs j LEFT JOIN monthly_source_links l ON l.ingestion_job_id=j.id AND l.period_id=$2 WHERE j.organization_id=$1 AND j.legal_entity_id=$3 AND (l.id IS NOT NULL OR j.status NOT IN('completed','completed_with_issues','failed_final','cancelled') OR EXISTS(SELECT 1 FROM ingestion_items i JOIN period_cfdis pc ON pc.cfdi_id=i.cfdi_id WHERE i.ingestion_job_id=j.id AND pc.period_id=$2)) ORDER BY j.id`,
      [c.p.organization_id, c.p.id, c.p.legal_entity_id],
    );
    const sat = await c.m.query<SourceEvidence[]>(
      `SELECT j.id,'sat' AS kind,j.status,CASE WHEN l.id IS NOT NULL THEN 'linked' WHEN j.direction='folio' THEN 'unclarified' ELSE 'filters' END AS scope,j.status NOT IN('completed','completed_with_issues','cancelled','failed') AS pending,j.date_from::text AS "dateFrom",j.date_to::text AS "dateTo",r.verified_at::text AS "observedAt" FROM sat_download_jobs j LEFT JOIN monthly_source_links l ON l.sat_job_id=j.id AND l.period_id=$2 LEFT JOIN sat_requests r ON r.job_id=j.id WHERE j.organization_id=$1 AND j.legal_entity_id=$3 AND (l.id IS NOT NULL OR (j.direction='folio' AND j.terminal_at IS NULL) OR (j.date_from<make_date($4,$5,1)+interval '1 month' AND j.date_to>=make_date($4,$5,1))) ORDER BY j.id`,
      [c.p.organization_id, c.p.id, c.p.legal_entity_id, c.p.year, c.p.month],
    );
    return [...ingest, ...sat];
  }
  private async incidentEvidence(c: Work): Promise<IncidentEvidence[]> {
    if (!c.t.permissions.includes('incidents.view')) return [];
    return c.m.query<IncidentEvidence[]>(
      `SELECT i.id,i.cfdi_id AS "cfdiId",(SELECT cf.normalized_uuid FROM cfdis cf WHERE cf.id=i.cfdi_id) AS "cfdiUuid",ii.ingestion_job_id AS "ingestionJobId",i.code,i.severity,i.status AS "originalStatus",coalesce(e.version,0) AS version,CASE WHEN i.code='FISCAL_PERIOD_NOT_CONFIGURED' AND EXISTS(SELECT 1 FROM cfdi_period_reconciliations rr WHERE rr.cfdi_id=i.cfdi_id AND rr.status='resolved') THEN 'resolved' ELSE coalesce(e.state,i.status) END AS state,e.reason,e.comment,e.responsible_membership_id AS "responsibleMembershipId",e.actor_membership_id AS "actorMembershipId",e.id AS "eventId" FROM incidents i LEFT JOIN cfdis cf ON cf.id=i.cfdi_id LEFT JOIN ingestion_items ii ON ii.id=i.ingestion_item_id LEFT JOIN LATERAL(SELECT * FROM monthly_incident_events x WHERE x.incident_id=i.id AND x.period_id=$2 ORDER BY version DESC LIMIT 1)e ON true WHERE i.organization_id=$1 AND i.legal_entity_id=$3 AND ($4::boolean OR coalesce(cf.document_type,ii.document_type,'?')<>'N') AND (e.id IS NOT NULL OR EXISTS(SELECT 1 FROM period_cfdis pc WHERE pc.cfdi_id=i.cfdi_id AND pc.period_id=$2) OR EXISTS(SELECT 1 FROM monthly_source_links l WHERE l.period_id=$2 AND l.ingestion_job_id=ii.ingestion_job_id) OR EXISTS(SELECT 1 FROM ingestion_items sibling JOIN period_cfdis pc ON pc.cfdi_id=sibling.cfdi_id WHERE sibling.ingestion_job_id=ii.ingestion_job_id AND pc.period_id=$2)) ORDER BY i.id`,
      [
        c.p.organization_id,
        c.p.id,
        c.p.legal_entity_id,
        c.t.permissions.includes('payroll.view'),
      ],
    );
  }
  private async checklistEvidence(
    c: Work,
    rows: Participation[],
    incidents: IncidentEvidence[],
    sources: SourceEvidence[],
  ): Promise<ChecklistEvidence[]> {
    const human = await c.m.query<
      {
        item_key: string;
        version: number;
        confirmed: boolean;
        reason: string;
        id: string;
        actor_membership_id: string;
      }[]
    >(
      `SELECT DISTINCT ON(item_key) item_key,version,confirmed,reason,id,actor_membership_id FROM monthly_checklist_events WHERE period_id=$1 ORDER BY item_key,version DESC`,
      [c.p.id],
    );
    const automatic: Record<string, boolean> = {
      documents_reviewed: rows.every((x) => x.reviewStatus === 'reviewed'),
      exclusions_reasoned: rows.every(
        (x) => x.inclusion !== 'excluded' || Boolean(x.exclusionReason?.trim()),
      ),
      sources_settled: !sources.some((x) => x.pending),
      integrity_resolved:
        c.t.permissions.includes('incidents.view') &&
        incidents.every((x) =>
          ['resolved', 'dismissed', 'reviewed_rejection'].includes(x.state),
        ),
      snapshot_ready:
        c.t.permissions.includes('processes.view') &&
        c.t.permissions.includes('incidents.view') &&
        rows.every(
          (x) =>
            Boolean(x.sourceObjectId) &&
            /^[0-9a-f]{64}$/.test(x.sha256) &&
            Boolean(x.policyVersion),
        ),
    };
    return (c.w?.template_keys ?? [...DEFAULT_CHECKLIST]).map((key) => {
      const item = human.find((x) => x.item_key === key);
      return key in automatic
        ? {
            key,
            kind: 'automatic',
            version: 0,
            passed: automatic[key],
            reason: null,
            eventId: null,
            actorMembershipId: null,
          }
        : {
            key,
            kind: 'human',
            version: item?.version ?? 0,
            passed: item?.confirmed ?? false,
            reason: item?.reason ?? null,
            eventId: item?.id ?? null,
            actorMembershipId: item?.actor_membership_id ?? null,
          };
    });
  }
  private async snapshot(c: Work): Promise<MonthlySnapshot> {
    const participations = await this.participations(c),
      incidents = await this.incidentEvidence(c),
      sources = await this.sources(c);
    return {
      schemaVersion: MONTHLY_SCHEMA,
      decisionPolicy: DECISION_POLICY,
      periodId: c.p.id,
      entityId: c.p.legal_entity_id,
      year: c.p.year,
      month: c.p.month,
      participations,
      incidents,
      sources,
      checklist: await this.checklistEvidence(
        c,
        participations,
        incidents,
        sources,
      ),
      templateKeys: c.w?.template_keys ?? [...DEFAULT_CHECKLIST],
      scopeStatement:
        'Revisión interna de los CFDI incorporados; no acredita cobertura completa SAT ni presentación de declaración.',
    };
  }
  private async fullScope(c: Work) {
    if (
      !c.t.permissions.includes('incidents.view') ||
      !c.t.permissions.includes('processes.view')
    )
      monthlyError('MONTHLY_SCOPE_DENIED', 403);
    const [row] = await c.m.query<{ restricted: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM period_cfdis pc JOIN cfdis cf ON cf.id=pc.cfdi_id WHERE pc.period_id=$1 AND cf.document_type='N') OR EXISTS(SELECT 1 FROM monthly_source_links l JOIN ingestion_items i ON i.ingestion_job_id=l.ingestion_job_id WHERE l.period_id=$1 AND i.document_type='N') AS restricted`,
      [c.p.id],
    );
    if (row.restricted && !c.t.permissions.includes('payroll.view'))
      monthlyError('MONTHLY_SCOPE_DENIED', 403);
  }
  private async newsInternal(c: Work) {
    await this.fullScope(c);
    const [old] = await c.m.query<CloseRow[]>(
      'SELECT id,version,snapshot,closed_at FROM monthly_closes WHERE period_id=$1 ORDER BY version DESC LIMIT 1',
      [c.p.id],
    );
    const current = await this.snapshot(c);
    return old
      ? monthlyChanges(old.snapshot, current)
      : {
          added: [],
          changed: [],
          removed: [],
          sourceChanges: [],
          incidentChanges: [],
          sourcesChanged: false,
          incidentsChanged: false,
        };
  }
  async news(t: SessionAuthorizationContext, id: string) {
    return this.run(t, id, false, (c) => this.newsInternal(c));
  }
  async checklist(t: SessionAuthorizationContext, id: string) {
    return this.run(t, id, false, async (c) => {
      this.permission(c.t, 'checklist.view');
      const s = await this.snapshot(c);
      return { items: s.checklist, version: c.w?.version ?? 0 };
    });
  }
  async incidents(
    t: SessionAuthorizationContext,
    id: string,
    page = 1,
    limit = 25,
  ) {
    return this.run(t, id, false, async (c) => {
      this.permission(c.t, 'incidents.view');
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        monthlyError('MONTHLY_PAGE_INVALID', 400);
      const rows = await this.incidentEvidence(c);
      return {
        items: rows.slice((page - 1) * limit, page * limit),
        meta: { page, limit, total: rows.length },
      };
    });
  }
  private async saveDecision(c: Work, row: Participation, next: Decision) {
    validateDecision(next);
    for (const key of decisionPermissions(row, next)) this.permission(c.t, key);
    if (next.categoryId) {
      const [cat] = await c.m.query<{ label: string; archived: boolean }[]>(
        'SELECT label,archived FROM cfdi_categories WHERE organization_id=$1 AND id=$2',
        [c.p.organization_id, next.categoryId],
      );
      if (!cat || (cat.archived && row.categoryId !== next.categoryId))
        monthlyError('MONTHLY_CATEGORY_UNAVAILABLE');
      next.categoryLabel = cat.label;
    } else next.categoryLabel = null;
    const id = randomUUID();
    await c.m.query(
      `INSERT INTO monthly_decisions(id,organization_id,client_account_id,legal_entity_id,period_id,participation_id,version,review_status,inclusion,exclusion_reason,category_id,category_label,tax_status,tax_note,vat_status,vat_note,comment,actor_user_id,actor_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        id,
        ...this.scope(c),
        row.id,
        row.version + 1,
        next.reviewStatus,
        next.inclusion,
        next.exclusionReason,
        next.categoryId,
        next.categoryLabel,
        next.taxStatus,
        next.taxNote,
        next.vatStatus,
        next.vatNote,
        next.comment,
        c.t.userId,
        c.t.membershipId,
      ],
    );
    await this.audit(c, 'monthly.decision_saved', id);
    return { id: row.id, decisionId: id, decisionVersion: row.version + 1 };
  }
  async decision(
    t: SessionAuthorizationContext,
    id: string,
    participationId: string,
    input: DecisionDto,
    key: string,
  ) {
    return this.run(t, id, true, async (c) => {
      const next: Decision = {
        reviewStatus: input.reviewStatus,
        inclusion: input.inclusion,
        exclusionReason: input.exclusionReason?.trim() || null,
        categoryId: input.categoryId ?? null,
        categoryLabel: null,
        taxStatus: input.taxStatus,
        taxNote: input.taxNote?.trim() || null,
        vatStatus: input.vatStatus,
        vatNote: input.vatNote?.trim() || null,
        comment: input.comment?.trim() || null,
      };
      const replay = await this.replay(c, key, 'decision', [
        participationId,
        input.decisionVersion,
        next,
      ]);
      if (replay.old) return replay.old;
      this.lease(c, input);
      const [row] = await c.m.query<Participation[]>(
        participationSql + ' AND pc.id=$4',
        [
          c.p.organization_id,
          id,
          c.t.permissions.includes('payroll.view'),
          participationId,
        ],
      );
      if (!row) monthlyError('MONTHLY_NOT_FOUND', 404);
      if (row.version !== input.decisionVersion)
        monthlyError('MONTHLY_VERSION_CONFLICT');
      const result = {
        ...(await this.saveDecision(c, row, next)),
        version: await this.changed(c),
      };
      await this.remember(c, key, 'decision', replay.hash, result);
      return result;
    });
  }
  async history(
    t: SessionAuthorizationContext,
    id: string,
    participationId: string,
  ) {
    return this.run(t, id, false, async (c) => {
      const [row] = await c.m.query<Participation[]>(
        participationSql + ' AND pc.id=$4',
        [
          c.p.organization_id,
          id,
          c.t.permissions.includes('payroll.view'),
          participationId,
        ],
      );
      if (!row) monthlyError('MONTHLY_NOT_FOUND', 404);
      const items = await c.m.query<Record<string, unknown>[]>(
        `SELECT id,version,review_status AS "reviewStatus",inclusion,exclusion_reason AS "exclusionReason",category_label AS "categoryLabel",tax_status AS "taxStatus",tax_note AS "taxNote",vat_status AS "vatStatus",vat_note AS "vatNote",comment,actor_membership_id AS "actorMembershipId",created_at AS "createdAt" FROM monthly_decisions WHERE participation_id=$1 ORDER BY version DESC LIMIT 100`,
        [participationId],
      );
      return { items };
    });
  }
  async bulk(
    t: SessionAuthorizationContext,
    id: string,
    input: BulkDto,
    key: string,
    preview: boolean,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'cfdi.bulk_action');
      const selectionHash = fingerprint([
        input.selection,
        input.action,
        input.reason ?? null,
        input.categoryId ?? null,
      ]);
      const operation = preview ? 'bulk_preview' : 'bulk_execute';
      const replay = await this.replay(c, key, operation, [
        selectionHash,
        input.previewId ?? null,
      ]);
      if (replay.old) return replay.old;
      this.lease(c, input);
      if (!preview) {
        const [saved] = await c.m.query<
          { response: { selectionHash: string } }[]
        >(
          `SELECT response FROM monthly_operations WHERE id=$1 AND period_id=$2 AND actor_membership_id=$3 AND operation='bulk_preview'`,
          [input.previewId ?? null, id, c.t.membershipId],
        );
        if (saved?.response.selectionHash !== selectionHash)
          monthlyError('MONTHLY_PREVIEW_REQUIRED');
      }
      const rows = await c.m.query<Participation[]>(
        participationSql + ' AND pc.id=ANY($4::uuid[])',
        [
          c.p.organization_id,
          id,
          c.t.permissions.includes('payroll.view'),
          input.selection.map((x) => x.id),
        ],
      );
      const results: {
        id: string;
        status: string;
        code?: string;
        decisionVersion?: number;
      }[] = [];
      let applied = 0;
      for (const item of input.selection) {
        const row = rows.find((x) => x.id === item.id);
        if (!row) {
          results.push({
            id: item.id,
            status: 'failed',
            code: 'MONTHLY_NOT_FOUND',
          });
          continue;
        }
        if (row.version !== item.version) {
          results.push({
            id: item.id,
            status: 'failed',
            code: 'MONTHLY_VERSION_CONFLICT',
          });
          continue;
        }
        const next: Decision = { ...row };
        if (input.action === 'review' || input.action === 'unreview')
          next.reviewStatus =
            input.action === 'review' ? 'reviewed' : 'pending';
        if (input.action === 'include' || input.action === 'exclude') {
          next.inclusion = input.action === 'include' ? 'included' : 'excluded';
          next.exclusionReason =
            input.action === 'exclude' ? input.reason?.trim() || null : null;
        }
        if (input.action === 'category')
          next.categoryId = input.categoryId ?? null;
        await c.m.query('SAVEPOINT monthly_bulk_item');
        try {
          validateDecision(next);
          for (const permission of decisionPermissions(row, next))
            this.permission(c.t, permission);
          if (preview) {
            if (next.categoryId) {
              const [category] = await c.m.query<{ id: string }[]>(
                'SELECT id FROM cfdi_categories WHERE id=$1 AND NOT archived',
                [next.categoryId],
              );
              if (!category) monthlyError('MONTHLY_CATEGORY_UNAVAILABLE');
            }
            results.push({ id: item.id, status: 'eligible' });
          } else {
            const result = await this.saveDecision(c, row, next);
            results.push({
              id: item.id,
              status: 'applied',
              decisionVersion: result.decisionVersion,
            });
            applied++;
          }
          await c.m.query('RELEASE SAVEPOINT monthly_bulk_item');
        } catch (error) {
          await c.m.query('ROLLBACK TO SAVEPOINT monthly_bulk_item');
          await c.m.query('RELEASE SAVEPOINT monthly_bulk_item');
          if (!(error instanceof Error) || !('getResponse' in error))
            throw error;
          const detail = (
            error as { getResponse: () => unknown }
          ).getResponse();
          const code =
            typeof detail === 'object' && detail !== null && 'code' in detail
              ? String(detail.code)
              : 'MONTHLY_ACTION_DENIED';
          results.push({ id: item.id, status: 'failed', code });
          if (!preview)
            await this.audit(
              c,
              'monthly.bulk_item_rejected',
              item.id,
              code,
              'DENY',
            );
        }
      }
      const version = applied ? await this.changed(c) : c.w!.version;
      const previewId = preview ? randomUUID() : undefined;
      const response = {
        previewId,
        selectionHash,
        selection: input.selection,
        action: input.action,
        results,
        applied,
        failed: results.filter((x) => x.status === 'failed').length,
        version,
      };
      if (preview) {
        await c.m.query(
          `INSERT INTO monthly_operations(id,organization_id,client_account_id,legal_entity_id,period_id,actor_membership_id,idempotency_key,operation,fingerprint,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            previewId,
            ...this.scope(c),
            c.t.membershipId,
            key,
            operation,
            replay.hash,
            JSON.stringify(response),
          ],
        );
      } else await this.remember(c, key, operation, replay.hash, response);
      return response;
    });
  }
  async confirmChecklist(
    t: SessionAuthorizationContext,
    id: string,
    input: ChecklistDto,
    key: string,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'checklist.complete');
      const replay = await this.replay(c, key, 'checklist', [
        input.key,
        input.itemVersion,
        input.confirmed,
        input.reason,
      ]);
      if (replay.old) return replay.old;
      this.lease(c, input);
      if (
        !input.reason?.trim() ||
        !c.w!.template_keys.includes(input.key) ||
        !(HUMAN_CHECKLIST as readonly string[]).includes(input.key)
      )
        monthlyError('MONTHLY_CHECKLIST_INVALID', 400);
      const [old] = await c.m.query<{ version: number }[]>(
        'SELECT version FROM monthly_checklist_events WHERE period_id=$1 AND item_key=$2 ORDER BY version DESC LIMIT 1',
        [id, input.key],
      );
      if ((old?.version ?? 0) !== input.itemVersion)
        monthlyError('MONTHLY_VERSION_CONFLICT');
      await c.m.query(
        `INSERT INTO monthly_checklist_events(id,organization_id,client_account_id,legal_entity_id,period_id,item_key,version,confirmed,reason,actor_user_id,actor_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          ...this.scope(c),
          input.key,
          input.itemVersion + 1,
          input.confirmed,
          input.reason,
          c.t.userId,
          c.t.membershipId,
        ],
      );
      await this.audit(c, 'monthly.checklist_confirmed', id, input.reason);
      const response = {
        version: await this.changed(c),
        itemVersion: input.itemVersion + 1,
      };
      await this.remember(c, key, 'checklist', replay.hash, response);
      return response;
    });
  }
  async incidentHistory(
    t: SessionAuthorizationContext,
    id: string,
    incidentId: string,
    page = 1,
    limit = 25,
  ) {
    return this.run(t, id, false, async (c) => {
      this.permission(c.t, 'incidents.view');
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        monthlyError('MONTHLY_PAGE_INVALID', 400);
      if (!(await this.incidentEvidence(c)).some((x) => x.id === incidentId))
        monthlyError('MONTHLY_NOT_FOUND', 404);
      const [{ total }] = await c.m.query<{ total: string }[]>(
        'SELECT count(*)::text AS total FROM monthly_incident_events WHERE period_id=$1 AND incident_id=$2',
        [id, incidentId],
      );
      const items = await c.m.query<
        {
          version: number;
          state: string;
          reason: string;
          comment: string | null;
          actorMembershipId: string;
          createdAt: Date;
        }[]
      >(
        `SELECT version,state,reason,comment,actor_membership_id AS "actorMembershipId",responsible_membership_id AS "responsibleMembershipId",created_at AS "createdAt" FROM monthly_incident_events WHERE period_id=$1 AND incident_id=$2 ORDER BY version DESC LIMIT $3 OFFSET $4`,
        [id, incidentId, limit, (page - 1) * limit],
      );
      return { items, meta: { page, limit, total: Number(total) } };
    });
  }
  async manageIncident(
    t: SessionAuthorizationContext,
    id: string,
    incidentId: string,
    input: IncidentDto,
    key: string,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'incidents.manage');
      const replay = await this.replay(c, key, 'incident', [
        incidentId,
        input.incidentVersion,
        input.state,
        input.reason,
        input.comment,
        input.responsibleMembershipId,
      ]);
      if (replay.old) return replay.old;
      this.lease(c, input);
      if (!input.reason?.trim()) monthlyError('MONTHLY_REASON_REQUIRED', 400);
      const row = (await this.incidentEvidence(c)).find(
        (x) => x.id === incidentId,
      );
      if (!row) monthlyError('MONTHLY_NOT_FOUND', 404);
      if (row.version !== input.incidentVersion)
        monthlyError('MONTHLY_VERSION_CONFLICT');
      // A reviewer may acknowledge rejection, but cannot override unresolved integrity of an incorporated original.
      if (
        ['resolved', 'reviewed_rejection'].includes(input.state) &&
        row.cfdiId &&
        row.originalStatus === 'open' &&
        ['high', 'critical'].includes(row.severity)
      )
        monthlyError('MONTHLY_INTEGRITY_UNRESOLVED');
      if (input.state === 'reviewed_rejection' && row.cfdiId)
        monthlyError('MONTHLY_REJECTION_NOT_APPLICABLE');
      if (input.responsibleMembershipId) {
        const [{ payroll }] = await c.m.query<{ payroll: boolean }[]>(
          `SELECT EXISTS(SELECT 1 FROM cfdis WHERE id=$1 AND document_type='N') AS payroll`,
          [row.cfdiId],
        );
        const [assignee] = await c.m.query<{ id: string }[]>(
          `SELECT m.id FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.id=$2 AND m.status='active' AND (o.owner_user_id=m.user_id OR EXISTS(SELECT 1 FROM account_assignments a WHERE a.organization_id=m.organization_id AND a.membership_id=m.id AND a.client_account_id=$3 AND a.status='active')) AND NOT EXISTS(SELECT required.key FROM unnest($4::text[]) required(key) WHERE NOT EXISTS(SELECT 1 FROM permissions p WHERE p.key=required.key AND p.status='active' AND NOT EXISTS(SELECT 1 FROM membership_permissions mp WHERE mp.membership_id=m.id AND mp.permission_id=p.id AND mp.revoked_at IS NULL AND mp.effect='deny') AND (EXISTS(SELECT 1 FROM membership_permissions mp WHERE mp.membership_id=m.id AND mp.permission_id=p.id AND mp.revoked_at IS NULL AND mp.effect='grant') OR EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=m.role_id AND rp.permission_id=p.id AND rp.enabled AND (rp.valid_from IS NULL OR rp.valid_from<=statement_timestamp()) AND (rp.valid_until IS NULL OR rp.valid_until>statement_timestamp())))))`,
          [
            c.p.organization_id,
            input.responsibleMembershipId,
            c.p.client_account_id,
            payroll
              ? ['incidents.manage', 'payroll.view']
              : ['incidents.manage'],
          ],
        );
        if (!assignee) monthlyError('MONTHLY_ASSIGNEE_INVALID', 400);
      }
      await c.m.query(
        `INSERT INTO monthly_incident_events(id,organization_id,client_account_id,legal_entity_id,period_id,incident_id,version,state,responsible_membership_id,reason,comment,actor_user_id,actor_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          ...this.scope(c),
          incidentId,
          input.incidentVersion + 1,
          input.state,
          input.responsibleMembershipId ?? null,
          input.reason,
          input.comment,
          c.t.userId,
          c.t.membershipId,
        ],
      );
      await this.audit(c, 'monthly.incident_managed', incidentId, input.reason);
      const response = {
        version: await this.changed(c),
        incidentVersion: input.incidentVersion + 1,
      };
      await this.remember(c, key, 'incident', replay.hash, response);
      return response;
    });
  }
  async linkSource(
    t: SessionAuthorizationContext,
    id: string,
    input: SourceLinkDto,
    key: string,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'periods.review');
      this.permission(c.t, 'processes.view');
      const replay = await this.replay(c, key, 'source', [
        input.kind,
        input.sourceId,
        input.reason,
      ]);
      if (replay.old) return replay.old;
      this.lease(c, input);
      if (!input.reason?.trim()) monthlyError('MONTHLY_REASON_REQUIRED', 400);
      const table =
        input.kind === 'sat' ? 'sat_download_jobs' : 'ingestion_jobs';
      const [source] = await c.m.query<{ id: string }[]>(
        `SELECT id FROM ${table} WHERE organization_id=$1 AND client_account_id=$2 AND legal_entity_id=$3 AND id=$4`,
        [...this.scope(c).slice(0, 3), input.sourceId],
      );
      if (!source) monthlyError('MONTHLY_NOT_FOUND', 404);
      await c.m.query(
        `INSERT INTO monthly_source_links(id,organization_id,client_account_id,legal_entity_id,period_id,ingestion_job_id,sat_job_id,reason,actor_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          ...this.scope(c),
          input.kind === 'ingestion' ? input.sourceId : null,
          input.kind === 'sat' ? input.sourceId : null,
          input.reason,
          c.t.membershipId,
        ],
      );
      await this.audit(
        c,
        'monthly.source_linked',
        input.sourceId,
        input.reason,
      );
      const response = { version: await this.changed(c) };
      await this.remember(c, key, 'source', replay.hash, response);
      return response;
    });
  }
  private closeChecks(c: Work, s: MonthlySnapshot, input: CloseDto) {
    const pending = s.sources.some((x) => x.pending);
    if (pending) {
      if (!input.sourceExceptionReason?.trim())
        monthlyError('MONTHLY_SOURCES_PENDING');
      this.permission(c.t, 'exceptions.accept');
    }
    if (
      s.checklist.some(
        (x) =>
          !x.passed &&
          !(
            x.key === 'sources_settled' &&
            pending &&
            input.sourceExceptionReason?.trim()
          ),
      )
    )
      monthlyError('MONTHLY_CLOSE_BLOCKED');
  }
  async prepareClose(
    t: SessionAuthorizationContext,
    id: string,
    input: CloseDto,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'periods.ready');
      this.lease(c, input);
      await this.fullScope(c);
      const snapshot = await this.snapshot(c);
      this.lease(c, input);
      this.closeChecks(c, snapshot, input);
      const hash = fingerprint(snapshot);
      await c.m.query(
        'UPDATE monthly_workspaces SET version=version+1,prepared_fingerprint=$2 WHERE period_id=$1',
        [id, hash],
      );
      await c.m.query(
        `UPDATE periods SET status='ready_to_close',lock_version=lock_version+1 WHERE id=$1`,
        [id],
      );
      await this.audit(c, 'monthly.close_prepared', id);
      return {
        version: c.w!.version + 1,
        documents: new Set(snapshot.participations.map((x) => x.cfdiId)).size,
        participations: snapshot.participations.length,
        excluded: snapshot.participations.filter(
          (x) => x.inclusion === 'excluded',
        ).length,
        checklist: snapshot.checklist,
        sources: snapshot.sources,
        sourceExceptionReason: input.sourceExceptionReason ?? null,
        scopeStatement: snapshot.scopeStatement,
      };
    });
  }
  async close(
    t: SessionAuthorizationContext,
    id: string,
    input: CloseDto,
    key: string,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'periods.close');
      await this.fullScope(c);
      const replay = await this.replay(c, key, 'close', [
        input.expectedVersion,
        input.sourceExceptionReason?.trim() || null,
      ]);
      if (replay.old) return replay.old;
      this.lease(c, input);
      if (c.p.status !== 'ready_to_close') monthlyError('MONTHLY_NOT_PREPARED');
      const snapshot = await this.snapshot(c);
      this.closeChecks(c, snapshot, input);
      const hash = fingerprint(snapshot);
      if (c.w!.prepared_fingerprint !== hash)
        monthlyError('MONTHLY_INFORMATION_CHANGED');
      const [{ version }] = await c.m.query<{ version: number }[]>(
        'SELECT coalesce(max(version),0)+1 AS version FROM monthly_closes WHERE period_id=$1',
        [id],
      );
      const closeId = randomUUID();
      await c.m.query(
        `INSERT INTO monthly_closes(id,organization_id,client_account_id,legal_entity_id,period_id,version,workspace_version,schema_version,fingerprint,snapshot,source_exception_reason,actor_user_id,actor_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          closeId,
          ...this.scope(c),
          version,
          c.w!.version,
          MONTHLY_SCHEMA,
          hash,
          JSON.stringify(snapshot),
          input.sourceExceptionReason?.trim() || null,
          c.t.userId,
          c.t.membershipId,
        ],
      );
      await c.m.query(
        'UPDATE monthly_workspaces SET latest_close_id=$2,version=version+1,prepared_fingerprint=NULL WHERE period_id=$1',
        [id, closeId],
      );
      await c.m.query(
        `UPDATE periods SET status='closed',cutoff_at=clock_timestamp(),lock_version=lock_version+1 WHERE id=$1`,
        [id],
      );
      await this.audit(
        c,
        'monthly.closed',
        closeId,
        input.sourceExceptionReason ?? null,
      );
      const response = {
        id: closeId,
        closeVersion: version,
        version: c.w!.version + 1,
        status: 'closed',
      };
      await this.remember(c, key, 'close', replay.hash, response);
      return response;
    });
  }
  async reopen(
    t: SessionAuthorizationContext,
    id: string,
    input: MonthlyWriteDto,
    key: string,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'periods.reopen');
      await this.fullScope(c);
      const replay = await this.replay(c, key, 'reopen', [
        input.expectedVersion,
        input.reason,
      ]);
      if (replay.old) return replay.old;
      this.lease(c, input, true);
      if (
        !['closed', 'changes_detected'].includes(c.p.status) ||
        !input.reason?.trim()
      )
        monthlyError('MONTHLY_REOPEN_INVALID');
      await c.m.query(
        `UPDATE periods SET status='reopened',lock_version=lock_version+1 WHERE id=$1`,
        [id],
      );
      await c.m.query(
        'UPDATE monthly_workspaces SET version=version+1,prepared_fingerprint=NULL WHERE period_id=$1',
        [id],
      );
      await this.audit(c, 'monthly.reopened', id, input.reason);
      const response = { status: 'reopened', version: c.w!.version + 1 };
      await this.remember(c, key, 'reopen', replay.hash, response);
      return response;
    });
  }
  async closes(
    t: SessionAuthorizationContext,
    id: string,
    version?: number,
    page = 1,
    limit = 25,
  ) {
    return this.run(t, id, false, async (c) => {
      await this.fullScope(c);
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        monthlyError('MONTHLY_PAGE_INVALID', 400);
      if (version !== undefined) {
        if (!Number.isInteger(version) || version < 1)
          monthlyError('MONTHLY_PAGE_INVALID', 400);
        const [row] = await c.m.query<CloseRow[]>(
          `SELECT id,version,closed_at,source_exception_reason,actor_membership_id,jsonb_array_length(snapshot->'participations') AS total,(snapshot-'participations')||jsonb_build_object('participations',coalesce((SELECT jsonb_agg(item ORDER BY ordinal) FROM (SELECT item,ordinal FROM jsonb_array_elements(snapshot->'participations') WITH ORDINALITY a(item,ordinal) ORDER BY ordinal LIMIT $3 OFFSET $4) page),'[]'::jsonb)) AS snapshot FROM monthly_closes WHERE period_id=$1 AND version=$2`,
          [id, version, limit, (page - 1) * limit],
        );
        if (!row) monthlyError('MONTHLY_NOT_FOUND', 404);
        return {
          id: row.id,
          version: row.version,
          closedAt: row.closed_at,
          sourceExceptionReason: row.source_exception_reason,
          actorMembershipId: row.actor_membership_id,
          meta: { page, limit, total: row.total ?? 0 },
          snapshot: {
            ...row.snapshot,
            participations: row.snapshot.participations.map((row) =>
              publicParticipation(row),
            ),
          },
        };
      }
      return {
        items: await c.m.query<Record<string, unknown>[]>(
          `SELECT id,version,closed_at AS "closedAt",actor_membership_id AS "actorMembershipId",source_exception_reason AS "sourceExceptionReason" FROM monthly_closes WHERE period_id=$1 ORDER BY version DESC LIMIT 100`,
          [id],
        ),
      };
    });
  }
  async visibleDocument(
    t: SessionAuthorizationContext,
    id: string,
    participationId: string,
  ) {
    return this.run(t, id, false, async (c) => {
      const [row] = await c.m.query<Participation[]>(
        participationSql + ' AND pc.id=$4',
        [
          c.p.organization_id,
          id,
          c.t.permissions.includes('payroll.view'),
          participationId,
        ],
      );
      if (!row) monthlyError('MONTHLY_NOT_FOUND', 404);
      return { cfdiId: row.cfdiId, context: c.t };
    });
  }
  async checklistTemplate(t: SessionAuthorizationContext, id: string) {
    return this.run(t, id, false, async (c) => {
      this.permission(c.t, 'checklist.view');
      const [row] = await c.m.query<{ version: number; keys: string[] }[]>(
        'SELECT version,item_keys AS keys FROM monthly_checklist_templates WHERE organization_id=$1 ORDER BY version DESC LIMIT 1',
        [c.p.organization_id],
      );
      return row ?? { version: 0, keys: [...DEFAULT_CHECKLIST] };
    });
  }
  async assignees(t: SessionAuthorizationContext, id: string) {
    return this.run(t, id, false, async (c) => {
      this.permission(c.t, 'incidents.view');
      return {
        items: await c.m.query<{ id: string; name: string }[]>(
          `SELECT m.id,u.first_name||' '||u.last_name AS name FROM memberships m JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.status='active' AND u.status='active' AND (o.owner_user_id=m.user_id OR EXISTS(SELECT 1 FROM account_assignments a WHERE a.organization_id=m.organization_id AND a.membership_id=m.id AND a.client_account_id=$2 AND a.status='active')) ORDER BY u.first_name,u.last_name,m.id LIMIT 100`,
          [c.p.organization_id, c.p.client_account_id],
        ),
      };
    });
  }
  async categories(t: SessionAuthorizationContext, id: string) {
    return this.run(t, id, false, async (c) => ({
      items: await c.m.query<Record<string, unknown>[]>(
        'SELECT id,label,archived,version FROM cfdi_categories WHERE organization_id=$1 ORDER BY archived,lower(label),id',
        [c.p.organization_id],
      ),
    }));
  }
  async category(
    t: SessionAuthorizationContext,
    id: string,
    categoryId: string | undefined,
    input: CategoryDto,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'cfdi.categories.manage');
      if (!input.label.trim()) monthlyError('MONTHLY_CATEGORY_INVALID', 400);
      if (categoryId) {
        const rows = await c.m.query<{ id: string; version: number }[]>(
          'UPDATE cfdi_categories SET label=$3,archived=$4,version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 AND version=$5 RETURNING id,version',
          [
            c.p.organization_id,
            categoryId,
            input.label.trim(),
            input.archived,
            input.expectedVersion,
          ],
        );
        if (!rows[0]) monthlyError('MONTHLY_VERSION_CONFLICT');
        await this.audit(c, 'monthly.category_updated', categoryId);
        return rows[0];
      }
      if (input.expectedVersion !== 0) monthlyError('MONTHLY_VERSION_CONFLICT');
      const newId = randomUUID();
      await c.m.query(
        'INSERT INTO cfdi_categories(id,organization_id,label,archived,created_by) VALUES($1,$2,$3,$4,$5)',
        [
          newId,
          c.p.organization_id,
          input.label.trim(),
          input.archived,
          c.t.membershipId,
        ],
      );
      await this.audit(c, 'monthly.category_created', newId);
      return { id: newId, version: 1 };
    });
  }
  async configureChecklist(
    t: SessionAuthorizationContext,
    id: string,
    input: TemplateDto,
  ) {
    return this.run(t, id, true, async (c) => {
      this.permission(c.t, 'checklist.configure');
      if (DEFAULT_CHECKLIST.some((x) => !input.keys.includes(x)))
        monthlyError('MONTHLY_CHECKLIST_MINIMUM_REQUIRED', 400);
      await c.m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        c.p.organization_id + ':monthly-template',
      ]);
      const [{ version }] = await c.m.query<{ version: number }[]>(
        'SELECT coalesce(max(version),0) AS version FROM monthly_checklist_templates WHERE organization_id=$1',
        [c.p.organization_id],
      );
      if (version !== input.expectedVersion)
        monthlyError('MONTHLY_VERSION_CONFLICT');
      await c.m.query(
        'INSERT INTO monthly_checklist_templates(id,organization_id,version,item_keys,created_by) VALUES($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          c.p.organization_id,
          version + 1,
          input.keys,
          c.t.membershipId,
        ],
      );
      await this.audit(c, 'monthly.template_configured', id);
      return { version: version + 1, appliesTo: 'future_workspaces' };
    });
  }
}
