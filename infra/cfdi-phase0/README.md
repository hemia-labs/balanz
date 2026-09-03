# CFDI Phase 0 development infrastructure

This Compose project creates an isolated integration environment for the fiscal
ingestion foundation. It does not reuse, replace, truncate, or delete the
configured `accounting_dev` database.

## Start

1. Copy `.env.example` to `.env` in this directory and replace all example
   passwords. Keep the MinIO root and application passwords distinct. Replace
   the `MINIO_KMS_SECRET_KEY` placeholder with `balanz-phase0:` followed by a
   base64-encoded, cryptographically random 32-byte development key.
2. Run `docker compose --env-file infra/cfdi-phase0/.env -f
infra/cfdi-phase0/compose.yaml up -d --wait postgres redis minio clamav`
from the repository root, followed by the one-shot `minio-bootstrap` service.
Vault and the real API/worker entrypoints belong to the
`phase0-validation` profile and are configured automatically by the validator;
do not point that profile at a shared Vault.
3. Point the Phase 0 integration test process at:

   - PostgreSQL: `127.0.0.1:55432/balanz_cfdi_phase0_test`
   - Redis: `127.0.0.1:56379`
   - MinIO S3 API: `http://127.0.0.1:59000`
   - ClamAV INSTREAM: `127.0.0.1:53310`

