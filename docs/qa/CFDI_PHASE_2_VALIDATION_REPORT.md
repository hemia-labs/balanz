# PHASE_2_ZIP — implementación y validación focalizada

**Actualización de revisión de PR #22, 2026-09-09:** la evidencia vigente de las
correcciones está en la sección 11. Las secciones 1–10 conservan el reporte
original del 8 de septiembre y su SHA, sin atribuirles verificaciones posteriores.

Fecha local: 2026-09-08. Entorno: Windows, Node 24.19.0, Bun, PostgreSQL 16,
MinIO y ClamAV locales reales. La evidencia de este reporte corresponde al código
del commit indicado; el commit posterior únicamente actualiza documentación.

```text
BASE_SHA: f1d37d1f38822dafd93d950cf49e26eb1e43a12b
WORK_BRANCH: codex/cfdi-phase2-zip
VALIDATED_CODE_SHA: f7fe80245bd5bb0db3102539308b3ef97e7a9bd2
PR_17_MERGE_PRESENT: YES - a6ee35f
PR_18_MERGE_PRESENT: YES - 5ff2dd0
PHASE_2_IMPLEMENTATION_STATUS: COMPLETE
PHASE_2_FUNCTIONAL_VALIDATION: PASS
PHASE_2_INTEGRATION_STATUS: NOT_MERGED
PHASE_2_RELEASE_STATUS: BLOCKED
KNOWN_FUNCTIONAL_DEFECTS: NONE
EXTERNAL_BLOCKERS_PHASE_2_VALIDATION: NONE
DEFERRED_RELEASE_GATES: Full integrado; secretos runtime compartidos Vault; reconciliación documental Fases 0/1
```

## 1. Autorización, base y protección del workspace

La autorización explícita cubrió toda Fase 2 y posteriormente `yauzl` y sus tipos,
como exige AGENTS.md para dependencias nuevas. Se fijaron `yauzl@3.4.0` y
`@types/yauzl@3.4.0`; no se añadieron otras dependencias directas.

Se inspeccionaron status, rama, HEAD y origin/develop antes de crear la rama;
el workspace original tenía cambios preexistentes y HEAD `e8bac2e`. Tras fetch,
origin/develop era `f1d37d1`; `merge-base --is-ancestor` confirmó ambos merges.
Se creó el worktree `F:/HemiaBalanceOs/balanz-phase2-zip` desde esa base. No se
escribió en el workspace original ni se incluyeron sus cambios. Al finalizar la
inspección, el workspace original estaba limpio en develop@f1d37d1, sin acciones
de esta implementación para descartar, mover o integrar sus cambios.

Fuentes revisadas: roadmap, reportes históricos 0/1, ADR-CFDI-001 a 005,
contratos API/errores, matriz de permisos/configuración y runbook. No se editan
los reportes históricos de Fases 0/1. No se ejecuta Full ni se consulta/resuelve
Vault. No se hace merge, rebase destructivo, despliegue ni trabajo de Fase 3.

## 2. Resultado y decisiones técnicas

- API de tres pasos: init reserva upload/objeto sin job; PUT temporal escribe
  bytes privados; confirm vuelve a leer tamaño/SHA-256 y reserva `manual_zip`
  con wakeup después del commit. Se conserva el mecanismo de idempotencia existente.
- S3/MinIO: PUT firmado corto, tamaño/hash/MIME/cifrado ligados y
  `If-None-Match: *`. Local: endpoint autenticado, plazo durable, streaming y
  backpressure; el estado durable se confirma en el tercer paso.
- `ObjectStoragePort` añade capacidades opcionales de escritura temporal,
  lectura por rangos y limpieza de escrituras abandonadas. Los contratos XML,
  lectura firmada, cifrado y privacidad permanecen compatibles.
- `ZipExtractor`: ZIP32 STORE/DEFLATE, yauzl con acceso aleatorio respaldado por
  rangos, validación central/local, descriptors, rangos no solapados, CRC y
  fin real de DEFLATE. No usa nombres del archivo como rutas del filesystem.
