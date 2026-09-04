import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import type { FiscalPlatformConfig } from '../../../config/fiscal-platform.config';
import { FiscalTenantTransactionService } from '../../../database/rls/fiscal-tenant-transaction.service';
import { ClientAccountScopeService } from '../../client-accounts/client-account-scope.service';
import { OBJECT_STORAGE_PORT } from '../../object-storage/object-storage.tokens';
import type { ObjectStoragePort } from '../../object-storage/ports/object-storage.port';
import type { SessionAuthorizationContext } from '../../sessions/session.types';
import { cfdiHttpError } from '../cfdi-http.errors';
import type { CfdiListQueryDto } from '../dtos/cfdi-query.dtos';

interface CfdiRow {
  id: string;
  client_account_id: string;
  legal_entity_id: string;
  source_object_id: string;
  normalized_uuid: string;
  cfdi_version: string;
  schema_version: string;
  parser_version: string;
  document_type: string;
  issued_at: Date;
  certified_at: Date;
  issuer_rfc: string;
  issuer_name: string | null;
  receiver_rfc: string;
  receiver_name: string | null;
  receiver_fiscal_zip: string | null;
  receiver_fiscal_regime_code: string | null;
  usage_code: string | null;
  currency: string;
  exchange_rate: string | null;
  subtotal: string;
  discount: string | null;
  total: string;
  payment_form: string | null;
  payment_method: string | null;
  place_of_issue: string | null;
  export_code: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

type SqlRow = Record<string, unknown>;

@Injectable()
export class CfdiQueryService {
  private readonly ttlSeconds: number;
  private readonly apiPrefix: string;

  constructor(
    private readonly transactions: FiscalTenantTransactionService,
    private readonly accountScope: ClientAccountScopeService,
    @Inject(OBJECT_STORAGE_PORT)
    private readonly storage: ObjectStoragePort,
    config: ConfigService,
  ) {
    this.ttlSeconds =
      config.getOrThrow<FiscalPlatformConfig>(
        'fiscalPlatform',
      ).storage.signedUrlTtlSeconds;
    const configuredPrefix = config.get<string>('app.globalPrefix') ?? 'api/v1';
    this.apiPrefix =
      configuredPrefix.trim().replace(/^\/+|\/+$/g, '') || 'api/v1';
  }

