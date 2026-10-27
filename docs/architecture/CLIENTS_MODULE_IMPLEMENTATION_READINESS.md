# Clients module: implementation readiness

> Documento histórico de planeación. La implementación ya se realizó; consultar
> [CLIENTS_MODULE_IMPLEMENTATION_REPORT.md](CLIENTS_MODULE_IMPLEMENTATION_REPORT.md)
> y
> [../qa/CLIENTS_MODULE_DEVELOPMENT_VALIDATION_REPORT.md](../qa/CLIENTS_MODULE_DEVELOPMENT_VALIDATION_REPORT.md)
> para el estado actual.

This document is the technical input for a later implementation task. It proposes contracts and sequencing; it does not report them as implemented.

## A. Recommended first implementation scope

### In scope

1. Prerequisite platform safeguards that directly protect client writes: reject unsafe cookie requests without an acceptable origin policy, establish request correlation, and make the tenant/membership relationship enforceable by foreign keys.
2. The core domain only: `ClientAccount`, first/multiple `LegalEntity`, explicit `AccountAssignment`, `FiscalYear` and its 12 `Period` rows.
3. Tenant-scoped list/search/filter/page/sort, aggregate create, detail/update/archive, legal-entity lifecycle, assignment lifecycle, available-member projection, fiscal-year create/list and period list.
4. Transactional audit events for every mutation and denied sensitive attempts where the current audit architecture can safely record them.
5. Assignment-aware authorization and immediate cache invalidation.
6. Connection of the existing list, create dialog, overview, responsible, fiscal-year and period screens to the existing `apiClient()`.
7. Unit, real PostgreSQL integration, isolated API E2E and frontend/E2E coverage.

### Explicitly out of scope

- SAT/e.firma credentials, `credential_records`, secret material, recovery codes, XML/CFDI storage, `stored_objects`, downloads/uploads and process queues.
- CFDI review/exclusion, period accounting workflow, closing/reopening, exports, obligations, DIOT and IEPS.
- Notes, tags, tax regimes, tax determination and definitive RFC verification against SAT.
- Invitations, membership permission overrides, billing, platform support and a general RBAC redesign.
- RLS unless a separate architecture decision adopts it for the whole tenant model. Application scoping plus composite database constraints is the proposed first boundary.
- A new HTTP, form, state, table, validation or repository library. Current dependencies are sufficient.

### Readiness verdict

**Can the module be implemented with the current schema? `NO`.**

Evidence: there is no entity or migration for `client_accounts`, `legal_entities`, `account_assignments`, `fiscal_years` or `periods`; `AuthorizationService` returns no assignments; and existing `memberships` lacks the composite/FK integrity needed by assignments. The changes are relevant and additive, not minor configuration.

## B. Domain model and invariants

| Resource | Meaning | Required ownership/invariants | Lifecycle |
| --- | --- | --- | --- |
| `Organization` | Accounting firm/tenant buying Balanz | Active tenant comes only from the opaque session | Existing active/suspended/cancelled states |
| `User` | Global person identity | Never used directly as client access authority | Existing global lifecycle |
| `Membership` | User’s relationship to one organization | Must be active and belong to the active organization before assignment | Existing pending/active/suspended/revoked states |
| `ClientAccount` | Operational customer account of the firm | Belongs to exactly one organization; access is not granted merely by membership | Active/suspended/archived; no physical delete in first scope |
| `LegalEntity` | Fiscal taxpayer identified by RFC | Belongs to a client account in the same tenant; an account has one or more | Active/archived; active RFC unique inside organization |
| `AccountAssignment` | Explicit access relation from membership to client account | Account and membership must share organization; one active row per pair; at most one active primary responsible | Append/history preserving: active then revoked |
| `FiscalYear` | Fiscal year for one legal entity | Same tenant/account/legal chain; unique year per legal entity | Open/closed/archived policy; first slice creates open only |
| `Period` | Calendar month within fiscal year | Month 1–12; exactly one row per fiscal year/month | Initial open state; later workflows out of scope |

Authorization is the intersection, not the union, of:

```text
valid opaque session
AND active tenant/membership
AND required persisted permission
AND active account assignment for resource access
AND allowed resource state
AND MFA when the permission policy requires it
```

No controller or service may authorize via `if (role === 'owner')`. Ownership ambiguity remains outside this module; permissions and explicit assignment are executable authorities.

## C. Proposed functional flow

### What the current UI expects

`ClientsScreen` in `apps/web/src/components/screens/global-screens.tsx` presents one dialog with four fields: razón social, RFC, responsable and ejercicio inicial. On success, existing links expect a client ID that immediately opens overview, one fiscal year and twelve periods. This is **Alternative 2**, not an account-only create.

### Recommended atomic create

`POST /client-accounts` is a composite command. In one PostgreSQL transaction it should:

1. Derive `organizationId` and actor membership from `@CurrentTenant()`; never accept tenant authority in the body.
2. Require `clients.manage` and `clients.assign`. Because `clients.assign` is already MFA-sensitive, the whole command requires verified/configured MFA.
3. Validate that the selected responsible membership is active and belongs to the active organization; lock or otherwise serialize the membership eligibility read where necessary.
4. Normalize the input. The present UI supplies one name: the candidate mapping is to initialize both `ClientAccount.name` and the first `LegalEntity.legalName` from that “Razón social” value. Product must ratify this mapping or add a separate operating-name field before connection.
5. Insert the account, first legal entity, active primary assignment, fiscal year and months 1–12.
6. Insert audit events using the same `EntityManager`; at minimum one aggregate create event with child identifiers, or bounded child events if audit consumers require them.
7. Commit everything or roll back everything, including audit. No pending/orphan account is returned.
8. Invalidate authorization/session cache for the selected membership and actor after commit; if the cache operation fails, the database remains authoritative and cache TTL is the maximum stale window, but revocation paths need fail-closed resolution or direct eviction/recheck.
9. Return `201` with a client aggregate sufficient to populate the list and navigate to overview.