- Seguridad: 50 MiB comprimidos; 250 MiB expandidos acumulados; 2,000 archivos
  regulares; ratio 50:1 por archivo/paquete; profundidad 2; ruta 240; XML 5 MiB.
  Se aplican límites al admitir, inspeccionar y descomprimir bytes reales.
  También se limita a 6,000 headers incluyendo carpetas. Se rechazan ZIP64,
  autoextraíbles, multidisco, enlaces, cifrado, ZIP anidado, rutas/alias peligrosos
  y extras/métodos no permitidos. CRC tiene compatibilidad incremental Node 20;
  SHA-256 usa el mecanismo nativo existente y determina identidad del objeto.
- `ManualZipJobHandler` comparte `XmlObjectProcessor` con el handler XML; no lo
  invoca como handler anidado ni crea jobs hijos. La única extracción de código
  XML es el procesamiento reusable de un objeto. Parser y dominio fiscal no se duplican.
- Se inspecciona y extrae completamente antes de parsear cualquier XML, para
  que una amenaza estructural tardía no deje CFDI creados por un paquete rechazado.
  Los resultados individuales posteriores se guardan en transacciones independientes.

## 3. Migración y procedencia

Nueva migración append-only:
`apps/api/src/database/migrations/1787690900000-PhaseTwoZipIngestion.ts`.

Siete columnas nullable compatibles: `ingestion_uploads.write_expires_at`,
`stored_objects.cleanup_requested_at`, e `ingestion_items.archive_path_sha256`,
`compressed_size_bytes`, `uncompressed_size_bytes`, `compression_method`,
`directory_depth`. No hay una tabla de entradas adicional ni JSONB libre para
seguridad. Se reutilizan job/upload/root/object IDs, ordinal único, safe_filename,
hash, resultado, errores, parser y vínculo CFDI. El nombre visible se genera por
ordinal; sólo se guarda hash de la ruta normalizada.

Constraint tipado de metadata de archivo; índice scope/job/result/ordinal/id;
unicidad del job inicial por upload ZIP; índice de cleanup. Se conservan FORCE
RLS y FKs compuestas existentes; grants nuevos de worker son por columna.
`finalize_manual_zip_items()` reconcilia resultados/counters en toda transición
terminal ZIP, incluyendo cancelación/recovery. `claim_zip_cleanup()` es un
boundary acotado de mantenimiento sin permiso público, con doble comprobación
tras lock y lectura/borrado posterior bajo worker RLS.

La migración se aplicó sobre una base QA efímera real con todas las migraciones
anteriores, y el flujo funcionó con LOGINs API/worker NOINHERIT/NOBYPASSRLS.
No se aplicó sobre la base compartida de usuario ni producción. El rollback
operativo restaura aplicación, no elimina esta migración ni la procedencia.

## 4. Endpoints finales

Prefijo `/api/v1` (configurable):

| Método | Ruta | Contrato |
| --- | --- | --- |
| POST | `/legal-entities/:legalEntityId/ingestions/zip/init` | 201; `ingestion.create`, Idempotency-Key, filename/MIME/size/SHA |
| PUT | URL S3 temporal o `/ingestion-uploads/:uploadId/zip/content` local | Streaming al único objeto reservado; local vuelve a autorizar sesión/scope |
| POST | `/ingestion-uploads/:uploadId/zip/confirm` | 202; misma autorización, Idempotency-Key, verificación real y job durable |
| GET | `/ingestions/:ingestionJobId` | Estado XML/ZIP, ETag/polling y counters |
| GET | `/ingestions/:ingestionJobId/items` | Página máxima 100; ZIP ordinal estable; filtro de resultado; cfdiId |
| GET | `/processes` | XML/ZIP dentro de scope, filtro source opcional |
| POST | `/ingestions/:ingestionJobId/retry` | 202, nuevo job completo y referencia al anterior; clave idempotente |
| POST | `/ingestions/:ingestionJobId/cancel` | 202, solicitud durable y convergencia con lease |

Fingerprint/versiones: `manual_zip_upload_init_v1`,
`manual_zip_upload_confirm_v1`, `manual_zip_retry_v1`. Confirm y reserva de job
son transacciones consecutivas recuperables: repetir confirm cubre una caída
entre ambas. El índice y la clave derivada del upload impiden doble job inicial.