  async list(
    legalEntityId: string,
    query: CfdiListQueryDto,
    tenant: SessionAuthorizationContext,
  ) {
    return this.run(tenant, async (manager) => {
      await this.requireEntity(manager, legalEntityId, tenant);
      const where = ['organization_id = $1', 'legal_entity_id = $2'];
      const values: unknown[] = [tenant.organizationId, legalEntityId];
      if (query.documentType) {
        values.push(query.documentType);
        where.push(`document_type = $${values.length}`);
      }
      if (query.uuid) {
        values.push(query.uuid.toLowerCase());
        where.push(`normalized_uuid = $${values.length}::uuid`);
      }
      if (query.issuedFrom) {
        values.push(query.issuedFrom);
        where.push(`issued_at >= $${values.length}::timestamptz`);
      }
      if (query.issuedTo) {
        values.push(query.issuedTo);
        where.push(`issued_at <= $${values.length}::timestamptz`);
      }
      if (query.counterpartyRfc) {
        values.push(query.counterpartyRfc.toUpperCase());
        where.push(
          `(issuer_rfc = $${values.length} OR receiver_rfc = $${values.length})`,
        );
      }
      const [{ total }] = await manager.query<Array<{ total: string }>>(
        `SELECT count(*)::text AS total FROM cfdis WHERE ${where.join(' AND ')}`,
        values,
      );
      const sorts = {
        issuedAt: 'issued_at',
        total: 'total',
        createdAt: 'created_at',
      } as const;
      const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
      values.push(query.limit, (query.page - 1) * query.limit);
      const rows = await manager.query<CfdiRow[]>(
        `SELECT id, client_account_id, legal_entity_id, source_object_id,
                normalized_uuid, cfdi_version, schema_version, parser_version,
                document_type, issued_at, certified_at, issuer_rfc, issuer_name,
                receiver_rfc, receiver_name, receiver_fiscal_zip,
                receiver_fiscal_regime_code, usage_code, currency, exchange_rate,
                subtotal, discount, total, payment_form, payment_method,
                place_of_issue, export_code, created_at, updated_at, version
           FROM cfdis
          WHERE ${where.join(' AND ')}
          ORDER BY ${sorts[query.sort]} ${direction}, id ${direction}
          LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return {
        items: rows.map((row) => this.coreResponse(row)),
        meta: pageMeta(query.page, query.limit, Number(total)),
      };
    });
  }

  async detail(cfdiId: string, tenant: SessionAuthorizationContext) {
    return this.run(tenant, async (manager) => {
      const cfdi = await this.requireCfdi(manager, cfdiId, tenant);
      const scope = [tenant.organizationId, cfdi.id];
      const concepts = await manager.query<SqlRow[]>(
        `SELECT id, ordinal, product_service_code, identification_number,
                quantity, unit_code, unit_name, description, unit_value,
                amount, discount, tax_object_code
           FROM cfdi_concepts
          WHERE organization_id = $1 AND cfdi_id = $2
          ORDER BY ordinal ASC`,
        scope,
      );
      const taxes = await manager.query<SqlRow[]>(
        `SELECT id, concept_id, payment_id, payment_document_id, scope_type,
                direction, ordinal, tax_code, factor_type, base_amount,
                rate_or_quota, amount
           FROM cfdi_taxes
          WHERE organization_id = $1 AND cfdi_id = $2
          ORDER BY scope_type ASC, ordinal ASC`,
        scope,
      );
      const relations = await manager.query<SqlRow[]>(
        `SELECT id, relation_group_ordinal, ordinal, relation_type, related_uuid
           FROM cfdi_relations
          WHERE organization_id = $1 AND cfdi_id = $2
          ORDER BY relation_group_ordinal ASC, ordinal ASC`,
        scope,
      );
      const payments = await manager.query<SqlRow[]>(
        `SELECT id, ordinal, payment_date, payment_form, currency, exchange_rate,
                amount, operation_number, payer_bank_rfc,
                payer_foreign_bank_name, payer_account,
                beneficiary_bank_rfc, beneficiary_account
           FROM cfdi_payments
          WHERE organization_id = $1 AND cfdi_id = $2
          ORDER BY ordinal ASC`,
        scope,
      );
      const paymentDocuments = await manager.query<SqlRow[]>(
        `SELECT id, payment_id, ordinal, related_uuid, series, folio, currency,
                equivalence, installment_number, previous_balance, paid_amount,
                remaining_balance, tax_object_code
           FROM cfdi_payment_documents
          WHERE organization_id = $1 AND cfdi_id = $2
          ORDER BY payment_id ASC, ordinal ASC`,
        scope,
      );
      const periods = await manager.query<SqlRow[]>(
        `SELECT participation.id, participation.period_id,
                participation.participation_type, participation.policy_version,
                participation.timezone, participation.source_date,
                participation.source_ordinal, participation.origin,
                period.month, year.year
           FROM period_cfdis participation
           INNER JOIN periods period
             ON period.organization_id = participation.organization_id
            AND period.client_account_id = participation.client_account_id
            AND period.legal_entity_id = participation.legal_entity_id
            AND period.id = participation.period_id
           INNER JOIN fiscal_years year
             ON year.organization_id = period.organization_id
            AND year.client_account_id = period.client_account_id
            AND year.legal_entity_id = period.legal_entity_id
            AND year.id = period.fiscal_year_id
          WHERE participation.organization_id = $1
            AND participation.cfdi_id = $2
          ORDER BY participation.source_date ASC, participation.source_ordinal ASC`,
        scope,
      );
      const provenance = await manager.query<SqlRow[]>(
        `SELECT id, ingestion_job_id, object_id, observed_at, product_result,
                parser_version, schema_version, parsed_cfdi_version, processed_at
           FROM ingestion_items
          WHERE organization_id = $1 AND cfdi_id = $2
          ORDER BY observed_at ASC, id ASC`,
        scope,
      );
      const payroll =
        cfdi.document_type === 'N'
          ? tenant.permissions.includes('payroll.view')
            ? await this.payroll(manager, cfdi.id, tenant.organizationId!)
            : { restricted: true }
          : null;
      const incidents = tenant.permissions.includes('incidents.view')
        ? await manager.query<SqlRow[]>(
            `SELECT id, code, severity, status, safe_detail, detected_at,
                    resolved_at, version
               FROM incidents
              WHERE organization_id = $1 AND cfdi_id = $2
              ORDER BY detected_at DESC, id DESC`,
            scope,
          )
        : { restricted: true };
      return {
        ...this.coreResponse(cfdi),
        concepts: concepts.map(camelize),
        taxes: taxes.map(camelize),
        relations: relations.map(camelize),
        payments: payments.map(camelize),
        paymentDocuments: paymentDocuments.map(camelize),
        payroll,
        periods: periods.map(camelize),
        incidents: Array.isArray(incidents)
          ? incidents.map(camelize)
          : incidents,
        provenance: provenance.map(camelize),
      };
    });
  }

  async createAccessGrant(
    cfdiId: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const grantId = randomUUID();
    const result = await this.run(tenant, async (manager) => {
      const cfdi = await this.requireCfdi(manager, cfdiId, tenant);
      const objects = await manager.query<
        Array<{
          id: string;
          lifecycle_state: string;
          malware_scan_status: string;
        }>
      >(
        `SELECT id, lifecycle_state, malware_scan_status
           FROM stored_objects
          WHERE organization_id = $1 AND id = $2`,
        [tenant.organizationId, cfdi.source_object_id],
      );
      const object = objects[0];
      if (
        !object ||
        object.lifecycle_state !== 'available' ||
        !['clean', 'bypassed'].includes(object.malware_scan_status)
      ) {
        throw cfdiHttpError(
          HttpStatus.CONFLICT,
          'JOB_ROOT_OBJECT_UNAVAILABLE',
          'El XML original todavía no está disponible.',
        );
      }
      const rows = await manager.query<Array<{ expires_at: Date }>>(
        `INSERT INTO cfdi_access_grants (
           id, organization_id, client_account_id, legal_entity_id,
           cfdi_id, object_id, membership_id, session_id, token_hash, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,
           clock_timestamp() + make_interval(secs => $10)
         ) RETURNING expires_at`,
        [
          grantId,
          tenant.organizationId,
          cfdi.client_account_id,
          cfdi.legal_entity_id,
          cfdi.id,
          cfdi.source_object_id,
          tenant.membershipId,
          tenant.sessionId,
          tokenHash,
          this.ttlSeconds,
        ],
      );
      await this.audit(manager, tenant, request, {
        action: 'cfdi.original.access_granted',
        objectType: 'cfdi',
        objectId: cfdi.id,
        clientAccountId: cfdi.client_account_id,
        legalEntityId: cfdi.legal_entity_id,
      });
      return rows[0];
    });
    return {
      accessUrl: `/${this.apiPrefix}/cfdis/${cfdiId}/content?token=${encodeURIComponent(rawToken)}`,
      expiresAt: result.expires_at,
    };
  }

  async consumeAccessGrant(
    cfdiId: string,
    rawToken: string,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw notFound();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const object = await this.run(tenant, async (manager) => {
      const grants = await manager.query<
        Array<{
          id: string;
          client_account_id: string;
          legal_entity_id: string;
          object_id: string;
        }>
      >(
        `SELECT id, client_account_id, legal_entity_id, object_id
           FROM cfdi_access_grants
          WHERE organization_id = $1
            AND cfdi_id = $2
            AND membership_id = $3
            AND session_id = $4
            AND token_hash = $5
            AND used_at IS NULL
            AND expires_at > statement_timestamp()
          FOR UPDATE`,
        [
          tenant.organizationId,
          cfdiId,
          tenant.membershipId,
          tenant.sessionId,
          tokenHash,
        ],
      );
      const grant = grants[0];
      if (!grant) throw notFound();
      try {
        await this.accountScope.requireAccessibleAccountWithManager(
          manager,
          grant.client_account_id,
          tenant,
        );
      } catch {
        throw notFound();
      }
      const objects = await manager.query<
        Array<{
          object_key: string;
          size_bytes: string;
          lifecycle_state: string;
          malware_scan_status: string;
        }>
      >(
        `SELECT object_key, size_bytes, lifecycle_state, malware_scan_status
           FROM stored_objects
          WHERE organization_id = $1 AND id = $2`,
        [tenant.organizationId, grant.object_id],
      );
      const stored = objects[0];
      if (
        !stored ||
        stored.lifecycle_state !== 'available' ||
        !['clean', 'bypassed'].includes(stored.malware_scan_status)
      ) {
        throw notFound();
      }
      const consumed = await manager.query<Array<{ id: string }>>(
        `UPDATE cfdi_access_grants
            SET used_at = statement_timestamp()
          WHERE id = $1 AND used_at IS NULL
            AND expires_at > statement_timestamp()
        RETURNING id`,
        [grant.id],
      );
      if (consumed.length !== 1) throw notFound();
      await this.audit(manager, tenant, request, {
        action: 'cfdi.original.downloaded',
        objectType: 'cfdi',
        objectId: cfdiId,
        clientAccountId: grant.client_account_id,
        legalEntityId: grant.legal_entity_id,
      });
      return stored;
    });
    return {
      stream: await this.storage.openReadStream(object.object_key),
      sizeBytes: Number(object.size_bytes),
    };
  }

  private async payroll(
    manager: EntityManager,
    cfdiId: string,
    organizationId: string,
  ) {
    const rows = await manager.query<Array<Record<string, unknown>>>(
      `SELECT id, payroll_version, payroll_type, payment_date,
              initial_payment_date, final_payment_date, paid_days,
              total_perceptions, total_deductions, total_other_payments,
              employer_registration, employee_curp,
              employee_social_security_number, employment_start_date,
              seniority, contract_type, regime_type, employee_number,
              position, risk_position, payment_periodicity, bank_code,
              bank_account, base_salary, integrated_daily_salary, state_code
         FROM cfdi_payrolls
        WHERE organization_id = $1 AND cfdi_id = $2`,
      [organizationId, cfdiId],
    );
    const payroll = rows[0];
    if (!payroll) return null;
    const id = payroll.id as string;
    const perceptions = await manager.query<SqlRow[]>(
      `SELECT ordinal, perception_type, key, concept, taxable_amount, exempt_amount
         FROM cfdi_payroll_perceptions
        WHERE organization_id = $1 AND payroll_id = $2 ORDER BY ordinal ASC`,
      [organizationId, id],
    );
    const deductions = await manager.query<SqlRow[]>(
      `SELECT ordinal, deduction_type, key, concept, amount
         FROM cfdi_payroll_deductions
        WHERE organization_id = $1 AND payroll_id = $2 ORDER BY ordinal ASC`,
      [organizationId, id],
    );
    const otherPayments = await manager.query<SqlRow[]>(
      `SELECT ordinal, other_payment_type, key, concept, amount
         FROM cfdi_payroll_other_payments
        WHERE organization_id = $1 AND payroll_id = $2 ORDER BY ordinal ASC`,
      [organizationId, id],
    );
    const incapacities = await manager.query<SqlRow[]>(
      `SELECT ordinal, incapacity_days, incapacity_type, amount
         FROM cfdi_payroll_incapacities
        WHERE organization_id = $1 AND payroll_id = $2 ORDER BY ordinal ASC`,
      [organizationId, id],
    );
    return {
      ...camelize(payroll),
      perceptions: perceptions.map(camelize),
      deductions: deductions.map(camelize),
      otherPayments: otherPayments.map(camelize),
      incapacities: incapacities.map(camelize),
    };
  }

  private async requireEntity(
    manager: EntityManager,
    legalEntityId: string,
    tenant: SessionAuthorizationContext,
  ) {
    const rows = await manager.query<Array<{ client_account_id: string }>>(
      `SELECT client_account_id FROM legal_entities
        WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
      [tenant.organizationId, legalEntityId],
    );
    const entity = rows[0];
    if (!entity) throw notFound();
    try {
      await this.accountScope.requireAccessibleAccountWithManager(
        manager,
        entity.client_account_id,
        tenant,
      );
    } catch {
      throw notFound();
    }
    return entity;
  }

  private async requireCfdi(
    manager: EntityManager,
    cfdiId: string,
    tenant: SessionAuthorizationContext,
  ): Promise<CfdiRow> {
    const rows = await manager.query<CfdiRow[]>(
      `SELECT id, client_account_id, legal_entity_id, source_object_id,
              normalized_uuid, cfdi_version, schema_version, parser_version,
              document_type, issued_at, certified_at, issuer_rfc, issuer_name,
              receiver_rfc, receiver_name, receiver_fiscal_zip,
              receiver_fiscal_regime_code, usage_code, currency, exchange_rate,
              subtotal, discount, total, payment_form, payment_method,
              place_of_issue, export_code, created_at, updated_at, version
         FROM cfdis
        WHERE organization_id = $1 AND id = $2`,
      [tenant.organizationId, cfdiId],
    );
    const cfdi = rows[0];
    if (!cfdi) throw notFound();
    try {
      await this.accountScope.requireAccessibleAccountWithManager(
        manager,
        cfdi.client_account_id,
        tenant,
      );
    } catch {
      throw notFound();
    }
    return cfdi;
  }

  private run<T>(
    tenant: SessionAuthorizationContext,
    work: (manager: EntityManager) => Promise<T>,
  ) {
    if (!tenant.organizationId || !tenant.membershipId) throw notFound();
    return this.transactions.run(
      {
        organizationId: tenant.organizationId,
        membershipId: tenant.membershipId,
      },
      work,
    );
  }

  private coreResponse(row: CfdiRow) {
    return {
      id: row.id,
      clientAccountId: row.client_account_id,
      legalEntityId: row.legal_entity_id,
      uuid: row.normalized_uuid,
      version: row.cfdi_version,
      schemaVersion: row.schema_version,
      parserVersion: row.parser_version,
      documentType: row.document_type,
      issuedAt: row.issued_at,
      certifiedAt: row.certified_at,
      issuer: { rfc: row.issuer_rfc, name: row.issuer_name },
      receiver: {
        rfc: row.receiver_rfc,
        name: row.receiver_name,
        fiscalZip: row.receiver_fiscal_zip,
        fiscalRegimeCode: row.receiver_fiscal_regime_code,
        usageCode: row.usage_code,
      },
      currency: row.currency,
      exchangeRate: row.exchange_rate,
      subtotal: row.subtotal,
      discount: row.discount,
      total: row.total,
      paymentForm: row.payment_form,
      paymentMethod: row.payment_method,
      placeOfIssue: row.place_of_issue,
      exportCode: row.export_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      recordVersion: row.version,
    };
  }

  private audit(
    manager: EntityManager,
    tenant: SessionAuthorizationContext,
    request: RequestContext,
    event: {
      action: string;
      objectType: string;
      objectId: string;
      clientAccountId: string;
      legalEntityId: string;
    },
  ) {
    return manager.query(
      `INSERT INTO audit_events (
         organization_id, actor_type, actor_user_id, actor_membership_id,
         client_account_id, legal_entity_id, action, permission_key,
         decision, object_type, object_id, correlation_id, ip_address, metadata
       ) VALUES ($1,'user',$2,$3,$4,$5,$6,'cfdi.download','ALLOW',$7,$8,$9,$10,'{}'::jsonb)`,
      [
        tenant.organizationId,
        tenant.userId,
        tenant.membershipId,
        event.clientAccountId,
        event.legalEntityId,
        event.action,
        event.objectType,
        event.objectId,
        request.correlationId,
        request.ipAddress,
      ],
    );
  }
}

function pageMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

function camelize(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_match, letter: string) =>
        letter.toUpperCase(),
      ),
      value,
    ]),
  );
}

function notFound() {
  return cfdiHttpError(
    HttpStatus.NOT_FOUND,
    'RESOURCE_NOT_FOUND',
    'El recurso no existe o ya no tienes acceso.',
  );
}
