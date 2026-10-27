# Clients module: current-state technical audit

> Documento histórico previo a la implementación. El estado vigente y la
> evidencia pre-PR están en
> [CLIENTS_MODULE_IMPLEMENTATION_REPORT.md](CLIENTS_MODULE_IMPLEMENTATION_REPORT.md)
> y
> [../qa/CLIENTS_MODULE_DEVELOPMENT_VALIDATION_REPORT.md](../qa/CLIENTS_MODULE_DEVELOPMENT_VALIDATION_REPORT.md).

## A. Metadata

| Item | Verified value | Evidence | Confidence |
| --- | --- | --- | --- |
| Audit date | 2026-08-26 (America/Mexico_City) | Local execution context | HIGH |
| Repository root | `F:/HemiaBalanceOs/balanz` | `git rev-parse --show-toplevel` | HIGH |
| Branch | `codex/refactor-ux-ui` | `git branch --show-current` | HIGH |
| Starting SHA | `f2b5ed0b298347c138f6fbdd2bf91710ffd4517d` | `git rev-parse HEAD` | HIGH |
| Initial worktree | Clean; `git status --short` returned no entries | Command output before validation | HIGH |
| Repository shape | Bun/npm workspace monorepo, applications in `apps/*` | `package.json` | HIGH |
| Safe database | None identified. No `.env` was printed and no local/test connection was unambiguously available. | `.env.example` variable names, `apps/api/src/config/database.config.ts` | HIGH |

### Documents reviewed and authority

| Document | Version/date or state | Use in this audit | Confidence |
| --- | --- | --- | --- |
| `apps/web/AGENTS.md` | Current worktree | Applicable repository instructions | HIGH |
| `docs/architecture/CORRECTED_POSTGRESQL_DATA_MODEL.md` | v4.0, 2026-08-18 | Target model only; not proof of implementation | HIGH |
| `docs/architecture/FRONTEND_DATABASE_GAP_ANALYSIS.md` | v1.0, 2026-08-18 | Prior gap analysis; some identity claims are now stale | HIGH |
| `docs/design/ACCOUNTING_UI_DESIGN_AGENT.md` | v1.1.0, 2026-08-18 | Normative UI language and behavior | HIGH |
| `docs/product/ACCOUNTING_INFORMATION_ARCHITECTURE.md` | Current worktree | Product/navigation intent | HIGH |
| `docs/EMAIL-CATALOG.md` | Current worktree | Existing email scope | HIGH |
| `README.md`, `apps/api/README.md`, `apps/web/README.md` | Current worktree | Operational context, verified against code | HIGH |
| `docs/design/ACCOUNTING_UI_MIGRATION_PLAN.md`, `docs/design/ACCOUNTING_UI_RESEARCH.md` | Historical files recovered from Git history before commit `ba0d399` | Historical context only | MEDIUM |
| `ARCHITECTURE.md` | Not present in current tree or reachable document paths inspected | Mandatory authority unavailable | HIGH |
| `control_mensual_cfdi.md` and versioned filename variants | Not present in current tree. `FRONTEND_DATABASE_GAP_ANALYSIS.md` references an external v3.1 dated 2026-08-12, which cannot be revalidated here. | Limitation; no claims imported as current truth | HIGH |

The executable hierarchy used here is: current code/migration/tests, then current architectural documents, then current functional/design intent, then Git history. A document statement is never reported as implemented without executable evidence.

### Commands executed

| Command | Result | Approx. time | Observation |
| --- | --- | ---: | --- |
| `git status --short` | PASS, empty | <1 s | Clean at start and before report creation. |
| `npm --prefix apps/api ls --depth=0` | PASS | 18 s together with web inventory | Resolved installed versions without installing. |
| `npm --prefix apps/web ls --depth=0` | PASS | 18 s together with API inventory | Resolved installed versions without installing. |
| `node_modules/.bin/prettier.cmd --check ...` | TOOLING FAILURE | <1 s | npm-style wrapper pointed to a non-existent hoisted path under the Bun layout; no file changed. |
| `bun run --cwd apps/api prettier --check 'src/**/*.ts' 'test/**/*.ts'` | FAIL (pre-existing) | 1.6 s | 118 TypeScript files do not satisfy Prettier. Check-only; no write. |
| `bun run --cwd apps/api eslint '{src,apps,libs,test}/**/*.ts'` | FAIL (pre-existing) | 11.5 s | 103 findings: 87 errors and 16 warnings; errors are predominantly `prettier/prettier`. Deliberately omitted `--fix`. |
| `bun run --cwd apps/api jest --runInBand --no-cache --testPathIgnorePatterns=e2e-spec` | PASS | 8.3 s | 20 suites, 62 tests. Expected error log from the mocked “provider down” email case. |
| `bun run --cwd apps/api build` | PASS | 5.7 s | Nest compilation succeeds. |
| `bun run --cwd apps/web lint` | PASS | 5.7 s | No findings. |
| `bun run --cwd apps/web typecheck` | PASS | 4.1 s | `tsc --noEmit`. |
| `bun run --cwd apps/web test` | PASS | 1.4 s | 10 Node tests pass. |
| `bun run --cwd apps/web build` | PASS | 10.6 s | Next.js production build and route generation succeed. |
| API `format` and `lint` package scripts | OMITTED | — | They include `--write` and `--fix`, forbidden by the audit scope; equivalent read-only checks were run. |
| `bun run --cwd apps/api test` | OMITTED | — | Its `testRegex` also matches `*.e2e-spec.ts`, so it is not isolated. The explicit unit-only command above was used. |
| `bun run --cwd apps/api test:e2e` | OMITTED | — | `app.e2e-spec.ts`/`auth.e2e-spec.ts` import `AppModule`; the latter performs cleanup `DELETE`s. No unequivocally isolated DB exists. |
| Migrations, seeds, schema introspection | OMITTED | — | No safe local/test database was identified. |

### Limitations

- “Schema verifiable” below means prepared by the only migration and corroborated by TypeORM entities; it does **not** mean applied in a running database.
- Deployment drift, PostgreSQL extensions and migration history in a live environment are not verifiable. In particular, the migration uses `uuid_generate_v4()` but does not create `uuid-ossp`.
- Missing mandatory documents cannot be reconstructed from references. Historical files are explicitly treated as context.
- No secret value, `.env`, cookie, token, connection string, MFA material, SES credential or Vault credential was read or printed.

## B. Executive summary

**Overall state: NOT READY for implementation without prerequisite decisions and schema/security work. Risk: HIGH.**

Implemented and reusable:

- Identity foundation: users, organizations, memberships, roles, permissions, opaque sessions, TOTP MFA, email verification, subscriptions, audit-event persistence and Redis authorization/session cache.
- Trustworthy request context: `SessionGuard` resolves the server-side session, `TenantAccessGuard` requires the active tenant, `PermissionsGuard` reads persisted role permissions, and `@CurrentTenant()` exposes the derived context.
- Frontend session transport: one `apiClient()` with `credentials: "include"`, timeout/cancellation and normalized API errors.
- A complete visual/demo navigation skeleton for clients, fiscal years and periods.

