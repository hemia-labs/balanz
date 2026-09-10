import { Injectable, Optional } from '@nestjs/common';
import { FiscalMetricsService } from '../../common/observability/fiscal-metrics.service';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { EfirmaConfig } from '../../config/efirma.config';
import { FiscalTenantTransactionService } from '../../database/rls/fiscal-tenant-transaction.service';
import type { SessionAuthorizationContext } from '../sessions/session.types';
import { readCustodyGeneration } from './custody-generation';
import { efirmaError } from './efirma.errors';
import type { CustodyContext } from './custody-envelope';

export interface SatCustodyBinding {
  purpose: 'sat.submit' | 'sat.recover';
  jobId: string;
  filterVersion: 1;
}
export interface CustodyRow {
  purpose?: 'efirma.prepare' | 'sat.submit' | 'sat.recover';
  sat_job_id?: string | null;
  filter_version?: 1 | null;
  id: string;
  organization_id: string;
  membership_id: string;
  user_id: string;
  auth_session_id: string | null;
  client_account_id: string;
  legal_entity_id: string;
  generation: string;
  expires_at: Date;
  created_at: Date;
  status: string;
  request_fingerprint: string;
  wrapped_token_ciphertext: string | null;
  wrapping_accessor: string | null;
  wrapping_expires_at: Date | null;
  certificate_object_id: string | null;
  private_key_object_id: string | null;
  claim_id: string | null;
  lease_until: Date | null;
  cleanup_claim_id: string | null;
  cleanup_completed_at: Date | null;
  local_validation_passed: boolean;
  error_code: string | null;
}
export const digest = (data: Buffer | string) =>
  createHash('sha256').update(data).digest('hex');
export function envelopeContext(row: CustodyRow): CustodyContext {
  return {
    organizationId: row.organization_id,
    legalEntityId: row.legal_entity_id,
    intentionId: row.id,
    purpose: row.purpose ?? 'efirma.prepare',
    ...(row.sat_job_id
      ? {
          sat: {
            jobId: row.sat_job_id,
            filterVersion: row.filter_version!,
            userId: row.user_id,
            sessionId: row.auth_session_id!,
            membershipId: row.membership_id,
          },
        }
      : {}),
    expiresAt: row.expires_at.toISOString(),
    generation: row.generation,
  };
}
export function custodyDto(row: CustodyRow) {
  return {
    id: row.id,
    legalEntityId: row.legal_entity_id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    localValidation: row.local_validation_passed
      ? 'local_validation_passed'
      : 'not_passed',
    revocationStatus: 'unknown',
    synthetic: true,
    errorCode: row.error_code,
    cleanup: row.cleanup_completed_at ? 'completed' : 'pending',
  };
}

@Injectable()
export class EfirmaRepository {
  readonly config: EfirmaConfig;
  constructor(
    readonly transactions: FiscalTenantTransactionService,
    configuration: ConfigService,
    @Optional() readonly metrics?: FiscalMetricsService,
  ) {
    this.config = configuration.getOrThrow<EfirmaConfig>('efirma');
  }

  async generation(): Promise<string> {
    if (!this.config.enabled) throw efirmaError('EFIRMA_DISABLED', 503);
    try {
      return await readCustodyGeneration(this.config.generationFile);
    } catch {
      throw efirmaError('EFIRMA_DEPENDENCY_UNAVAILABLE', 503);
    }
  }

  run<T>(
    tenant: SessionAuthorizationContext,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (!tenant.organizationId || !tenant.membershipId || !tenant.tenantActive)
      throw efirmaError('EFIRMA_SCOPE_DENIED', 403);
    return this.transactions.run(
      {
        organizationId: tenant.organizationId,
        membershipId: tenant.membershipId,
      },
      work,
    );
  }

  async authorized(
    manager: EntityManager,
    row: Pick<
      CustodyRow,
      | 'user_id'
      | 'auth_session_id'
      | 'organization_id'
      | 'membership_id'
      | 'client_account_id'
      | 'legal_entity_id'
    > &
      Partial<Pick<CustodyRow, 'purpose' | 'sat_job_id' | 'filter_version'>>,
  ): Promise<void> {
    const rows: { allowed: boolean }[] = await manager.query(
      'SELECT efirma_authorized($1,$2,$3,$4,$5,$6,$7) AS allowed',
      [
        row.user_id,
        row.auth_session_id,
        row.organization_id,
        row.membership_id,
        row.client_account_id,
        row.legal_entity_id,
        this.config.sessionIdleSeconds,
      ],
    );
    if (!rows[0]?.allowed) throw efirmaError('EFIRMA_SCOPE_DENIED', 403);
    if (row.sat_job_id) {
      const sat: { allowed: boolean }[] = await manager.query(
        'SELECT sat_authorized($1,$2,$3,$4,$5,$6,$7,$8,$9) AS allowed',
        [
          row.user_id,
          row.auth_session_id,
          row.organization_id,
          row.membership_id,
          row.client_account_id,
          row.legal_entity_id,
          row.sat_job_id,
          row.purpose,
          this.config.sessionIdleSeconds,
        ],
      );
      if (!sat[0]?.allowed) throw efirmaError('EFIRMA_SCOPE_DENIED', 403);
    }
  }