Se reutilizan permisos de ingesta/procesos/CFDI; no se agrega permiso ZIP ni MFA
de carga. Titular real conserva tenant-wide; demás roles requieren asignación.
Descarga XML sigue bajo `cfdi.view`, `cfdi.download` y MFA de Fase 1.

## 5. Éxito parcial, retry, cancelación y frontend

Raíz infectada: cuarentena/hold infinito, cero extracción/CFDI. Amenazas
estructurales o límites: fallo del paquete. Archivos regulares benignos no XML:
items `unsupported`; carpetas: sin items. XML procesable se escanea individualmente
antes del parser; errores XML, unsupported, foreign, duplicado, conflicto e infección
localizada no revierten resultados válidos. Sólo errores transitorios de infraestructura
interrumpen el intento para retry durable. Duplicados solos permiten `completed`;
otros errores/incidentes producen `completed_with_issues`.

Cada retry manual crea job nuevo, referencia al anterior y raíz elegible; no
modifica la versión del job previo. Reprocesa todo y usa dedupe fiscal. El retry
automático conserva items únicos y objetos ya extraídos, verifica bytes existentes
y omite items terminales. Lease perdido impide publicar; cancelación no consume
el presupuesto automático. Counters provienen de SQL, no de acumuladores del handler.

Frontend: XML y ZIP son opciones distintas en la misma pantalla. Un ZIP,
validación previa 50 MiB, checksum WebCrypto local, init/PUT con progreso XHR/
confirm 202, seguimiento de extracting y resultados. Polling recupera tras
reload/reinicio; localStorage contiene sólo IDs técnicos de scope/intención/
upload/job/objeto/correlación. Confirmación pendiente se puede recuperar sin
retransmitir bytes existentes. Si faltan bytes se vuelve a seleccionar el mismo
archivo. Hay cancelación de transferencia/proceso, retry de paquete, 25 items
por página, counters, enlaces al detalle CFDI y limpieza/abort al cambiar tenant.
No hay resultados simulados ni URLs/keys/contenido persistidos.

## 6. Cleanup, métricas y auditoría

Raíz limpia: 30 días tras escaneo/retry. XML fuente de CFDI: preservar.
Duplicados/rechazados usan ventanas Fase 1. Pendientes cancelados/fallidos: 1 día.
Uploads incompletos/huérfanos: admisión expira según política existente y cleanup
a partir de 31 días. Malware, holds, incidentes abiertos, referencias CFDI o jobs
activos excluyen borrado. Raíz con rechazo estructural no se reintenta.

El claim de cleanup se persiste antes de efectos; al fallar o morir el worker se
reclama otra vez tras 5 minutos. Delete repetido es seguro; sólo después se
publica `deleted` y auditoría. Filesystem limpia los partial UUID del objeto
reclamado, sin afectar delete XML común. S3 conserva lifecycle de multipart
incompleto. No hay purga automática de malware ni de investigaciones.

Métricas nuevas acotadas: admisiones ZIP, bytes expandidos, entradas, ratio,
duración de extracción, rechazos estructurales y cleanup fallido. Bytes comprimidos
y resultados completos/parciales/fallidos usan las métricas de ingesta existentes
con source `manual_zip`. Se auditan admisión, confirmación, retry, cancelación,
rechazo, terminal y borrado; descarga conserva auditoría existente. No se registran
XML, nombres sensibles, bytes del ZIP, URLs firmadas, tokens, secretos o keys completas.

## 7. Pruebas ejecutadas y conteos

**API: 17 suites, 234 pruebas aprobadas, 0 fallos/omitidas.** De ellas 76 son
nuevas de Fase 2 y 158 son regresiones directamente afectadas.

