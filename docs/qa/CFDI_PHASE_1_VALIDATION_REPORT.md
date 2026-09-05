# Reporte de validación CFDI — Fase 1 XML

Las secciones 1–16 conservan la evidencia y los bloqueos del cierre anterior.
La integración posterior con las PR #16/#17 y su validación incremental se
registran en la sección 17. La sección 18 documenta la retirada del workflow
CFDI por solicitud del equipo y la validación local que permanece pendiente.

## 1. Resultado ejecutivo

La vertical `PHASE_1_XML` quedó implementada sobre la plataforma durable de
Fase 0 en la rama `codex/cfdi-phase1-xml`, con base
`origin/codex/cfdis@a4d71bd77fe0db1cdd8f7f747ec1a18ab3db1a7d`. El alcance
incluye upload streaming de un XML, job durable `manual_xml`, escaneo,
validación y extracción CFDI 4.0, persistencia fiscal con RLS, períodos,
incidencias, consultas, acceso temporal al original y pantallas reales.

La implementación y la validación funcional están `COMPLETE`/`PASS`, pero el
gate general de Fase 1 permanece `BLOCKED`, no `DONE`, por el check requerido
fallido de PR #18. Con Docker operativo,
la prueba externa final de ClamAV pasó health, XML limpio, EICAR y scanner
offline fail-closed. La prueba externa final de MinIO pasó bucket privado con
SSE, round-trip streaming, tamaño/hash, acceso anónimo denegado, URL temporal,
expiración denegada y cleanup.

El recorrido manual de navegador confirmó progreso, `202`, transiciones
`queued`/`processing`, recuperación durable tras recarga y procesamiento por el
worker. Después de aplicar la migración `071`, el pago sintético CP01 quedó
`incorporated` con 2 pagos, 3 documentos relacionados y 2 períodos; una segunda
carga quedó `duplicate` y se conservó un único CFDI lógico. También pasaron
EICAR por el worker real, cambio de tenant y descarga de 3213 bytes mediante
MFA/grant de un uso. El defecto TypeORM del consumo del grant fue corregido y no
quedan defectos funcionales conocidos.

```text
RESULT: PHASE_1_XML_BLOCKED_BY_REQUIRED_CHECK
PHASE_0_DEVELOPMENT_STATUS: ACCEPTED
PHASE_0_RELEASE_STATUS: BLOCKED
PHASE_0_RELEASE_GATES:
  - CI_RUNTIME_WORKER_STARTUP: FAIL - runtime env EACCES
  - SHARED_VAULT_POSTGRES_RUNTIME_SECRETS: BLOCKED - API/worker NOT_FOUND
PHASE_1_IMPLEMENTATION_STATUS: COMPLETE
PHASE_1_VALIDATION_STATUS: PASS
PHASE_1_INTEGRATION_STATUS: BLOCKED
PHASE_1_XML: BLOCKED
CLAMAV_REAL: PASS
MINIO_REAL: PASS
MANUAL_E2E: PASS
TECHNICAL_DEBT: 0
KNOWN_FUNCTIONAL_DEFECTS: 0
PR_18_REQUIRED_CHECKS: FAIL - migration validator exact count
PHASE_2_ZIP: NOT_STARTED
```

```text
CLAMAV_HEALTH: PASS
CLAMAV_CLEAN: PASS
CLAMAV_EICAR: PASS
INFECTED_CFDI_ROWS: 0
CLAMAV_CLEANUP: PASS
MINIO_HEALTH: PASS
PRIVATE_BUCKET: PASS
STREAM_ROUNDTRIP: PASS
HASH_INTEGRITY: PASS
PUBLIC_ACCESS_DENIED: PASS
TEMPORARY_ACCESS: PASS
EXPIRED_ACCESS_DENIED: PASS
CROSS_SCOPE_DENIED: PASS
MINIO_CLEANUP: PASS
MANUAL_E2E_LOGIN: PASS
MANUAL_E2E_UPLOAD: PASS
MANUAL_E2E_202: PASS
MANUAL_E2E_WORKER: PASS
MANUAL_E2E_RELOAD_RECOVERY: PASS
MANUAL_E2E_CFDI_DETAIL: PASS
MANUAL_E2E_MFA_DOWNLOAD: PASS
MANUAL_E2E_DUPLICATE: PASS
MANUAL_E2E_TENANT_SWITCH: PASS
```

La única regresión completa final registrada quedó verde y no hay deuda técnica
aceptada ni defectos funcionales conocidos. El check requerido de PR #18 impide
la integración y el estado `DONE`; no se presenta como capacidad futura.

## 2. Alcance implementado

Se implementó exclusivamente XML individual:

- `multipart/form-data` con un solo archivo, límite de 5 MiB, hash y tamaño
  durante el stream, MIME declarado/detectado y object key opaca;
- respuesta `202 Accepted` con `uploadId`, `objectId`, `jobId`, estado, links y
  `correlationId`;
- idempotencia `manual_xml_upload_v1`, replay y conflicto estable;
- job durable `manual_xml` sobre claim, lease, heartbeat, retry, Redis wakeup y
  polling PostgreSQL de Fase 0;