Partial or unsafe:

- Multi-tenant identity data exists, but several fundamental foreign keys and cross-context checks are missing from `Migration1787601284711`.
- Authorization exposes `assignedAccountIds`, but `AuthorizationService` always returns `[]`; assignments do not exist.
- `clients.view`, `clients.manage` and `clients.assign` are seeded, but no client endpoint uses them. Fiscal-entity/year permissions do not exist.
- Audit infrastructure exists, but team mutations are not audited and no client events exist.
- Client routes are real only in demo mode. In non-demo mode the catch-all route returns a generic organization placeholder before resolving any client route.

Absent:

- `ClientAccount`, `LegalEntity`, `AccountAssignment`, `FiscalYear` and `Period` entities, tables, migrations, modules, controllers, DTOs, services, mappers and tests.
- Live frontend client service/hooks/cache/mutations and field-error rendering for these flows.
- A UI capable of representing more than one RFC per client, despite the required 1:N domain.

Blocking conditions:

1. Unsafe CSRF behavior accepts every unsafe request without `Origin`.
2. Core tenant FKs/context constraints are absent; future assignment relationships could otherwise cross tenants or become orphaned.
3. The first-create contract is unresolved at the domain boundary: the UI asks for account + RFC + responsible + year atomically, while the required model separates four resources.
4. Permission policy for legal entities/fiscal years and assignment-based visibility must be decided and made executable.

The frontend is visually prepared, but not connection-ready: its data shape conflates account and legal entity, actions are disconnected, action-level capabilities are incomplete, and non-demo routing does not render the product screens. The database is not ready: all five core client tables are absent.

## C. Repository map

| Area | Path | Current contents |
| --- | --- | --- |
| Workspace root/scripts | `package.json` | Bun workspace over `apps/*`; aggregate dev/build only. |
| Backend | `apps/api/src` | Nest modules, shared guards/config, TypeORM database layer. |
| Frontend | `apps/web/src` | Next App Router application, components, session features and demo product model. |
| Backend modules | `apps/api/src/modules` | `auth`, `audit`, `email`, `memberships`, `organizations`, `permissions`, `redis`, `secrets`, `sessions`, `subscriptions`, `users`. No clients module. |
| Entities | `apps/api/src/modules/**/entities` | 12 entity classes, inventoried in section G. |
| Migration | `apps/api/src/database/migrations/1787601284711-Migration.ts` | Single prepared migration, `Migration1787601284711`. |
| Seed | `apps/api/src/database/seeds/run-seeds.ts` | Roles, 23 permissions and role-permission mappings. |
| API tests | `apps/api/test` | Unit and database-touching E2E tests share the directory. |
| Web tests | `apps/web/src/lib/*.test.ts` | Navigation, auth types, API client and navigation security. |
| Product routes | `apps/web/src/lib/product-route.ts` | Canonical catch-all route resolver. |
| Client UI | `apps/web/src/components/screens/global-screens.tsx`, `client-screens.tsx` | Portfolio/list/create shell, detail/settings/fiscal screens. |
| Demo model/data | `apps/web/src/lib/accounting-types.ts`, `demo-data.ts` | Local types and all current operational data. |
| Documentation | `docs/architecture`, `docs/design`, `docs/product` | Target model, product/navigation and UI conventions. |

There are no shared application packages beyond workspace dependencies and no client-specific code in the backend.

## D. Current architecture

### Effective stack

Installed/resolved versions are evidence from `package.json` plus `npm ... ls --depth=0`.

| Concern | Effective implementation | Status |
| --- | --- | --- |
| Runtime/package manager | Node 20.15.1, Bun 1.3.14, npm 10.8.1; Bun lock/layout and npm-compatible workspaces | IMPLEMENTED |
| Backend | NestJS 11.1.27, Express platform 11.1.27 | IMPLEMENTED |
| ORM/database | TypeORM 1.0.0, `@nestjs/typeorm` 11.0.2, PostgreSQL driver 8.21.0; `synchronize: false` | IMPLEMENTED |
| Cache | Redis 6.2.1 with database fallback | IMPLEMENTED |
| Frontend | Next.js App Router 16.2.12, React 19.2.4, TypeScript 5.9.3 | IMPLEMENTED |
| Vite / React Router | Not installed; Next routing is used | NOT_REQUIRED |
| Frontend state/query cache | React context/local state only; no TanStack Query/SWR/store library | MISSING for server data cache |
| HTTP client | Native `fetch` wrapper `apps/web/src/lib/api-client.ts` | IMPLEMENTED |
| Forms/validation | Native controlled/uncontrolled elements; no form or frontend schema library | PARTIAL |
| Tables | Local `ProductTable` over Base UI primitives; no data-grid library | PARTIAL |
| Tests | Jest 30.4.2, Supertest 7.2.2; web uses TypeScript + `node:test` | IMPLEMENTED |
| Playwright / Storybook / OpenAPI | Not installed or configured | MISSING |

### Backend conventions

