# Reporte de validación CFDI — Fase 0

Las evidencias `Full` y de infraestructura de las secciones 1–21 corresponden
al cierre del 3 de septiembre de 2026 y a los SHAs allí indicados. El seguimiento
de revisión del 4 de septiembre, sus cambios y sus límites de validación se
registran por separado en la sección 22; no renueva aquella evidencia `Full`.

## 1. Resultado ejecutivo

La plataforma fiscal compartida de Fase 0 quedó implementada y validada con
PostgreSQL, Redis, MinIO, ClamAV, Vault, API y worker reales en infraestructura
aislada. También se comprobó el Redis compartido de desarrollo recuperando su
configuración desde Vault, sin exponer ni versionar secretos. Las migraciones
append-only `060`, `061`, `062` y `063` están aplicadas e inspeccionadas en
`accounting_dev`; los seeds se ejecutaron dos veces y las migraciones `030` y
`050` quedaron reconciliadas al integrar la base vigente de `origin/develop`.

El resultado permanece `PHASE_0_BLOCKED` por un único control externo,
`TD-004`: los paths canónicos `database/postgres-api` y
`database/postgres-worker` no existen en el Vault compartido de desarrollo y
el AppRole disponible responde `ACCESS_DENIED` al intentar escribirlos. Por
ello no se pueden crear ni validar los LOGINs persistentes de API y worker
contra la base compartida. Los mismos perfiles, políticas Vault, LOGINs
`NOINHERIT`/`NOBYPASSRLS`, RLS y entrypoints sí fueron validados de extremo a
extremo con credenciales efímeras en el ambiente aislado; esa evidencia no se
presenta como sustituto del gate del ambiente compartido.

`TD-004` corresponde a dos identidades de ejecución sobre una sola base
existente, `accounting_dev`. Los paths de Vault identifican secretos de
conexión para API y worker, no bases distintas. El cierre exige aprovisionar
los dos secretos/LOGINs con sus permisos respectivos y validar ambos contra
esa misma base; no requiere crear otra base de datos.

```text
RESULT: PHASE_0_BLOCKED
PHASE_0: BLOCKED
PHASE_1_XML: NOT_STARTED
TECHNICAL_DEBT: 1
KNOWN_DEFECTS: 0
```

Estado solicitado por el ajuste de ejecución:

```text
REDIS_SECRET_IN_VAULT: PASS
REDIS_NETWORK_ACCESS: PASS
REDIS_PUBSUB: PASS
REDIS_ONLINE_TEST: PASS
REDIS_OFFLINE_FALLBACK: PASS
DOCKER_IN_CODEX_ENVIRONMENT: PASS
LOCAL_VALIDATION_SCRIPT: PASS
MINIO_TEST: PASS
CLAMAV_TEST: PASS
API_RUNTIME_SECRET: NOT_FOUND
WORKER_RUNTIME_SECRET: NOT_FOUND
API_RUNTIME_LOGIN: BLOCKED
WORKER_RUNTIME_LOGIN: BLOCKED
PHASE_0_RESULT: BLOCKED
PR_STATUS: DRAFT
MERGE_STATUS: NOT_MERGED
```

Evidencia final de cierre:

```text
FINAL_IMPLEMENTATION_SHA: 97592ad8243c31107d09663486a5e8ce144030e5
FINAL_FULL_VALIDATION: PASS
FINAL_FULL_VALIDATION_REPORT: .local/cfdi-phase0-validation-reports/cfdi-phase0-full-final2-20260903.json
FINAL_API_JEST_COUNTS: PASS - 52 suites, 370 tests
FINAL_WEB_TEST_COUNTS: PASS - 53 tests
```

## 2. Rama, base, SHA y estado Git

| Campo                 | Valor                                                               |
| --------------------- | ------------------------------------------------------------------- |
| Rama                  | `codex/cfdis`                                                       |
| Base integrada        | `origin/develop` en `e3d4f432dca1df6bbd0877d86e60bd52d8c15325`      |
| SHA de implementación | `97592ad8243c31107d09663486a5e8ce144030e5`                          |
| Fecha de corte        | 2026-09-03, `America/Mexico_City`                                   |
| Resultado de Fase 0   | `PHASE_0_BLOCKED`                                                   |
| Estado de Fase 1      | `NOT_STARTED`                                                       |
| Pull request          | `DRAFT`                                                             |
| Merge a `develop`     | `NOT_MERGED`, prohibido mientras el resultado sea `PHASE_0_BLOCKED` |

La rama integra la versión vigente de `develop` mediante el commit
`9a8a769 merge: integrate latest develop into cfdi phase zero`. Al momento de
esa integración estaba 0 commits detrás y 7 delante de `origin/develop`.

### Estado inicial preservado y clasificación

Los cambios que ya existían sobre `develop` se conservaron y se separaron de
la implementación de plataforma:

- cambios web previos del usuario en status y flujos fiscales: commit
  `4778f5e feat(web): improve fiscal status and year workflows`;
- documentos de descubrimiento aportados como entrada: commit
  `63a6535 docs(cfdi): add ingestion discovery inputs`;
- implementación, pruebas, infraestructura y documentación inicial de Fase 0:
  commits `01933b5`, `0c1d50f`, `189e0ef` y `1de79c3`;
- integración de `origin/develop`: commit `9a8a769`;
- correcciones finales de implementación: reflejadas en
  `97592ad8243c31107d09663486a5e8ce144030e5`.

El estado inicial incluía cuatro componentes web modificados y cuatro
documentos de arquitectura/entrada sin rastrear. No se descartaron, mezclaron
silenciosamente ni sobrescribieron. Los archivos locales de reparación WSL y
sus logs permanecen fuera del alcance y no deben versionarse.

## 3. Alcance y frontera de fase

Se implementó exclusivamente la plataforma compartida de Fase 0:

