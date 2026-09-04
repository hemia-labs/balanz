# Reporte de validación CFDI — Fase 1 XML

## 1. Resultado ejecutivo

La vertical `PHASE_1_XML` quedó implementada sobre la plataforma durable de
Fase 0 en la rama `codex/cfdi-phase1-xml`, con base
`origin/codex/cfdis@a4d71bd77fe0db1cdd8f7f747ec1a18ab3db1a7d`. El alcance
incluye upload streaming de un XML, job durable `manual_xml`, escaneo,
validación y extracción CFDI 4.0, persistencia fiscal con RLS, períodos,
incidencias, consultas, acceso temporal al original y pantallas reales.

El estado de cierre es `PARTIALLY_COMPLETE`, no `DONE`. Después de la
interrupción eléctrica, Docker Desktop no pudo restablecer su socket interno;
por ello no se repitieron con el código final las pruebas de ClamAV real
clean/EICAR ni S3/MinIO real. Tampoco se completó el recorrido manual
navegador–API–worker–scanner–storage de extremo a extremo. Las pruebas de
dependencia caída sí comprobaron el comportamiento fail-closed. Esta falta de
evidencia no se sustituye con mocks ni con las validaciones históricas de Fase
0.

```text
RESULT: PHASE_1_XML_PARTIALLY_COMPLETE
PHASE_0_DEVELOPMENT_STATUS: ACCEPTED
PHASE_0_RELEASE_STATUS: BLOCKED
PHASE_0_RELEASE_GATES:
  - CI_RUNTIME_WORKER_STARTUP
  - SHARED_VAULT_POSTGRES_RUNTIME_SECRETS
PHASE_1_XML: PARTIALLY_COMPLETE
TECHNICAL_DEBT: 0
KNOWN_DEFECTS: 0
NEXT_PHASE: NOT_AUTHORIZED
```

La única regresión completa final quedó verde. No se conocen defectos ni deuda
técnica dentro del código implementado. Los bloqueos de infraestructura
descritos aquí son gaps de validación/release, no defectos conocidos ni
capacidades trasladadas silenciosamente a otra fase.

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
  del tenant anterior no puede reemplazar el upload ni el resultado vigente.

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

La matriz siguiente distingue cobertura automatizada de validación externa
pendiente. `Cubierto` significa que existe una prueba focal ejecutada o una
validación PostgreSQL registrada; la regresión completa final también quedó
registrada en la sección 12.

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
| ClamAV real clean/EICAR | requiere clamd real después del outage | **bloqueado** |
| S3/MinIO real | requiere Docker Desktop operativo | **bloqueado** |

La validación PostgreSQL cubre incorporated, E, T, N, pagos/documentos,
duplicate, conflicto, períodos, complemento desconocido, unsupported, foreign,
retenciones agregadas, nombre de banco extranjero separado, FKs cross-parent,
tenant B, heartbeat/cancel concurrentes, reinicios, terminalización de errores,
lease perdido y auditoría sin XML dentro de una transacción aislada.

## 12. Comandos y resultados

Sólo se registran resultados observados. La regresión completa final se ejecutó
una sola vez sobre el árbol cerrado; el único ajuste posterior fue alinear un
fixture TypeScript con las constantes canónicas de versión del parser/XSD, y su
única repetición de typecheck quedó verde.