- ClamAV mediante `MalwareScannerPort`, parser seguro y persistencia fiscal;
- lista, detalle, procesos, retry/cancel y descarga temporal protegida;
- UI real con progreso XHR, abort, polling y recuperación tras recarga.

Permanecen fuera de alcance ZIP, e.firma, descarga/sincronización SAT,
exportaciones, mesa mensual completa, checklist/cierre, DIOT, IEPS, PDF, reglas
automáticas y cualquier trabajo de Fase 2 o posterior.

## 3. Migración y dominio fiscal

La migración append-only
`1787690700000-PhaseOneCfdiDomain.ts` agrega 14 tablas fiscales:

1. `cfdis`;
2. `cfdi_concepts`;
3. `cfdi_taxes`;
4. `cfdi_relations`;
5. `cfdi_payments`;
6. `cfdi_payment_documents`;
7. `cfdi_payrolls`;
8. `cfdi_payroll_perceptions`;
9. `cfdi_payroll_deductions`;
10. `cfdi_payroll_other_payments`;
11. `cfdi_payroll_incapacities`;
12. `period_cfdis`;
13. `incidents`;
14. `cfdi_access_grants`.

La migración append-only focal
`1787690710000-CfdiUsageCodeLength.ts` amplía `cfdis.usage_code` de
`varchar(3)` a `varchar(4)` para conservar valores válidos como `CP01`. Fue
aplicada antes de repetir el pago sintético del recorrido manual.

También extiende `ingestion_items` con vínculo a CFDI, versión de parser y
schema, versión CFDI detectada, UUID normalizado, RFC emisor/receptor, tipo y
fecha de parseo. La migración usa `timestamptz`, `numeric`, constraints e
índices explícitos; no usa float, EAV ni JSONB como sustituto del dominio.

El modelo de impuestos distingue los nodos detallados de los agregados de
retenciones permitidos por CFDI 4.0 y Pagos 2.0. En estos últimos se conserva
`Impuesto` e `Importe` sin inventar base, tasa o factor; las constraints sólo
permiten esa forma en scope documento/pago. En pagos, `NomBancoOrdExt` se
persiste en `payer_foreign_bank_name` separado de `CtaOrdenante`, por lo que el
nombre del banco extranjero no se trunca ni sustituye a la cuenta ordenante.

Las 14 tablas nuevas tienen `ENABLE ROW LEVEL SECURITY` y
`FORCE ROW LEVEL SECURITY`. El scope fiscal se conserva mediante
`organization_id`, `client_account_id`, `legal_entity_id` y FKs compuestas,
incluidos los hijos de conceptos, pagos, documentos e impuestos. La FK de
`cfdi_access_grants.session_id` referencia la identidad estable de la sesión;
el tenant y la membresía se vuelven a verificar al consumir el grant, de modo
que cambiar de organización no queda bloqueado por una FK que congele el scope
anterior.

La validación PostgreSQL final usa la base aislada
`test_balanz_cfdi_phase1_final_20260903`. La evidencia registrada incluye:

- migración aplicada como entrada 14 del historial;
- 14 tablas con FORCE RLS y 27 policies;
- cero drift entre entidades TypeORM y schema;
- ciclo `up/down/up` dentro de una transacción externa con rollback final;
- FKs cross-parent rechazadas;
- tenant B invisible bajo contexto de tenant A;
- pérdida de lease revierte la publicación fiscal;
- retención `unsupported` de 30 días y conflicto UUID/hash con retención y hold
  iniciales de 7 días.

## 4. Parser y assets oficiales

`CfdiParserModule` expone un port y un adapter SAXES para el prefiltrado seguro
y la extracción, seguido de validación XSD real local mediante
`xmllint-wasm@5.3.0`. El parser:

- resuelve namespaces por URI y no por prefijo;
- prohíbe DTD, entidades, processing instructions, XInclude y red;
- limita bytes, profundidad, nodos, atributos totales/por elemento, tamaño de
  texto y tiempo monotónico/wall-clock;
- acepta UTF-8 y BOM UTF-8, y rechaza encodings no permitidos;
- valida secuencia y cardinalidad, y valida el documento contra los XSD SAT
  versionados antes de publicar dominio fiscal;
- conserva decimales como strings exactos y nunca usa `parseFloat`;
- soporta CFDI 4.0, TFD 1.1, Pagos 2.0, Nómina 1.2 core y tipos
  `I`, `E`, `T`, `N`, `P`;
- admite múltiples `Pago` y `DoctoRelacionado`;
- registra `parserVersion` y `schemaVersion`;
- no infiere cancelación ni excluye automáticamente por `UsoCFDI`;
- incorpora el core ante un namespace de complemento desconocido y produce
  `COMPLEMENT_UNSUPPORTED` sin inventar campos.