  async entity(
    manager: EntityManager,
    tenant: SessionAuthorizationContext,
    entityId: string,
  ) {
    const entities: { client_account_id: string; rfc: string }[] =
      await manager.query(
        'SELECT client_account_id,rfc FROM legal_entities WHERE organization_id=$1 AND id=$2',
        [tenant.organizationId, entityId],
      );
    const entity = entities[0];
    if (!entity) throw efirmaError('EFIRMA_NOT_FOUND', 404);
    const identity = {
      user_id: tenant.userId,
      auth_session_id: tenant.sessionId,
      organization_id: tenant.organizationId!,
      membership_id: tenant.membershipId!,
      client_account_id: entity.client_account_id,
      legal_entity_id: entityId,
    };
    await this.authorized(manager, identity);
    return { ...identity, rfc: entity.rfc };
  }

  async audit(
    manager: EntityManager,
    row: Pick<
      CustodyRow,
      | 'organization_id'
      | 'membership_id'
      | 'user_id'
      | 'client_account_id'
      | 'legal_entity_id'
      | 'id'
    >,
    action: string,
    correlationId: string,
  ) {
    await manager.query(
      `INSERT INTO audit_events(organization_id,actor_type,actor_user_id,actor_membership_id,
      client_account_id,legal_entity_id,action,permission_key,decision,object_type,object_id,correlation_id,metadata)
      VALUES($1,'user',$2,$3,$4,$5,$6,'credentials.manage','ALLOW','efirma_session',$7,$8,'{}'::jsonb)`,
      [
        row.organization_id,
        row.user_id,
        row.membership_id,
        row.client_account_id,
        row.legal_entity_id,
        action,
        row.id,
        correlationId,
      ],
    );
    const metrics = {
      'efirma.custody.ready': 'efirma_ready_total',
      'efirma.custody.consumed': 'efirma_consumed_total',
      'efirma.custody.expired': 'efirma_expired_total',
    } as const;
    const metric = metrics[action as keyof typeof metrics];
    if (metric) this.metrics?.increment(metric, {});
  }

  /** Called only immediately after AuthService.reauthenticate has consumed fresh TOTP and rotated its session. */
  async issueGrant(
    tenant: SessionAuthorizationContext,
    entityId: string,
    correlationId: string,
    binding?: SatCustodyBinding,
  ) {
    const generation = await this.generation();
    const token = randomBytes(32).toString('hex');
    const id = randomUUID();
    return this.run(tenant, async (manager) => {
      const identity = await this.entity(manager, tenant, entityId);
      if (binding)
        await this.authorized(manager, {
          ...identity,
          sat_job_id: binding.jobId,
          purpose: binding.purpose,
          filter_version: binding.filterVersion,
        });
      const rows: { expires_at: Date }[] = await manager.query(
        `INSERT INTO fiscal_reauth_grants
        (id,organization_id,client_account_id,legal_entity_id,user_id,membership_id,auth_session_id,generation,token_hash,expires_at,purpose,sat_job_id,filter_version)
        SELECT $1,$2,$3,$4,$5,$6,id,$8,$9,least(expires_at,clock_timestamp()+interval '600 seconds'),$10,$11,$12 FROM auth_sessions
        WHERE id=$7 AND status='active' AND reauthenticated_at>clock_timestamp()-interval '10 seconds'
        RETURNING expires_at`,
        [
          id,
          identity.organization_id,
          identity.client_account_id,
          entityId,
          identity.user_id,
          identity.membership_id,
          tenant.sessionId,
          generation,
          digest(token),
          binding?.purpose ?? 'efirma.prepare',
          binding?.jobId ?? null,
          binding?.filterVersion ?? null,
        ],
      );
      if (!rows[0]) throw efirmaError('EFIRMA_FRESH_TOTP_REQUIRED', 403);
      await this.audit(
        manager,
        { ...identity, id },
        'efirma.grant.issued',
        correlationId,
      );
      return {
        grant: token,
        expiresAt: rows[0].expires_at,
        purpose: binding?.purpose ?? 'efirma.prepare',
      };
    });
  }