- Modules inject TypeORM repositories/services through Nest DI. Transactions use `DataSource.transaction()`/`EntityManager`; this is the convention to retain, not replace with manual instantiation or a generic repository wrapper.
- DTOs use `class-validator`; `main.ts` installs a global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform` all enabled.
- Controllers return DTOs/mapped values in the user flow (`UserMapper`); future client entities must not be returned directly.
- `AllExceptionsFilter` emits `{ statusCode, message, error, code?, path, timestamp }`. It has no correlation ID response/header.
- `FindUsersDto` demonstrates bounded page pagination (`limit <= 100`). No reusable sort/filter allowlist abstraction exists.
- `AuditService.record()` can participate in a supplied transaction, which is suitable for atomic domain mutations.

### Sessions and trusted tenant context

Evidence: `apps/api/src/modules/sessions/sessions.service.ts`, `authorization.service.ts`, `session-cache.service.ts`, `session.types.ts`.

- The raw session token is 32 random bytes encoded as hex; only its SHA-256 hash is stored in `auth_sessions`. It is an opaque-session strategy.
- Cookie defaults: `HttpOnly`, path `/`, `SameSite=Lax` outside production and `Strict` in production; production requires `Secure`. The secure default name is `__Host-session`, otherwise `balanz_session`, with configuration validation in `cookies.config.ts`.
- Defaults: 8-hour absolute TTL, 30-minute idle TTL and 60-second authorization cache TTL.
- Revocation updates the database and deletes cache. Membership suspension/revocation revokes relevant sessions. MFA activation/disable rotates the raw token and revokes other sessions.
- Tenant switch validates an active membership/organization and updates session context, but does **not** rotate the token. It replaces the cache entry for the same token hash.
- `SessionGuard` populates `request.authSession` and `request.tenantContext`; `@CurrentTenant()` exposes `SessionAuthorizationContext`. `organizationId` is therefore server-derived on current protected routes.
- `assignedAccountIds` is in the contract but hard-coded to `[]` in `AuthorizationService`; it is not authorization evidence today.
- No active JWT strategy/guard issues request credentials. `@nestjs/jwt`, JWT config/types and the `request.user` fallback in `PermissionsGuard` are legacy/dead paths, not a second active authentication mechanism.
- **Open defect:** normal `resolve()` calls do not persist or advance `last_activity_at`; cache `touch()` rewrites the same timestamp. Active users can hit the idle cutoff about 30 minutes after session creation. The API README’s “persist every five minutes” claim is not implemented.

### Guards and order

| Guard | Evidence | Responsibility/context | Failure behavior | Coverage/gap |
| --- | --- | --- | --- | --- |
| `CsrfGuard` (global `APP_GUARD`) | `apps/api/src/common/guards/csrf.guard.ts`, `app.module.ts` | Safe-method bypass; compare explicit `Origin` with configured CORS origins | 403 `Invalid request origin` for explicit mismatch | Tests cover safe/configured/mismatched origins. Missing `Origin` is always accepted; blocker for cookie mutations. |
| `ThrottlerGuard` | `AuthController` | Auth endpoint throttling | 429 framework response | Auth only; no client policy. |
| `SessionGuard` | `session.guard.ts` | Resolve opaque cookie and attach trusted session/tenant context; enforce pending login MFA | 401 `MFA_REQUIRED` or session errors | Unit coverage through sessions/auth tests. |
| `TenantAccessGuard` | `tenant-access.guard.ts` | Require active tenant context | 401 context missing; 403 inactive tenant | Thin guard; service queries must still scope every resource. |
| `PermissionsGuard` | `permissions.guard.ts` | Require all `@Permissions`; enforce MFA for sensitive keys | 401 MFA required; 403 setup/permission failures | Unit tests exist. Legacy `request.user` fallback remains. |
| `MfaGuard` | `mfa.guard.ts` | Duplicate sensitive-key enforcement | Same MFA codes | Provided but not used on endpoints; enforcement currently lives in `PermissionsGuard`. |
| Reauthentication | No guard/service | None; `/me/authorization` returns an empty action list | None | MISSING. |

The reusable protected-controller order is demonstrated by `UsersController`: `SessionGuard`, `TenantAccessGuard`, `PermissionsGuard`. CSRF precedes them globally.

### Tenant isolation behavior

- `UsersController` never accepts organization authority from body/query/route; it derives it with `@CurrentTenant()`.
- `UsersService.ensureMember()` scopes by `organizationId` and returns 404 for an ID outside that tenant, which is the correct non-enumerating pattern to reuse.
- `PATCH /auth/session/organization` necessarily accepts a candidate organization ID, but `AuthService.changeOrganization()` validates active membership before changing the server-side session.
- There is no RLS and no `SET LOCAL` transaction context. Isolation depends on application queries and constraints.
- The current authorization cache represents tenant permissions, not account assignment access. Future assignment mutation requires explicit invalidation of the session/authorization entries for the affected membership.

### Other platform gaps relevant to clients

- CORS is exact/configured in production and frontend fetches include credentials. In non-production, an empty origin allowlist enables arbitrary origins.
- Production bootstrap does not configure Express `trust proxy`, although E2E setup does. IP-based audit/rate-limit decisions may be wrong behind a proxy.
- No Helmet/security-header setup, health endpoint, OpenAPI/Swagger, correlation-ID middleware or response propagation exists.
- Audit rows carry `correlation_id`, but callers manufacture/pass it; there is no request-wide correlation context.

| Previously signaled architecture gap | Verification state | Relevant to clients | Blocks clients? | Evidence/decision |
| --- | --- | --- | --- | --- |
| Session activity refresh | OPEN | Yes | Required before release, not schema coding | `SessionsService.resolve()`/`SessionCacheService.touch()` do not advance persisted activity. |
| CSRF without `Origin` | OPEN | Yes | **Yes, before mutations** | Explicit early `return true` in `CsrfGuard`. |
| Missing identity FKs | OPEN | Yes | **Yes, before/with assignment schema** | Only three FKs in `Migration1787601284711`. |
| Production `trust proxy` | OPEN | Yes for IP audit/limits | No for local coding; yes for production hardening | Absent from `main.ts`, manually set by E2E. |
| Security headers | OPEN | Yes | No for module coding; required production baseline | No Helmet/header middleware found. |
| Correlation ID | PARTIAL | Yes for audit | Required for auditable release | Audit column/service input exists; request context/response does not. |
| Health checks | OPEN | Operationally | No | No health module/controller. |
| OpenAPI | OPEN | Integration | No | No Swagger dependency/configuration. |
| Permission/MFA alignment | PARTIAL | Yes | Decision required before endpoint decorators | Three client keys are aligned catalog↔seed; assignment is MFA-sensitive; subresource keys absent and `clients.manage` MFA intent unresolved. |

## E. Frontend state

### Routing and data source

The canonical route is `apps/web/src/app/[lang]/(private)/organizations/[organizationSlug]/[[...segments]]/page.tsx` and routes are parsed by `apps/web/src/lib/product-route.ts`.

In demo mode, it resolves organization, capability, client assignment and deep links before rendering `AccountingScreen`. Outside demo mode, it returns “Tu organización está lista” before calling `resolveProductRoute`; therefore none of the client screens is a live product route despite the successful Next build.

Client route families:

- `/:lang/organizations/:organizationSlug/clients`
- `.../clients/:clientId/overview`
- `.../clients/:clientId/fiscal-years`
- `.../clients/:clientId/fiscal-years/:year`
- `.../clients/:clientId/fiscal-years/:year/periods/:month/:tab`
- `.../clients/:clientId/cfdi[/<uuid>]`, `alerts`, `obligations/...`
- `.../clients/:clientId/settings/{data,responsibles,e-signature-sat,obligations,access}`

`AccountingContextProvider` combines real session organizations/permissions with demo objects. Its `mapRole()` only recognizes `titular`, `administrador` and `responsable`; backend `owner`, `accountant` and `collaborator` all fall through to visual `colaborador`. This is a live integration defect.

### Client screens and actions

| Screen/flow | Component and route | Required visible data/actions | Current source/state | Connected? | Confidence |
| --- | --- | --- | --- | --- | --- |
| Organization dashboard/portfolio | `OrganizationHomeScreen`, `.../home` | Visible client count, attention/process counts; client, RFC, period, status, progress, responsible | `demoData`, local filters | No | HIGH |
| Client list/search/filter | `ClientsScreen`, `.../clients` | Name/RFC, responsible, current period, status, e.firma, last activity; search name/RFC; status/e.firma filters | `clientsFor()` fixtures; inputs have no handlers | No | HIGH |
| Create client modal | `ClientsScreen`/`ActionDialog` | Razón social, RFC, responsable, ejercicio inicial | Uncontrolled UI, confirmation disabled by `ActionDialog` default | No | HIGH |
| Client summary | `ClientOverviewScreen`, `.../:id/overview` | Current period, status/progress, SAT/e.firma, counts, year/12 periods; SAT/upload/change responsible actions | Fixtures/hard-coded values; save disabled | No | HIGH |
| Fiscal years | `FiscalYearsScreen`, `.../:id/fiscal-years` | Year/status/period counts/activity; create-year field | Local constant + dialog disabled | No | HIGH |
| Fiscal year/periods | `FiscalYearScreen`, `.../:id/fiscal-years/:year` | 12 months, status/progress/CFDI/incidents/cutoff/version/responsible | `demoData.periods` | No | HIGH |
| Client settings/data | `ClientSettingsScreen`, `.../settings/data` | Razón social, RFC, responsable, período actual | Fixture defaults; save disabled | No | HIGH |
| Responsibles/access | Same, `.../settings/responsibles|access` | Static assignment list and “Cambiar responsable” | Local rows; action has no mutation | No | HIGH |
| e.firma/SAT | Same, `.../settings/e-signature-sat` | Status/connection/protected holder/expiry | Demo | No | HIGH |
| Add/list/edit/archive RFC | No component/route | Required by 1:N `LegalEntity` domain | Absent | No | HIGH |
| Edit/archive/reactivate client | No connected flow; disabled settings edit only | Required lifecycle actions | Absent | No | HIGH |

`ProductTable` supports a semantic caption and empty row, but not loading, request error, pagination or sorting. Private-route `loading.tsx` and `error.tsx` provide coarse page states only. No client mutation has success/toast/field-error behavior.

### Actual form fields classified

| UI field | Current location | Candidate owner | Treatment | Gap/decision |
| --- | --- | --- | --- | --- |
| Razón social | Create and settings | `LegalEntity.legalName` under the required domain; UI currently treats it as client name | Persist after the domain decision | UI has no separate operating `ClientAccount.name`. |
| RFC | Create and settings | `LegalEntity.rfc` | Normalize/persist with tenant-active unique constraint | UI assumes exactly one RFC. |
| Responsable | Create, summary drawer, settings | `AccountAssignment` + joined `Membership/User` display | Persist assignment; derive display name | Must send membership ID, never a name; available-member API is needed. |
| Ejercicio inicial/Año | Create and fiscal-year modal | `FiscalYear.year` | Persist; periods are server-created children | Needs legal-entity context when account has multiple RFCs. |
| Período actual | Settings/summary | Derived from `Period`/workflow policy | Derive, not free-text account data | Current editable input is unsupported by target model. |
| Estado | Tables/summary | Resource status | Persist server-controlled transitions | Create DTO must not mass-assign arbitrary status. |
| Progress, incidents, last cutoff/activity, SAT/e.firma | Tables/summary | Aggregates or future credential/process domains | Calculate/join; do not add blindly to account | Demo-only today. |
| Name/operating name, internal code, trade name, taxpayer type, regime, postal code, contact/email/phone, collaborators, notes, tags | Not present in client forms | Various/undecided | Do not add to v1 UI contract without product decision | Some occur in target database document, not the current visual contract. |

### Frontend transport contract to reuse

`apps/web/src/lib/api-client.ts` provides the single architecture to extend:

- Base URL `NEXT_PUBLIC_API_URL`, default `http://localhost:3021/api/v1`.
- Native fetch, JSON content type when a body exists, `credentials: "include"`, 10-second timeout and external `AbortSignal` composition.
- `ApiError(status, code, fieldErrors, details)` and classifications for 401/MFA, 403, 409, 422, 429, network/timeout.
- `SessionProvider` redirects 401 to login, shows forbidden state for 403/MFA setup, reloads organizations/authorization after tenant switch and clears stale context during switching.