Los XSD y catálogos del SAT están versionados bajo
`apps/api/src/modules/cfdi-parser/schemas`. `manifest.json` registra URL
oficial, fecha, tamaño y SHA-256 para CFDI 4.0, TFD 1.1, Pagos 2.0, Nómina 1.2
y dependencias transitivas. Antes de usarlos se verifica su tamaño y SHA-256;
los imports se resuelven sólo desde una allowlist en un filesystem en memoria.
La validación corre en un `worker_thread` cancelable con `--nonet`, heap acotado
y memoria WASM acotada; timeout o abort terminan el worker, y los errores son
genéricos sin incluir XML. El schema raíz de runtime importa TFD, Pagos y Nómina
locales y usa validación `lax` únicamente en el wildcard de complementos para
mantener la política de core + incidente ante complementos desconocidos. No hay
descargas de schemas ni acceso de red en runtime. Todos los XML de prueba son
fixtures sintéticos.

La validación rechaza, entre otros casos, atributos obligatorios ausentes,
fechas calendario imposibles y valores inválidos de catálogos CFDI/TFD/Pagos/
Nómina. La conversión posterior a `timestamptz` valida primero cada componente
de fecha/hora y el round-trip en la zona configurada, evitando que JavaScript
normalice silenciosamente fechas inexistentes.

## 5. Upload e idempotencia

El endpoint
`POST /legal-entities/:legalEntityId/ingestions/xml` exige sesión opaca,
tenant/membresía activos, asignación cuando corresponde,
`ingestion.create`, CSRF e `Idempotency-Key`. Busboy procesa un único campo
`file`; campos adicionales, segundo archivo, MIME falso, contenido no XML,
exceso de tamaño y abort del cliente fallan con códigos estables y cleanup
acotado. Un rechazo temprano del archivo se observa aunque el request multipart
siga abierto; se cancelan/drenan los streams restantes y la promesa queda
consumida, evitando hangs o rechazos no manejados en el boundary HTTP.

La recepción no retiene una conexión PostgreSQL mientras fluye el multipart.
`ingestion_uploads.state`, `updated_at` y `version` forman un fence optimista de
receptor, con heartbeat y recuperación de una recepción abandonada. Un replay
confirmado recalcula hash/tamaño; si el proceso cayó después de almacenar pero
antes de confirmar, la recuperación reabre el objeto privado y verifica los
bytes durables. El sistema no asocia metadata nueva a bytes antiguos y no
reemplaza un objeto confirmado.

La admisión se serializa en la transacción corta de creación: máximo dos
procesos activos por membresía productora y cuatro por tenant. El replay
idempotente no consume otro slot. La misma key/fingerprint conserva las mismas
referencias; la misma key con fingerprint distinto produce
`409 IDEMPOTENCY_CONFLICT`.

## 6. Worker y persistencia

El registry productivo incorpora sólo el handler `manual_xml` de esta fase. El
flujo reutiliza el worker durable de Fase 0:

1. claim y establecimiento de contexto RLS;
2. resolución del objeto privado y scope;
3. apertura del stream, ClamAV `INSTREAM` y verificación SHA-256/tamaño sobre
   los bytes realmente leídos;
4. reapertura y nueva verificación del stream entregado al parser;
5. clasificación y persistencia transaccional cercada por `lease_token`;
6. actualización de item, incidentes, auditoría, counters y transición final.

No se hacen llamadas externas dentro de la transacción fiscal. Una sustitución
de storage con el mismo tamaño pero distinto hash falla
`OBJECT_HASH_MISMATCH`; una sustitución entre scanner y parser también se
detecta. Un worker sin lease vigente no publica resultado terminal.

La etapa `persisting` se publica en una transacción corta antes de abrir la
transacción fiscal. Así, la persistencia lenta no retiene el row lock del job y
heartbeat o cancelación pueden resolverse sin bloquearse. El fence se verifica
al entrar y al publicar: una cancelación anterior al commit fiscal impide el
resultado; una vez que el item/CFDI quedó publicado, el job deja de ser
cancelable y puede completar sin quedar en un estado contradictorio.

`attempt_count` conserva cada claim, incluidos shutdown/reclaim, y no limita la
reclamabilidad. Sólo `automatic_retry_count` consume el presupuesto de tres
reintentos, por lo que reinicios sucesivos siguen siendo observables sin agotar
ejecuciones productivas. Si un error no retryable o el agotamiento de retries
lleva a `failed_final`, el item `manual_xml` no queda en `processing`: se
terminaliza como `internal_error` con detalle seguro y se reconcilian counters.
Los resultados de contenido que alcanzaron el parser, incluidos rechazos,
conservan `parser_version`, `schema_version` y fecha de intento sin guardar XML.

La identidad lógica es `legal_entity_id + normalized_uuid`:

| Caso | Resultado |
| ---- | --------- |
| UUID nuevo + XML válido | `incorporated`; persiste CFDI y detalle |
| UUID existente + mismo hash | `duplicate`; conserva nueva observación, no crea otro CFDI |
| UUID existente + hash distinto | `invalid`; no reemplaza; incidente alto y objeto en cuarentena |
| RFC ajeno | `foreign`; conserva procedencia, no crea CFDI |
| versión raíz no soportada | `unsupported`; conserva procedencia, no crea CFDI |

## 7. Participación en períodos e incidencias