- planeación, ADR, threat model, contrato, runbooks y matrices;
- persistencia fundacional, idempotencia, procedencia y lifecycle;
- FORCE RLS y roles de ejecución mínimos;
- worker durable separado y Redis wakeup best-effort;
- adapters filesystem y S3/MinIO;
- scanner ClamAV `INSTREAM`;
- reconciliadores, health, métricas, logs y configuración;
- infraestructura reproducible, validación local/CI y controles de deploy.

Verificación negativa del límite:

- no hay endpoint de carga XML ni ZIP;
- no hay parser CFDI funcional ni validación XSD;
- no hay persistencia de CFDI, conceptos, impuestos, relaciones, pagos o
  nómina;
- no hay lista, detalle, descarga ni carga CFDI funcional integrada; la UI
  demostrativa preexistente no llama un endpoint ni persiste datos y no fue
  convertida en capacidad de Fase 1;
- no hay e.firma, descarga SAT, mesa mensual, exportaciones ni retención de
  producto;
- no existe `docs/qa/CFDI_PHASE_1_VALIDATION_REPORT.md`;
- Fases 1–8 permanecen `NOT_STARTED`.

## 4. Planeación y documentación

Se creó y mantuvo el roadmap maestro:

- `docs/roadmaps/CFDI_P0_MASTER_IMPLEMENTATION_PLAN.md`.

Registra las Fases 0–8, dependencias, criterios de entrada/salida, pruebas,
riesgos, entregables y gates. El parser seguro se define como decisión futura,
sin iniciar Fase 1.

ADR creados:

- `docs/architecture/decisions/ADR-CFDI-001-DURABLE-JOBS.md`;
- `docs/architecture/decisions/ADR-CFDI-002-OBJECT-STORAGE.md`;
- `docs/architecture/decisions/ADR-CFDI-003-RLS.md`;
- `docs/architecture/decisions/ADR-CFDI-004-IDEMPOTENCY-PROVENANCE.md`;
- `docs/architecture/decisions/ADR-CFDI-005-XML-PARSER.md`.

Seguridad, contrato y operación:

- `docs/security/CFDI_INGESTION_THREAT_MODEL.md`;
- `docs/security/CFDI_INGESTION_PERMISSION_MATRIX.md`;
- `docs/contracts/CFDI_INGESTION_API.md`;
- `docs/contracts/CFDI_INGESTION_ERROR_CATALOG.md`;
- `docs/operations/CFDI_WORKER_RUNBOOK.md`;
- `docs/operations/CFDI_INGESTION_CONFIGURATION_MATRIX.md`.

También se alinearon `docs/architecture/ARCHITECTURE.md`,
`docs/architecture/CORRECTED_POSTGRESQL_DATA_MODEL.md`, los README de API/web y
`infra/cfdi-phase0/README.md`.

## 5. Arquitectura implementada

- API NestJS con perfil `api` y worker NestJS con perfil `worker` dentro del
  mismo monorepo/release, pero con procesos, configuración y secretos
  separados.
- Entrypoints reales `apps/api/src/main.ts` y `apps/api/src/worker.ts`, con
  scripts `start:api:*` y `start:worker:*`.
- PostgreSQL es la única autoridad durable. Redis sólo notifica después del
  commit y el polling nunca se deshabilita.
- `fiscal-platform` compone la infraestructura; `ingestion` contiene estados,
  repositorios y runner; `object-storage` y `malware-scanner` implementan sus
  ports; `health` y `observability` exponen probes y telemetría.
- El worker no recibe secretos JWT, MFA, email o cookies; la API no recibe la
  credencial del worker. Los perfiles fallan rápido ante mezcla de variables.
- No se registró ningún tipo de job ficticio en producción. Los handlers
  sintéticos existen sólo en módulos/scripts de prueba.

## 6. Persistencia, migraciones y seeds

### Migraciones append-only

| Timestamp       | Migración                       | `accounting_dev` |
| --------------- | ------------------------------- | ---------------- |
| `1787690600000` | `FiscalIngestionFoundation`     | aplicada         |
| `1787690610000` | `FiscalRlsWorkerClaims`         | aplicada         |
| `1787690620000` | `IngestionAutomaticRetryBudget` | aplicada         |
| `1787690630000` | `PhaseZeroRuntimeCompatibility` | aplicada         |

La secuencia creó únicamente `stored_objects`, `ingestion_uploads`,
`ingestion_jobs` e `ingestion_items`, además de funciones, roles, políticas,
índices y estructuras auxiliares indispensables. No se añadieron tablas de
dominio CFDI.

La inspección confirmó:

- `organization_id`, `client_account_id` y `legal_entity_id` con FKs
  compuestas;
- checks, uniques e índices de claim, idempotencia, reconciliación, dirty
  counters, cancelación y retención;
- timestamps `timestamptz`, versión, estados canónicos, correlación,
  procedencia, fingerprint e idempotency key;
- lease token, worker ID, lock, heartbeat, intentos, reintentos automáticos,
  próximo intento, cancelación, inicio, finalización y último error;
- triggers de inmutabilidad y counters;
- funciones mínimas de claim, queue age y reconciliación;
- cero drift TypeORM después de aplicar el manifest.

### Reconciliación de `030` y `050`

Las migraciones `PasswordResetTokens1787690300000` y
`AuthDataCleanupIndexes1787690500000`, antes ejecutadas pero ausentes del árbol
de trabajo, llegaron desde la base vigente de `origin/develop`. El manifest y
los runners las reconocen; `migration:show` ya no reporta esas entradas como
desconocidas. No se fabricaron migraciones vacías ni se reescribió el historial
aplicado.

### Respaldos y preflight

Evidencia schema-only preservada fuera de Git:

| Evidencia                                                   |  Bytes | SHA-256                                                            |
| ----------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| `.local/accounting_dev-schema-post-062-20260902-123601.sql` | 169059 | `120DA10DAF39560F18B253BC2558C82FD0A42F558EA3C1E753CBE752F9BE27D0` |
| `.local/accounting_dev-schema-pre-063-20260902-154900.sql`  | 202370 | `FD73295235EFF55D699719A9B0E3FE80D272A4ADF9DDABD545C1E412B809A44D` |
| `.local/accounting_dev-schema-post-063-20260902-154950.sql` | 202846 | `55AA9AB3DBF1E00F37A5ADE1F051FC96CE72B3271ED646F1FAD7F21D83E0E104` |

El dump pre-062 no existe porque la instrucción se recibió después de aplicar
esa migración. Se registró como defecto de proceso, se tomó inmediatamente el
dump post-062 y antes de `063` ya se exigieron preflight y dump previo. No se
revirtió ni editó ninguna migración aplicada.

El preflight verificó PostgreSQL 16.11, base `accounting_dev`, extensiones,
candidate keys, ausencia de datos incompatibles y autoridad migrator. No se
ejecutó `DROP DATABASE`, `TRUNCATE` general, `migration:revert` sobre datos de
desarrollo ni `synchronize=true`.

### Seeds

Los seeds se ejecutaron dos veces tanto en la base aislada como en
`accounting_dev`. Ambas pasadas conservaron los mismos 4 roles, 38 permisos y
86 relaciones rol/permiso, con conteos distintos idénticos. Resultado:
idempotencia demostrada.

## 7. RLS, roles y autoridad de ejecución

Las cuatro tablas fundacionales tienen `ENABLE ROW LEVEL SECURITY`,
`FORCE ROW LEVEL SECURITY` y políticas por `organization_id`. El contexto se
establece únicamente mediante `SET LOCAL` dentro de una transacción.

Las pruebas PostgreSQL reales cubrieron:

- tenant A y tenant B sin fuga cruzada;
- GUC ausente fail-closed y GUC inválida con error controlado;
- table owner bajo FORCE RLS;
- API y worker con `NOBYPASSRLS`;
- LOGINs `NOINHERIT` que sólo pueden seleccionar su grupo exacto;
- rechazo de membresía inactiva, inexistente o cross-tenant;
- rechazo de FKs cross-scope;
- rechazo de ACL directa, ownership, privilegios por defecto, `CREATE`, roles
  privilegiados alcanzables y cualquier LOGIN hermano que pertenezca a
  `balanz_api` o `balanz_worker`.

El claim cross-tenant usa una función `SECURITY DEFINER` mínima con
`search_path` fijo, `FOR UPDATE SKIP LOCKED`, claim atómico, lease token,
worker ID y retorno del scope estrictamente necesario. La migración `063`
ajusta los grants exactos requeridos por los entrypoints y revoca firmas legacy
sin conceder lectura fiscal arbitraria.

## 8. Worker durable

Se validaron con PostgreSQL real y procesos reales:

- un solo ganador ante claim concurrente de dos workers;
- fairness entre tenants y límite de concurrencia;
- lease de 90 segundos y heartbeat cada 20 segundos;
- recuperación de leases vencidos y protección ABA por lease token;
- ejecución inicial más tres reintentos automáticos;
- backoff de 10, 30 y 120 segundos con jitter;
- `automatic_retry_count` separado del `attempt_count` de claims;
- shutdown/reclaim sin consumir presupuesto de retry;
- expiración real de lease sí consume el fallo/retry correspondiente;
- cancelación durable y rechazo de resultados stale;
- reconciliación y polling PostgreSQL permanentes;
- SIGTERM acotado, sin SIGKILL, restart ni doble ejecución.

El registry productivo no contiene un handler ficticio. El smoke del worker
usa únicamente una operación read-only de la cola durable para probar el
entrypoint y su principal real.

## 9. Redis wakeup

### Secreto compartido y conectividad

Evidencia segura, sin valores:

```text
Logical path: cache/redis
Vault environment: dev (KV v2)
Vault secret: FOUND
Redis connectivity: REACHABLE
TLS: DISABLED
Pub/Sub capability: AVAILABLE
```

El contrato encontrado usa `redis_host`, `redis_port`,
`redis_password` opcional y `redis_db`. No contiene URL completa, username ni
campo TLS. API y worker resuelven el mismo secreto a través del módulo Redis,
sin duplicar configuración ni copiar credenciales a archivos.

La prueba online compartida se ejecutó con namespace/canal exclusivo y mensaje
constante sin datos fiscales. Verificó `PING`, cache mínimo, `PUBLISH`,
`SUBSCRIBE`, wakeup posterior al commit, claim PostgreSQL, reconexión, métricas
y shutdown limpio: 1 suite y 3 pruebas PASS. No se ejecutaron `KEYS`, flush,
shutdown, cambios ACL/configuración ni operaciones destructivas sobre el Redis
compartido.

### Fallback offline

La indisponibilidad se probó contra el Redis aislado, nunca apagando el
servicio compartido. Se verificó:

- publicación best-effort fallida sin perder el job;
- `redis_wakeup_failures_total` incrementada;
- Redis reportado `down` y `required=false`;
- API/worker vivos y readiness degradada sin convertir Redis en dependencia;
- polling/reconciliación PostgreSQL activos y job procesado;
- recuperación posterior y shutdown limpio con Redis disponible/no disponible.

El payload no contiene CFDI, RFC, UUID fiscal, object key, cliente ni secreto.
PostgreSQL sigue siendo la única autoridad.

## 10. Object storage

### Filesystem local

`LocalFilesystemObjectStorageAdapter` fue validado con un root privado fuera de
`public`: key UUID opaca, rechazo de traversal/rutas absolutas/backslash y
reparse/symlink, streaming de escritura/lectura, SHA-256, tamaño, inmutabilidad,
permisos mínimos y cleanup. En Windows el preparador exige una DACL privada
para el SID actual y LocalSystem; producción no acepta ese adapter.

### S3/MinIO

`S3ObjectStorageAdapter` se validó contra MinIO real:

- bucket privado, acceso anónimo deshabilitado y usuario app bucket-scoped;
- roundtrip por streams y cleanup;
- hash y tamaño;
- URL firmada de corta duración;
- SSE-S3 `AES256` observada mediante `HeadObject`;
- carrera de multipart writes sobre una key inmutable con un solo ganador;
- timeouts y abort/cleanup de multipart.

El adapter productivo soporta SSE-KMS por configuración, nunca solicita ACL
pública y falla rápido en producción si faltan bucket, HTTPS, KMS o parámetros
obligatorios. La prueba MinIO demuestra compatibilidad S3 y headers SSE; no
pretende sustituir una integración futura con un KMS administrado.

## 11. Malware scanner

`ClamAvScannerAdapter` usa protocolo `INSTREAM`, framing/chunks acotados,
timeout, health check y errores tipados. No construye comandos shell con datos
de usuario. Producción falla al arrancar si el scanner está deshabilitado; el
bypass sólo existe en desarrollo y requiere configuración explícita.

Con `clamd` real se verificaron health, archivo limpio y fixture EICAR de
seguridad controlado. Con el contenedor aislado inaccesible se verificó
fail-closed: health `down` y error `MALWARE_SCANNER_UNAVAILABLE`, nunca resultado
clean. También pasan las pruebas de protocolo, timeout y respuestas
clean/infected/error.

## 12. Idempotencia, reconciliadores, lifecycle y auditoría

Se validaron:

- creación concurrente con la misma idempotency key y un solo resultado;
- replay con mismo fingerprint y conflicto con fingerprint distinto;
- uploads expirados;
- objetos huérfanos;
- objetos confirmados sin job y jobs sin root/upload viable;
- lease vencido retryable, terminal o cancelado;
- counters dirty y bytes redundantes;
- elegibilidad de retención;
- transiciones auditadas y segunda pasada idempotente con cero cambios.

Los reconciliadores procesan lotes acotados y los planes `EXPLAIN` utilizan los
índices previstos. La auditoría se corrigió para insertar sin `RETURNING` de
entidad, conservando fail-closed y el `EntityManager` transaccional; así los
LOGINs runtime no necesitan `SELECT` sobre `audit_events` ni una ampliación de
ACL.

## 13. Configuración, health, métricas y logs

La configuración validada cubre storage, S3/MinIO, ClamAV, worker, lease,
heartbeat, retries, backoff, polling, Redis, concurrencia, retención, límites,
RLS, health y métricas. Los defaults de desarrollo no se convierten en defaults
inseguros de producción. `.env.example`, `.env.api.example` y
`.env.worker.example` contienen únicamente nombres y placeholders, no secretos.

Health/readiness implementado:

- API liveness y readiness;
- worker liveness, readiness y estado del supervisor;
- PostgreSQL y storage requeridos en ambos procesos; scanner requerido en
  worker y observado como degradación en API para mantener consultas;
- Redis como dependencia observada pero no requerida;
- probes con single-flight, caché lógica de hasta un segundo y timeout acotado;
  el éxito de storage físico tiene una ventana independiente de 30 s por
  defecto, sin reutilización después del vencimiento; cleanup S3 sigue acotado.

Observabilidad implementada:

- logs JSON estructurados con correlation ID, job/object ID técnico, etapa,
  duración y resultado;
- redacción centralizada y catálogo allowlist de error codes;
- métricas de jobs, items, queue age, leases/recovery, storage, scanner, Redis y
  actividad del worker;
- labels limitadas a valores acotados; ningún RFC, UUID fiscal, nombre, razón
  social, dato personal, tenant, object key o ID de alta cardinalidad.

La captura de logs de los entrypoints aislados pasó el escaneo de secretos.

## 14. Infraestructura real y validación de runtimes

Docker está disponible en el entorno de Codex:

```text
Docker client/server: 29.7.2
Docker Desktop: 4.89.0
Docker Compose: 5.5.0
Engine: Linux
```

`infra/cfdi-phase0/compose.yaml` levanta servicios efímeros aislados y
versionados: PostgreSQL 16.15, Redis 7.4.10, MinIO desde el release upstream
fijado, ClamAV 1.5.4, Vault 1.20.4 y runtimes Node.js 22.22.0. Los puertos se
publican sólo en loopback, las imágenes/digests están fijadas y el bucket es
privado.

El host lanzador expone Node.js 20.15.1 y Bun 1.3.14 y no cuenta como evidencia
del runtime fijado. Los gates autoritativos de CI/contenedores y el preflight
del destino validan Node.js 22.22.0 y Bun 1.3.2.

`infra/cfdi-phase0/validate-phase0-local.ps1`:

- valida Docker/Compose y los controles de release;
- genera credenciales efímeras sólo en memoria;
- crea un proyecto Compose con nombre único;
- espera healthchecks y prepara storage privado;
- migra desde cero y ejecuta seeds dos veces;
- configura Vault TLS KV v2 con AppRoles API/worker mínimos;
- crea LOGINs PostgreSQL separados y prueba el caso negativo de migrator sin
  autoridad;
- ejecuta pruebas PostgreSQL, adapters externos y entrypoints compilados;
- valida red, `.env` por perfil y mounts mínimos read-only;
- ejecuta smoke real de autenticación/autorización/RLS en API y cola durable en
  worker;
- valida logs redactados, SIGTERM y Redis online/offline;
- elimina sólo los contenedores, redes, volúmenes y directorios etiquetados como
  propiedad de esa corrida; nunca usa prune ni toca `accounting_dev`.

El ambiente aislado probó API y worker con identidades Vault y PostgreSQL
distintas, `NOINHERIT`, `NOBYPASSRLS`, membresía única, storage privado y
scanner real. La corrida Full final quedó registrada con su salida real:

```text
FINAL_FULL_VALIDATION: PASS
FINAL_FULL_VALIDATION_REPORT: .local/cfdi-phase0-validation-reports/cfdi-phase0-full-final2-20260903.json
```

## 15. Deploy, rollout y rollback