Missing for clients: service/type files, query ownership/cache/invalidation, page/list state, paging/sort/filter conventions, mutation state, field error binding, success feedback and permission-gated actions. No second HTTP abstraction should be introduced.

## F. Backend state

### Existing APIs

All routes are under `/api/v1` (`main.ts`).

| Method/path | Controller.method | Guards/permission | Contract summary |
| --- | --- | --- | --- |
| `POST /auth/register` | `AuthController.register()` | CSRF + throttler | `RegisterDto`; creates pending identity/tenant/trial flow. |
| `POST /auth/login` | `login()` | CSRF + throttler | Email/password; sets opaque cookie. |
| `POST /auth/login/mfa` | `loginMfa()` | CSRF + throttler + session | TOTP; rotates session token. |
| `POST /auth/email/verification/resend` | `resendVerification()` | CSRF + throttler | Always 202 behavior. |
| `POST /auth/email/verification/confirm` | `confirmEmail()` | CSRF + throttler | Token; activates onboarding/session. |
| `GET /auth/onboarding` | `onboarding()` | session + onboarding | Trial/onboarding state. |
| `POST /auth/mfa/totp/{setup,verify,disable}` | Corresponding methods | CSRF + session | TOTP lifecycle. |
| `GET/DELETE /auth/session` | `session()`/`logout()` | session; DELETE also CSRF | Context / revoke. |
| `PATCH /auth/session/organization` | `changeOrganization()` | CSRF + session | Candidate `organizationId`, membership-validated. |
| `GET /me/organizations` | `MeController.organizations()` | session | Active organizations/memberships. |
| `GET /me/authorization` | `authorization()` | session + tenant | Role, permissions, empty assignments, empty reauth actions. |
| `GET /users` | `UsersController.findAll()` | session, tenant, `team.view` | Search/status/page/limit; `UsersPageResponseDto`. |
| `GET /users/:id` | `findOne()` | session, tenant, `team.view` | Tenant-scoped user projection. |
| `POST /users` | `create()` | session, tenant, `team.manage` + MFA | Creates a new global user and membership; not an invitation/available-member endpoint. |
| `PUT /users/:id` | `update()` | same | Membership status update only. |
| `DELETE /users/:id` | `remove()` | same | Revokes membership/sessions. |

There are no client, legal-entity, assignment, fiscal-year or period APIs, DTOs, controllers, services or mappers.

#### Existing DTO/response contract inventory

| DTO or response | Exact public fields/validation | Evidence and relevance |
| --- | --- | --- |
| `RegisterDto` | Required trimmed `firstName`/`lastName` (max 100), normalized email (max 320), password (min 8), organization name (max 160), normalized slug (max 100/pattern), subscription type (max 100); optional E.164 phone, locale, timezone, legal name, billing email and organization timezone | `apps/api/src/modules/auth/dtos/register.dto.ts`; demonstrates transformations and explicit validation. |
| `RegisterResponseDto` | User/organization/membership IDs, role/statuses, subscription type/status, `nextStep='verify_email'`, MFA false, tenant false | `register-response.dto.ts`; aggregate transactional response precedent. |
| `LoginDto` / `VerifyMfaDto` / `DisableMfaDto` | Email+non-empty password; six-digit MFA code; disable requires password+code | Auth DTO folder; never reuse password/MFA DTOs in clients. |
| `VerifyEmailDto` / `ResendVerificationDto` | Token 32–512 chars; valid email <=320 | Auth DTO folder. |
| `ChangeOrganizationDto` | `organizationId` UUID | `change-organization.dto.ts`; candidate tenant is validated against membership by service, unlike domain DTO tenant authority. |
| Session response | User/session IDs, nullable organization/membership/role, permissions, `assignedAccountIds`, MFA state/expiry and `tenantActive` | `AuthService.sessionDetails()`, `apps/web/src/features/session/types.ts`; assignments are currently always empty. |
| Authorization response | Organization/membership/role, permissions, empty assignments and `reauthenticationRequiredActions: []` | `MeController.authorization()`. |
| `FindUsersDto` | Optional unbounded-string `search`, membership-status enum, page default 1, limit default 20/max 100 | `apps/api/src/modules/users/dtos/find-users.dto.ts`; paging precedent, but search needs a maximum for client candidates. |
| `CreateUserDto` | First/last/email/password plus optional phone/locale/timezone | `create-user.dto.ts`; creates identity, so it is not the assignment DTO. |
| `UpdateUserDto` | Optional membership `status` only | `update-user.dto.ts`. |
| `UserResponseDto` / `UsersPageResponseDto` | User identity/contact/status/timestamps; page wrapper `{items, meta:{page,limit,total,totalPages}}` | `user-response.dto.ts`, `users-page-response.dto.ts`; explicit mapping precedent but too much user PII and no membership ID for an assignment picker. |