La policy `cfdi-period-participation/1.0.0` persiste tipo, versión, timezone,
fecha fuente, ordinal y origen. Usa la zona configurada y el fallback
`America/Mexico_City`:

- `I`, `E`, `T`: mes de `Comprobante.Fecha`;
- `P`: mes de cada `Pago.FechaPago`;
- `N`: mes de `Nomina.FechaPago`.

Un CFDI puede tener varias participaciones. Si el ejercicio/período no existe,
el CFDI se incorpora sin crear el ejercicio y se registra
`FISCAL_PERIOD_NOT_CONFIGURED`. El período desde el que se inició la carga no
determina la participación.

Se persisten incidentes para complemento desconocido, período no configurado,
RFC ajeno, versión/contenido inválidos, malware y conflicto UUID/hash. Los
errores y eventos de auditoría sólo conservan códigos e IDs técnicos; no XML ni
fragmentos.

## 8. Autorización y API de consulta

La autoridad no proviene de un rol enviado por el cliente. El titular real
`user_id == organizations.owner_user_id` tiene alcance tenant-wide; admin no
titular, accountant y collaborator requieren asignación activa. Platform admin
no recibe acceso fiscal.

La API expone DTOs explícitos y respuestas no enumerantes:

| Método | Ruta | Control principal |
| ------ | ---- | ----------------- |
| `GET` | `/ingestions/:ingestionJobId` | `ingestion.view`, ETag y Retry-After activo |
| `GET` | `/ingestions/:ingestionJobId/items` | `ingestion.view`, paginación |
| `POST` | `/ingestions/:ingestionJobId/retry` | `ingestion.retry`, idempotencia |
| `POST` | `/ingestions/:ingestionJobId/cancel` | `ingestion.cancel`, cancelación durable |
| `GET` | `/processes` | `processes.view` |
| `GET` | `/legal-entities/:legalEntityId/cfdis` | `cfdi.view` |
| `GET` | `/cfdis/:cfdiId` | `cfdi.view`; nómina/incidencias protegidas |
| `POST` | `/cfdis/:cfdiId/access-url` | `cfdi.view` + `cfdi.download` + MFA |
| `GET` | `/cfdis/:cfdiId/content?token=…` | mismo scope/MFA; grant de un uso |

Las listas tienen paginación con máximo 100, filtros/sorts allowlisted y orden
determinista. El acceso original no expone `storage_key`, queda ligado a la
sesión/membresía y consume atómicamente un grant breve.
Los filtros UUID se validan sintácticamente en el DTO antes de construir la
consulta PostgreSQL, de modo que un valor malformado produce un error de entrada
estable y no llega a un cast `uuid` de base de datos.

## 9. Frontend

Las pantallas existentes quedaron conectadas a datos reales:

- selector de un XML, validación visible de extensión/tamaño, progreso real y
  cancelación mediante XHR; polling cancelable con `AbortController`;
- estado pending/202, polling con ETag/Retry-After y recuperación persistida al
  recargar;
- resultados incorporated, duplicate, foreign, invalid, unsupported e
  internal error;
- lista y detalle CFDI con conceptos, impuestos, relaciones, pagos, nómina
  protegida, procedencia, períodos e incidencias;
- acceso temporal al original con MFA;
- cancelación de upload/polling y limpieza de estado al cambiar de tenant. El
  lifecycle invalida callbacks ya encolados, de modo que una respuesta tardía
  del tenant anterior no puede reemplazar el upload ni el resultado vigente;
- topbar y notificaciones sin copy hardcodeado de contadores que pudiera
  presentar datos ficticios.

Las rutas CFDI/procesos usan siempre componentes live, incluso si el resto del
producto se ejecuta en modo demo. ZIP y SAT se muestran como no disponibles y
no simulan éxito.

## 10. Seguridad

Los controles verificados en código y pruebas focales incluyen:

- streaming y límites antes/durante almacenamiento;
- object keys opacas, storage privado e inmutabilidad;
- hash/tamaño al recibir y en cada lectura del worker;
- parser sin DTD, entidades, red ni contenido XML en errores, con XSD SAT local
  íntegro ejecutado dentro de límites explícitos;
- sesión, CSRF, permiso, scope, asignación, MFA y 404 no enumerante;
- FORCE RLS, roles runtime sin `BYPASSRLS` y FKs compuestas;
- grants de descarga breves, de un solo uso y ligados a sesión;
- auditoría/logs allowlisted sin XML, object key, RFC o UUID fiscal;
- fencing del lease antes de toda publicación terminal.

La revisión focal de seguridad detectó y corrigió: conexión/advisory lock
retenidos durante uploads lentos; recuperación post-`put` capaz de mezclar
metadata; falta de SHA-256 al releer el objeto; cardinalidades core XML
permisivas; validación XSD meramente estructural; y FK de grant que podía
congelar el tenant mutable de una sesión. También cerró el bloqueo de
heartbeat/cancel por la transacción fiscal, el resultado tardío de un upload de
otro tenant y la inconsistencia de cancelar después de publicar dominio.

## 11. Pruebas de Fase 1