If any insert/constraint/audit write fails, the transaction rolls back. Known unique violations become a bounded `409` code; unexpected failures remain sanitized 500 responses. The frontend must not blindly retry a timed-out create: natural constraints prevent duplicates but do not make a lost-response retry semantically idempotent. If transparent automatic retries are required, approve a scoped idempotency design (key, retention and response replay) before implementation rather than adding an unmodeled generic table.

### Alternative 1 assessment

| Concern | Account only, then separate setup | Recommended aggregate command |
| --- | --- | --- |
| Current UX fit | Poor: current modal collects all child data and overview expects them | Exact fit after the one-name decision |
| Transaction/rollback | Simple first insert, but exposes incomplete/orphan setup states | Larger transaction; all required initial rows and audit are atomic |
| Partial errors | User must discover/resume missing RFC/assignment/year | One bounded response; any failure leaves no partial client |
| Permission/MFA | Can create with `clients.manage`, then separately challenge assignment | Entire operation requires both permissions and MFA |
| Idempotency | Multiple individually retryable commands | Needs no automatic retry or an explicit idempotency policy |
| Tests | More state-transition/resume cases | More transaction/concurrency cases, simpler product invariant |
| Migration | Same five tables eventually | Same five tables immediately |

Creating additional RFCs, collaborators and later fiscal years should remain separate commands after initial creation.

## D. Candidate API contracts

### Common contract rules

- Prefix remains `/api/v1`; examples below are controller-relative paths.
- Protected order: `SessionGuard`, `TenantAccessGuard`, `PermissionsGuard`; `CsrfGuard` remains global after its prerequisite fix.
- `organizationId`, actor IDs, status timestamps and audit fields are server-managed and forbidden in request DTOs.
- All resource IDs are UUIDs parsed/validated. An ID outside active tenant/assignment scope returns the same `404 CLIENT_ACCOUNT_NOT_FOUND`/resource equivalent as a missing ID.
- Validation failures follow the current Nest convention (`400`), not a new 422 convention, unless the platform error contract is deliberately changed first.
- List defaults candidate: `page=1`, `limit=25`, maximum 100; stable tie-breaker `id`; no unbounded list.
- Initial client sort allowlist: `name`, `status`, `updatedAt`; directions `asc|desc`. Search is bounded and normalized. e.firma is not a core filter until credential data exists.
- Responses are explicit DTOs/mappers, never TypeORM entities or relation expansion selected by query input.
- No endpoint has reauthentication today because no mechanism exists. The product/security decision may add it later; MFA is not described as reauthentication.

### Endpoint matrix