La definición de despliegue de desarrollo fue endurecida y validada con lint y
smokes locales:

- gate reusable de Fase 0 antes del deploy;
- actions fijadas por SHA y runner versionado;
- release directory único por SHA/run/attempt;
- dependencias instaladas antes de inyectar secretos;
- symlinks externos rechazados antes de instalar y todos los enlaces revalidados
  después de que Bun materializa dependencias;
- release read-only y configuración externa separada para API, worker y
  migrator; web no recibe archivo de secretos;
- worker pausado antes de migrar;
- credencial migrator efímera con owner/grupo dedicados y modo `0640`, eliminada antes de activar
  runtimes;
- wrappers `env -i`, UIDs runtime distintos, PM2 release-local y unidad systemd
  root-owned;
- persistencia PM2 semántica y atómica de `dump.pm2` y `dump.pm2.bak`, validada
  contra PM2 real 7.0.4, incluida la detección de procesos homónimos fuera del
  release;
- limpieza fail-closed que exige lista de procesos y dumps vacíos, unidad
  inactiva con código canónico y daemon sin PID;
- `TimeoutStopSec=135s`, superior al `kill_timeout` de 125s del worker, y
  allowlist sudoers exacta para la consulta de estado;
- cadena remota de migración exclusivamente con Bun 1.3.2, con rechazo probado
  de una dependencia transitiva de npm;
- bootstrap legacy en dos pasos (`quiesce` → revocación PostgreSQL/Vault con
  evidencia root-only → `finalize`) antes de aceptar la identidad
  `balanz-deploy`;
- cold-start de la API anterior, activación atómica, probes de API/worker y
  primer cutover fail-closed sin reactivar el legacy: el candidato permanece
  como `current`, con el control plane y ambos dumps vacíos para reintentar el
  mismo candidato;
- cleanup verificado de credenciales/releases inactivos.
- imágenes locales de MinIO y deploy-smoke con tag/label/ID únicos por corrida y
  cleanup exacto, sin `force` ni `prune`.

El rollback usa un marcador ligado al hash y sólo cambia versiones de
aplicación compatibles; no intenta revertir migraciones append-only. Se probó
que no arranca un worker legacy y que se detiene ante marcador manipulado o
probe fallido. Esto valida el mecanismo, no afirma un despliegue a un host
externo durante esta ejecución.

## 16. Matriz de pruebas

| Área / gate                                         | Resultado                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| API ESLint sin autocorrección                       | PASS                                                                                  |
| API TypeScript `--noEmit`                           | PASS                                                                                  |
| API build                                           | PASS                                                                                  |
| API Jest completa                                   | PASS — 52 suites, 370 tests                                                           |
| Web ESLint                                          | PASS                                                                                  |
| Web typecheck                                       | PASS                                                                                  |
| Web build                                           | PASS                                                                                  |
| Web tests                                           | PASS — 53 tests                                                                       |
| `npm audit --audit-level=moderate`                  | PASS — 0 vulnerabilidades                                                             |
| `npm audit --omit=dev --audit-level=moderate`       | PASS — 0 vulnerabilidades                                                             |
| `git diff --check`                                  | PASS                                                                                  |
| Secret/scope scan                                   | PASS — sin secretos ni endpoint, parser, persistencia o artefacto funcional de Fase 1 |
| `migration:show` / preflight                        | PASS                                                                                  |
| Migraciones 060–063 en `accounting_dev`             | PASS                                                                                  |
| Seeds dobles en `accounting_dev`                    | PASS                                                                                  |
| Schema, manifest y drift                            | PASS                                                                                  |
| FKs compuestas y casos negativos                    | PASS                                                                                  |
| RLS tenant A/B, GUC, owner, API y worker            | PASS                                                                                  |
| Roles/ACL exactos y LOGIN hermano negativo          | PASS                                                                                  |
| Claim concurrente, lease, heartbeat y recovery      | PASS                                                                                  |
| Retry inicial + 3, backoff y shutdown               | PASS                                                                                  |
| Idempotencia y fingerprint conflict                 | PASS                                                                                  |
| Reconciliadores/lifecycle/auditoría                 | PASS                                                                                  |
| Redis compartido desde Vault                        | PASS — 1 suite, 3 pruebas                                                             |
| Redis aislado online/offline y polling fallback     | PASS                                                                                  |
| Filesystem local real                               | PASS                                                                                  |
| MinIO/S3 real                                       | PASS                                                                                  |
| ClamAV real clean/EICAR y scanner caído             | PASS                                                                                  |
| Vault aislado, AppRoles y negación cross-profile    | PASS                                                                                  |
| API/worker aislados, health/readiness y RLS         | PASS                                                                                  |
| Logs redactados y métricas sin PII                  | PASS                                                                                  |
| Bash `-n`, ShellCheck 0.10.0 y actionlint 1.7.7     | PASS                                                                                  |
| Persistencia PM2 real 7.0.4                         | PASS                                                                                  |
| Runtime-isolation, rollback y legacy-cutover smokes | PASS — 3 escenarios Docker aislados; rollback incluye PM2 real 7.0.4                  |
| Corrida local Full final                            | PASS — 400.977 s, `failedStep: null`, cleanup completo                                |
| Secretos runtime API/worker en Vault compartido     | BLOCKED — ambos `NOT_FOUND`; write `ACCESS_DENIED`                                    |
| LOGINs API/worker en base compartida                | BLOCKED — depende de los secretos anteriores                                          |

## 17. Defectos encontrados y corregidos

Todos estos hallazgos quedaron corregidos con regresión; no hay un defecto
reproducible abierto:

1. Las migraciones externas `030`/`050` aparecían como desconocidas: se integró
   `origin/develop` y se hizo autoritativo el manifest real.
2. Los runners permitían una autoridad insuficiente/inconsistente: preflight y
   migrate exigen migrator cuando hay migraciones P0 pendientes y la credencial
   no puede usarse como runtime.