The current global filter usually represents validation failures as 400 with an array/string `message`; it does not emit the frontend’s optional `fieldErrors` shape. A later client integration must either map this existing shape in the form or deliberately extend the shared error contract, not assume 422 field errors already exist.

### Reusable and non-reusable conventions

- Reuse: controller guard ordering, `@CurrentTenant()`, UUID pipes/DTO validation, `UsersService`’s tenant-scoped 404 pattern, explicit mappers, bounded page response, transaction-aware `AuditService`, unique-conflict translation from registration, and frontend `apiClient`.
- Modify/extend: authorization resolution/cache to populate account assignments; audit callers; response correlation; permissions policy.
- Do not reuse as the member picker contract: `POST /users` creates a global identity. `GET /users` is partially reusable for candidates but returns user-oriented data and lacks membership/assignment eligibility details.

### Existing tests

API unit suites cover exception filtering, audit persistence, authorization tenant mismatch, cookie/CORS/CSRF behavior, database config, email, identity states, MFA encryption, password hashing, permission guard, DTO validation, registration conflict, session cache/session service and tenant-scoped users including last-owner protection. There are no client-domain tests and only narrow authorization coverage.

`app.e2e-spec.ts` and `auth.e2e-spec.ts` are database-coupled. Their current placement also means the default `jest` regex includes them; this is why only an explicit ignore-pattern test run was safe.

## G. Database state

### Implemented/prepared tables

The only migration is `apps/api/src/database/migrations/1787601284711-Migration.ts`; all entries below are corroborated by an entity in `apps/api/src/modules/**/entities`. No later migrations exist.

| Table/entity | Main columns and constraints | Relationships/indexes and risks | Current use | Confidence |
| --- | --- | --- | --- | --- |
| `users` / `User` | UUID PK; name, unique normalized email, verification/phone/locale/timezone/status/login fields; `password_hash` is `select:false`; timestamps and `deleted_at` | No issue linking tenant directly; timestamp-without-time-zone used for several audit fields | Auth/users | HIGH |
| `organizations` / `Organization` | UUID PK; name/legal name, unique slug, billing email, timezone, `owner_user_id`, status/lifecycle timestamps | **No FK** from owner to user | Tenant/onboarding | HIGH |
| `memberships` / `Membership` | UUID PK; organization/user/role IDs, state timestamps; unique `(organization_id,user_id)` | Only `role_id -> roles` FK. **No org/user FKs** and no composite tenant key | Tenant/RBAC/users | HIGH |
| `roles` / `Role` | UUID PK; unique key, name, description, scope | Seeded owner/accountant/collaborator/admin definitions | RBAC | HIGH |
| `permissions` / `Permission` | UUID PK; unique key, name, description | 23 seeded keys | RBAC | HIGH |
| `role_permissions` / `RolePermission` | Composite PK `(role_id,permission_id)` | Both FKs present | RBAC | HIGH |
| `auth_sessions` / `AuthSession` | UUID PK; unique token hash, user/org/membership IDs, status/MFA, expiry/activity/IP/UA/revocation | User/status/expiry and tenant-context indexes; **no FKs or context check** | Opaque sessions | HIGH |
| `auth_factors` / `AuthFactor` | UUID PK; user ID; encrypted secret; state/counters; partial unique current factor | User/status index; **no user FK**; AES-GCM secret | TOTP | HIGH |
| `auth_rate_limits` / `AuthRateLimit` | UUID PK; scope, hashed key, attempts/window/expiry; unique `(scope,key_hash)` | Expiry index | Auth abuse control | HIGH |
| `email_verification_tokens` / `EmailVerificationToken` | UUID PK; user ID; unique token hash; expiry/use timestamps | **No user FK** | Verification | HIGH |
| `subscriptions` / `Subscription` | UUID PK; unique organization ID, type/status/trial timestamps | **No organization FK** | Trial onboarding | HIGH |
| `audit_events` / `AuditEvent` | UUID PK; tenant/actor/client/legal IDs, action/permission/decision/object/reason/correlation/IP, JSONB metadata, `occurred_at` | Tenant/time/object/correlation indexes; **no FKs/checks/DB append-only rule** | Auth/security audit | HIGH |

#### Exact prepared-column inventory

Notation: `NN` = `NOT NULL`; omitted `NN` means nullable. All UUID primary keys default to `uuid_generate_v4()`. Unless stated otherwise there is no soft delete, no TypeORM relation decorator, no FK and no `CHECK`. This inventory is transcribed from `Migration1787601284711` and cross-checked with the named entity; it is prepared state, not proof of deployment.