La matriz siguiente distingue cobertura automatizada, externa y manual.
`Cubierto` significa que existe una prueba focal ejecutada o una validación
PostgreSQL registrada; la regresión completa final también quedó registrada en
la sección 12.

| Caso obligatorio | Evidencia | Estado al corte |
| ---------------- | --------- | --------------- |
| CFDI 4.0, I/E/T | parser exacto; persistencia E/T | cubierto |
| TFD 1.1 | parser y persistencia de timbre | cubierto |
| P, múltiples Pago/DoctoRelacionado | parser + persistencia y multi-período | cubierto |
| N y nómina core | parser + tablas protegidas y período | cubierto |
| complemento desconocido | core + incidente | cubierto |
| versión no soportada | CFDI/TFD/Pagos/Nómina; sin CFDI | cubierto |
| XSD SAT: atributos/fechas/catálogos inválidos | `xmllint-wasm`, schemas locales íntegros | cubierto |
| truncado/malformado/UUID inválido | errores estables; metadata de intento | cubierto |
| DOCTYPE/XXE/entity expansion | rechazo de seguridad | cubierto |
| profundidad/nodos/atributos/texto/tiempo | límites normativos | cubierto |
| MIME falso/segundo archivo/archivo grande/abort | boundary streaming y cleanup | cubierto |
| RFC ajeno | `foreign`, procedencia, cero CFDI | cubierto |
| duplicate mismo hash | una identidad CFDI, nueva observación | cubierto |
| UUID/hash conflict | original preservado, incidente alto | cubierto |
| ejercicio inexistente | CFDI incorporado + incidente, sin crear ejercicio | cubierto |
| participación multi-período | pagos en meses distintos | cubierto |
| retenciones agregadas / banco extranjero | modelo exacto sin campos inventados ni mezcla de cuenta | cubierto |
| tenant B/RLS | PostgreSQL runtime, padre e hijo invisibles | cubierto |
| cuenta no asignada | 404 antes de storage | cubierto |
| permiso/MFA faltante | metadata de controller/guard y contrato HTTP | cubierto |
| misma key concurrente/fingerprint distinto | un resultado / 409 | cubierto |
| worker reiniciado | reentrada durable sin rescaneo/publicación duplicada | cubierto |
| reinicios repetidos | `attempt_count` observable sin consumir retry automático | cubierto |
| heartbeat/cancel durante persistencia | no bloquean; fence decide publicación | cubierto |
| lease perdido / boundary post-publicación | rollback previo; cancelación rechazada tras publicar | cubierto |
| Redis apagado | conexión real fallida; polling permanece autoridad | cubierto |
| scanner caído | conexión real cerrada + handler retryable/fail-closed | cubierto |
| storage caído | error retryable sin publicación | cubierto |
| cancelación/retry | comandos durables e idempotentes | cubierto |
| fallo final | item `internal_error` terminal y counters reconciliados | cubierto |
| filtro UUID malformado | rechazo DTO antes de cast PostgreSQL | cubierto |
| auditoría/logs sin XML | canario sintético y allowlist | cubierto |
| ClamAV externo real clean/EICAR/offline | health, clean y EICAR reales; caída fail-closed | **PASS** |
| S3/MinIO externo real | bucket SSE privado, streaming/hash, acceso anónimo/expirado denegados, URL temporal y cleanup | **PASS** |
| EICAR por pipeline de ingesta | worker real: objeto `quarantined`/`infected`, `MALWARE_DETECTED`, cero CFDI y cleanup S3/DB | **PASS** |
| cambio de tenant manual | detalle previo redirigido; tenant nuevo con 0 clientes y 0 procesos | **PASS** |
| descarga manual con MFA | 3213 bytes, SHA-256 del fixture, grant de un uso y contrato sin `storage_key` | **PASS** |

La validación PostgreSQL cubre incorporated, E, T, N, pagos/documentos,
duplicate, conflicto, períodos, complemento desconocido, unsupported, foreign,
retenciones agregadas, nombre de banco extranjero separado, FKs cross-parent,
tenant B, heartbeat/cancel concurrentes, reinicios, terminalización de errores,
lease perdido y auditoría sin XML dentro de una transacción aislada.

## 12. Comandos y resultados

Sólo se registran resultados observados. Las regresiones finales de API y
frontend se ejecutaron una sola vez sobre el árbol cerrado. `apps/api` no
define un script `typecheck`: la invocación devolvió `Script not found` y no se
repitió; el chequeo TypeScript directo usado por el repositorio ya había pasado
después de las correcciones focales.