| Suite | Pruebas PASS |
| --- | ---: |
| zip-extractor | 45 |
| manual-zip-job.handler | 10 |
| zip-upload.service | 15 |
| zip-cleanup | 4 |
| ingestion-worker-runner (incluye 1 nueva) | 14 |
| local-filesystem-object-storage (incluye 1 nueva) | 15 |
| manual-xml-job.handler | 32 |
| xml-upload.service | 30 |
| ingestion-query.service | 3 |
| ingestion-admission | 4 |
| ingestion-retry-readiness | 1 |
| s3-object-storage.contract | 11 |
| instrumented-object-storage | 2 |
| cfdi-http-contract | 9 |
| cfdi-api.bootstrap | 1 |
| fiscal-observability | 31 |
| cfdi-worker-audit-safety | 7 |

Extractor: ZIP válido, XML múltiples, no XML/carpetas, 2,000/2,001, 50 MiB exactos
y exceso, 250 MiB exactos acumulados y 251 MiB declarados, ratio, rutas POSIX/
Windows/drive/UNC, profundidad/ruta larga, enlaces/especiales/hardlink extra,
cifrado, anidado nombrado/disfrazado, headers/tamaños/CRC/truncación/central corrupto,
padding DEFLATE, streaming, cancelación y separación de error SQL/archivo.
Fixtures grandes se generan en memoria **sólo en tests**, no se almacenan en Git.

**Frontend: 111 pruebas aprobadas, 0 fallos/omitidas**, con 12 nuevas ZIP y
regresiones del API client, polling, recovery, lifecycle/session de upload,
tipos, scope, navegación y CFDI. El script web pequeño tarda menos de un segundo
en ejecución Node; no se ejecutaron matrices históricas de viewports.

Checks finales: lint API/web PASS sin warnings; typecheck API (incluye tests) y
web PASS; `nest build` PASS; `next build` PASS. `git diff --check` PASS.
No se ejecutó indiscriminadamente toda la suite API ni certificaciones 0/1.

Comandos, en runtime Node compatible:

```powershell
# API: los 17 archivos de la tabla se pasaron explícitamente a --runTestsByPath
bun run --cwd apps/api test --runInBand --runTestsByPath <archivos de la tabla>
bun run --cwd apps/api lint
# Desde apps/api:
node node_modules/typescript/bin/tsc --noEmit --incremental false
bun run --cwd apps/api build
bun run --cwd apps/web test
bun run --cwd apps/web lint
bun run --cwd apps/web typecheck
bun run --cwd apps/web build
```

## 8. Integración real representativa

**1 prueba aprobada, 36 comprobaciones contadas**, más la aserción de rechazo
por cancelación. Archivo: `apps/api/test/external/manual-zip.external.ts`.

Recorrido real: sesión opaca y CSRF → init API → PUT MinIO firmado → confirm con
hash real → PostgreSQL/worker de producción → ClamAV INSTREAM → extracción por
rangos → parser real → resultados API. Se creó una base aislada, se aplicaron
migraciones y se usaron dos LOGINs efímeros restringidos; no hay guards, storage,
scanner ni parser simulados. Redis wakeup estaba deshabilitado y polling PostgreSQL
procesó el job, conforme a su papel no autoritativo.

Paquete: **30 items: 1 incorporated, 1 duplicate, 1 invalid, 27 unsupported**.
Status `completed_with_issues`, 1 CFDI. Se comprobó init sin job, replay init y
confirm, objeto ausente, rechazo de bytes diferentes por firma/checksum,
sobrescritura PUT 412, otra clave confirm 409, scope ajeno 404/RLS vacío,
paginación 25+5 con ordinals 1/26, lista/detalle CFDI existentes, retry nuevo
job con 2 duplicate y 0 incorporated, versión anterior inmutable, XML individual
duplicado, cancelación durable y cleanup que conserva original y raíz con retry
activo. El barrido eliminó copias duplicadas expiradas.

Las bases, LOGINs y objetos sintéticos de cada ejecución fueron limpiados.
El test se repitió durante correcciones; no se ejecutaron matrices históricas
completas de MinIO/ClamAV/Vault. En el código validado el recorrido final pasó.

## 9. Límites de evidencia y riesgos residuales

- No hay bloqueo externo de la integración ZIP local requerida. Sí siguen
  pendientes los gates de release heredados; esta evidencia no los acredita.