| Table | Columns: PostgreSQL type, nullability and default | PK/FK/unique/index | Lifecycle, sensitivity, use/tests and risk |
| --- | --- | --- | --- |
| `users` | `id uuid NN`; `first_name varchar(100) NN`; `last_name varchar(100) NN`; `email varchar(320) NN`; `email_verified_at timestamptz`; `phone_e164 varchar(16)`; `phone_verified_at timestamptz`; `locale varchar(10) NN DEFAULT 'es-MX'`; `timezone varchar(64) NN DEFAULT 'America/Mexico_City'`; `status users_status_enum NN DEFAULT 'active'`; `last_login_at timestamptz`; `password_hash varchar NN`; `created_at/updated_at timestamp NN DEFAULT now()`; `deleted_at timestamp` | PK `id`; unique `email`; index `(status,last_login_at)`; no outgoing FKs | Only entity with soft delete. `passwordHash` is `select:false` and email has a lower/trim transformer in `User`. Used by auth/users; password, registration and users tests. Mixed timestamp types and missing inbound integrity are risks. |
| `organizations` | `id uuid NN`; `name varchar(160) NN`; `legal_name varchar(200)`; `slug varchar(100) NN`; `billing_email varchar(320)`; `timezone varchar(64) NN DEFAULT 'America/Mexico_City'`; `owner_user_id uuid NN`; `status organizations_status_enum NN`; `suspended_at/cancelled_at timestamptz`; `created_at/updated_at timestamp NN DEFAULT now()` | PK; unique index `uq_organizations_slug`; **no owner-user FK** | State timestamps, no soft delete. Used by onboarding/session. Organization/user integrity is unenforced. |
| `memberships` | `id uuid NN`; `organization_id/user_id/role_id uuid NN`; `status memberships_status_enum NN`; `invited_at/joined_at/suspended_at/revoked_at timestamptz`; `created_at/updated_at timestamp NN DEFAULT now()` | PK; unique `(organization_id,user_id)`; only FK `role_id -> roles.id ON DELETE RESTRICT`; no org/user FKs | History by status/timestamps, no soft delete. Used by tenant/session/users; identity-state/users tests. Cross-tenant/orphan risk and no `(organization_id,id)` composite target. |
| `roles` | `id uuid NN`; `key varchar(50) NN`; `name varchar(160) NN`; `description text NN`; `scope varchar(20) NN` | PK; unique index on `key`; referenced by membership/role-permission FKs | Seed-managed; no lifecycle. Used by authorization and seed. `scope` has no DB check. |
| `permissions` | `id uuid NN`; `key varchar(80) NN`; `name varchar(160) NN`; `description text NN` | PK; unique index on `key`; referenced by cascade FK from role permissions | Seed-managed; no lifecycle. Catalog/guard tests, but persisted target DB not inspected. |
| `role_permissions` | `role_id uuid NN`; `permission_id uuid NN` | Composite PK; FK role and permission, both `ON DELETE CASCADE` | Join table used by authorization/seed. This is the only fully FK-bound join. |
| `auth_sessions` | `id uuid NN`; `session_token_hash varchar(64) NN`; `user_id uuid NN`; `membership_id/organization_id uuid`; `status auth_sessions_status_enum NN`; `mfa_verified_at timestamptz`; `requires_mfa boolean NN DEFAULT false`; `expires_at/last_activity_at timestamptz NN`; `ip_address varchar(45)`; `user_agent varchar(512)`; `revoked_reason varchar(100)`; `revoked_at timestamptz`; `created_at timestamp NN DEFAULT now()` | PK; unique token hash; indexes `(user_id,status,expires_at)` and `(organization_id,membership_id,status,expires_at)`; **no FKs or context check** | Token hash is sensitive though not `select:false`; raw token is never stored. Revocation is state-based. Session/cache tests. Orphan/mismatched tenant context and idle-activity defect are risks. |
| `auth_factors` | `id uuid NN`; `user_id uuid NN`; `secret_encrypted text NN`; `status auth_factors_status_enum NN`; `verified_at/last_used_at timestamptz`; `last_used_counter bigint`; `revoked_at timestamptz`; `created_at/updated_at timestamptz NN DEFAULT now()` | PK; partial unique user where status pending/active; index `(user_id,status)`; no user FK | Encrypted MFA secret is sensitive and not marked `select:false`; service restricts use. MFA encryption/auth tests. Missing FK and absence of recovery codes. |
| `auth_rate_limits` | `id uuid NN`; `scope varchar(40) NN`; `key_hash varchar(64) NN`; `attempts integer NN DEFAULT 0`; `window_started_at/expires_at timestamptz NN`; `created_at/updated_at timestamptz NN DEFAULT now()` | PK; unique `(scope,key_hash)`; expiry index | Hash is security data; no soft delete. Auth only. No client abuse policy. |
| `email_verification_tokens` | `id uuid NN`; `user_id uuid NN`; `token_hash varchar(64) NN`; `expires_at timestamptz NN`; `used_at timestamptz`; `created_at timestamp NN DEFAULT now()` | PK; unique token hash; index `(user_id,expires_at)`; no user FK | Token hash sensitive and not `select:false`; state by used/expiry. Registration/auth tests. Missing user FK. |
| `subscriptions` | `id uuid NN`; `organization_id uuid NN`; `subscription_type varchar(100) NN`; `status subscriptions_status_enum NN`; `trial_started_at/trial_ends_at timestamptz`; `created_at/updated_at timestamp NN DEFAULT now()` | PK; unique organization ID; no organization FK | Pending/trialing only; onboarding tests through auth. Missing FK/checks and very narrow status enum. |
| `audit_events` | `id uuid NN`; `organization_id uuid`; `actor_type varchar(16) NN`; `actor_user_id/actor_membership_id uuid`; `service_principal varchar(160)`; `support_grant_id/client_account_id/legal_entity_id uuid`; `action varchar(100) NN`; `permission_key varchar(80)`; `decision varchar(32)`; `object_type varchar(64) NN`; `object_id uuid`; `reason varchar(1000)`; `correlation_id uuid NN`; `ip_address inet`; `metadata jsonb NN DEFAULT '{}'`; `occurred_at timestamptz NN DEFAULT now()` | PK; indexes correlation, `(organization_id,object_type,object_id,occurred_at)`, `(organization_id,occurred_at)`; no FK/unique/check | Intended append-only, but DB does not enforce it. Metadata can hold PII if callers are careless. `AuditService` tests cover record/transaction behavior. Client/legal columns exist only as nullable identifiers, not domain tables. |

`membership_permissions` and `invitations` are absent. Credential/object/checklist/process/config tables are absent. `credential_records` and `stored_objects` therefore cannot participate in initial client creation.

### Client-domain coverage matrix