3. `attempt_count` mezclaba claims con presupuesto de fallos: se añadió
   `automatic_retry_count`, inicial + 3 retries y backoff 10/30/120+jitter;
   shutdown no consume retry y lease vencido sí.
4. Los grants runtime no coincidían exactamente con las consultas actuales:
   `063` concedió sólo columnas/funciones requeridas y revocó firmas legacy.
5. El guard no rechazaba todas las rutas indirectas de privilegio: ahora
   detecta ACL/ownership/default privileges, roles privilegiados y cualquier
   LOGIN hermano en grupos API/worker.
6. La auditoría de TypeORM emitía `INSERT ... RETURNING` y exigía `SELECT`:
   ahora inserta sin rehidratar entidad y conserva la transacción fail-closed.
7. Redis no exponía toda la señal de fallo/reconexión y su lifecycle podía
   prolongarse offline: métricas, reconexión y shutdown quedaron acotados.
8. Códigos de error operativos podían convertirse en labels libres: se añadió
   una allowlist común y fallback acotado.
9. Readiness podía duplicar probes lentos y acumular trabajo: se añadió
   single-flight, TTL breve y límites temporales; el cleanup de health S3 ya no
   depende de que la operación previa termine a tiempo.
10. El repositorio de idempotencia conservaba locks/casts/normalización de
    resultados incompatibles con privilegios mínimos o TypeORM: se corrigieron
    el advisory-lock flow, casts y `UPDATE ... RETURNING`.
11. Los perfiles API/worker compartían demasiado entorno: se separaron
    contratos, secretos, archivos `.env` y validaciones fail-fast.
12. El validador local tuvo incompatibilidades PowerShell/Windows y mounts
    ambiguos: se corrigieron arrays ACL, stderr nativo, JSON PS5, normalización
    de rutas y binds mínimos explícitos.
13. El validador aceptaba señales de shutdown ambiguas: ahora sólo acepta exit
    `0` o `143` dentro del límite y rechaza `137`, restart u OOM.
14. Deploy/rollback permitía estados insuficientemente ligados al release: se
    añadieron marker hash-bound, probes, aislamiento de credenciales y gates.
15. El dump pre-062 se solicitó después de migrar: el incidente quedó
    documentado, se generó evidencia post-062 y `063` sí tuvo dump pre/post con
    hashes verificados.
16. El primer pin de PM2 incorporó advisories transitivos: se actualizó el
    runtime release-local a `7.0.4`, se regeneraron `package-lock.json` y
    `bun.lock` con los toolchains fijados y ambos audits regresaron a cero.
17. El timeout lógico de readiness podía soltar el gate mientras seguía un
    probe físico de storage/scanner: ahora conserva un único AbortController y
    no libera single-flight hasta que el adapter termina su cleanup real.
18. El bootstrap/cutover podía quedar sin reentrada tras purgar la identidad o
    crear `.pm2`: se añadió progreso root-only ligado a fingerprints,
    reanudación estricta, failpoints y rechazo de estado parcial manipulado.
19. La instalación remota ocurría antes de validar symlinks del artefacto: el
    deploy ahora usa `--safe-links`, escanea antes de Bun y revalida después.
20. Las imágenes locales MinIO/deploy-smoke usaban tags globales y podían dejar
    residuo: ahora cada corrida verifica tag, label e ID propios y los elimina
    de forma exacta sin prune/force.
21. Un rollback de primer despliegue podía dejar activo el control plane PM2
    sin un `current` válido: el cleanup fail-closed detiene unidad y daemon,
    vacía `dump.pm2` y `dump.pm2.bak` y prueba un retry completo.
22. PM2 7.0.4 podía devolver éxito aunque fallara el respaldo de `pm2 save`, y
    validar sólo nombres aceptaba homónimos: ahora se verifican release, cwd,
    entrypoint, intérprete y argumentos, y ambos dumps se reinstalan de forma
    atómica, durable y semánticamente equivalente; el smoke usa PM2 real.
23. El cleanup fail-closed podía dejar procesos, dumps, unidad o daemon en un
    estado ambiguo: ahora elimina todo el control plane y exige lista vacía,
    ambos dumps vacíos, PID ausente y `systemctl is-active` con código exacto 3;
    se prueban fallas de delete, save, stop y códigos no canónicos.
24. El timeout systemd y la allowlist sudoers no cubrían de forma demostrable el
    shutdown completo del worker: se fijó `TimeoutStopSec=135s`, por encima de
    `kill_timeout=125s`, y una regla exacta para `is-active --quiet`.
25. Las migraciones remotas podían depender transitivamente de npm y del Node.js
    del host: el flujo usa exclusivamente Bun 1.3.2 y tiene una prueba negativa
    que rechaza la invocación de npm.
26. El primer cutover legacy fallido podía intentar repuntar una identidad ya
    revocada: ahora conserva el candidato como `current`, deja procesos y dumps
    vacíos y sólo permite reintentar ese mismo candidato.
27. El primer CI Linux rechazó la propiedad de imágenes porque el validador
    dependía de labels implícitos que varían entre versiones de Compose: MinIO
    y deploy-smoke ahora reciben labels explícitos de corrida/servicio, usados
    tanto para validar como para eliminar por identidad. La regresión Full local
    terminó `PASS` con cleanup total.

```text
KNOWN_DEFECTS: 0
```

## 18. Riesgos restantes y deuda técnica