| Comando o corrida | Resultado observado | Alcance |
| ----------------- | ------------------- | ------- |
| `bun run lint` desde `apps/api` | PASS — exit 0 | código y tests API |
| `bun run typecheck` desde `apps/api` | N/A — script no definido; sin repetición | el paquete usa chequeo TypeScript directo |
| `npx tsc -p tsconfig.json --noEmit` desde `apps/api` | PASS | compilación estática focal posterior a las correcciones |
| `bun run test` desde `apps/api` | PASS — 61 suites, 502 tests | regresión completa API, una sola corrida |
| `bun run build` desde `apps/api` | PASS — exit 0 | artefacto NestJS |
| parser CFDI focal | PASS — 44 tests | CFDI/TFD/Pagos/Nómina, seguridad y XSD local |
| upload XML focal | PASS — 29 tests | streaming, idempotencia, abort y recovery |
| `$env:NODE_ENV='test'; $env:CFDI_PHASE0_USE_TEST_DATABASE='true'; $env:CFDI_PHASE0_TEST_DATABASE='test_balanz_cfdi_phase1_final_20260903'; npm run test:integration:cfdi-domain` desde `apps/api` | PASS | 14 tablas/FORCE RLS, 27 policies, 9 columnas de procedencia, dominio y fencing |
| `$env:NODE_ENV='test'; $env:CFDI_PHASE0_USE_TEST_DATABASE='true'; $env:CFDI_PHASE0_TEST_DATABASE='test_balanz_cfdi_phase1_final_20260903'; npm run test:integration:cfdi-worker-transitions` desde `apps/api` | PASS | interleavings, leases, cancelación, reinicios y terminalización |
| `bun run lint` desde `apps/web` | PASS — exit 0 | frontend |
| `bun run typecheck` desde `apps/web` | PASS — exit 0 | frontend |
| `bun run test` desde `apps/web` | PASS — 78 tests | regresión completa frontend, incluidos ingestion/CFDI |
| `bun run build` desde `apps/web` | PASS — 14/14 páginas | Next.js producción |
| integración filesystem local real | PASS — 1 test | stream/hash/cleanup |
| integración ClamAV con socket cerrado | PASS — 1; clean/EICAR omitidos | fail-closed real |
| integración Redis con destino cerrado | PASS — 1; online omitido | degradación/fallback |
| `docker version` durante el outage | BLOCKED — cliente 29.7.2 disponible; daemon `dockerDesktopLinuxEngine` ausente | diagnóstico inicial |
| `docker version` tras la recuperación | PASS — engine 29.7.2; PostgreSQL, Redis, MinIO y ClamAV healthy | infraestructura local disponible |
| `migration:show`, `migration:preflight`, `migration:run` sobre `balanz_cfdi_phase0_test` | PASS — migraciones 070/071 aplicadas | schema local de Fase 1 |
| bootstrap local API/worker y readiness | PASS — HTTP 200; PostgreSQL, MinIO/S3, ClamAV y Redis disponibles | runtime real de desarrollo |
| tests focales de wiring `CfdiApiModule` | PASS — 2 suites, 10 tests | regresión de DI y contrato HTTP |
| corrida externa focal de ClamAV | PASS — health, clean, EICAR y offline fail-closed | scanner real con cleanup |
| corrida externa focal de MinIO | PASS — bucket SSE privado, stream/hash, acceso anónimo denegado, URL temporal y expiración denegada | adapter S3 real con cleanup |
| migración `071` + pago CP01 | PASS — `incorporated`, 2 pagos, 3 documentos y 2 períodos | recorrido manual API/worker |
| segunda carga del pago CP01 | PASS — `duplicate`, un único CFDI lógico | dedupe real |
| EICAR por worker real | PASS — objeto `quarantined`/`infected`, `MALWARE_DETECTED`, 0 CFDI | cleanup S3/DB PASS |
| navegador: MFA y descarga | PASS — 3213 bytes, SHA-256 del fixture y grant de un uso | respuesta pública sin `storage_key` |
| navegador: cambio de tenant | PASS — detalle previo redirigido; tenant nuevo con 0 clientes/0 procesos | estado anterior descartado |

## 13. QA manual

Con navegador, API y worker reales se verificaron login, progreso de upload,
respuesta `202`, estados `queued`/`processing`, recarga y recuperación del mismo
job. El worker recuperó el trabajo y, después de aplicar la migración `071`, el
pago sintético CP01 terminó `incorporated`. Lista y detalle mostraron 2 pagos, 3
documentos relacionados y participación en 2 períodos. La repetición del XML
terminó `duplicate` y la consulta conservó un único CFDI lógico.

El EICAR procesado por el worker real produjo `MALWARE_DETECTED`, dejó el objeto
`quarantined`/`infected`, no generó CFDI y completó cleanup S3/DB. La descarga
con MFA entregó 3213 bytes cuyo SHA-256 coincide con el fixture, consumió el
grant una sola vez y no expuso `storage_key`. Al cambiar de tenant, el detalle
anterior fue redirigido y el nuevo tenant mostró 0 clientes y 0 procesos. El QA
manual end-to-end queda `PASS`.

## 14. Defectos corregidos

1. El multipart podía aceptar silenciosamente un segundo archivo y algunos
   aborts no terminaban con cleanup/código estable; se corrigió el boundary y
   se añadieron regresiones.
2. El upload conservaba un advisory lock de sesión durante el stream y podía
   agotar el pool; se sustituyó por fence/heartbeat durable de receptor.
3. Una caída después de `putStream` podía confirmar metadata de un replay sin
   verificar el objeto anterior; ahora se reabre y hashea antes de confirmar.
4. El worker sólo comparaba tamaño al releer storage; ahora verifica SHA-256 en
   scanner y parser, incluido reemplazo del mismo tamaño.
