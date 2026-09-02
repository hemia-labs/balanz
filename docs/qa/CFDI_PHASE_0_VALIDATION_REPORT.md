# Reporte de validación CFDI — Fase 0

## 1. Resultado ejecutivo

```text
RESULT: PHASE_0_BLOCKED
PHASE_0: BLOCKED
PHASE_1_XML: NOT_STARTED
TECHNICAL_DEBT: 4
KNOWN_DEFECTS: 0
```

La plataforma fiscal compartida quedó implementada, compilada y validada con
PostgreSQL 16 real, filesystem real y escenarios reales de indisponibilidad de
Redis y ClamAV. Las migraciones append-only `060` y `061` quedaron aplicadas en
`accounting_dev`; los seeds se ejecutaron dos veces; el esquema post-migración
y el ciclo transaccional resultaron correctos.

No se usa `PHASE_0_DONE` porque cuatro controles obligatorios no pudieron
ejecutarse contra servicios levantados en este host:

1. wakeup con Redis real disponible;
2. adapter S3 contra MinIO/S3-compatible real;
3. ClamAV real con archivo limpio y fixture EICAR controlado;
4. arranque real de API y worker con LOGINs persistentes separados: Vault no
   contiene todavía el secreto de runtime requerido.

No hay un defecto de código conocido abierto. Los cuatro controles pendientes
se registran como deuda de validación y no se ocultan bajo una fase futura.

## 2. Rama, SHA y estado Git

| Campo           | Valor                                      |
| --------------- | ------------------------------------------ |
| Rama            | `codex/cfdis`                              |
| SHA base/actual | `a53de839eddf7febbbd611c63f514e611a3cf8b6` |
| Rama base       | `develop`                                  |
| Commits creados | ninguno                                    |
| Push            | no ejecutado                               |
| Fecha de corte  | 2026-08-28, `America/Mexico_City`          |

### Estado inicial preservado

La rama se creó conservando los cambios que ya estaban sobre `develop`:

```text
 M apps/web/src/components/status-badge.tsx
 M apps/web/src/features/clients/live-client-detail-screen.tsx
 M apps/web/src/features/clients/live-clients-screen.tsx
 M apps/web/src/features/clients/live-fiscal-screens.tsx
?? docs/architecture/CFDI_DOWNLOAD_INGESTION_CURRENT_STATE.md
?? docs/architecture/CFDI_DOWNLOAD_INGESTION_DECISION_INPUTS.md
?? docs/architecture/PROMPT_CODEX_ROADMAP_E_IMPLEMENTACION_CFDI_BALANZ_FASE_0_1.md
?? docs/architecture/control_mensual_cfdi (2).md
```

Esos archivos no se descartaron ni se sobrescribieron. Los cuatro componentes
web siguen siendo cambios previos del usuario y no forman parte de la
implementación funcional de Fase 0.

## 3. Alcance y frontera de fase

Implementado exclusivamente en Fase 0:

- plataforma durable compartida;
- persistencia fundacional;
- FORCE RLS y funciones mínimas;
- worker separado;
- Redis wakeup best-effort con polling PostgreSQL permanente;
- filesystem privado y S3/MinIO adapter;
- ClamAV `INSTREAM` y bypass sólo de desarrollo;
- reconciliación, health, métricas, logs y configuración;
- infraestructura reproducible y documentación.

Verificación negativa de alcance:

- no existe controller/endpoint de upload;
- no existe parser XML funcional;
- no existen tablas `cfdis`, conceptos, impuestos, relaciones, pagos o nómina;
- no existe reporte de Fase 1;
- no se implementó UI fiscal nueva para carga/lista/detalle;
- Fase 1 permanece `NOT_STARTED`.

## 4. Documentación creada y actualizada

### Roadmap maestro

- `docs/roadmaps/CFDI_P0_MASTER_IMPLEMENTATION_PLAN.md`

Registra Fases 0–8, dependencias, entradas, salidas, pruebas, riesgos,
rollback, entregables y estados. Fases 1–8 permanecen `NOT_STARTED`.

### ADR