All published ports bind to loopback. The MinIO bootstrap creates a private
bucket, explicitly disables anonymous access, and provisions the non-root
`MINIO_APP_USER` with a bucket-scoped policy. S3 integration tests must use
`MINIO_APP_USER`/`MINIO_APP_PASSWORD` as `S3_ACCESS_KEY_ID`/
`S3_SECRET_ACCESS_KEY`; root credentials are bootstrap-only. Credentials in
the example file are placeholders and must never be reused outside this
isolated test environment. This MinIO validation uses `S3_SSE_MODE=AES256`
and asserts the persisted object's `ServerSideEncryption` metadata with a
real `HeadObject` request. MinIO needs a KMS even for SSE-S3, so this isolated
environment uses its development-only static KMS secret; production must use
the external managed KMS selected in ADR-CFDI-002. MinIO documents this
development mechanism in its
[KMS guide](https://github.com/minio/minio/blob/master/docs/kms/README.md).

On the first initialization of the isolated PostgreSQL volume, the versioned
`postgres/001-extensions.sql` enables `uuid-ossp`, which the repository's
existing baseline migration requires. It is not executed against an existing
development database. The read-only migration preflight must confirm that
`uuid-ossp` is already present there before `migration:run`.

The MinIO server image is compiled from upstream security release
`RELEASE.2025-10-15T17-29-55Z` and verifies its full published commit
`9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`. Both build/runtime base images
are pinned by multi-platform manifest digest. It intentionally does not use
the older archived pre-built image.
The first build therefore needs network access to fetch the exact source tag
and checksum-verified Go modules.

Infrastructure versions are pinned to patched releases available at the Phase
0 validation date: PostgreSQL `16.15`, Redis `7.4.10`, ClamAV `1.5.4`, Vault
`1.20.4`, and Node.js `22.22.0`. Registry images use immutable manifest
digests; the MinIO source build additionally pins and verifies its upstream
commit.
ClamAV 1.4.3 is intentionally excluded because fixes published in the 1.4.5/
1.5.3 line cover malformed-file memory-safety and extraction-limit issues.
Review these pins again before every later pilot or production-like exercise.
The Compose healthcheck sends a framed `zPING` over TCP port 3310, the same
listener used between containers; a healthy local Unix socket alone is not
accepted. Persistent manual development keeps FreshClam enabled by default.
Only the disposable validator sets `CLAMAV_NO_FRESHCLAMD=true`: its new volume
is populated by the image's initial signature download, while disabling
the background updater removes external-network/reload timing from that finite
test. This test setting is not a production or long-running-development update
policy.

## Windows local adapter

Node's POSIX-style `chmod` cannot prove a private NTFS DACL. Before selecting
the local adapter on Windows, prepare an empty dedicated root with:

```powershell
powershell -NoProfile -File infra/cfdi-phase0/prepare-local-storage.ps1
```

The script refuses paths outside this workspace, `public`, reparse points and
non-empty roots. It replaces inheritance with two inheritable full-control
rules only: the current SID and LocalSystem, creates/verifies the versioned
private-root marker, then verifies the result. Relative app configuration is
resolved against this same repository root rather than `process.cwd()`. Set
`OBJECT_STORAGE_LOCAL_WINDOWS_PRESECURED=true` only after that command passes.
Run it under the same operating-system identity that will run the API/worker.
Production never accepts this attestation and must use S3/KMS.

## Validation commands

For the complete, repeatable validation, run this from the repository root
after installing dependencies from the lockfile:

```powershell
powershell -NoProfile -File infra/cfdi-phase0/validate-phase0-local.ps1
```

The validator runs the API/web lint, typecheck, general tests, and builds before
integration work. It allocates loopback-only ports, generates every credential
in process memory, starts a uniquely named Compose project, waits for health,
and prepares a private filesystem root. It provisions an ephemeral TLS Vault
with versioned KV v2 data, separate minimal API/worker AppRoles, dedicated
PostgreSQL runtime LOGINs, and a synthetic Redis secret. It never reads the
developer Vault or a shared Redis instance.

The same run executes the append-only migration preflight/run,
`qa:cfdi:postgres`, and `test:external:fiscal`; starts the compiled
`dist/main.js` and `dist/worker.js` entrypoints with separate environment
profiles; verifies liveness, readiness, Vault policy denial, environment
routing, unique isolated-network addresses and aliases, framed ClamAV TCP from
both runtime containers, and secret-free logs. A real API smoke signs in a synthetic user,
selects a tenant, exercises authorization and RLS isolation, and signs out. A
separate worker smoke proves the running supervisor uses its dedicated
`LOGIN NOINHERIT` principal with a single `INHERIT FALSE` membership, selects
only `balanz_worker` at connection startup, and executes the
read-only durable queue function without inventing a Phase 0 production
handler. The same entrypoints load separate `.env.api`/`.env.worker` files
natively through `PlatformConfigModule`; validation files contain only
non-sensitive routing markers and observable profile settings, while every
disposable credential remains process-only. The validator then
sends SIGTERM and requires a clean bounded shutdown without restart. Nest may
finish its shutdown hooks and then re-emit SIGTERM, so Docker exit `143` is
accepted alongside `0`; timeout/SIGKILL exit `137` and every other exit remain
failures. It removes
only those stopped disposable runtime containers, stops Redis completely, and
cold-starts fresh API/worker containers without Redis as a dependency gate.
Redis uses a dedicated Compose wakeup network while PostgreSQL, storage,
scanner, and Vault remain on the dependency network; API/worker attach to both.
This prevents a stopped Redis endpoint address from being recycled as a
required-dependency address during the same cold-start test. The validator
checks the exact per-service topology, unique addresses within each network,
case-sensitive DNS aliases, and a framed ClamAV PONG from both runtimes.
Both stay live with degraded readiness, while the worker supervisor continues
its PostgreSQL polling/reconciliation activity. The validator then restarts
Redis without restarting either runtime, requires API publisher and worker
publisher/subscriber readiness to return to `up`, and delivers a second real
constant-payload wakeup whose worker metric must advance. It stops Redis once
more before a second SIGTERM so shutdown is also proven while the optional
accelerator is unavailable. All migrator/API/worker database credentials are distinct.
The final JSON summary contains status only, never credential values, and is
written under `.local/cfdi-phase0-validation-reports/` for CI artifact
collection.

Before cleanup, the script verifies the exact Compose project label, service or
volume label, project-name namespace, Compose file, and project directory. Its
`finally` block removes only that project and, by default, its disposable named
volumes; it never invokes prune or a global delete. Pass `-PreserveEvidence`
explicitly to retain named volumes and the isolated storage/Vault directories
after a failure. The script rejects storage/report roots that escape their fixed
workspace locations or traverse a symlink, junction, or reparse point, using
case-insensitive comparisons only on Windows. On Windows it delegates the NTFS
storage ACL setup and verification to `prepare-local-storage.ps1`; CI uses the
equivalent private POSIX mode.

The lower-level commands below remain useful when diagnosing one stage or when
validating a pre-existing development service explicitly.

From `apps/api`, keep the Vault/configured development connection but redirect
only these guarded QA scripts to the isolated test database. The preparation
step creates it only when absent and never drops it:

```powershell
$env:CFDI_PHASE0_TEST_DATABASE='balanz_cfdi_phase0_test'
npm run db:test:prepare
$env:CFDI_PHASE0_USE_TEST_DATABASE='true'
$env:QA_ALLOW_TRANSACTIONAL_MIGRATION_DOWN_UP='true'
$env:QA_ALLOW_FISCAL_RUNTIME_VALIDATION='true'
$env:RUN_REDIS_INTEGRATION='true'
$env:REDIS_URL='redis://127.0.0.1:56379'
npm run qa:cfdi:postgres
```

`qa:cfdi:postgres` runs, in order: read-only `migration:show`, read-only
preflight, append-only `migration:run`, `seed:run` twice, transactional
migration QA, schema/FK/RLS validation, and the real multi-connection runtime
validator. On a fresh database, `migration:show` and preflight do not create the
migration log; every migration remains pending until the explicit run.
With `RUN_REDIS_INTEGRATION=true`, that same runtime validator also starts a
real subscriber, sets the PostgreSQL polling interval to 30 seconds, commits a
synthetic job through the production repository, and proves Redis wakes the
worker well before the fallback poll. The Redis URL is never included in its
JSON report.

To start the API/worker themselves after migrations, provision their dedicated
development LOGINs without putting credentials in migrations or output:

```powershell
$env:CFDI_PROVISION_RUNTIME_LOGINS='true'
npm run db:runtime:provision
Remove-Item Env:CFDI_PROVISION_RUNTIME_LOGINS
```

The script reads the same Vault runtime paths as the application (or the four
`DB_API_*`/`DB_WORKER_*` variables when Vault is disabled), validates exclusive
least-privilege memberships, and runs the production database guard for both
connections.

The real adapter suite is deliberately opt-in:

```powershell
npm run test:external:fiscal
```

Before the latter command, set `RUN_LOCAL_STORAGE_INTEGRATION=true`,
`OBJECT_STORAGE_LOCAL_ROOT`, `RUN_MINIO_INTEGRATION=true`,
`RUN_CLAMAV_INTEGRATION=true`, `RUN_REDIS_INTEGRATION=true`, and the endpoint
variables consumed by the test files: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SSE_MODE`, `S3_ALLOW_INSECURE`,
`S3_FORCE_PATH_STYLE`, `CLAMAV_HOST`, `CLAMAV_PORT`, and `REDIS_URL`. Use only
the disposable credentials from the local `.env`; never paste production
secrets into shell history or reports. Every generated object is deleted in a
`finally` block.

## Redis-down validation

Stop only Redis with `docker compose --env-file infra/cfdi-phase0/.env -f
infra/cfdi-phase0/compose.yaml stop redis`. Keep PostgreSQL and the worker
running and verify that polling still claims the synthetic test job. Start
Redis again before the wakeup-latency scenario.

## Scanner-down validation

Stop only ClamAV with `docker compose --env-file infra/cfdi-phase0/.env -f
infra/cfdi-phase0/compose.yaml stop clamav`. The integration test must observe a
retryable scanner-unavailable result and must never treat the object as clean.

## Cleanup

The full validator removes its uniquely labelled disposable volumes by default.
Use `-PreserveEvidence` when they are needed for diagnosis. Manual development
commands continue to use `docker compose ... down` without `--volumes`; remove
manual volumes only after resolving the exact Compose project and confirming
that no development data is in scope.

These manifests are development/test infrastructure, not a production
deployment definition. Production S3 requires KMS-backed encryption and a
private bucket policy that enforces conditional writes (`If-None-Match`); the
local MinIO scenario validates S3 compatibility, privacy, immutable-key races,
and SSE headers, not a managed KMS service.