5. El parser aceptaba cardinalidades/orden core inválidos; ahora rechaza
   duplicados y secuencias incompatibles.
6. FKs de hijos fiscales permitían combinar IDs de padres del mismo tenant;
   ahora las relaciones incluyen el parent scope completo.
7. `UPDATE ... RETURNING` bajo ACL runtime podía parecer una pérdida de lease;
   la mutación se adaptó al patrón compatible y quedó regresionada.
8. Un `FOR UPDATE OF cfdi` exigía privilegios no concedidos al worker; el
   dedupe conserva el advisory lock transaccional sin ampliar ACL.
9. La descarga podía impedir el cambio legítimo de tenant por una FK compuesta
   a campos mutables de sesión; se separó identidad de sesión y revalidación de
   scope al consumir.
10. El alcance global podía inferirse por nombre de rol; ahora sólo el titular
    real de `organizations.owner_user_id` obtiene alcance tenant-wide.
11. Las retenciones de `unsupported` y conflicto UUID/hash no coincidían con la
    matriz normativa; quedaron en 30 días y retención/hold inicial de 7 días,
    respectivamente, con validación PostgreSQL.
12. La validación estructural podía aceptar XML que incumplía atributos,
    formatos o catálogos oficiales; se integró `xmllint-wasm` contra los XSD SAT
    locales, íntegros, sin red y dentro de un worker cancelable/acotado.
13. Fechas imposibles podían normalizarse al convertirlas a UTC; ahora se
    validan componentes, calendario y round-trip en la zona configurada.
14. Las retenciones agregadas de CFDI/Pagos, válidas sin base/tasa/factor, no
    cabían en el modelo; se añadió una forma relacional restringida por scope.
15. `NomBancoOrdExt` podía confundirse con `CtaOrdenante` y exceder su longitud;
    ahora ambos valores se extraen, persisten, consultan y muestran por separado.
16. Un rechazo temprano del file stream podía quedar sin observador mientras el
    multipart seguía abierto; el boundary ahora liquida streams y promesas sin
    hang ni rechazo no manejado.
17. La transición a `persisting` dentro de la transacción fiscal retenía el row
    lock del job y bloqueaba heartbeat/cancel; se movió a una transacción corta.
18. La cancelación podía competir después de publicar el item/CFDI; el boundary
    durable ya no acepta cancelación tras esa publicación y permite completar el
    job con el resultado ya cercado.
19. Un cap basado en `attempt_count` podía volver no reclamable un job después de
    reinicios que no consumían retry; sólo `automatic_retry_count` gobierna el
    presupuesto y cada claim sigue quedando registrado.
20. Un fallo final podía dejar el item `manual_xml` en `processing`; ahora se
    terminaliza `internal_error` y se reconcilian sus counters en la misma
    operación cercada.
21. Los rechazos posteriores al inicio del parser podían perder procedencia;
    ahora guardan versión de parser/schema y timestamp del intento, sin XML.
22. Al cambiar de tenant podían sobrevivir el transporte o callbacks tardíos
    del upload anterior; el lifecycle los aborta/invalida y limpia la
    recuperación fuera de scope.
23. Un filtro UUID malformado llegaba al cast PostgreSQL; ahora el DTO lo rechaza
    antes de consultar la base.
24. El arranque productivo de `CfdiApiModule` no podía resolver los servicios de
    sesión y auditoría requeridos por sus guards; se añadieron los imports
    directos y una regresión que compila e inicializa el módulo sin depender de
    infraestructura externa.
25. `cfdis.usage_code` estaba limitado a `varchar(3)` y rechazaba el valor CFDI
    válido `CP01`; la migración append-only `071` lo amplía a `varchar(4)` y el
    pago sintético quedó incorporado en la repetición focal.
26. El consumo del grant de descarga fallaba por la forma del `UPDATE` generado
    por TypeORM bajo el perfil runtime; se corrigió la mutación y el navegador
    confirmó MFA, descarga íntegra y rechazo de reutilización del grant.
27. Topbar y notificaciones mostraban copy hardcodeado de contadores; se eliminó
    para no presentar actividad ficticia.

## 15. Deuda, defectos y capacidades diferidas

No se contabilizan como deuda de Fase 1 las capacidades expresamente
diferidas:

| Capacidad | Fase/estado |
| --------- | ----------- |
| ZIP | `PHASE_2_ZIP`, `NOT_STARTED` |
| reauth y e.firma | `PHASE_3_REAUTH_AND_EFIRMA`, `NOT_STARTED` |
| descarga/sincronización SAT | `PHASE_4_SAT_ON_DEMAND`, `NOT_STARTED` |
| mesa mensual, checklist y cierre | `PHASE_5_MONTHLY_WORKSPACE`, `NOT_STARTED` |
| exportaciones y lifecycle comercial | `PHASE_6_EXPORT_AND_RETENTION`, `NOT_STARTED` |
| operación global/soporte | `PHASE_7_GLOBAL_OPERATIONS`, `NOT_STARTED` |
| hardening/piloto | `PHASE_8_HARDENING_AND_PILOT`, `NOT_STARTED` |
| CFDI 3.3, PDF y reglas automáticas | posterior a F8 según el roadmap |
| DIOT e IEPS | no asignados por el roadmap vigente; requieren decisión explícita |

