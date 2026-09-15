import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
export const MONTHLY_SCHEMA = 'monthly-close/1.0.0' as const;
export const DECISION_POLICY = 'monthly-decision/1.0.0' as const;
export const DEFAULT_CHECKLIST = [
  'documents_reviewed',
  'exclusions_reasoned',
  'sources_settled',
  'integrity_resolved',
  'relationships_reviewed',
  'scope_confirmed',
  'snapshot_ready',
] as const;
export const HUMAN_CHECKLIST = [
  'relationships_reviewed',
  'scope_confirmed',
  'client_clarifications',
  'professional_review',
] as const;
export const LEASE_SECONDS = 120;
export const MONTHLY_MAX_BATCH = 100;
export function monthlyError(code: string, status = 409): never {
  throw new HttpException(
    {
      code,
      message:
        (
          {
            MONTHLY_LEASE_LOST:
              'Otra instancia tiene la edición. Vuelve a obtener acceso antes de guardar.',
            MONTHLY_VERSION_CONFLICT:
              'La información cambió. Actualiza antes de guardar.',
            MONTHLY_SCOPE_DENIED: 'No tienes acceso a esta operación.',
            MONTHLY_CLOSE_BLOCKED:
              'Hay comprobaciones pendientes antes de cerrar.',
            MONTHLY_CLOSED: 'La revisión está cerrada; requiere reapertura.',
          } as Record<string, string>
        )[code] ?? 'No fue posible completar la operación mensual.',
    },
    status,
  );
}
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface Decision {
  reviewStatus: 'pending' | 'reviewed';
  inclusion: 'included' | 'excluded';
  exclusionReason: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  taxStatus: 'pendiente' | 'no_aplica' | 'documentado';
  taxNote: string | null;
  vatStatus: 'pendiente' | 'no_aplica' | 'documentado';
  vatNote: string | null;
  comment: string | null;
}
export const DEFAULT_DECISION: Decision = {
  reviewStatus: 'pending',
  inclusion: 'included',
  exclusionReason: null,
  categoryId: null,
  categoryLabel: null,
  taxStatus: 'pendiente',
  taxNote: null,
  vatStatus: 'pendiente',
  vatNote: null,
  comment: null,
};
export interface Selection {
  id: string;
  version: number;
}
export interface Participation extends Decision {
  id: string;
  cfdiId: string;
  uuid: string;
  documentType: string;
  direction: string;
  issuerRfc: string;
  issuerName: string | null;
  receiverRfc: string;
  receiverName: string | null;
  sourceDate: string;
  literalDate: string;
  satObservation: {
    id: string;
    packageId: string;
    status: string;
    observedAt: string;
  } | null;
  relations: {
    id: string;
    uuid: string;
    type: string;
    incorporation: 'present' | 'not_observed' | 'unknown';
  }[];
  sourceOrdinal: number;
  participationType: string;
  policyVersion: string;
  timezone: string;
  currency: string;
  total: string;
  version: number;
  decisionId: string | null;
  sourceObjectId: string;
  sha256: string;
  hasIncidents: boolean;
}
export interface SourceEvidence {
  id: string;
  kind: 'ingestion' | 'sat';
  status: string;
  scope: 'linked' | 'unclarified' | 'filters';
  pending: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  observedAt: string | null;
}
export interface IncidentEvidence {
  comment: string | null;
  id: string;
  cfdiId: string | null;
  cfdiUuid?: string | null;
  ingestionJobId?: string | null;
  code: string;
  severity: string;
  originalStatus: string;
  version: number;
  state: string;
  reason: string | null;
  responsibleMembershipId: string | null;
  actorMembershipId: string | null;
  eventId: string | null;
}
export interface ChecklistEvidence {
  version: number;
  key: string;
  kind: 'automatic' | 'human';
  passed: boolean;
  reason: string | null;
  eventId: string | null;
  actorMembershipId: string | null;
}
export interface MonthlySnapshot {
  schemaVersion: typeof MONTHLY_SCHEMA;
  decisionPolicy: typeof DECISION_POLICY;
  periodId: string;
  entityId: string;
  year: number;
  month: number;
  participations: Participation[];
  incidents: IncidentEvidence[];
  sources: SourceEvidence[];
  checklist: ChecklistEvidence[];
  templateKeys: string[];
  scopeStatement: string;
}
export function decisionPermissions(
  previous: Decision,
  next: Decision,
): string[] {
  const result = ['cfdi.review'];
  if (
    previous.inclusion !== next.inclusion ||
    previous.exclusionReason !== next.exclusionReason
  )
    result.push('cfdi.exclude');
  if (
    previous.categoryId !== next.categoryId ||
    previous.taxStatus !== next.taxStatus ||
    previous.taxNote !== next.taxNote ||
    previous.vatStatus !== next.vatStatus ||
    previous.vatNote !== next.vatNote
  )
    result.push('cfdi.classify');
  return result;
}
export function validateDecision(d: Decision) {
  if (d.inclusion === 'excluded' && !d.exclusionReason?.trim())
    monthlyError('MONTHLY_EXCLUSION_REASON_REQUIRED', 400);
  if (
    (d.taxStatus === 'documentado' && !d.taxNote?.trim()) ||
    (d.vatStatus === 'documentado' && !d.vatNote?.trim())
  )
    monthlyError('MONTHLY_TREATMENT_NOTE_REQUIRED', 400);
}
/** Compare durable identities and content, never arrival timestamps or UUID order. */
export function monthlyChanges(
  before: MonthlySnapshot,
  after: MonthlySnapshot,
) {
  const old = new Map(before.participations.map((x) => [x.id, x]));
  const now = new Map(after.participations.map((x) => [x.id, x]));
  return {
    added: after.participations
      .filter((x) => !old.has(x.id))
      .map((x) => ({ id: x.id, cfdiId: x.cfdiId, uuid: x.uuid })),
    changed: after.participations
      .filter(
        (x) => old.has(x.id) && fingerprint(old.get(x.id)) !== fingerprint(x),
      )
      .map((x) => ({
        id: x.id,
        cfdiId: x.cfdiId,
        uuid: x.uuid,
        relationsChanged:
          fingerprint(old.get(x.id)?.relations) !== fingerprint(x.relations),
        observation: x.satObservation,
        previousObservation: old.get(x.id)?.satObservation ?? null,
      })),
    removed: before.participations
      .filter((x) => !now.has(x.id))
      .map((x) => ({ id: x.id, cfdiId: x.cfdiId, uuid: x.uuid })),
    sourceChanges: after.sources
      .filter(
        (x) =>
          fingerprint(
            before.sources.find((y) => y.id === x.id && y.kind === x.kind),
          ) !== fingerprint(x),
      )
      .map((x) => ({
        id: x.id,
        kind: x.kind,
        before:
          before.sources.find((y) => y.id === x.id && y.kind === x.kind)
            ?.status ?? null,
        after: x.status,
        observedAt: x.observedAt,
      })),
    incidentChanges: after.incidents
      .filter(
        (x) =>
          fingerprint(before.incidents.find((y) => y.id === x.id)) !==
          fingerprint(x),
      )
      .map((x) => ({
        id: x.id,
        code: x.code,
        before: before.incidents.find((y) => y.id === x.id)?.state ?? null,
        after: x.state,
      })),
    sourcesChanged: fingerprint(before.sources) !== fingerprint(after.sources),
    incidentsChanged:
      fingerprint(before.incidents) !== fingerprint(after.incidents),
  };
}