- `docs/architecture/decisions/ADR-CFDI-001-DURABLE-JOBS.md`
- `docs/architecture/decisions/ADR-CFDI-002-OBJECT-STORAGE.md`
- `docs/architecture/decisions/ADR-CFDI-003-RLS.md`
- `docs/architecture/decisions/ADR-CFDI-004-IDEMPOTENCY-PROVENANCE.md`
- `docs/architecture/decisions/ADR-CFDI-005-XML-PARSER.md`

El ADR del parser fija la frontera segura futura sin implementar Fase 1.

### Seguridad, contratos y operación

- `docs/security/CFDI_INGESTION_THREAT_MODEL.md`
- `docs/security/CFDI_INGESTION_PERMISSION_MATRIX.md`
- `docs/contracts/CFDI_INGESTION_API.md`
- `docs/contracts/CFDI_INGESTION_ERROR_CATALOG.md`
- `docs/operations/CFDI_WORKER_RUNBOOK.md`
- `docs/operations/CFDI_INGESTION_CONFIGURATION_MATRIX.md`

### Documentación integrada

- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/CORRECTED_POSTGRESQL_DATA_MODEL.md`
- `apps/api/README.md`
- `apps/web/README.md`
- `infra/cfdi-phase0/README.md`

El modelo ejecutable está alineado con migraciones `060`/`061`, incluye
`ingestion_uploads` y marca como `FUTURE / NOT_STARTED` todo dominio posterior.

## 5. Arquitectura implementada

### Procesos

- API NestJS con perfil de configuración `api`.
- Worker NestJS separado con perfil `worker` y entrypoint real
  `apps/api/src/worker.ts`.
- Scripts `start:api:*` y `start:worker:*`.
- PostgreSQL como única autoridad durable.
- Redis sólo acelera el despertar después del commit.

Los perfiles fallan rápido si reciben credenciales del otro proceso. El worker
no carga secretos JWT/MFA/email/cookies ni la credencial API; la API no carga
la credencial worker.

### Módulos fundacionales

- `fiscal-platform` compone infraestructura compartida;
- `ingestion` contiene repositorios, estados y worker durable;
- `object-storage` contiene port, key factory y adapters local/S3;
- `malware-scanner` contiene port, ClamAV y bypass de desarrollo;
- `health` y `observability` exponen probes, métricas y logs estructurados;
- `database/rls` aplica rol y GUC únicamente dentro de transacciones.

No se registró un handler ficticio en producción. Los handlers de prueba viven
únicamente en el entorno de test.

## 6. Persistencia y migraciones

### Migraciones append-only

| Timestamp       | Migración                   | Resultado en `accounting_dev` |
| --------------- | --------------------------- | ----------------------------- |
| `1787690600000` | `FiscalIngestionFoundation` | ejecutada                     |
| `1787690610000` | `FiscalRlsWorkerClaims`     | ejecutada                     |

El preflight anterior a migrar confirmó:

- PostgreSQL `16.11` (`server_version_num=160011`);
- base `accounting_dev` y migrator `admin` de desarrollo;
- `uuid-ossp` y candidate keys requeridas;
- cero `legal_entities` huérfanas respecto de tenant/cuenta;
- cero colisiones de timestamp fiscal;
- ausencia previa de las cuatro tablas fundacionales;
- autoridad suficiente para owner roles, FORCE RLS y funciones.

`pg_dump` no estaba instalado (`PG_DUMP_NOT_FOUND`), por lo que no fue posible
crear un schema-only dump local. Se capturaron en su lugar el historial,
preflight y catálogo read-only antes de aplicar cambios. No se ejecutó
`DROP DATABASE`, `TRUNCATE`, `migration:revert` ni `synchronize=true` sobre
desarrollo.

### Esquema inspeccionado

Se verificaron en PostgreSQL real:

- cuatro tablas: `stored_objects`, `ingestion_uploads`, `ingestion_jobs`,
  `ingestion_items`;
- cuatro tablas con `ENABLE ROW LEVEL SECURITY` y
  `FORCE ROW LEVEL SECURITY`;
- nueve políticas;
- columnas durables de lease, heartbeat, retry, cancelación, error,
  correlación, procedencia, timestamps y versión;
- FKs compuestas completas;
- checks, uniques e índices fundacionales;
- índices de claim, cancelación, reconciliación y dirty items usados por
  `EXPLAIN`;
- trigger de inmutabilidad de objetos;
- trigger de dirty counters;
- funciones de claim, queue age, cancelación y reconciliación;
- cero drift TypeORM (`upQueries=0`, `downQueries=0`).

### Historial externo preexistente

`accounting_dev` contiene dos migraciones ejecutadas que no pertenecen al
working tree actual:

- `PasswordResetTokens1787690300000`;
- `AuthDataCleanupIndexes1787690500000`.

`migration:show` las reporta como `unknownExecuted`. No colisionan con `060` ni
`061` y el preflight fue verde. Es una divergencia preexistente del ambiente,
registrada como riesgo; no se inventaron archivos vacíos ni se modificó su
historial para ocultarla.

## 7. Seeds

Los seeds se ejecutaron dos veces en la base aislada y dos veces en
`accounting_dev`. Ambas corridas terminaron con commit.

La comprobación transaccional obtuvo en las dos pasadas:

| Conteo                 | Primera | Segunda |
| ---------------------- | ------: | ------: |
| Roles                  |       4 |       4 |
| Roles distintos        |       4 |       4 |
| Permisos               |      38 |      38 |
| Permisos distintos     |      38 |      38 |
| Relaciones rol/permiso |      86 |      86 |

Resultado: idempotencia demostrada.

## 8. RLS, roles y función cross-tenant

Se validó con PostgreSQL real:

- tenant A ve sólo tenant A;
- tenant B no ve tenant A;
- GUC ausente devuelve cero filas;
- GUC inválida falla con SQLSTATE `22P02`;
- membresía inexistente, cross-tenant o inactiva falla cerrado;
- table owner no atraviesa `FORCE RLS`;
- API y worker operan con roles `NOBYPASSRLS`;
- LOGINs QA `NOINHERIT` sólo pueden `SET LOCAL ROLE` al grupo esperado;
- ACL directa de columna para API es rechazada por el runtime guard;
- ACL directa de función para worker es rechazada;
- owner roles no son alcanzables ni conservan `CREATE` sobre `public`;
- FKs cross-scope fallan con SQLSTATE `23503`.

El claim cross-tenant es `SECURITY DEFINER`, tiene `search_path` fijo, parámetros
operativos bloqueados, scope de retorno mínimo, claim atómico con
`FOR UPDATE SKIP LOCKED`, lease token y worker ID. El worker no obtiene lectura
fiscal arbitraria.

## 9. Worker durable

Validado en PostgreSQL real con dos conexiones:

- un solo ganador entre dos workers concurrentes;
- lease de 90 segundos;
- heartbeat y auditoría;
- pérdida del lease después de estado terminal;
- protección ABA mediante lease token;
- recuperación de lease vencido;
- fairness entre dos tenants;
- cancelación durable;
- máximo de tres ejecuciones;
- backoff 10/30 con jitter dentro del límite de tres ejecuciones; la lista
  configurada conserva `10,30,120` sin autorizar un cuarto claim;
- shutdown real libera el lease y deja el job `queued` o terminal según el
  presupuesto;
- stale handler no puede publicar resultado;
- polling completa un job con Redis apagado.

El límite de concurrencia está configurado y probado en el runner. El registry
productivo no contiene job ficticio.

## 10. Redis wakeup

Implementado:

- publicación best-effort sólo después de commit;
- canal con prefijo de ambiente;
- mensaje constante sin payload fiscal ni secretos;
- subscriber del worker;
- polling PostgreSQL siempre activo;
- sin `KEYS`;
- Redis degradado no falla readiness;
- lifecycle y shutdown acotados.

Evidencia ejecutada con Redis totalmente apagado:

- publicación devuelve `false` sin perder autoridad durable;
- métrica `redis_wakeup_failures_total` presente;
- publisher/subscriber permanecen no-ready;
- el worker completa el job mediante polling;
- dos pruebas externas offline pasan y una prueba online queda omitida por
  bloqueo de infraestructura.

Pendiente obligatorio: demostrar latencia de wakeup con Redis real arriba.

## 11. Object storage

### Adapter local

Implementado y probado contra filesystem real privado:

- root fuera de `public`;
- key opaca generada por UUID técnico;
- rechazo de traversal, rutas absolutas, backslash y symlink/reparse unsafe;
- stream de escritura/lectura;
- hash SHA-256 y tamaño;
- conflicto de key inmutable;
- permisos POSIX/Windows fail-closed;
- cleanup al finalizar.

La prueba externa real pasó y dejó únicamente el marcador de root
`.balanz-fiscal-object-storage-root-v1`; no quedaron objetos sintéticos.

### Adapter S3/MinIO

Implementado:

- `S3ObjectStorageAdapter` productivo, sin `TODO`;
- bucket privado y sin ACL pública;
- SSE-S3/SSE-KMS según configuración;
- URL firmada de TTL corto;
- streaming/multipart, hash/tamaño, timeout y cleanup;
- rechazo atómico de carreras sobre key inmutable;
- fail-fast productivo por bucket/KMS/HTTPS/config faltante.

El contrato unitario del adapter pasa. La prueba externa contra MinIO real no
pudo ejecutarse porque no hay runtime ni servicio disponible en el host.

## 12. Malware scanner

Implementado:

- `MalwareScannerPort`;
- `ClamAvScannerAdapter` mediante protocolo `INSTREAM`;
- framing/chunks, límite de bytes, timeout y health;
- errores tipados y política fail-closed;
- bypass sólo con configuración explícita en desarrollo;
- producción rechaza scanner deshabilitado;
- no construye comandos shell.

Pruebas ejecutadas:

- protocolo `INSTREAM`, respuesta clean/infected/error/timeout mediante servidor
  controlado del test;
- scanner totalmente inaccesible: health `down` y scan rechaza con
  `MALWARE_SCANNER_UNAVAILABLE`;
- configuración productiva fail-fast.

Pendiente obligatorio: clean y EICAR contra un daemon ClamAV real arriba.

## 13. Reconciliadores y lifecycle

La función idempotente de reconciliación verificó:

- uploads expirados;
- objetos huérfanos;
- objetos confirmados sin job;
- jobs con root/upload no disponible;
- lease vencido retryable/final/cancelado;
- reparación acotada de counters;
- bytes redundantes;
- elegibilidad de retención;
- auditoría de transiciones.

La segunda pasada devolvió cero cambios en todas las categorías. La función
procesa lotes acotados de 100 y usa índices confirmados con `EXPLAIN`.

## 14. Health, readiness, observabilidad y métricas

Implementado:

- liveness/readiness HTTP de API;
- liveness/readiness HTTP del worker;
- PostgreSQL, storage y scanner como dependencias requeridas;
- Redis como estado degradado no bloqueante;
- métricas de jobs, queue age, leases, recovery, storage, scanner y wakeup;
- correlation ID propagado;
- logs estructurados con job/object/stage/duración/resultado;
- redacción de datos y allowlist de labels;
- sin RFC, UUID fiscal, nombre, razón social o PII como labels.

Las suites `fiscal-health-http`, `fiscal-readiness` y
`fiscal-observability` pasan. El arranque HTTP contra LOGINs persistentes reales
queda bloqueado por el secreto Vault ausente; el guard y las operaciones de
repositorio sí se validaron con LOGINs efímeros reales en la base aislada.

## 15. Configuración

Se agregó validación para storage, S3/MinIO, scanner, worker, lease, heartbeat,
retries, backoff, polling, Redis wakeup, concurrencia, retención, límites, RLS,
métricas y health.

Controles relevantes:

- filesystem y scanner bypass rechazados en producción;
- producción exige S3, HTTPS y SSE-KMS;
- producción exige ClamAV;
- secretos productivos exigen `SECRETS_ENVIRONMENT=prod`;
- API y worker usan perfiles mutuamente excluyentes;
- lease 90, heartbeat 20, máximo 3 y backoff `10,30,120` están bloqueados;
- `.env.example`, `.env.api.example` y `.env.worker.example` no contienen
  secretos.

## 16. Infraestructura reproducible

Se creó `infra/cfdi-phase0` con:

- Docker Compose para PostgreSQL, Redis, MinIO y ClamAV;
- imágenes versionadas;
- healthchecks;
- bucket/policy privados;
- extensión PostgreSQL;
- `.env.example` sin secretos;
- script PowerShell para preparar y verificar el root local privado;
- README de operación y cleanup.

Evidencia del host:

```text
docker=NOT_FOUND
podman=NOT_FOUND
nerdctl=NOT_FOUND
wsl --status => WSL no está instalado
redis-server=NOT_FOUND
redis-cli=NOT_FOUND
minio=NOT_FOUND
mc=NOT_FOUND
clamd=NOT_FOUND
clamscan=NOT_FOUND
127.0.0.1:56379=False
127.0.0.1:59000=False
127.0.0.1:53310=False
127.0.0.1:55432=False
```

No se instaló WSL ni un runtime de contenedores porque sería aprovisionamiento
externo del host. No se simuló que los servicios estaban disponibles.

## 17. Matriz de pruebas ejecutada

| Prueba                                         | Resultado                            |
| ---------------------------------------------- | ------------------------------------ |
| API Jest completa                              | PASS — 41 suites, 286 tests          |
| API ESLint sin autocorrección                  | PASS — 0 errores, 0 warnings         |
| API TypeScript `--noEmit`                      | PASS                                 |
| API build                                      | PASS                                 |
| Web ESLint                                     | PASS                                 |
| Web typecheck                                  | PASS                                 |
| Web tests                                      | PASS — 49/49                         |
| Web build Next 16.3.3                          | PASS                                 |
| `npm audit --audit-level=moderate`             | PASS — 0 vulnerabilidades            |
| `git diff --check`                             | PASS                                 |
| Preflight PostgreSQL aislado                   | PASS                                 |
| Migraciones en base aislada                    | PASS                                 |
| Seeds dobles aislados                          | PASS                                 |
| Down/up 060/061 bajo savepoint                 | PASS                                 |
| Validación PostgreSQL transaccional            | PASS                                 |
| Validación PostgreSQL runtime multi-conexión   | PASS                                 |
| Pipeline aislado repetido de extremo a extremo | PASS                                 |
| Migraciones 060/061 en `accounting_dev`        | PASS                                 |
| Seeds dobles en `accounting_dev`               | PASS                                 |
| Postflight/schema/drift en `accounting_dev`    | PASS                                 |
| Storage local real                             | PASS — 1/1 y cleanup                 |
| Redis totalmente apagado                       | PASS — 2/2 seleccionadas             |
| Redis real arriba                              | BLOCKED — servicio/runtimes ausentes |
| ClamAV totalmente apagado                      | PASS — 1/1 seleccionada              |
| ClamAV real clean/EICAR                        | BLOCKED — servicio/runtimes ausentes |
| MinIO/S3 real                                  | BLOCKED — servicio/runtimes ausentes |
| Provisión LOGINs runtime persistentes          | BLOCKED — `Vault secret not found`   |

## 18. Defectos encontrados y corregidos

Todos los siguientes hallazgos quedaron corregidos y cubiertos por regresión:

1. colisión preventiva con una migración externa `050`: las migraciones CFDI se
   fijaron en `060`/`061`;
2. guard de base insuficientemente estricto: ahora rechaza `INHERIT`, membresías
   indebidas, ACL directa fiscal, ownership, roles privilegiados alcanzables y
   `CREATE` sobre base/schema;
3. perfiles API/worker compartían demasiado entorno: se separaron contratos y
   secretos de arranque;
4. `aclexplode` recibía un array ACL vacío de cero dimensiones en PostgreSQL:
   se usa `NULL` strict y no un array artificial;
5. una colección `name[]` del catálogo no tenía contrato estable en el driver:
   se sustituyó por conteo entero;
6. parámetros preparados reutilizaban UUID como `text`: se fijó cast
   `uuid::text`;
7. `SELECT ... FOR UPDATE` sobre replay de job pedía privilegio `UPDATE` al API:
   se eliminó el lock redundante y se conservó el advisory lock transaccional;
8. TypeORM devuelve `[rows, rowCount]` para `UPDATE ... RETURNING`: se normalizó
   el resultado antes de evaluar/usar filas;
9. el parámetro de estado del job se deducía como tipos incompatibles: se fijó
   `varchar` explícito;
10. cleanup del test Redis intentaba destruir un cliente ya cerrado: ahora es
    idempotente;
11. el árbol web contenía una versión de Next con advisories: se actualizó Next
    y `eslint-config-next` a `16.3.3`; el audit final reporta cero;
12. catálogo/runbook/modelo conservaban nombres o estados anteriores: quedaron
    alineados con código y migraciones `060`/`061`.

`KNOWN_DEFECTS: 0` significa que no quedó ningún fallo reproducible abierto;
no convierte en PASS los cuatro controles externos pendientes.

## 19. Riesgos restantes y deuda técnica

| ID        | Tipo                  | Estado     | Acción necesaria                                                              |
| --------- | --------------------- | ---------- | ----------------------------------------------------------------------------- |
| TD-001    | control obligatorio   | OPEN       | levantar Redis real y ejecutar wakeup online                                  |
| TD-002    | control obligatorio   | OPEN       | levantar MinIO privado y ejecutar roundtrip/SSE/signed URL/race               |
| TD-003    | control obligatorio   | OPEN       | levantar ClamAV real y ejecutar clean/EICAR                                   |
| TD-004    | control obligatorio   | OPEN       | aprovisionar secretos Vault API/worker, crear LOGINs y ejecutar probes reales |
| R-EXT-001 | ambiente preexistente | OPEN       | reconciliar las migraciones `030`/`050` con su rama/autorización de origen    |
| R-EXT-002 | herramienta host      | DOCUMENTED | instalar `pg_dump` para próximos respaldos schema-only                        |

Los TD-001 a TD-004 son el motivo exacto de `PHASE_0_BLOCKED`. No requieren
cambiar el diseño ni implementar Fase 1; requieren disponibilidad/aprovisionado
externo y repetir las suites ya preparadas.

## 20. Archivos modificados

### Cambios previos preservados

- `apps/web/src/components/status-badge.tsx`
- `apps/web/src/features/clients/live-client-detail-screen.tsx`
- `apps/web/src/features/clients/live-clients-screen.tsx`
- `apps/web/src/features/clients/live-fiscal-screens.tsx`
- `docs/architecture/CFDI_DOWNLOAD_INGESTION_CURRENT_STATE.md`
- `docs/architecture/CFDI_DOWNLOAD_INGESTION_DECISION_INPUTS.md`
- `docs/architecture/PROMPT_CODEX_ROADMAP_E_IMPLEMENTACION_CFDI_BALANZ_FASE_0_1.md`
- `docs/architecture/control_mensual_cfdi (2).md`

### Configuración, paquetes y entrypoints

- `.gitignore`
- `package.json`
- `package-lock.json`
- `bun.lock`
- `apps/api/package.json`
- `apps/api/.env.example`
- `apps/api/.env.api.example`
- `apps/api/.env.worker.example`
- `apps/api/src/app.module.ts`
- `apps/api/src/main.ts`
- `apps/api/src/worker.ts`
- `apps/api/src/worker.module.ts`
- `apps/api/src/config/database.config.ts`
- `apps/api/src/config/env.validation.ts`
- `apps/api/src/config/fiscal-platform.config.ts`
- `apps/api/src/config/platform-config.module.ts`
- `apps/api/src/config/secrets.config.ts`
- `apps/api/src/modules/secrets/secrets.module.ts`
- `apps/web/package.json`

### Persistencia, seguridad y scripts

- `apps/api/src/database/database-options.factory.ts`
- `apps/api/src/database/database.module.ts`
- `apps/api/src/database/migrations/1787690600000-FiscalIngestionFoundation.ts`
- `apps/api/src/database/migrations/1787690610000-FiscalRlsWorkerClaims.ts`
- `apps/api/src/database/rls/fiscal-tenant-transaction.service.ts`
- `apps/api/src/database/runtime-database-guard.service.ts`
- `apps/api/src/database/scripts/preflight-fiscal-foundation.ts`
- `apps/api/src/database/scripts/prepare-fiscal-test-database.ts`
- `apps/api/src/database/scripts/provision-fiscal-runtime-logins.ts`
- `apps/api/src/database/scripts/run-migrations.ts`
- `apps/api/src/database/scripts/script-database-options.ts`
- `apps/api/src/database/scripts/show-migrations.ts`
- `apps/api/src/database/seeds/run-seeds.ts`
- `apps/api/src/common/auth/permission-catalog.ts`
- `apps/api/src/common/correlation/correlation-id.service.ts`

### Plataforma fiscal

- `apps/api/src/common/observability/*`
- `apps/api/src/modules/fiscal-platform/*`
- `apps/api/src/modules/health/*`
- `apps/api/src/modules/ingestion/*`
- `apps/api/src/modules/malware-scanner/*`
- `apps/api/src/modules/object-storage/*`
- `apps/api/src/modules/redis/redis-client-shutdown.ts`
- `apps/api/src/modules/redis/redis-wakeup.service.ts`
- `apps/api/src/modules/redis/redis.module.ts`

### Pruebas

- `apps/api/test/clamav-scanner.protocol.spec.ts`
- `apps/api/test/development-bypass-scanner.spec.ts`
- `apps/api/test/external/*`
- `apps/api/test/fiscal-health-http.spec.ts`
- `apps/api/test/fiscal-observability.spec.ts`
- `apps/api/test/fiscal-platform-config.spec.ts`
- `apps/api/test/fiscal-readiness.spec.ts`
- `apps/api/test/ingestion-worker-runner.spec.ts`
- `apps/api/test/instrumented-object-storage.spec.ts`
- `apps/api/test/local-filesystem-object-storage.spec.ts`
- `apps/api/test/opaque-object-key.factory.spec.ts`
- `apps/api/test/redis-wakeup.spec.ts`
- `apps/api/test/runtime-config-profiles.spec.ts`
- `apps/api/test/runtime-database-guard.spec.ts`
- `apps/api/test/s3-object-storage.contract.spec.ts`
- `apps/api/test/validate-fiscal-foundation-runtime.ts`
- `apps/api/test/validate-fiscal-foundation-transaction.ts`
- `apps/api/test/validate-migration-lifecycle.ts`
- ajustes de compatibilidad en tests existentes de configuración.

### Documentación e infraestructura

- todos los documentos enumerados en la sección 4;
- `infra/cfdi-phase0/.env.example`
- `infra/cfdi-phase0/compose.yaml`
- `infra/cfdi-phase0/minio/Dockerfile`
- `infra/cfdi-phase0/minio/app-policy.json`
- `infra/cfdi-phase0/postgres/001-extensions.sql`
- `infra/cfdi-phase0/prepare-local-storage.ps1`
- `docs/qa/CFDI_PHASE_0_VALIDATION_REPORT.md`

## 21. Comandos principales ejecutados

```text
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check

npm install --ignore-scripts
bun install --lockfile-only --ignore-scripts
bun install --ignore-scripts
npm audit --audit-level=moderate

bunx eslint "{src,apps,libs,test}/**/*.ts"
bunx tsc --noEmit
bun run build
node.exe node_modules/jest/bin/jest.js --runInBand

