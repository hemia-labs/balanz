export interface Decision {
  reviewStatus: "pending" | "reviewed";
  inclusion: "included" | "excluded";
  exclusionReason: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  taxStatus: "pendiente" | "no_aplica" | "documentado";
  taxNote: string | null;
  vatStatus: "pendiente" | "no_aplica" | "documentado";
  vatNote: string | null;
  comment: string | null;
}
export interface MonthlyItem extends Decision {
  id: string;
  cfdiId: string;
  uuid: string;
  documentType: "I" | "E" | "T" | "P" | "N";
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
    incorporation: "present" | "not_observed" | "unknown";
  }[];
  sourceOrdinal: number;
  participationType: string;
  policyVersion: string;
  timezone: string;
  currency: string;
  total: string;
  version: number;
  decisionId: string | null;
  hasIncidents: boolean;
}
export interface Source {
  id: string;
  kind: "ingestion" | "sat";
  status: string;
  scope: string;
  pending: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  observedAt: string | null;
}
export interface Overview {
  period: {
    id: string;
    legalEntityId: string;
    clientAccountId: string;
    rfc: string;
    year: number;
    month: number;
    status: string;
    version: number;
    legacyClosed: boolean;
  };
  counts: {
    documents: number;
    participations: number;
    pending: number;
    reviewed: number;
    excluded: number;
    incidents: number;
  };
  amounts: {
    currency: string;
    documentType: string;
    direction: string;
    total: string;
  }[];
  lease: {
    name: string | null;
    membershipId: string | null;
    expiresAt: string | null;
    ownSession: boolean;
  };
  sources: Source[];
  permissions: string[];
}
export interface ItemPage {
  items: MonthlyItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
export interface Checklist {
  key: string;
  kind: "automatic" | "human";
  passed: boolean;
  reason: string | null;
  eventId: string | null;
  actorMembershipId: string | null;
  version: number;
}
export interface Incident {
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
export interface Category {
  id: string;
  label: string;
  archived: boolean;
  version: number;
}
export interface BulkResult {
  previewId?: string;
  results: { id: string; status: string; code?: string }[];
  applied: number;
  failed: number;
  version: number;
}
export interface CloseSummary {
  version: number;
  documents: number;
  participations: number;
  excluded: number;
  checklist: Checklist[];
  sources: Source[];
  scopeStatement: string;
  sourceExceptionReason: string | null;
}
export interface Changes {
  added: { id: string; cfdiId: string; uuid: string }[];
  changed: { id: string; cfdiId: string; uuid: string }[];
  removed: { id: string; cfdiId: string; uuid: string }[];
  sourceChanges: {
    id: string;
    kind: string;
    before: string | null;
    after: string;
    observedAt: string | null;
  }[];
  incidentChanges: {
    id: string;
    code: string;
    before: string | null;
    after: string;
  }[];
  sourcesChanged: boolean;
  incidentsChanged: boolean;
}