| Comando o corrida | Resultado observado | Alcance |
| ----------------- | ------------------- | ------- |
| `npm test -- --runInBand` desde `apps/api` | PASS — 59 suites, 499 tests | regresión completa API |
| `npm run lint` desde `apps/api` | PASS — 0 errores, 0 warnings | código y tests API |
| `npx tsc -p tsconfig.json --noEmit` desde `apps/api` | PASS | compilación estática; una corrección focal y una repetición |
| `npm run build` desde `apps/api` | PASS | artefacto NestJS |
| parser CFDI focal | PASS — 44 tests | CFDI/TFD/Pagos/Nómina, seguridad y XSD local |
| upload XML focal | PASS — 29 tests | streaming, idempotencia, abort y recovery |
| `$env:NODE_ENV='test'; $env:CFDI_PHASE0_USE_TEST_DATABASE='true'; $env:CFDI_PHASE0_TEST_DATABASE='test_balanz_cfdi_phase1_final_20260903'; npm run test:integration:cfdi-domain` desde `apps/api` | PASS | 14 tablas/FORCE RLS, 27 policies, 9 columnas de procedencia, dominio y fencing |
| `$env:NODE_ENV='test'; $env:CFDI_PHASE0_USE_TEST_DATABASE='true'; $env:CFDI_PHASE0_TEST_DATABASE='test_balanz_cfdi_phase1_final_20260903'; npm run test:integration:cfdi-worker-transitions` desde `apps/api` | PASS | interleavings, leases, cancelación, reinicios y terminalización |
| `npm test` desde `apps/web` | PASS — 78 tests | regresión completa frontend, incluidos ingestion/CFDI |
| `npm run lint` desde `apps/web` | PASS | frontend |
| `npm run typecheck` desde `apps/web` | PASS | frontend |
| `npm run build` desde `apps/web` | PASS | Next.js producción |
| integración filesystem local real | PASS — 1 test | stream/hash/cleanup |
| integración ClamAV con socket cerrado | PASS — 1; clean/EICAR omitidos | fail-closed real |
| integración Redis con destino cerrado | PASS — 1; online omitido | degradación/fallback |
| `docker version` posterior al outage | BLOCKED — cliente 29.7.2 disponible; daemon `dockerDesktopLinuxEngine` ausente (`The system cannot find the file specified`) | impide clamd y MinIO reales |

## 13. QA manual

La inspección estática y las pruebas frontend confirman rutas, estados,
progreso XHR, cancelación, polling, recuperación, limpieza de tenant y detalle
protegido. Quedó pendiente el recorrido manual completo en navegador con API,
worker, PostgreSQL, storage y ClamAV reales por la indisponibilidad de Docker.
Por esta razón no se afirma que la Definition of Done de producto esté cerrada.

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

## 15. Deuda, defectos y capacidades diferidas

No se contabilizan como deuda de Fase 1 las capacidades expresamente
diferidas:

| Capacidad | Fase/estado |
| --------- | ----------- |
| ZIP | `PHASE_2_ZIP`, `NOT_AUTHORIZED` |
| reauth y e.firma | `PHASE_3_REAUTH_AND_EFIRMA`, `NOT_STARTED` |
| descarga/sincronización SAT | `PHASE_4_SAT_ON_DEMAND`, `NOT_STARTED` |
| mesa mensual, checklist y cierre | `PHASE_5_MONTHLY_WORKSPACE`, `NOT_STARTED` |
| exportaciones y lifecycle comercial | `PHASE_6_EXPORT_AND_RETENTION`, `NOT_STARTED` |
| operación global/soporte | `PHASE_7_GLOBAL_OPERATIONS`, `NOT_STARTED` |
| hardening/piloto | `PHASE_8_HARDENING_AND_PILOT`, `NOT_STARTED` |
| CFDI 3.3, PDF y reglas automáticas | posterior a F8 según el roadmap |
| DIOT e IEPS | no asignados por el roadmap vigente; requieren decisión explícita |

Los gaps abiertos para cerrar `DONE` son de validación:

1. ClamAV real: health, archivo limpio y EICAR con el código final.
2. S3/MinIO real: round-trip privado, integridad, acceso temporal y fallos.
3. QA manual end-to-end desde navegador con API/worker reales.

## 16. Estado de los gates de Fase 0

Fase 0 está aceptada para continuar desarrollo, pero no para release. Este
reporte no reabre ni repite su validación Full y no modifica el reporte
histórico de Fase 0.

| Gate | Estado | Efecto |
| ---- | ------ | ------ |
| `CI_RUNTIME_WORKER_STARTUP` | OPEN | obligatorio antes de merge/despliegue; no bloqueó desarrollo F1 |
| `SHARED_VAULT_POSTGRES_RUNTIME_SECRETS` | OPEN | obligatorio antes de merge/despliegue; no bloqueó desarrollo F1 |

No se hizo merge ni se modificó/cerró el PR #17. No se inició Fase 2.