- No se ejecutó un despliegue, AWS real/SSE-KMS productivo, Vault compartido,
  prueba visual manual de navegador ni los cinco viewports históricos. El
  frontend está validado con tests de comportamiento/contratos y build, no con
  una grabación de interacción real. MinIO AES256 es la evidencia real de storage.
- CORS del bucket, timeout/límite del proxy, claves KMS y lifecycle deben estar
  configurados en el ambiente objetivo antes de exponer la carga. No se cambió
  infraestructura remota para resolverlos en esta fase.
- ZIP32 estricto rechaza variantes no admitidas incluso si algún descompresor
  general las tolera; esto está documentado como contrato, no como fallback.
- Una cancelación no promete recuperar bytes ya enviados; converge por estado,
  lease y cleanup. Incidentes/malware se conservan para revisión autorizada.
- No hay defectos funcionales conocidos dentro del alcance. La rama está lista
  para revisión; no equivale a release desplegable ni autoriza merge automático.

## 10. Documentación y siguiente acción

- `docs/roadmaps/CFDI_P0_MASTER_IMPLEMENTATION_PLAN.md`
- `docs/contracts/CFDI_INGESTION_API.md` (p2.0, sección 13)
- `docs/contracts/CFDI_INGESTION_ERROR_CATALOG.md`
- `docs/security/CFDI_INGESTION_PERMISSION_MATRIX.md`
- `docs/operations/CFDI_INGESTION_CONFIGURATION_MATRIX.md`
- `docs/operations/CFDI_WORKER_RUNBOOK.md` (sección 11)
- `docs/qa/CFDI_PHASE_2_VALIDATION_REPORT.md` (este reporte)

Siguiente acción: revisión de la PR en borrador, especialmente migración, fencing,
cleanup y contrato de upload. Resolver los gates de release heredados en su
trabajo correspondiente antes de desplegar. No continuar con Fase 3 ni fusionar.

## 11. Correcciones de revisión de PR #22 — 2026-09-09

```text
REVIEWED_PR: https://github.com/hemia-labs/balanz/pull/22
CURRENT_DEVELOP_INCLUDED: a38ea2695929ac2ceb10f5db510f95b7af0177c5
DEVELOP_INTO_WORK_BRANCH_MERGE: 8f14a9b
VALIDATED_REVIEW_CODE_SHA: 16dc8016a698deed121d387ce28e3f9e11dbf529
WORK_BRANCH: codex/cfdi-phase2-zip
LOCAL_TARGETED_VALIDATION: PASS
MIGRATIONS_ADDED_OR_MODIFIED: NONE
DEPENDENCIES_ADDED: NONE
CI_WORKFLOWS_MODIFIED: NONE
PR_MERGED: NO
```

Se incorporó develop a la rama de trabajo para resolver su conflicto de storage,
conservando las capacidades de upload firmado y los diagnósticos actuales de
despliegue/S3. El checkout original permanece intacto. El commit posterior a
`16dc801` sólo documenta estas verificaciones.

Correcciones y justificación:

1. **Plan de reconciliación:** el índice nuevo de Fase 2 y el índice foundation
   comparten el prefijo `(organization_id, ingestion_job_id)`. Para la unión y
   el agregado, PostgreSQL puede elegir `ix_ingestion_items_job_result_ordinal`
   en lugar de `ix_ingestion_items_job_updated`; exigir exclusivamente el nombre
   anterior generaba un falso negativo. El validador ahora inspecciona nodos de
   acceso por índice del EXPLAIN y admite esas dos alternativas concretas.
   Sigue exigiendo `ix_ingestion_jobs_counter_reconcile`; la consulta conserva
   scope, `SKIP LOCKED` y `LIMIT 100`. La validación de existencia del índice
   foundation también permanece. No se editaron la migración compartida
   `1787690900000`, el SQL productivo de reconciliación ni los workflows.