| Method and route | Purpose / status | Permission, assignment, MFA | Input | Output and paging | Errors/codes | Audit / transaction / tables / indexes / tests |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /client-accounts` | Assigned portfolio; **new** | `clients.view`; active assignment required by query; no MFA | Query `search?`, `status?`, `page?`, `limit?`, `sort?`, `direction?` | `ClientAccountsPageDto {items,page,limit,total}`; summary includes account ID/name/status, primary legal entity RFC/name, responsible, available current-year summary | 400 `INVALID_CLIENT_SORT`; 401/403 auth; empty 200 | No mutation audit by default; query `account_assignments` first, then accounts/legal/year aggregates; indexes on assignment membership/status and tenant account sort/search; integration query-plan/N+1 and assignment visibility tests |
| `POST /client-accounts` | Atomic initial create; **new** | `clients.manage` + `clients.assign`; actor and selected responsible eligibility; MFA because assign is sensitive | `CreateClientDto { legalName, rfc, primaryMembershipId, fiscalYear }`; no status/tenant/IDs | 201 `ClientAccountDetailDto` containing account, initial legal entity, primary assignment, year and 12 periods | 400 validation; 404 candidate membership (non-enumerating where needed); 409 `LEGAL_ENTITY_RFC_CONFLICT`, `ACCOUNT_ASSIGNMENT_CONFLICT`, `FISCAL_YEAR_CONFLICT`; 401/403 MFA/auth | One transaction and transactional audit; all five tables + audit; partial uniques; unit normalization/mapper, PostgreSQL rollback/concurrency, API MFA/cross-tenant tests |
| `GET /client-accounts/:clientAccountId` | Overview/detail; **new** | `clients.view` + active assignment; no MFA | UUID path | 200 aggregate with bounded legal entities, assignments summary and fiscal-year summaries; future process counts must be nullable/omitted rather than fabricated | 404 for absent/foreign/unassigned/archived according to policy | Read audit only if policy requires; tenant/account/assignment indexes; cross-tenant/unassigned/N+1 tests |
| `PATCH /client-accounts/:clientAccountId` | Edit account-owned fields; **new** | `clients.manage` + active assignment; currently no MFA | `UpdateClientAccountDto { name?, code?, expectedVersion }`; status/audit fields forbidden | 200 mapped detail; version increments | 400; 404 scoped; 409 `CLIENT_ACCOUNT_CODE_CONFLICT` or `STALE_CLIENT_ACCOUNT` | Transactional `CLIENT_ACCOUNT_UPDATED` with changed field names only; `client_accounts`; optimistic concurrency tests |
| `DELETE /client-accounts/:clientAccountId` | Archive, never physical delete; **new** | `clients.manage` + active assignment; MFA policy unresolved (currently no) | UUID path plus optional bounded reason DTO only if the framework accepts DELETE body; otherwise dedicated command route | 204 | 404; 409 `CLIENT_ACCOUNT_STATE_CONFLICT`/active workflow conflict | Transaction archives account and applies explicit child-access policy; audit same transaction; archive/visibility/unique-reuse tests |
| `POST /client-accounts/:clientAccountId/reactivate` | Reactivate if product includes it; **new/future first-scope decision** | `clients.manage` + assignment/history eligibility; MFA policy unresolved | `ReactivateClientAccountDto { expectedVersion }` | 200 detail | 404; 409 code/RFC/state conflict | Transactional audit; partial-unique conflict tests |
| `GET /client-accounts/:clientAccountId/legal-entities` | Represent 1:N RFCs; **new** | Candidate `clients.view` + account assignment; no MFA | page/limit/status candidate | Paged `LegalEntitySummaryDto` | 404 account; 400 query | No mutation audit; legal account/status index; isolation/paging tests |
| `POST /client-accounts/:clientAccountId/legal-entities` | Add RFC; **new** | Candidate `clients.manage` + assignment; no current MFA; permission decision required | `CreateLegalEntityDto { legalName, rfc }`; optional target fields only after UI/product approval | 201 entity DTO | 404 account; 409 `LEGAL_ENTITY_RFC_CONFLICT` | Transaction + `LEGAL_ENTITY_CREATED` audit; legal table partial unique; normalization/concurrency tests |
| `PATCH /legal-entities/:legalEntityId` | Edit fiscal identity; **new** | Candidate `clients.manage` + assignment resolved through legal entity; no current MFA | `UpdateLegalEntityDto { legalName?, rfc?, expectedVersion }` | 200 entity DTO | 404 scoped; 409 RFC/stale conflict | Transactional before/after field-name audit, not full PII DTO; normalization/conflict tests |
| `DELETE /legal-entities/:legalEntityId` | Archive RFC; **new** | Candidate `clients.manage` + assignment | UUID; optional bounded reason | 204 | 404; 409 last-active-entity or active-year policy code | Transactional `LEGAL_ENTITY_ARCHIVED`; lifecycle/last-entity tests |
| `GET /client-accounts/:clientAccountId/assignments` | List access/responsibles; **new** | `clients.view` + account assignment; assignment detail visibility may additionally require `clients.assign` | page/limit/status | Paged assignment DTO with membership/user display projection; no password/global private fields | 404 account | No mutation audit; assignment account/status index; projection/PII tests |
| `GET /client-accounts/:clientAccountId/available-members` | Restricted picker; `/users` is only partially reusable; **new** | `clients.assign`; caller must already access account; MFA challenge is currently triggered because the permission is sensitive | Query `search?`, `page?`, `limit?` | Active eligible membership IDs + display names/role key/assignment state | 404 account; 400 bounds | No mutation; memberships org/status + assignment anti-join; pending/suspended/revoked and cross-tenant tests |
| `POST /client-accounts/:clientAccountId/assignments` | Add/replace responsible or collaborator; **new** | `clients.assign` + caller account access; MFA yes; reauth not implemented | `CreateAssignmentDto { membershipId, responsibility }`; no org/status/actor | 201 assignment DTO; replacing primary must be an explicit atomic mode, not an implicit side effect | 404 account/member; 409 `MEMBERSHIP_NOT_ELIGIBLE`, `ACCOUNT_ASSIGNMENT_CONFLICT`, `PRIMARY_ASSIGNMENT_CONFLICT` | Transactional assignment + audit; partial uniques and composite FKs; cache eviction after commit; concurrency/escalation tests |
| `DELETE /client-accounts/:clientAccountId/assignments/:assignmentId` | Revoke while preserving history; **new** | `clients.assign`; caller access; MFA yes | UUID paths, optional expected version/reason | 204 | 404; 409 `LAST_PRIMARY_ASSIGNMENT`, self-lockout policy code | Transactional revoke/audit; cache invalidation immediately after commit; stale-session/revocation tests |
| `GET /legal-entities/:legalEntityId/fiscal-years` | List years; **new** | Candidate `clients.view` + inherited account assignment | page/limit/sort year only | Paged year summaries | 404 legal entity | No mutation; legal/year unique/index; isolation tests |
| `POST /legal-entities/:legalEntityId/fiscal-years` | Create year + 12 months; **new** | Candidate `clients.manage` + inherited assignment; specific-permission decision open | `CreateFiscalYearDto { year }` | 201 year with 12 periods | 404; 409 `FISCAL_YEAR_CONFLICT` | One transaction + audit; fiscal unique and period unique/check; rollback/concurrent-create tests |
| `GET /fiscal-years/:fiscalYearId/periods` | List exactly 12 months; **new** | Candidate `clients.view` + inherited assignment | UUID path | Ordered month-ascending `PeriodDto[]` | 404 scoped | No mutation; year/month index; cardinality/order/cross-tenant tests |

The candidate dedicated LegalEntity/FiscalYear permission keys are intentionally **not** placed in decorators until the permission decision is approved and added to catalog, seed, MFA policy and tests. If v1 reuses client keys, document that as a deliberate coarse-grained policy.

### Candidate DTO normalization and response shape

- `legalName`/`name`: trim, collapse only product-approved whitespace, enforce bounded UTF-8-visible length; do not silently remove meaningful punctuation.
- `rfc`: trim outer whitespace, uppercase, length 12 or 13 and reasonable Mexican RFC form. A regex is syntactic only and must never be described as SAT validation.
- `primaryMembershipId` and every path ID: UUID syntax first, then tenant/eligibility business check.
- `fiscalYear`: integer and product-approved range; the repository cannot determine the minimum/maximum years.
- Search: trim and cap length; escape through TypeORM parameters, never interpolate. Sort maps a public enum to fixed column expressions.
- Responses expose string UUIDs, ISO-8601 timestamps and explicit status enums; no encrypted credential, token hash, audit metadata blob or unrelated user PII.

## E. Minimum schema changes

### Deployment answer and migration strategy

Answer: **NO**, the current schema is insufficient. Use append-only migrations and keep `synchronize: false`. No existing column should be repurposed and no JSONB/EAV/generic-resource table should model this domain.

Before writing migration code, inspect the actual non-production/deployment schema safely to verify the applied baseline, `uuid-ossp`, orphan data and index names. Do not assume the single repository migration is applied.

### Prerequisite integrity changes

| Existing table/change | Definition | Backfill/compatibility | Risk/rollback/order |
| --- | --- | --- | --- |
| `memberships` organization/user FKs | FK `organization_id -> organizations.id`; FK `user_id -> users.id`; unique `(organization_id,id)` as composite target | Columns already non-null; first query for orphans. No destructive automatic cleanup. Add/validate constraints only after a data decision. | Mandatory for assignments. Constraint rollback is possible; data cleanup is not automatically reversible. |
| `organizations.owner_user_id` FK | FK to `users.id` with deliberate delete action (normally restrict) | Verify owner rows first | Required identity integrity; ownership redesign remains separate. |
| `auth_sessions` context integrity | FKs to user/organization and composite `(organization_id,membership_id) -> memberships`; check organization/membership are both null or both present | Existing tenant-less sessions are valid if both null; inspect mismatches | Security prerequisite. Adding constraint can fail on drift; roll back constraint only. |
| `subscriptions`, `auth_factors`, `email_verification_tokens` FKs | To organization/user as appropriate | Inspect orphans; retain history policy deliberately | Platform integrity required before production, but these may ship in a separate prerequisite migration before client tables. |
| `uuid-ossp` availability | Explicitly create/verify extension or switch future defaults to a repository-approved UUID mechanism | Verify deployment privileges and existing defaults | Migration currently depends on `uuid_generate_v4()` implicitly. Decide before new tables. |

Audit FKs are not made a prerequisite: audit history often needs looser retention semantics. Instead, audit identifiers must be transactionally correct and indexed. Any later FK policy must account for retained events.

### New core tables

The exact candidate below is minimal for the current UI and security model. Names/lengths must be reconciled with `CORRECTED_POSTGRESQL_DATA_MODEL.md` during migration design; fields not used by first scope remain omitted from DTOs even if reserved in schema.

| Table | Columns (type, nullability, default) | Keys/checks/indexes | Backfill/compatibility | Requirement |
| --- | --- | --- | --- | --- |
| `client_accounts` | `id uuid PK` generated; `organization_id uuid NOT NULL`; `name varchar(160) NOT NULL`; `code varchar(50) NULL`; `status enum(active,suspended,archived) NOT NULL DEFAULT active`; `version integer NOT NULL DEFAULT 1`; `archived_at timestamptz NULL`; `created_at/updated_at timestamptz NOT NULL DEFAULT now()` | FK org; unique `(organization_id,id)`; partial unique normalized `(organization_id,code)` when code non-null/not archived; check archived status/timestamp consistency; index `(organization_id,status,updated_at,id)` and approved name-search expression | Empty table, no backfill. Additive. Rollback drops only this new empty-domain schema; after use, rollback requires export/forward fix. | Mandatory for basic client |
| `legal_entities` | `id uuid`; `organization_id uuid`; `client_account_id uuid`; `rfc varchar(13)`; `legal_name varchar(200)`; `status enum(active,archived) DEFAULT active`; `version int DEFAULT 1`; archive/create/update timestamptz | Composite FK `(organization_id,client_account_id)`; unique `(organization_id,client_account_id,id)`; partial unique `(organization_id,rfc)` for active/non-archived rows; RFC uppercase/trim + length 12/13 check; index account/status | No backfill. Trade name/type/regime/postal/contact stay outside first UI contract unless approved. | Mandatory to add RFC |
| `account_assignments` | `id uuid`; `organization_id`, `client_account_id`, `membership_id` UUID non-null; `responsibility enum(primary,collaborator,reviewer)`; `status enum(active,revoked) DEFAULT active`; `assigned_by_membership_id uuid`; `assigned_at timestamptz DEFAULT now()`; `revoked_by_membership_id/revoked_at` nullable | Composite FKs to account and membership for target/actor; partial unique active `(organization_id,client_account_id,membership_id)`; partial unique one active primary per account; indexes `(organization_id,membership_id,status,client_account_id)` and account/status; revoked timestamp/status consistency | No backfill. History retained; no delete. | Mandatory for assignments/visibility |
| `fiscal_years` | `id uuid`; org/account/legal IDs; `year smallint`; `status enum(open,closed,archived) DEFAULT open`; `version int DEFAULT 1`; create/update/archive timestamptz | Composite FK to legal entity chain; unique `(organization_id,legal_entity_id,year)` and `(organization_id,id)`; product-approved year check; index account/legal/year | No backfill. First command creates open only. | Mandatory for exercises |
| `periods` | `id uuid`; `organization_id`, `fiscal_year_id`; `month smallint`; `status enum(open,closed) DEFAULT open`; create/update timestamptz | Composite FK `(organization_id,fiscal_year_id)`; unique `(organization_id,fiscal_year_id,month)`; check month 1–12; index year/month | No backfill. Exactly 12 inserted transactionally. Later workflow fields require later migrations. | Mandatory for initial year |

To make the proposed composite FKs possible, each parent needs a matching unique candidate key. A migration must name constraints/indexes deterministically. Do not use a pre-insert “exists” query as the concurrency boundary.

### Deployment order

1. Read-only deployment schema/drift/orphan/extension audit.
2. Append-only identity-integrity migration; deploy and validate constraints. No clients traffic yet.
3. Append-only client core-schema migration in parent-to-child order.
4. Deploy backend code that can read/write the new schema; keep UI mutation unavailable until security/tests pass.
5. Seed/catalog changes only if the permission decision adds keys; otherwise verify existing client keys in the target environment. Do not couple normal production start to unexpected destructive seed behavior.
6. Connect frontend behind a controlled rollout; monitor 4xx/5xx, latency and audit completeness.
7. Rollback application before schema. Once real rows exist, prefer a forward-fix migration; do not drop populated tables.

## F. Authorization strategy

### Tenant and non-enumeration

- Derive organization from `SessionAuthorizationContext`; reject `organizationId` in every body/query DTO through the global whitelist/forbid policy.
- Every repository predicate includes organization and active lifecycle state. Nested resources resolve through the whole parent chain, not by globally unique ID alone.
- Missing, foreign-tenant and unassigned resources produce the same 404 code/body. Tests must confirm no existence, name, RFC, membership or state leak.
- Database composite FKs make cross-tenant writes invalid even if an application check regresses.

### Permissions and assignments

- `clients.view`: list/read only accounts with an active assignment.
- `clients.manage`: create/update/archive account and, if explicitly approved for v1, legal-entity/year lifecycle. It never grants global tenant portfolio visibility by itself.
- `clients.assign`: list eligible membership projections and create/revoke assignment. It already requires MFA through `PermissionsGuard`.
- Atomic initial create requires both manage and assign because it assigns a selected responsible. If product wants non-MFA account-only create, that is Alternative 1 and requires a UI/contract change.
- An actor cannot elevate a membership’s organization role or permissions through an assignment DTO. Responsibility is an account-level enum only.
- Pending/suspended/revoked memberships cannot be assigned. Self-assignment and last-primary/self-lockout policy require explicit decisions and tests.

### Immediate revocation/cache behavior

`assignedAccountIds` must be resolved from active assignment rows, not accepted from the client. On create/revoke/replace, invalidate every cached authorization/session entry for the affected membership after the transaction commits. Because the current cache keys are token-oriented and there is no membership-to-session index in Redis, the implementation may need a bounded database lookup of active session hashes or a deliberate reverse cache index. It must not wait 60 seconds for a sensitive revocation without a documented fail-closed database recheck.

MFA is enforced by the executable sensitive-permission set. Reauthentication remains unsupported (`reauthenticationRequiredActions: []`); do not claim MFA recency as reauthentication. If assignment requires recent auth, build that platform mechanism and error contract first.

## G. Validation and error strategy

| Input | Syntax/normalization | Business rule | Database boundary |
| --- | --- | --- | --- |
| Name/legal name | Trim; length 1–160/200; reject control characters as appropriate | One UI value mapping to two resources needs approval | Not necessarily unique; optional code is the durable duplicate key |
| Code | Trim/canonical case; length <=50; allowlisted characters only if product approves | Optional/internal, not body-controlled ID | Partial tenant-active unique constraint |
| RFC | Outer trim, uppercase, 12/13 and reasonable syntax | Regex cannot assert SAT validity; archive/reactivation policy | Partial active unique per organization |
| Email/phone/contact | Not in current create UI | If later added, use existing email conventions/E.164 and PII policy | No duplicate columns without model decision |
| Status/archive fields | Enum only in command-specific DTOs; never create DTO | Server-controlled transition/version | Checks + optimistic concurrency |
| Taxpayer type/regime/postal | Not in current UI | Do not invent fiscal catalog/validation | Future migration/contract if approved |
| Fiscal year | Integer and approved range | One per LegalEntity; calendar policy | Unique `(org,legal,year)` |
| UUIDs | `IsUUID`/`ParseUUIDPipe` | Same tenant, active/eligible, assigned | Composite FKs |
| Search | Trim, cap length | Defined fields only | Parameterized query and indexable plan |
| Sort | Public enum mapped to fixed expression | Stable ID tie-breaker | Never interpolate query text as a column |
| Filters/page | Explicit enums/integers; max 100 | Supported combinations only | Bounded query |

DTOs must be operation-specific. Do not spread DTOs onto entities, accept arbitrary includes/relations, build raw interpolated SQL or expose dynamic column/table names. Translate named PostgreSQL constraints to stable 409 codes; do not parse fragile human database messages when a driver constraint name is available.

## H. Security strategy

### Concrete threats and controls

| Threat | Required control |
| --- | --- |
| IDOR/cross-tenant URL manipulation | Session-derived tenant, assignment predicate, parent-chain resolution, composite FKs, uniform 404 and negative tests |
| Body/query tenant manipulation | No tenant field in DTO; global whitelist + `forbidNonWhitelisted`; server-populated ownership/actor fields |
| Cross-tenant membership assignment | Composite `(organization_id,membership_id)` FK plus active-state service check under transaction |
| SQL/sort injection | TypeORM parameters and a fixed public-sort-to-column map; no raw query fragments from the request |
| Mass assignment/prototype pollution | Concrete DTO instances, explicit mapper/field assignment, no `{...dto}` into an entity and no arbitrary relation expansion |
| Cookie CSRF | Keep HttpOnly/Secure/SameSite/exact CORS/credentials; fix unsafe missing-Origin acceptance and test it before writes |
| Permission escalation | Persisted `@Permissions`, assignment/responsibility separate from role, no role-name branches |
| Stale revoked access | Transactional state change then targeted authorization/session cache invalidation plus DB-authoritative resolution |
| PII leakage | Minimize list/member projections, never log full DTO/RFC changes by default, sanitize errors |
| Abuse/performance | Required pagination/max limits, bounded search, deterministic order, text limits, query indexes, N+1 tests; add endpoint throttling only from observed/risk-based policy |
| Dependency/supply chain | Use Nest, TypeORM, class-validator, Node crypto/current utilities; no new package is needed |

Production prerequisites also include correct `trust proxy` so rate-limit/audit IP is meaningful, request correlation propagated to audit, and security headers. Cache is not a substitute for a sound indexed query; measure before adding client-data caching.

### Audit event catalog for later implementation

Candidate action keys:

- `CLIENT_ACCOUNT_CREATED`, `CLIENT_ACCOUNT_UPDATED`, `CLIENT_ACCOUNT_ARCHIVED`, `CLIENT_ACCOUNT_REACTIVATED`
- `LEGAL_ENTITY_CREATED`, `LEGAL_ENTITY_UPDATED`, `LEGAL_ENTITY_ARCHIVED`
- `ACCOUNT_ASSIGNMENT_CREATED`, `ACCOUNT_ASSIGNMENT_REVOKED`, `PRIMARY_ASSIGNMENT_CHANGED`
- `FISCAL_YEAR_CREATED`
- `CLIENT_ACTION_DENIED` for selected sensitive denied operations according to the audit-noise policy

Every mutation event includes actor user/membership, tenant, client account, legal entity when relevant, action, permission, decision, reason, request correlation and small allowlisted metadata (for example changed field names, year, responsibility). Never record a full DTO by default, RFC history unless explicitly necessary/protected, cookies, tokens, passwords, MFA secrets, credential material or XML. State and successful audit must commit together.

## I. Frontend integration strategy

### Reuse

- Extend `apps/web/src/lib/api-client.ts`; do not create a second fetch/interceptor architecture.
- Keep `SessionProvider`/`AccountingContextProvider` as session and tenant authorities, but fix backend-role mapping explicitly.
- Keep canonical routes from `product-route.ts`, `ProductTable`, `ActionDialog`, `DetailDrawer`, field patterns and design tokens.
- Continue `credentials: "include"`, external `AbortSignal`, timeout and `ApiError` handling.

### Add/modify in the later task

| Area | Candidate change |
| --- | --- |
| Types/API | Add a client feature folder following `features/session`/`features/organizations`, with request/response DTO types and functions for the candidate endpoints. |
| Route data | Remove the non-demo placeholder branch and resolve/load live resources. Server/client boundary must not trust slug/client ID; API remains authority. |
| List query | URL-owned page/search/status/sort values; debounce/cancel search; reset page on filter; render loading/error/empty/success. Do not show e.firma filter until backed by data. |
| Create mutation | Controlled values, explicit pending state, field errors, 409 mapping, MFA code handling and success navigation to returned ID. Disable duplicate submit. |
| Detail/settings | Separate account fields from a list of legal entities. Do not keep one editable RFC on the account settings form. |
| Assignments | Fetch restricted available-member projection; send membership ID; refresh detail and authorization after success/revocation. |
| Fiscal years | Resolve LegalEntity explicitly when accounts have multiple RFCs; connect year create and period list. |
| Cache | No query library exists. Use the smallest consistent context/hook state with abort and explicit refetch/invalidation. If a library is later proposed, it requires separate approval/dependency review. |
| Permissions | Hide/disable mutation affordances by exact `clients.manage`/`clients.assign` while treating backend authorization as final. Fix `mapRole()` independently of permissions. |
| Redirects/errors | 401 follows existing login return path; 403/MFA setup uses current classification; resource 404 invokes safe not-found UI; 409 remains in-form; tenant switch cancels requests and clears client state. |

Current `ActionDialog` defaults `confirmDisabled` to true. The connected create flow must intentionally own its confirm handler/pending/disabled state; simply adding an API function will not activate it.

## J. Test strategy

### Unit tests

- DTO whitelist, lengths, UUID/year/page/sort validation and extra-field rejection.
- RFC trim/uppercase/reasonable syntax, without claims of fiscal validity.
- Explicit mappers and PII exclusion.
- State transitions and optimistic version conflicts.
- Assignment eligibility, self-assignment/last-primary decisions and permission intersection.
- Constraint-name-to-409 mapping and safe 404/error mapping.
- Sort allowlist and parameterized search construction.
- Cache invalidation target calculation.

### PostgreSQL integration tests

Use an unequivocally isolated real PostgreSQL database with migrations applied per test suite. Cover:

- Aggregate create and exactly 12 periods.
- Account code, active RFC, assignment and fiscal-year duplicate constraints under concurrent inserts.
- Every FK/composite FK and cross-tenant relation rejection.
- Transaction/audit rollback at each child insertion failure.
- Archive/reactivation and partial-unique behavior.
- Assigned portfolio query, stable pagination/order, search index plan at representative volume and no N+1.
- Assignment revocation history and primary uniqueness.

### Isolated API E2E matrix

1. Owner creates a client in its active tenant and receives the complete aggregate.
2. User without `clients.manage` receives 403 and no rows/audit-success event.
3. Tenant B cannot see tenant A’s client.
4. Replacing a URL ID with a foreign ID returns the same safe 404.
5. List never returns another tenant’s or unassigned accounts.
6. Accountant sees only explicitly assigned scope.
7. Collaborator sees only assigned accounts.
8. Revoking assignment removes access immediately, including with a warmed cache.
9. Concurrent/duplicate RFC returns 409 `LEGAL_ENTITY_RFC_CONFLICT`.
10. Extra `organizationId`, status or audit field is rejected.
11. Manipulated tenant body/query cannot change tenant or create cross-tenant data.
12. Unknown sort is rejected; no SQL fragment reaches the query.
13. Page limit is capped/rejected according to DTO contract.
14. Mutation and audit event commit in one transaction.
15. Injected child/audit failure leaves no account, entity, assignment, year, period or success event.
16. Assignment change invalidates authorization cache for the affected membership.
17. `clients.assign` without verified/configured MFA returns the existing correct code.
18. Archived resources obey the approved list/detail/reactivation policy.
19. Unsafe mutation without `Origin` is rejected by the approved CSRF policy; allowed browser origin succeeds.
20. Every cross-tenant case asserts HTTP status, safe body, no mutation, no data leak and denied audit where policy requires it.

The repository’s current default API `jest` command also discovers E2E files. The implementation task should separate unit and E2E patterns or always use explicit configurations so CI cannot accidentally touch a shared database.

### Frontend and future Playwright

- Create through UI, pending/duplicate-submit behavior, field validation and returned-ID navigation.
- 409 RFC conflict, 403, MFA required/setup, safe 404 and network retry UX.
- List loading/error/empty/success, paging/filter/sort and request cancellation.
- Direct reload/deep link, tenant switch, unassigned client and access revoked during session.
- Multi-RFC selection and fiscal-year context after that UI is added.
- Visual capability gating plus a test proving hidden UI is not the authorization boundary.

## K. Recommended implementation order

1. **Close decisions:** one-name mapping, permission reuse/new keys, MFA for aggregate create, primary-assignment rules, fiscal-year range/calendar behavior, archive/reactivation and multi-RFC route selection.
2. **Platform prerequisites:** CSRF missing-Origin behavior/tests, request correlation, session activity fix, trust-proxy deployment setting and safe DB drift/orphan inspection.
3. **Identity integrity migration:** existing FKs/checks/composite membership key; validate against isolated and deployment-like data.
4. **Client schema migration:** five tables, named constraints and indexes; migration up/down only for unused/test data, forward-fix plan for production.
5. **Domain/backend write core:** entities, module, DTOs, mappers, scoped query helpers and transaction-aware audit.
6. **Authorization:** assignment resolution, account-scope checks, cache invalidation and MFA/404 behavior.
7. **Read APIs:** list/detail/legal entities/assignments/years/periods with paging/sort/query-plan tests.
8. **Write APIs:** aggregate create, updates, lifecycle, assignment and year create with concurrency/rollback tests.
9. **Frontend list/create:** client feature API/types/state, live route branch, action gates, errors and navigation.
10. **Frontend detail/1:N:** account settings, legal-entity UI, assignments, years/periods and direct-load states.
11. **Full isolated E2E/security pass:** cross-tenant, CSRF, cache revocation, concurrency and audit.
12. **Controlled rollout/operations:** migration verification, health/observability, latency/error/audit monitoring. Keep future fiscal-processing domains out.

## L. Definition of Done

- [ ] All prerequisite product/security decisions are recorded with exact permission and MFA policy.
- [ ] Only session-derived tenant authority is used; extra `organizationId` is rejected.
- [ ] Five core tables exist through append-only migration with named FKs, composite tenant protection, uniques, checks and indexes.
- [ ] No current identity row is orphaned and new identity FKs validate in the target environment.
- [ ] Aggregate create commits account, first RFC, primary assignment, year, 12 periods and audit atomically.
- [ ] A failure at any step leaves no partial domain or success audit row.
- [ ] Every list/detail/mutation is tenant-, assignment-, state- and permission-scoped and returns uniform 404 outside scope.
- [ ] `clients.assign` enforces the executable MFA policy; reauthentication is not falsely claimed.
- [ ] Assignment revocation removes cached access immediately by the approved mechanism.
- [ ] RFC, assignment and year concurrency is protected by database constraints and mapped to stable 409 codes.
- [ ] Sort/filter/page inputs are allowlisted/bounded and queries remain parameterized.
- [ ] DTOs/mappers prevent mass assignment and entity/PII leakage.
- [ ] CSRF rejects the approved unsafe missing-Origin cases; CORS/cookie/credentials behavior has tests.
- [ ] Every mutation writes bounded transactional audit with request correlation and no secrets/full DTO/XML.
- [ ] Existing non-demo routes render live client screens; demo fixtures are not a live fallback.
- [ ] UI supports loading/error/empty/success, field errors, cancellation, duplicate-submit prevention and safe 401/403/404/409 behavior.
- [ ] UI and response model represent 1:N LegalEntity explicitly.
- [ ] Unit, real isolated PostgreSQL integration, API E2E and frontend E2E matrices pass, including cross-tenant and warmed-cache cases.
- [ ] Backend format/lint/type/build/tests and frontend lint/typecheck/test/build are green without auto-formatting unrelated work.
- [ ] No new dependency is added without a demonstrated need and approval.
- [ ] No CFDI/DIOT/IEPS/credentials/storage scope enters the first migration or endpoint set.

## M. INPUTS FOR THE CLIENTS IMPLEMENTATION PROMPT

### Real paths and conventions

- Backend root: `apps/api/src`; frontend root: `apps/web/src`; API prefix `/api/v1`.
- Current protected-controller pattern: `apps/api/src/modules/users/users.controller.ts` with `SessionGuard`, `TenantAccessGuard`, `PermissionsGuard`, `@Permissions()` and `@CurrentTenant()`.
- Tenant-scoped 404 pattern: `apps/api/src/modules/users/users.service.ts` (`ensureMember()`).
- Permission truth: `apps/api/src/common/auth/permission-catalog.ts`; seed: `apps/api/src/database/seeds/run-seeds.ts`.
- Sessions/authorization/cache: `apps/api/src/modules/sessions/{sessions.service.ts,authorization.service.ts,session-cache.service.ts}`.
- Transaction-aware audit: `apps/api/src/modules/audit/audit.service.ts`, entity `audit-event.entity.ts`.
- Only current migration: `apps/api/src/database/migrations/1787601284711-Migration.ts`.
- Existing frontend transport: `apps/web/src/lib/api-client.ts`; session/tenant APIs in `apps/web/src/features/session` and `features/organizations`.
- Client routes: `apps/web/src/lib/product-route.ts` and catch-all `apps/web/src/app/[lang]/(private)/organizations/[organizationSlug]/[[...segments]]/page.tsx`.
- Visual screens: `apps/web/src/components/screens/global-screens.tsx`, `client-screens.tsx`; fixtures/types: `apps/web/src/lib/demo-data.ts`, `accounting-types.ts`.

### Existing and missing persistence/APIs

- Existing prepared tables: `users`, `organizations`, `memberships`, `roles`, `permissions`, `role_permissions`, `auth_sessions`, `auth_factors`, `auth_rate_limits`, `email_verification_tokens`, `subscriptions`, `audit_events`.
- Missing core tables: `client_accounts`, `legal_entities`, `account_assignments`, `fiscal_years`, `periods`.
- Missing nearby tables: `membership_permissions`, `invitations`, credentials/storage/checklist/process/config tables; these are not first-scope requirements.
- Existing relevant APIs: auth/session/tenant endpoints and tenant-scoped `/users`; `/users` is only partially reusable for an assignment picker.
- Missing APIs: every client/legal-entity/assignment/fiscal-year/period endpoint in section D.

### Executable permissions

- Client keys that really exist and are seeded: `clients.view`, `clients.manage`, `clients.assign`.
- Owner and accountant receive all three; collaborator receives `clients.view`; platform `admin` receives no seeded mappings.
- `clients.assign` requires MFA. `clients.manage` and `clients.view` do not.
- `fiscal_entities.*` and `fiscal_years.*` do not exist. Naming truth also uses `ownership.manage`, `team.manage`, `period.close`, `period.reopen`, `exports.create`; old variants are absent.

### Decisions established by repository evidence

- Authentication is opaque cookie session, not active JWT.
- Tenant authority comes from session context; body/query tenant is forbidden.
- Membership never implies client access; active account assignment is required.
- Current UI expects aggregate initial create: first account + RFC + primary responsible + year + 12 periods.
- Additional RFCs/assignments/years are subsequent operations.
- No new runtime dependency, generic repository layer, raw interpolated SQL, entity response or EAV/JSONB domain substitute is needed.
- Cross-tenant/out-of-assignment resource response is uniform 404.

### Pending decisions that the implementation prompt must close

1. Reuse `clients.view/manage` for legal entities/years or add approved permission keys with seed/MFA/tests.
2. Ratify aggregate-create MFA and one “Razón social” mapping to account name + first legal name, or change UI.
3. Primary responsible mandatory/eligibility/self-assignment/last-primary rules.
4. Active RFC uniqueness/reactivation behavior and account archive child policy.
5. Fiscal-year range and always-12-calendar-period rule.
6. Multi-RFC active-context route/UI behavior and whether reactivation enters first scope.
7. Deployed DB baseline/orphans/`uuid-ossp` state.

### Blocking risks

- `CsrfGuard` accepts unsafe requests with no `Origin`.
- Existing tenant FKs/context constraints are incomplete.
- Session activity timestamp does not advance.
- Assignment authorization/cache invalidation does not exist.
- Non-demo client route returns a placeholder and backend role mapping is incorrect.
- Audit correlation is not request-wide; trust proxy/security headers/health/OpenAPI remain open platform gaps.

### Safe validation commands for the next task

```text
bun run --cwd apps/api prettier --check 'src/**/*.ts' 'test/**/*.ts'
bun run --cwd apps/api eslint '{src,apps,libs,test}/**/*.ts'
bun run --cwd apps/api jest --runInBand --no-cache --testPathIgnorePatterns=e2e-spec
bun run --cwd apps/api build
bun run --cwd apps/web lint
bun run --cwd apps/web typecheck
bun run --cwd apps/web test
bun run --cwd apps/web build
```

The current API format/lint baseline already fails; do not hide it with unrelated auto-fixes. Run API E2E/integration only through a configuration proven to use an isolated disposable PostgreSQL database. Never run current `test:e2e`, migrations or seeds against a shared/unknown database.

### Required implementation order

Decisions → security/platform prerequisites → identity integrity migration → five-table client migration → domain/transactions/audit → assignment authorization/cache → read APIs → write APIs → frontend list/create → 1:N detail/assignments/years → isolated security/E2E → controlled rollout.