| Resource | Objective document | TypeORM entity | Migration | Verifiable schema | Real state | Minimum required change | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ClientAccount` / `client_accounts` | `CORRECTED_POSTGRESQL_DATA_MODEL.md` | None | None | No | DOCUMENTED_ONLY | New tenant-owned table with lifecycle, tenant uniqueness and composite key support | HIGH |
| `LegalEntity` / `legal_entities` | Same | None | None | No | DOCUMENTED_ONLY | New child table, normalized RFC and active tenant uniqueness | HIGH |
| `AccountAssignment` / `account_assignments` | Same | None | None | No | DOCUMENTED_ONLY | New history-preserving relation to account + membership with composite tenant FKs | HIGH |
| `FiscalYear` / `fiscal_years` | Same | None | None | No | DOCUMENTED_ONLY | New legal-entity child with unique year and state | HIGH |
| `Period` / `periods` | Same | None | None | No | DOCUMENTED_ONLY | New 12-month child with month check/unique key | HIGH |
| Membership-level overrides | Mentioned by prior architecture | None | None | No | MISSING | Not required for first clients slice unless product selects overrides | HIGH |
| Credential/storage/process/checklists | Target/future docs | None | None | No | DOCUMENTED_ONLY/FUTURE | Exclude from first client slice | HIGH |

### Multi-tenant integrity and concurrency

No RLS exists. For the future tables, `organization_id` on every tenant-owned resource plus composite uniqueness/FKs is necessary to make these invalid states unrepresentable:

- assignment from organization A’s account to organization B’s membership;
- legal entity attached to another tenant’s account;
- fiscal year attached to another tenant’s legal entity;
- period attached through mismatched ancestors.

This requires at least candidate composite keys such as `(organization_id,id)` on organizations’ child resources and FKs carrying `organization_id`; application checks alone are not sufficient. Existing `memberships` first needs a composite unique target `(organization_id,id)` and real organization/user FKs.

Duplicate account codes, active RFCs, assignments and fiscal years must be guarded by database unique/partial unique constraints. A pre-insert lookup remains useful for UX but cannot protect concurrent inserts. TypeORM/PostgreSQL unique violations must map to stable 409 codes.

## H. Permissions and effective roles

### Executable catalog

Source of truth: `apps/api/src/common/auth/permission-catalog.ts` and `apps/api/src/database/seeds/run-seeds.ts`. “Seed” means prepared by the seed script, not verified in a running database.

| Permission key | Executable description | Seed / roles | Endpoint/guard use | MFA | State/divergence |
| --- | --- | --- | --- | --- | --- |
| `organization.view` | View organization | Yes: owner, accountant, collaborator | Prepared/UI | No | Implemented catalog |
| `organization.manage` | Manage organization | Yes: owner | Prepared/UI | Yes | Implemented catalog |
| `ownership.manage` | Manage ownership | Yes: owner | Prepared/UI | Yes | Canonical; `organization.transfer` absent |
| `billing.manage` | Manage billing | Yes: owner | Prepared/UI | Yes | Implemented catalog |
| `team.view` | View team | Yes: owner, accountant | `GET /users*` | No | Implemented and used |
| `team.manage` | Manage team | Yes: owner | `POST/PUT/DELETE /users*` | Yes | Canonical; `members.manage` absent |
| `clients.view` | View client accounts | Yes: owner, accountant, collaborator | Demo route/UI only; no API | No | Prepared, not enforced on a client endpoint |
| `clients.manage` | Create/change/archive client accounts | Yes: owner, accountant | No endpoint; create button lacks action-level gate | **No** | Prepared; MFA policy decision remains |
| `clients.assign` | Assign clients to members | Yes: owner, accountant | No endpoint | **Yes** | Prepared; sensitive |
| `credentials.manage` | Manage fiscal credentials | Yes: owner, accountant | Prepared/UI | Yes | Future clients dependency, excluded from basic create |
| `sat.download` | SAT download | Yes: owner, accountant | Visual disabled actions | Yes | No API |
| `payroll.view` | View payroll | Yes: owner, accountant | Prepared/UI | No | No API |
| `cfdi.review` | Review CFDI | Yes: owner, accountant, collaborator | Demo routes/UI | No | No API |
| `cfdi.exclude` | Exclude CFDI | Yes: owner, accountant | Demo dialog | No | No API |
| `period.close` | Close period | Yes: owner, accountant | Demo/UI | Yes | Canonical; `periods.close` absent |
| `period.reopen` | Reopen period | Yes: owner, accountant | Demo/UI | Yes | Canonical singular |
| `exports.create` | Create exports | Yes: owner, accountant | Demo/UI | Yes | Canonical; `exports.generate` absent |
| `obligations.view` | View obligations | Yes: owner, accountant, collaborator | Demo route/UI | No | No API |
| `obligations.configure` | Configure obligations | Yes: owner, accountant | Demo/UI | No | No API |
| `diot.generate` | Generate DIOT | Yes: owner, accountant | Demo/UI | No | Future scope |
| `ieps.generate` | Generate IEPS | Yes: owner, accountant | Demo/UI | No | Future scope |
| `audit.view` | View audit | Yes: owner, accountant | Demo/UI | No | No read API found |
| `support.authorize` | Authorize support | Yes: owner | Prepared only | Yes | No API |

Absent from the executable catalog, seed and code: `fiscal_entities.view`, `fiscal_entities.manage`, `fiscal_years.view`, `fiscal_years.manage`, all singular/plural variants of those names, `organization.transfer`, `members.manage`, `periods.close` and `exports.generate`. They are not implemented permissions.

### Effective roles

| Role | Persisted definition | Seeded permissions | Client ability today |
| --- | --- | --- | --- |
| `owner` | Organization scope | All 23 | Catalog says view/manage/assign; no API exists. Assignment would require MFA. |
| `accountant` | Organization scope | 18, including all three client keys | Same prepared client ability as owner; no API exists. |
| `collaborator` | Organization scope | 4, including `clients.view` only | Could view only assigned clients by product intent, but assignments always resolve empty and no API exists. |
| `admin` | Platform scope | **None** in `ROLE_PERMISSION_KEYS` | No seeded client access; wildcard is accepted by permission utility but not seeded. |
| Visual `titular`, `administrador`, `responsable`, `colaborador` | Frontend demo types only | Fixture capabilities | Not aligned with backend role names. |

The code stores both `organizations.owner_user_id` and an `owner` membership role. `UsersService.assertNotLastOwner()` reasons from the active owner role, while the target model says ownership is contextual rather than an operational role. This contradiction must be decided; clients code must not hard-code roles either way.

Current answers by operation:

- View clients: prepared for owner/accountant/collaborator via `clients.view`; no endpoint.
- Create/edit/archive clients: prepared for owner/accountant via `clients.manage`; no endpoint and no MFA today.
- Add/edit/archive RFC or create fiscal year: no dedicated key. Reusing `clients.manage` is possible but must be an explicit policy decision.
- Assign members: prepared for owner/accountant via `clients.assign`; MFA enforced by `PermissionsGuard` once an endpoint uses the decorator.

## I. Frontend → API → database coverage

No row below is live end-to-end.

| Screen/action | Frontend route/evidence | Input → output needed | API / table | Permission / MFA / audit | State | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| List clients | `ClientsScreen`, `/clients` | page/filter/sort → client summaries | None / no table | `clients.view`; no MFA; read audit undecided | FRONTEND_ONLY | HIGH |
| Search | Same, search input | normalized search → same page | None / no index/table | `clients.view` | FRONTEND_ONLY | HIGH |
| Filter | Same, status/e.firma | allowlisted filters → page | None | `clients.view` | FRONTEND_ONLY; e.firma is future | HIGH |
| Paginate | `ProductTable` | page/limit → metadata | None | `clients.view` | MISSING | HIGH |
| Sort | `ProductTable` | allowlisted sort/direction | None | `clients.view` | MISSING | HIGH |
| Create client | `ClientsScreen` dialog | legal name, RFC, membership, year → navigable aggregate | None / five tables absent | `clients.manage`; assignment additionally `clients.assign` + MFA; audit required | CONFLICT | HIGH |
| View client | `ClientOverviewScreen`, `/clients/:id/overview` | route ID → scoped summary | None / no table | `clients.view` + assignment policy | FRONTEND_ONLY | HIGH |
| Edit client | disabled `ClientSettingsScreen` | selected account/legal fields → updated projection | None | `clients.manage`; audit required | CONFLICT | HIGH |
| Archive/reactivate client | No UI | lifecycle command → projection/204 | None | `clients.manage`; audit required | MISSING | HIGH |
| Add/edit/archive legal entity | No UI | RFC/legal fields → entity | None / no `legal_entities` | No executable specific key | MISSING | HIGH |
| Assign responsible | Summary drawer/settings | membership ID/responsibility → assignment | None / no assignments | `clients.assign`; MFA yes; audit required | FRONTEND_ONLY | HIGH |
| Assign collaborator | No connected flow | membership ID → assignment | None | `clients.assign`; MFA yes | MISSING | HIGH |
| Revoke assignment | No connected flow | assignment/version → revoked record | None | `clients.assign`; MFA yes; audit/cache invalidation | MISSING | HIGH |
| Available members | Static names in dialogs | search/page/status → eligible memberships | `/users` only partially reusable / memberships exist | `team.view` versus `clients.assign` decision | PARTIAL | HIGH |
| Create fiscal year | `FiscalYearsScreen` dialog | legal entity + year → year/12 periods | None / tables absent | No specific executable key | CONFLICT | HIGH |
| List years | `/fiscal-years` | scoped IDs → summaries | None | No specific key; likely `clients.view` if reused | FRONTEND_ONLY | HIGH |
| List periods | `FiscalYearScreen` | year → 12 periods | None | No specific key | FRONTEND_ONLY | HIGH |
| Summary aggregates | `ClientOverviewScreen` | account/legal/year → aggregate | None; several future tables absent | `clients.view` plus assignment | FRONTEND_ONLY | HIGH |

## J. Gaps and priorities

| Priority | Gap and evidence | Impact/risk | Recommendation/dependency | Timing | Confidence |
| --- | --- | --- | --- | --- | --- |
| P0-BLOCKER | Unsafe methods without `Origin` pass `CsrfGuard` (`csrf.guard.ts`) | Cookie-authenticated client mutations can bypass the intended origin check | Define and enforce missing-Origin policy; extend tests before exposing writes. Depends on deployment/client compatibility. | Before client mutations | HIGH |
| P0-BLOCKER | Core tenant FKs/context constraints absent in `Migration1787601284711` | Orphans and cross-context session/membership/assignment links; application mistakes become data leaks | Add append-only prerequisite constraints and composite tenant keys after deployment-state/backfill assessment. | Before or atomically with client schema | HIGH |
| P0-BLOCKER | UI create combines account/RFC/responsible/year, but domain is separated (`ClientsScreen`, target model) | Wrong transaction/API could create orphans or make UI impossible to connect | Adopt the atomic boundary proposed in readiness, or change product UI before coding. | Decision before implementation | HIGH |
| P0-REQUIRED | Five client-domain tables/entities/migrations are absent | Module cannot persist any client | Add only the five core tables with constraints/indexes. | Inside first module slice | HIGH |
| P0-REQUIRED | Assignment-based authorization is absent; `assignedAccountIds: []` | `clients.view` alone would expose the full tenant or nobody, violating product rule | Define visibility semantics; scope every query and invalidate affected caches immediately. | Inside first backend slice | HIGH |
| P0-REQUIRED | Legal-entity/fiscal-year permission keys do not exist | No executable policy for RFC/year operations | Decide whether v1 deliberately reuses `clients.view/manage` or schedules catalog/seed changes in a separately approved task. | Before endpoint decorators | HIGH |
| P0-REQUIRED | Session activity is never advanced (`SessionsService.resolve`, `SessionCacheService.touch`) | Active users may be logged out at idle TTL; stale documentation | Fix and test platform session activity separately. | Before release; can precede module | HIGH |
| P1 | Tenant switch does not rotate token; change audit is outside its transaction | Weaker session boundary and possible audit/state divergence | Define rotation/atomic audit policy in auth work, not in clients module. | Before production hardening | HIGH |
| P1 | Frontend client screens only work in demo branch; role mapping is wrong | “Connected” implementation would still show placeholder/mis-gate UI | Integrate route data and explicit backend-role mapping as frontend slice. | During connection | HIGH |
| P1 | Client action buttons lack operation-level gates | Users with view-only capability can see mutation affordances | Gate UI by exact permissions while retaining backend enforcement. | During connection | HIGH |
| P1 | No request correlation context, trust-proxy setup or security headers | Audit/IP evidence and baseline response protection are incomplete | Platform hardening stories; correlation is needed for client audit. | Correlation before audited release; others before production | HIGH |
| P1 | No OpenAPI, health checks or client API contract tests | Integration/operations regressions are harder to detect | Add contract documentation/tests without introducing unnecessary runtime dependencies. | During/before release | HIGH |
| P1 | Team mutations are not audited (`UsersService` has no `AuditService`) | Assignment prerequisites lack traceability | Add separately or as shared audit foundation. | Before production client administration | HIGH |
| DOCUMENTATION_CONFLICT | Current docs describe older JWT/global-user gaps, while code uses opaque sessions/identity tables | Future prompts may implement obsolete architecture | Treat this audit and code as current; update source docs in a separately authorized task. | Before broader implementation prompt | HIGH |
| DOCUMENTATION_CONFLICT | Stored `owner` role + `owner_user_id` conflicts with contextual ownership target; frontend uses Spanish roles | Ambiguous authorization and last-owner invariants | Make a product/architecture decision; never authorize client actions by role-name condition. | Before broader RBAC changes; not needed to choose endpoint permission keys | HIGH |
| TECH_DEBT | Backend format/lint baseline fails | No clean quality gate; large unrelated diff if auto-fixed | Address in separate formatting-only change. | Non-blocking for discovery; required for clean CI | HIGH |
| TECH_DEBT | Legacy JWT dependency/config/request fallback remains | Confusion and larger secret/config surface | Remove or document in separate auth refactor. | Non-blocking for clients | HIGH |
| NOT_REQUIRED | DIOT/IEPS/CFDI/credentials/storage tables | Not needed for basic client create | Keep out of first schema/migration. | Future slices | HIGH |

## K. Unresolved questions

Only repository-undecidable questions remain:

1. Does first release deliberately reuse `clients.view/manage` for LegalEntity, FiscalYear and Period lifecycle, or must separate permission keys be approved? This changes catalog, seed, MFA policy and tests.
2. Is `clients.manage` intentionally non-MFA while `clients.assign` is MFA-sensitive? Atomic create currently includes a responsible assignment, so the whole request would require MFA unless split.
3. Is a primary responsible mandatory at client creation, and may the actor assign themselves? Which membership states/roles are eligible?
4. Must an active RFC be unique across the entire organization even when archived historical duplicates exist? The target document suggests active tenant uniqueness; product must confirm reactivation conflict behavior.
5. Does a new fiscal year always create all 12 periods atomically, including for a non-calendar fiscal case, or is Balanz strictly calendar-month based?
6. Should the visual “Razón social” also become the initial `ClientAccount.name`, or must the UI collect a separate operating name? The current UI exposes only one name.
7. How should a multi-RFC account choose the active LegalEntity in overview/year routes? Current URLs and `DemoClient.rfc` assume one RFC.
8. Is client reactivation in first scope? There is no current UI, but lifecycle/uniqueness behavior depends on it.
9. Which deployed database and migration-history baseline is authoritative, and does it already have `uuid-ossp` plus clean data for the missing identity FKs? A safe deployment introspection is required before writing the migration.