2. **Confirmación durable:** reutiliza `receiving`, `updated_at`, `version` y
   heartbeat/lease existentes antes de HEAD/hash, con transacciones cortas y
   scope completo. Un concurrente recibe `UPLOAD_CONFIRM_IN_PROGRESS` y espera
   mediante confirm idempotente. Se comprueban expiración y versión al confirmar;
   un propietario anterior no puede renovar, confirmar ni liberar otro claim.
   El fallo de lectura libera sólo la versión propia; una caída se recupera al
   vencer el lease sin borrar el objeto. XML individual conserva su contrato.
3. **ZIP vacío:** `ZIP_EMPTY` rechaza paquetes sin archivos regulares, incluidos
   los que sólo contienen carpetas. Se escanea la raíz, se registra rechazo y
   no se crean items ni se invoca el parser.
4. **Preparación en navegador:** el File se envía a un Web Worker desechable;
   lectura y SHA-256 nativo ocurren fuera del hilo principal. Cancelación termina
   el worker e impide init. El digest nativo sigue necesitando un buffer limitado
   a 50 MiB dentro del worker; no se afirma hashing incremental. El progreso de
   transferencia continúa basado en eventos reales de XHR.
5. **Errores legibles:** traducciones ZIP centralizadas con acción de recuperación
   y código secundario en resultados de job/item, incluido el error local de hash.

### Verificación focalizada de las correcciones

| Comprobación | Evidencia final |
| --- | --- |
| API: extractor, servicio ZIP, handler ZIP, servicio XML, admisión, plan y observabilidad | **7 suites / 149 tests PASS**, 0 fallos/omitidos; 14 casos nuevos |
| Frontend: script existente con preparación, concurrencia y traducciones ZIP | **125 tests PASS**, 0 fallos/omitidos; 14 casos nuevos |
| Integración real representativa | **1 test PASS / 44 comprobaciones contadas**, más dos aserciones de rechazo (fence obsoleto y cancelación) |
| Gate `qa:migrations` vigente | PASS, invocado por la integración en su base efímera con todas las migraciones, incluida `1787690900000` |
| Lint API / web | PASS, sin warnings |
| Typecheck API (incluye tests) / web | PASS |
| Build API / frontend | PASS / PASS |
| `git diff --check` | PASS |

El test real conserva sesión/CSRF, API, PostgreSQL con LOGINs restringidos,
PUT firmado MinIO, ClamAV, worker, parser, resultados parciales, paginación,
retry, XML individual, detalle CFDI, scope y cleanup. Agrega un claim abandonado,
takeover con versión nueva, rechazo del propietario obsoleto y dos confirmaciones
concurrentes con una sola lectura/hash. El gate de migraciones usa exclusivamente
esa base sintética, con `SECRETS_ENABLED=false`, sin consultar Vault ni tocar una
base compartida; la base, LOGINs y objetos del ensayo se eliminan al finalizar.

Los tests frontend ejecutan el código del worker de hash en un hilo Node real y
comprueban SHA-256 exacto sin lectura de bytes en el hilo llamador, terminación al
cancelar, fallos seguros y espera/recovery de confirmación. No se atribuye a esto
una prueba visual de navegador.

Comandos finales (Node 24.19.0):

```powershell
# Desde apps/api
bun run test --runInBand --testPathPatterns='zip-upload.service|zip-extractor|manual-zip-job.handler|xml-upload.service|counter-reconciliation-plan|ingestion-admission|fiscal-observability'
$env:RUN_ZIP_INTEGRATION='true'
bun run test --runInBand --testRegex='test/external/manual-zip.external.ts$' --detectOpenHandles
bun run lint
node node_modules/typescript/bin/tsc --noEmit --incremental false
bun run build
# Desde apps/web
bun run test
bun run lint
bun run typecheck
bun run build
```

La ejecución remota de CI sobre el HEAD publicado se consulta en GitHub; sus
enlaces y resultado se dejan en la conversación de la PR, sin confundirlos con
la evidencia local anterior. Siguen fuera de esta revisión el despliegue, Vault
compartido, SSE-KMS productivo, matrices históricas y certificaciones Full/0/1.
Los gates de release heredados y la configuración del bucket destino permanecen
separados de estas correcciones. No se implementó Fase 3 ni se fusionó la PR.