  async reserve(
    tenant: SessionAuthorizationContext,
    entityId: string,
    key: string,
    fingerprint: string,
    token: string,
    replacesId: string | undefined,
    correlationId: string,
    binding?: SatCustodyBinding,
  ) {
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(key))
      throw efirmaError('EFIRMA_IDEMPOTENCY_KEY_REQUIRED', 400);
    const generation = await this.generation();
    return this.run(tenant, async (manager) => {
      const identity = await this.entity(manager, tenant, entityId);
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`${tenant.organizationId}:${tenant.membershipId}:${entityId}:${key}`],
      );
      const previous: CustodyRow[] = await manager.query(
        `SELECT * FROM efirma_sessions WHERE organization_id=$1
        AND membership_id=$2 AND legal_entity_id=$3 AND idempotency_key=$4`,
        [tenant.organizationId, tenant.membershipId, entityId, key],
      );
      if (previous[0]) {
        if (previous[0].request_fingerprint !== fingerprint)
          throw efirmaError('EFIRMA_IDEMPOTENCY_CONFLICT');
        return { row: previous[0], created: false, rfc: identity.rfc };
      }
      if (replacesId) {
        const parent: { id: string }[] = await manager.query(
          `SELECT id FROM efirma_sessions WHERE id=$1 AND legal_entity_id=$2
          AND status IN('consumed','revoked','expired','failed','requires_user_authorization')`,
          [replacesId, entityId],
        );
        if (!parent[0]) throw efirmaError('EFIRMA_REPLACEMENT_INVALID');
      }
      const grants: { id: string; expires_at: Date }[] = await manager.query(
        `WITH changed AS (UPDATE fiscal_reauth_grants SET consumed_at=clock_timestamp()
        WHERE token_hash=$1 AND organization_id=$2 AND membership_id=$3 AND user_id=$4 AND auth_session_id=$5
          AND legal_entity_id=$6 AND purpose=$8 AND sat_job_id IS NOT DISTINCT FROM $9::uuid AND filter_version IS NOT DISTINCT FROM $10::integer AND generation=$7 AND revoked_at IS NULL
          AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id,expires_at) SELECT * FROM changed`,
        [
          digest(token),
          identity.organization_id,
          identity.membership_id,
          identity.user_id,
          tenant.sessionId,
          entityId,
          generation,
          binding?.purpose ?? 'efirma.prepare',
          binding?.jobId ?? null,
          binding?.filterVersion ?? null,
        ],
      );
      if (!grants[0]) throw efirmaError('EFIRMA_GRANT_INVALID', 403);
      const rows: CustodyRow[] = await manager.query(
        `INSERT INTO efirma_sessions(id,organization_id,client_account_id,legal_entity_id,
        user_id,membership_id,auth_session_id,generation,expires_at,grant_id,replaces_id,idempotency_key,request_fingerprint,claim_id,lease_until,purpose,sat_job_id,filter_version,envelope_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,least($9::timestamptz,clock_timestamp()+interval '600 seconds'),$10,$11,$12,$13,$14,clock_timestamp()+interval '30 seconds',$15,$16,$17,$18) RETURNING *`,
        [
          randomUUID(),
          identity.organization_id,
          identity.client_account_id,
          entityId,
          identity.user_id,
          identity.membership_id,
          tenant.sessionId,
          generation,
          tenant.expiresAt,
          grants[0].id,
          replacesId ?? null,
          key,
          fingerprint,
          randomUUID(),
          binding?.purpose ?? 'efirma.prepare',
          binding?.jobId ?? null,
          binding?.filterVersion ?? null,
          binding ? 2 : 1,
        ],
      );
      await this.authorized(manager, rows[0]);
      await this.audit(
        manager,
        rows[0],
        'efirma.custody.admitted',
        correlationId,
      );
      return { row: rows[0], created: true, rfc: identity.rfc };
    });
  }

  async status(
    tenant: SessionAuthorizationContext,
    entityId: string,
    id: string,
  ) {
    const generation = await this.generation();
    return this.run(tenant, async (manager) => {
      await this.entity(manager, tenant, entityId);
      await manager.query(
        `UPDATE efirma_sessions SET status=CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'revoked' END,
        terminal_at=clock_timestamp(),cleanup_requested_at=clock_timestamp()
        WHERE id=$1 AND legal_entity_id=$2 AND status IN('preparing','ready','claimed','unwrapping')
          AND (expires_at<=clock_timestamp() OR generation<>$3 OR auth_session_id IS DISTINCT FROM $4)`,
        [id, entityId, generation, tenant.sessionId],
      );
      const rows: CustodyRow[] = await manager.query(
        'SELECT * FROM efirma_sessions WHERE id=$1 AND legal_entity_id=$2',
        [id, entityId],
      );
      if (!rows[0]) throw efirmaError('EFIRMA_NOT_FOUND', 404);
      return custodyDto(rows[0]);
    });
  }

  async revoke(
    tenant: SessionAuthorizationContext,
    entityId: string,
    id: string,
    correlationId: string,
  ) {
    return this.run(tenant, async (manager) => {
      await this.entity(manager, tenant, entityId);
      const changed: CustodyRow[] = await manager.query(
        `WITH changed AS (UPDATE efirma_sessions SET status='revoked',terminal_at=clock_timestamp(),
        cleanup_requested_at=clock_timestamp() WHERE id=$1 AND legal_entity_id=$2 AND status IN('preparing','ready','claimed','unwrapping') RETURNING *) SELECT * FROM changed`,
        [id, entityId],
      );
      if (changed[0])
        await this.audit(
          manager,
          changed[0],
          'efirma.custody.revoked',
          correlationId,
        );
      const rows: CustodyRow[] = await manager.query(
        'SELECT * FROM efirma_sessions WHERE id=$1 AND legal_entity_id=$2',
        [id, entityId],
      );
      if (!rows[0]) throw efirmaError('EFIRMA_NOT_FOUND', 404);
      return custodyDto(rows[0]);
    });
  }
}