bun run lint                    # web
bun run typecheck               # web
bun run test                    # web
bun run build                   # web

bun run migration:show
bun run migration:preflight
bun run db:test:prepare
bun run qa:cfdi:postgres        # base balanz_cfdi_phase0_test
bun run migration:run           # accounting_dev
bun run seed:run                # primera vez en accounting_dev
bun run seed:run                # segunda vez en accounting_dev
bun run qa:migrations           # transacción con rollback en accounting_dev
bun run db:runtime:provision    # bloqueado: Vault secret not found

jest local-storage.external.ts
jest redis-wakeup.external.ts --testNamePattern offline
jest malware-scanner.clamav.external.ts --testNamePattern "fails closed"

wsl --status
Get-Command docker,podman,nerdctl,redis-server,minio,clamd,pg_dump
pruebas TCP a 56379, 59000, 53310 y 55432
```

También se ejecutaron corridas focales durante la corrección de cada defecto;
las cifras de la sección 17 corresponden a los gates finales.

## 22. Estado final

```text
RESULT: PHASE_0_BLOCKED
TECHNICAL_DEBT: 4
KNOWN_DEFECTS: 0
DEFERRED_PRODUCT_CAPABILITIES:
  - PHASE_1_XML
  - PHASE_2_ZIP
  - PHASE_3_REAUTH_AND_EFIRMA
  - PHASE_4_SAT_ON_DEMAND
  - PHASE_5_MONTHLY_WORKSPACE
  - PHASE_6_EXPORT_AND_RETENTION
  - PHASE_7_GLOBAL_OPERATIONS
  - PHASE_8_HARDENING_AND_PILOT
```

Se detiene el trabajo antes de Fase 1. Para reabrir el gate de Fase 0 se debe
proveer el secreto Vault de runtime y un ambiente accesible con Redis, MinIO y
ClamAV; después se ejecutan las suites externas ya incluidas y los probes reales
de API/worker. No hace falta implementar carga XML para resolver estos bloqueos.