No quedan gaps funcionales conocidos de Fase 1. Para declarar `DONE` aún debe
quedar verde el check requerido de PR #18 y completarse la integración
secuencial después de desbloquear Fase 0.

## 16. Estado de los gates de Fase 0

Fase 0 está aceptada para continuar desarrollo, pero no para release. Este
reporte no reabre ni repite su validación Full y no modifica el reporte
histórico de Fase 0.

| Gate | Estado | Efecto |
| ---- | ------ | ------ |
| `CI_RUNTIME_WORKER_STARTUP` | FAIL — runtime env `EACCES` | bloquea PR #17 e integración secuencial |
| `SHARED_VAULT_POSTGRES_RUNTIME_SECRETS` | BLOCKED — API/worker `NOT_FOUND` | `develop` auto-despliega; bloquea integración/release |

PR #17 permanece `DRAFT` con check requerido fallido. PR #18 permanece `DRAFT`
con el check del validador de migraciones fallido por conteo exacto. No se hizo
merge, no se modificó/cerró el PR #17 y no se inició Fase 2.

## 17. Integración de PR #16/#17 — 2026-09-04

La PR #16 ya está fusionada en `develop` (`8f7f0ed`). Se actualizó la base
`codex/cfdis` y se incorporó a esta rama hasta `ee229fa`, sin fusionar ninguna
de las PR CFDI a `develop` ni adelantar Fase 2.

Resolución de conflictos y compatibilidad:

- Se mantiene la separación de pantallas demo y reales de PR #16, junto con
  las rutas de procesos/CFDI y `accountAccessMode` de Fase 1. La pantalla demo
  usa el nombre vigente del identificador de ruta, `cfdiId`.
- Se conserva la paginación y los conteos agrupados de ejercicios. Crear un
  ejercicio recarga la primera página y sus metadatos desde el servidor.
- Se integran la política de readiness API/worker, el muestreo de storage/cola,
  las métricas de heartbeat y la retirada de configuración ZIP sin consumidor.
- Se conservan las evidencias históricas de ambas fases, la limpieza de docs y
  la aclaración de que los dos LOGINs runtime comparten `accounting_dev`.

El check previo de PR #18 (`33840964617`) falló en
`Phase 0 migration shape: composite_foreign_keys`: el validador exigía
exactamente once FKs en las tablas fundacionales y la migración 070 añade
`fk_ingestion_items_cfdi`. Se sustituye ese total cerrado por presencia de
cada FK fundacional identificada por tabla/nombre y comprobación de que todas
las FKs, incluidas las adicionales, mantienen `organization_id` en ambos lados.
El manifiesto y sus validaciones de identidades permanecen intactos.

Se añaden regresiones PostgreSQL dentro de savepoints: una FK compuesta
adicional debe aceptarse; una FK fundacional ausente no puede quedar oculta
por otra adicional; una nueva FK sin alcance de tenant debe rechazarse.

También se incorpora el arreglo de PR #17 para el `EACCES` de los perfiles
sintéticos de CI. Sólo contienen marcadores/rutas/puertos sin secretos y se
montan de sólo lectura. Las credenciales continúan en Vault y no se amplían
los privilegios de los procesos runtime.

Validación local del árbol combinado: API 61 suites / 510 pruebas, build y
lint del validador PASS; web 78 pruebas, lint, TypeScript y build con Webpack
PASS; `git diff --check` PASS. Webpack permite usar las dependencias compartidas
mediante junctions del worktree. No se repite el recorrido manual de navegador.
La validación PostgreSQL de las regresiones nuevas y la corrida Full se delegan
al workflow aislado requerido de cada PR; a este corte esperan el nuevo run.
Resolver los conflictos no acredita aprovisionamiento de secretos runtime ni
autoriza merge/despliegue: `TD-004` sigue abierto.

## 18. Validación Full manual y retirada de CI — 2026-09-04

Se incorpora PR #17 en `c3cd1f4c5e916146c69bfa87d873038ae350480c` para retirar
`.github/workflows/cfdi-phase0-validation.yml` y su invocación desde el
despliegue. El equipo solicita evitar el consumo de minutos de ese workflow;
las últimas corridas de #17/#18 quedaron canceladas y no se relanzan.

El script y las pruebas se conservan para ejecución local manual según
`infra/cfdi-phase0/README.md`. La validación `Full` del árbol integrado y las
regresiones PostgreSQL añadidas en la sección 17 siguen pendientes; retirar
el workflow no constituye evidencia `PASS`. Los resultados locales API/web
de la sección 17 corresponden al código previo a este cambio de CI/docs.

Este ajuste se verifica con parseo del YAML restante, comprobación del trigger
de despliegue y ausencia de dependencias al workflow retirado, además de
`git diff --check`. No ejecuta la infraestructura ni consume minutos CI.
`TD-004` continúa abierto y no se autoriza merge/despliegue.