| ID       | Tipo                        | Estado | Evidencia / acción necesaria                                                                                                                                                                                                                                                                                       |
| -------- | --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TD-004` | control externo obligatorio | OPEN   | En Vault compartido, `database/postgres-api` y `database/postgres-worker` están `NOT_FOUND`; el AppRole actual obtiene `ACCESS_DENIED` al escribir. Un administrador debe crear los dos secretos canónicos y ejecutar el provisionador aprobado; después se repiten guard, login y probes contra `accounting_dev`. |

No se solicita ni se acepta que las contraseñas se peguen en chat. La operación
administrativa debe generar credenciales fuertes, crear los LOGINs con
`apps/api/src/database/scripts/provision-fiscal-runtime-logins.ts`, guardar sólo
los secretos canónicos en Vault y registrar metadata/resultado, nunca valores.

Riesgos operativos documentados que no son defectos ni capacidades incompletas
de Fase 0:

- el rollback conserva migraciones aditivas y requiere una versión de
  aplicación compatible;
- MinIO valida S3/SSE, no un KMS administrado de producción;
- los pins de imágenes deben revisarse antes de cada piloto o despliegue
  productivo;
- el cutover no se ejecutó en el host destino; los smokes desechables simulan
  systemd, sudo y Vault, aunque ejercitan PM2 7.0.4 real;
- el Redis compartido no debe usarse para pruebas destructivas; la caída se
  prueba sólo en infraestructura aislada.

```text
TECHNICAL_DEBT: 1
KNOWN_DEFECTS: 0
```

## 19. Archivos modificados

La implementación se distribuye en los siguientes grupos:

- configuración/entrypoints: `apps/api/.env*.example`,
  `apps/api/src/config/*`, `apps/api/src/main.ts`, `apps/api/src/worker.ts`,
  `apps/api/src/worker.module.ts` y scripts de `apps/api/package.json`;
- migraciones y seguridad DB:
  `apps/api/src/database/migrations/1787690600000-FiscalIngestionFoundation.ts`,
  `1787690610000-FiscalRlsWorkerClaims.ts`,
  `1787690620000-IngestionAutomaticRetryBudget.ts`,
  `1787690630000-PhaseZeroRuntimeCompatibility.ts`, RLS, guard, manifest,
  preflight y provisionador runtime;
- plataforma fiscal: `apps/api/src/modules/fiscal-platform/**`,
  `ingestion/**`, `object-storage/**`, `malware-scanner/**`, `redis/**`,
  `health/**`, `apps/api/src/common/observability/**` y auditoría;
- pruebas: suites unitarias y archivos de `apps/api/test/external/**`,
  validadores PostgreSQL, Vault, API/worker runtime, migration authority y
  provisioning policy;
- infraestructura/CI/deploy: `infra/cfdi-phase0/**`,
  `.github/workflows/cfdi-phase0-validation.yml`,
  `.github/workflows/deploy-dev.yml`, `ecosystem.config.cjs`, `.gitattributes`
  y `scripts/deploy/**`;
- toolchain y locks reproducibles: `package.json`, `package-lock.json` y
  `bun.lock`;
- alineación no funcional del orden del contrato de permisos web:
  `apps/web/src/lib/accounting-types.ts`;
- documentación: roadmap, cinco ADR, threat model, contrato, catálogo de
  errores, runbook, matrices, arquitectura/modelo y este reporte.

Los cambios web funcionales preexistentes quedaron en `4778f5e`; la corrección
final de `accounting-types.ts` sólo alinea el orden del contrato de permisos, sin
agregar UI ni capacidad de Fase 1. Los insumos previos quedaron en `63a6535`.
`.local/**`, envs con credenciales, artifacts Docker y logs de reparación no
forman parte del cambio versionado.

## 20. Comandos principales ejecutados

```text
git fetch --all --prune
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
git log --all -- apps/api/src/modules/redis apps/api/src/modules/secrets

docker version
docker compose version
docker info
docker compose --env-file infra/cfdi-phase0/.env \
  -f infra/cfdi-phase0/compose.yaml config
powershell -NoProfile -File infra/cfdi-phase0/validate-phase0-local.ps1 \
  -ValidationMode Full \
  -ProjectName cfdi-phase0-full-final2-20260903

npm --prefix apps/api run migration:show
npm --prefix apps/api run migration:preflight
npm --prefix apps/api run migration:run
npm --prefix apps/api run seed:run
npm --prefix apps/api run seed:run
npm --prefix apps/api run qa:migrations
npm --prefix apps/api run test:integration:fiscal
npm --prefix apps/api run test:integration:fiscal:runtime
npm --prefix apps/api run qa:cfdi:postgres
npm --prefix apps/api run db:runtime:provision

$env:RUN_REDIS_INTEGRATION='true'
npm --prefix apps/api run test:external:redis:vault
npm --prefix apps/api run test:external:fiscal

cd apps/api && npm exec -- eslint 'src/**/*.ts' 'test/**/*.ts'
npm exec tsc -- --noEmit -p apps/api/tsconfig.json
npm --prefix apps/api test -- --runInBand
npm --prefix apps/api run build
npm --prefix apps/web run lint
npm --prefix apps/web run typecheck
npm --prefix apps/web run test
npm --prefix apps/web run build
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate

