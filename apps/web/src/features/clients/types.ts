export type ClientAccountStatus = "active" | "suspended" | "archived";
export type LegalEntityStatus = "active" | "suspended" | "archived";
export type AssignmentResponsibility = "primary" | "collaborator" | "reviewer";
export type PeriodStatus =
  | "not_started"
  | "preparation"
  | "review"
  | "ready_to_close"
  | "closed"
  | "changes_detected"
  | "reopened"
  | "blocked";

export interface ClientAccount {
  id: string;
  name: string;
  code: string | null;
  status: ClientAccountStatus;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LegalEntity {
  id: string;
  clientAccountId: string;
  rfc: string;
  legalName: string;
  status: LegalEntityStatus;
  version: number;
  archivedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  fiscalYearCount?: number;
}

export interface AccountAssignment {
  id: string;
  clientAccountId?: string;
  membershipId: string;
  responsibility: AssignmentResponsibility;
  status: "active" | "revoked";
  assignedAt: string;
  displayName: string;
  email: string;
  role: "owner" | "accountant" | "collaborator";
}

export interface CreatedAssignment {
  id: string;
  membershipId: string;
  responsibility: AssignmentResponsibility;
  status: "active" | "revoked";
  assignedAt: string;
}

export interface PrimaryAssignmentSummary {
  displayName: string;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CollectionPage<T> {
  items: T[];
  meta: PageMeta;
}

export interface FiscalYear {
  id: string;
  clientAccountId: string;
  legalEntityId: string;
  year: number;
  status: "active" | "closed" | "archived";
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Period {
  id: string;
  fiscalYearId: string;
  month: number;
  status: PeriodStatus;
  cutoffAt: string | null;
  lockVersion: number;
}

export interface ClientListItem {
  account: ClientAccount;
  primaryLegalEntity: LegalEntity | null;
  primaryAssignment: PrimaryAssignmentSummary | null;
  latestFiscalYear: FiscalYear | null;
  currentPeriod: { year: number; month: number; status: PeriodStatus } | null;
}

export type ClientPage = CollectionPage<ClientListItem>;

export interface ClientDetail {
  account: ClientAccount;
  legalEntities: CollectionPage<LegalEntity>;
  primaryAssignment: PrimaryAssignmentSummary | null;
}

export interface MemberCandidate {
  membershipId: string;
  displayName: string;
  email: string;
  role: "owner" | "accountant" | "collaborator";
  membershipStatus?: string;
  assignmentId?: string | null;
  responsibility?: AssignmentResponsibility | null;
}

export interface CreatedClientAggregate {
  clientAccountId: string;
  legalEntityId: string;
  assignmentId: string;
  fiscalYearId: string;
}

export interface PeriodsResponse {
  fiscalYear: FiscalYear;
  periods: Period[];
}