actionlint -no-color
bash -n scripts/deploy/*.sh
shellcheck scripts/deploy/*.sh
node scripts/deploy/validate-ecosystem.cjs \
  ecosystem.config.cjs apps/api current
bash scripts/deploy/smoke-runtime-isolation.sh
bash scripts/deploy/smoke-pm2-persistence.sh
bash scripts/deploy/smoke-rollback.sh
bash scripts/deploy/smoke-legacy-cutover.sh
```

Las corridas destructivas se limitaron a bases, esquemas, contenedores y
volúmenes inequívocamente aislados. `accounting_dev` sólo recibió migraciones
append-only, seeds idempotentes, inspección y datos sintéticos autorizados.

## 21. Estado final y condición de desbloqueo

```text
RESULT: PHASE_0_BLOCKED
TECHNICAL_DEBT: 1
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
PHASE_1_XML: NOT_STARTED
```

Para cerrar `TD-004`, un administrador con autoridad sobre el Vault y
PostgreSQL de desarrollo debe aprovisionar los dos secretos/LOGINs canónicos,
asignar a cada LOGIN su grupo `balanz_api` o `balanz_worker`, y volver a
ejecutar los probes runtime contra la misma base existente `accounting_dev`.
La aclaración documental no acredita ese aprovisionamiento. Hasta entonces,
el PR sólo puede permanecer en borrador y `codex/cfdis` no debe fusionarse a
`develop`. El trabajo se detiene antes de Fase 1.

## 22. Seguimiento de revisión de PR #17 — 2026-09-04

Se evaluó el [comentario consolidado](https://github.com/hemia-labs/balanz/pull/17#issuecomment-5548845726)
contra la rama de esta PR, `codex/cfdis`, partiendo de
`0a615a0e997cb8953b37358e93ba0ec34a7bd9ea`. El alcance sigue siendo Fase 0.

| Hallazgo | Decisión y evidencia |
| --- | --- |
| 1. Gate acoplado a un conteo fijo de migraciones | No se reprodujo en este SHA. `migration-manifest.ts` define identidades canónicas y un subconjunto separado `PHASE_ZERO_MIGRATION_NAMES`; preflight compara nombres/timestamps y comprueba las invariantes fundacionales. No hay una aserción de cantidad numérica fija que deba relajarse. Una nueva migración debe incorporarse al manifiesto junto con sus expectativas de QA; rechazar archivos desconocidos conserva la integridad del catálogo. |
| 2. Parser, persistencia y upload XML demasiado grandes | Fuera del diff de esta PR: no contiene estos servicios de Fase 1. No se trasladan refactors de otra rama a Fase 0. |
| 3. Inserts fila por fila de hijos XML | Fuera del diff por el mismo motivo. El análisis de lotes, fixtures grandes y fencing corresponde a la PR que incorpore la persistencia XML. |
| 4. Scanner en readiness | Aplicado al health disponible: ClamAV es requerido para worker; API informa `degraded`/200 si falla únicamente scanner. El campo `scanner.required` explicita la política. La admisión de futuras cargas debe impedir procesamiento sin escaneo; todavía no hay endpoint de intake XML en esta PR. |
| 5. Costo de sondeo físico de storage | Aplicado: éxito reutilizable durante 30 s por defecto, configurable entre 1 y 300 s. PostgreSQL/scanner conservan caché breve; storage vencido debe comprobarse antes de responder. Fallos reintentan con la ventana breve, manteniendo el control de concurrencia y abort/cleanup existente. |
| 6. Consulta de edad de cola por ciclo | Aplicado: intervalo mínimo de 30 s por worker, configurable entre 1 y 300 s, y una sola consulta simultánea. También limita los intentos fallidos. Se añade histograma de duración/resultado y se conserva el polling de claims. No constituye un benchmark de la consulta con backlog grande. |
| 7. Auditoría continua de heartbeat | Aplicado: se retira únicamente el INSERT de heartbeat y se añade `worker_heartbeats_total`. La renovación con tenant/lease token, el bloqueo de fila y las auditorías de cambios de estado permanecen. |
| 8. Backfill histórico de reintentos | Riesgo de volumen aceptado como seguimiento, no declarado resuelto. La migración 062 ya filtra por `object_type` y dos acciones antes del agregado, pero eso no garantiza evitar un escaneo físico grande. Está aplicada en `accounting_dev` según la evidencia previa. No se reescribe una migración ejecutada ni se divide la transacción sin un plan que mantenga consistente el presupuesto de reintentos. Falta medir el plan con cardinalidad representativa antes de otro despliegue sobre auditoría grande y decidir índice/lotes a partir de esa evidencia. |

Limpieza aplicada:

- Se elimina el prompt maestro de implementación obsoleto; su contenido queda
  en Git. El plan y la matriz dejan de referenciarlo como autoridad vigente.
- Los snapshots `CFDI_DOWNLOAD_INGESTION_CURRENT_STATE.md` y
  `CFDI_DOWNLOAD_INGESTION_DECISION_INPUTS.md` se archivan sin alterar su
  contenido en `docs/archive/cfdi/2026-08-28/`, con un índice de fuentes vigentes.
- El documento de producto se renombra a
  `docs/architecture/CONTROL_MENSUAL_CFDI_V3_3.md` y se actualiza su enlace.
- Se retiran ocho opciones ZIP sin consumidor de runtime, validación y ejemplo
  de entorno. Sus límites previstos quedan documentados para Fase 2.
  `INGESTION_ZIP_MAX_BYTES` permanece: ya limita storage local/S3 y participa
  en la comprobación de capacidad de ClamAV. No se encontró configuración SAT
  operativa adicional que retirar.

Se conservan los tres scripts de cutover: la condición de retirada exige una
transición del host completada y documentada, que esta revisión no acredita.
Tampoco se retira el adapter local, usado en desarrollo/pruebas. Worker, RLS,
Redis, S3, ClamAV, migraciones y pruebas permanecen; XSD/parser de Fase 1 no
forman parte de este árbol. La consolidación del deploy se mantiene para después
de estabilizar la transición, conservando rollback y limpieza de credenciales.

Validación incremental ejecutada con Node 24.19.0:

- API Jest: 52 suites / 377 pruebas, PASS. Incluye scanner API frente a worker,
  expiración de caché física incluso esperando PostgreSQL, fallo/recuperación de storage, consultas de
  cola compartidas y limitadas incluso tras error, y métrica de heartbeat.
- Build del API: PASS.
- ESLint de los TypeScript modificados: PASS.
- `git diff --check`: PASS.

Se actualiza el validador PostgreSQL runtime para comprobar renovaciones
repetidas y ausencia de eventos de auditoría de heartbeat. No se pudo ejecutar
en este seguimiento: Docker Desktop falla al inicializar su backend por un
socket `sailor-ingest.sock` inaccesible y no ofrece el engine Linux. No se
reinicializaron datos ni volúmenes para sortear ese fallo. Quedan pendientes
la integración PostgreSQL de este cambio, la repetición `Full` y los planes de
cola/backfill con volumen representativo. Los resultados históricos no se
presentan como ejecución de estos cambios. `TD-004` no se cierra con esta revisión.
