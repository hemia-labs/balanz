# Auditoría técnica previa: estado actual de descarga e ingesta CFDI

## 1. Metadatos de la auditoría

| Campo | Valor |
| --- | --- |
| Fecha | 2026-08-28 |
| Zona horaria | America/Mexico_City |
| Rama | develop |
| SHA inicial | a53de839eddf7febbbd611c63f514e611a3cf8b6 |
| Tipo de revisión | Auditoría estática, read-only sobre implementación e infraestructura versionada |
| Estado general | NOT_READY |
| Alcance | Carga manual XML/ZIP y preparación para descarga masiva SAT |
| Cambios funcionales | Ninguno |
| Cambios de base de datos | Ninguno |
| Dependencias instaladas | Ninguna |
| XML fiscales abiertos | Ninguno |
| Secretos o valores de .env leídos | Ninguno |

### 1.1 Estado inicial del worktree

La línea base se capturó antes de la auditoría con los comandos exigidos.

| Archivo preexistente | Estado inicial |
| --- | --- |
| apps/web/src/components/status-badge.tsx | Modificado |
| apps/web/src/features/clients/live-client-detail-screen.tsx | Modificado |
| apps/web/src/features/clients/live-clients-screen.tsx | Modificado |
| apps/web/src/features/clients/live-fiscal-screens.tsx | Modificado |

El diff inicial contenía 397 inserciones y 86 eliminaciones en esos cuatro archivos. No había archivos no rastreados. Estos cambios pertenecían al usuario antes de esta tarea y no fueron modificados por la auditoría.

### 1.2 Escala de confianza

| Confidence | Uso |
| --- | --- |
| HIGH | Evidencia directa en código, migración, test, manifiesto o script versionado. |
| MEDIUM | Documento vigente coherente con el código, pero sin implementación ejecutable o sin verificación del despliegue. |
| LOW | Infraestructura externa no versionada, comportamiento productivo o supuesto pendiente de confirmación. |

### 1.3 Jerarquía de evidencia aplicada

1. Código, migraciones, tests, manifiestos y scripts del SHA auditado.
2. Documentación versionada del repositorio.
3. Documentación funcional entregada fuera del repositorio.
4. Código legacy accesible, tratado únicamente como antecedente.
5. Fuentes oficiales del SAT, verificadas el 2026-08-28.

Una maqueta, un tipo TypeScript, una dependencia transitiva o un DDL documental no se consideraron capacidad implementada.

## 2. Fuentes inspeccionadas

### 2.1 Repositorio actual

- apps/web/AGENTS.md.
- docs/architecture/ARCHITECTURE.md.
- docs/architecture/CORRECTED_POSTGRESQL_DATA_MODEL.md.
- docs/architecture/CLIENTS_MODULE_CURRENT_STATE_AUDIT.md.
- docs/architecture/CLIENTS_MODULE_IMPLEMENTATION_READINESS.md.
- docs/architecture/CLIENTS_MODULE_IMPLEMENTATION_REPORT.md.
- docs/architecture/FRONTEND_DATABASE_GAP_ANALYSIS.md.
- docs/qa/CLIENTS_MODULE_DEVELOPMENT_VALIDATION_REPORT.md.
- docs/product/ACCOUNTING_INFORMATION_ARCHITECTURE.md.
- docs/design/ACCOUNTING_UI_DESIGN_AGENT.md.
- README raíz, apps/api/README.md y apps/web/README.md.
- package.json, apps/api/package.json, apps/web/package.json, package-lock.json y bun.lock.
- Configuración TypeORM, entidades, migraciones, seeds, módulos, controllers, servicios y tests.
- Rutas, componentes, fixtures, cliente HTTP, sesión, permisos y navegación del frontend.
- Configuración de Redis, secretos, correo, Horus, correlación y errores.

### 2.2 Documentos externos entregados

- C:/Users/lofor/Downloads/control_mensual_cfdi (1).md, versión 3.3.
- C:/Users/lofor/Downloads/Propuesta_funcional_Control_mensual_CFDI_Hemia_v3.docx, versión 3.0.
- C:/Users/lofor/Downloads/Proyecto contador.docx.
- C:/Users/lofor/Downloads/ARCHITECTURE.md.
- Prompt de auditoría en el adjunto pasted-text.txt.

control_mensual_cfdi v3.3 y el prompt son determinantes para alcance e invariantes. Los dos DOCX y el ARCHITECTURE.md externo se consultaron para contraste histórico/funcional, pero ninguna capacidad se declaró implementada a partir de ellos. El backlog citado como backlog_control_mensual_cfdi.md no se encontró. Su ausencia se registra como limitación documental, no como bloqueo por sí sola.

### 2.3 Fuentes externas oficiales

- [Consulta y recuperación de comprobantes del SAT](https://wwwmat.sat.gob.mx/cs/Satellite?c=ConsultaInfo&childpagename=SatTyR/ConsultaInfo/SAT_LandingConsultaInformacion&cid=1462231542968&packedargs=d%3DTouch&pagename=TySWrapper).
- [Documentación SAT de solicitud de descarga masiva](https://wwwmatnp.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1705376527679&ssbinary=true), documento técnico consultado en la fecha de auditoría.
- [Documentación SAT de verificación de descarga masiva](https://wwwmatnp.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1705376527697&ssbinary=true), versión 1.2 de diciembre de 2023, consultada en la fecha de auditoría.
- [Formato de Factura, Anexo 20](https://wwwmatnp.sat.gob.mx/consultas/35025/formato-de-factura-electronica-%28anexo-20%29).

Las fuentes SAT confirman un proceso asíncrono de autenticación, solicitud, verificación y descarga de paquetes. También confirman que el Web Service requiere e.firma vigente y que los códigos, mensajes y estados oficiales deben conservarse separados del estado interno.

## 3. Resumen ejecutivo

**Conclusión: NOT_READY.**

La aplicación tiene una base reutilizable de identidad, sesiones, MFA, organizaciones, membresías, permisos, asignaciones de clientes, entidades fiscales, ejercicios y períodos. PostgreSQL es la autoridad durable; Redis es opcional y hoy sólo acelera sesiones. También existen correlación, auditoría básica y reporte de errores.

La descarga e ingesta CFDI, en cambio, no está implementada:

- los botones visibles en la maqueta son demostrativos y no transfieren archivos;
- las rutas CFDI no forman parte de la experiencia live;
- el cliente HTTP fuerza JSON y no tiene contrato multipart, progreso, idempotencia ni polling;
- no existen endpoints, módulo, entidades o migraciones de objetos, jobs, items, CFDI o paquetes SAT;
- no existe worker, cola durable, storage de objetos, parser XML, extractor ZIP ni adaptador SAT;
- no existen límites de archivo, cuarentena, validación segura, deduplicación transaccional ni pruebas de reinicio;
- los permisos actuales no cubren el ciclo granular de ingesta, consulta, reintento, cancelación y descarga del original;
- MFA existe, pero la reautenticación reciente no;
- RLS no está implementado y su momento de adopción se contradice entre documentos.

El modelo PostgreSQL corregido aporta una base útil, pero sigue siendo un diseño documental y requiere endurecer FKs dentro del mismo tenant, exclusividad de origen, UUID/hash e inmutabilidad antes de convertirlo en migración.

## 4. Topología real del sistema

| Área | Evidencia | Estado | Confidence |
| --- | --- | --- | --- |
| Frontend | apps/web/package.json y apps/web/src | IMPLEMENTED para identidad/clientes; CFDI demo | HIGH |
| API | apps/api/src/app.module.ts:16-24, 61-70 | IMPLEMENTED para identidad/clientes; CFDI ausente | HIGH |
| Base durable | apps/api/src/config/database.config.ts:27-46; synchronize false | IMPLEMENTED en código/configuración | HIGH |
| Redis | apps/api/src/modules/redis/redis.module.ts:31-111 y session-cache.service.ts | SESSION_CACHE_ONLY | HIGH |
| Storage de objetos | apps/api/src/modules y apps/api/package.json: sin módulo, adapter o dependencia directa | ABSENT_IN_REPO | HIGH |
| Worker/queue | package.json, apps/api/package.json y módulos: sin entrypoint, script o dependencia | ABSENT_IN_REPO | HIGH |
| Parser XML/ZIP | Manifiestos y src: sin dependencia directa ni código de parsing/extracción | ABSENT_IN_REPO | HIGH |
| Integración SAT | Controllers/módulos actuales: sin cliente, credenciales, jobs o endpoints | ABSENT_IN_REPO | HIGH |
| Despliegue real | Sin Docker/Compose/PM2/Kubernetes/CI versionado | UNKNOWN | MEDIUM |

Los módulos actuales de API son audit, auth, client-accounts, email, memberships, organizations, permissions, redis, secrets, sessions, subscriptions y users. No existe un módulo CFDI, ingestion, jobs, storage o SAT en apps/api/src/modules.

## 5. Estado real del frontend

### 5.1 Matriz de rutas y acciones

| Ruta o superficie | Componente/evidencia | Contexto | Acción esperada | Permiso visual actual | Estado real |
| --- | --- | --- | --- | --- | --- |
| Cliente live /overview | AccountingScreen deriva a LiveClientDetailScreen, apps/web/src/components/accounting-screen.tsx:71-133 | Organización/cuenta | Resumen real | clients.view | CONNECTED, sin acciones CFDI live |
| Cliente /cfdi | ClientCfdiScreen, client-screens.tsx:44-50 | Demo | Consultar CFDI | clients.view en product-route.ts:197-205 | DEMO_ONLY / API_MISSING |
| Cliente /cfdi/:uuid | CfdiDetailScreen, client-screens.tsx:48-51 | Demo | Detalle, XML, conceptos, impuestos, historial | clients.view | DEMO_ONLY / NO_HANDLER |
| Período /cfdi | PeriodScreen, period-screens.tsx:30 | Demo | Lista y acciones masivas | fiscal_years.view | DEMO_ONLY; la ruta se reconoce, pero live devuelve LiveUnavailableScreen: NO_HANDLER / API_MISSING |
| Período live /overview | LiveFiscalYearScreen con selectedMonth | Entidad/ejercicio/período | Consultar período | fiscal_years.view | CONNECTED para lectura |
| Procesos | Global ProcessesScreen, global-screens.tsx:66-78 | Demo | Progreso, resultado y reintento | Ruta global | DEMO_ONLY / NO_HANDLER |
| Descargar del SAT | CfdiActions, cfdi-actions.tsx:22-37 | Demo | Crear solicitud SAT | Sin comprobación específica en el componente | UI_DEMO / NO_SIDE_EFFECT / API_MISSING; trigger visible y confirmación disabled |
| Cargar XML o ZIP | CfdiActions, cfdi-actions.tsx:39-47 | Demo | Transferir archivo | Sin comprobación específica en el componente | UI_DEMO / NO_SIDE_EFFECT / API_MISSING; trigger visible y confirmación disabled |
| Exportar | CfdiActions, cfdi-actions.tsx:49-70 | Demo | Crear export job | Sin comprobación específica en el componente | UI_DEMO / NO_SIDE_EFFECT / API_MISSING; trigger visible y confirmación disabled |
| Crear ejercicio fiscal | features/clients/live-fiscal-screens.tsx:495-514 y API :238-242 | Live | Crear ejercicio | fiscal_years.manage y entidad active | CONNECTED |

La evidencia explícita de la maqueta dice:

- cfdi-actions.tsx:28: “No existe integración SAT. La solicitud no se enviará”.
- cfdi-actions.tsx:45: “No se transferirán archivos. El servicio de cargas está pendiente”.
- cfdi-actions.tsx:56: “El servicio de exportación no está conectado”.
- navigation.test.ts:253-255 confirma que sólo overview está soportado en períodos live; cfdi y payroll no.

El historial de Git muestra que CfdiActions entró en el commit cebcbf3 como estructura UX. No hay un commit posterior que lo conecte.

### 5.2 Cliente HTTP

| Capacidad | Estado | Evidencia | Impacto |
| --- | --- | --- | --- |
| Cookies de sesión | Sí | api-client.ts usa credentials include | Reutilizable |
| AbortSignal | Sí | api-client.ts:184-192 | Reutilizable |
| Timeout | Sí, 10 segundos | api-client.ts:184-188 | Insuficiente para upload/job sin contrato específico |
| JSON | Sí | api-client.ts:193-207 | Reutilizable para metadata |
| FormData/multipart de upload | Sin soporte de primera clase | Si existe body, apiClient fuerza Content-Type application/json en :193-195 salvo workaround manual de headers; los FormData locales de login/register sólo extraen campos y no se envían por este wrapper | El default es incompatible con el boundary de FormData |
| Progreso de upload | No | Sin XHR/stream/progress callbacks | UX sin avance real |
| Idempotency-Key | No | Sin header ni helper | Riesgo de jobs duplicados |
| Respuesta 202 tipada | No | response.ok acepta 202, sólo deserializa JSON y no expone headers; una respuesta vacía acaba como null tipado | No modela Location/job/Retry-After |
| Polling de jobs | No | Sin hooks ni cliente de procesos | No hay recuperación tras recarga |
| Errores CFDI estables | No | Sólo error genérico | No permite resultados por item |
| Cambio de tenant | Sí para sesión | session-provider y endpoint de organización | No existe binding de jobs/objetos |

### 5.3 Hallazgo de UX relevante

El selector actual usa accept=".xml,.zip" y multiple. Esto es sólo una sugerencia del navegador, no validación, y contradice la decisión cerrada de “XML individual o ZIP”. La implementación futura debe separar visualmente:

- Cargar un XML.
- Cargar un ZIP.
- Descargar del SAT.
- Ver procesos y resultados parciales.

## 6. Estado real del backend

### 6.1 Endpoints existentes reutilizables

| Recurso | Endpoints reales | Estado |
| --- | --- | --- |
| Cliente | GET/POST client-accounts; GET/PATCH/DELETE client-accounts/:id | IMPLEMENTED |
| Entidad fiscal | GET/POST por cliente; PATCH/DELETE por legalEntityId | IMPLEMENTED |
| Ejercicio/períodos | GET/POST fiscal years; GET periods | IMPLEMENTED |
| Asignaciones | GET/POST/DELETE assignments | IMPLEMENTED |
| Sesión/auth/MFA | Registro, login, MFA, sesión, cambio de organización | IMPLEMENTED |
| CFDI | Ninguno | ABSENT |
| Ingesta | Ninguno | ABSENT |
| Objetos/upload | Ninguno | ABSENT |
| Jobs/procesos | Ninguno | ABSENT |
| Descarga SAT | Ninguno | ABSENT |
| Credenciales SAT | Ninguno | ABSENT |

### 6.2 Comportamientos reutilizables

- La cadena organización → cuenta → entidad → ejercicio → período usa FKs compuestas.
- El RFC activo es único por organización.
- ClientAccountScopeService resuelve tenant y asignación y devuelve 404 para recursos fuera de alcance.
- El owner sólo obtiene alcance tenant-wide cuando coincide organizations.owner_user_id; no basta una etiqueta de rol.
- La revocación de asignación invalida el cache de autorización.
- ValidationPipe usa whitelist y forbidNonWhitelisted.
- CsrfGuard valida Origin/Referer en mutaciones con sesión.
- Existe CorrelationIdMiddleware y AuditService.

Estas bases deben extenderse; no sustituyen controles de archivos ni aislamiento de worker.

## 7. Estado de jobs, worker y Redis

### 7.1 Inventario

| Capacidad | Evidencia real | Estado |
| --- | --- | --- |
| Tabla durable de jobs | apps/api/src/database/migrations y búsqueda de Entity: no existe migración/entity | ABSENT |
| Worker separado | package.json y apps/api/package.json: no existe entrypoint/script | ABSENT |
| Lease/heartbeat | No existe | ABSENT |
| SKIP LOCKED/advisory locks | No existe en jobs | ABSENT |
| Retry/backoff/jitter | No existe | ABSENT |
| Cancelación durable | No existe | ABSENT |
| Dead-letter/quarantine de job | No existe | ABSENT |
| Outbox | No existe | ABSENT |
| Bull/BullMQ/Agenda/pg-boss/Graphile Worker | apps/api/package.json y lockfiles: sin dependencia directa | ABSENT |
| Redis | redis.module.ts:39-100 y session-cache.service.ts:42-53: cliente opcional para sesiones; fallback PostgreSQL | IMPLEMENTED, no job authority |

RedisModule registra fallbacks explícitos a PostgreSQL cuando Redis no está configurado o disponible. No hay evidencia para afirmar que Redis sea durable ni que ya soporte colas.

### 7.2 Comparación con la arquitectura actual

| Opción | Encaje con repo | Infra faltante | Riesgo |
| --- | --- | --- | --- |
| A. PostgreSQL durable jobs + worker con lease/locking + Redis opcional para wakeup | Alto: respeta PostgreSQL como autoridad y el monolito modular | Tablas, repositorio específico, worker, lease, heartbeat, retries, supervisión | Complejidad de locking debe probarse |
| B. BullMQ/Redis + estado de dominio en PostgreSQL | Medio-bajo: Redis existe, pero sólo como cache opcional | Dependencias BullMQ, Redis durable administrado, worker, reconciliación PG/Redis | Dos autoridades operativas y pérdida de job si Redis no es durable |
| C. Infra actual | Nulo para CFDI | Todo el pipeline | No satisface reinicios, idempotencia ni recuperación |

## 8. Estado de object storage y uploads

| Elemento | Estado | Evidencia |
| --- | --- | --- |
| Interfaz ObjectStorage | ABSENT | Sin port/adapter |
| S3/MinIO/GCS/Azure Blob | ABSENT_IN_REPO | Sin dependencia o config |
| Filesystem dev adapter | ABSENT | Sin implementación |
| URL firmada | ABSENT | Sin endpoint o signer |
| Multipart Nest | ABSENT | Sin FileInterceptor, UploadedFile o MulterModule |
| Streaming a storage | ABSENT | Sin pipeline |
| Cuarentena | ABSENT | Sin estado o lifecycle |
| Hash SHA-256 durante stream | ABSENT | Sin implementación |
| Cifrado/lifecycle bucket real | UNKNOWN | No hay infraestructura versionada |

Multer y Busboy aparecen transitivamente por Nest platform-express en package-lock.json:3674-3684 y bun.lock:454,904,1668. Eso no prueba una carga configurada; no hay límites activos de fileSize/files definidos por la aplicación.

## 9. Estado del parser XML/ZIP y versiones

### 9.1 Repositorio actual

- No existe parser XML server-side.
- No existe extractor ZIP.
- No existe validación de XSD, namespaces, Timbre Fiscal Digital o complementos.
- No existe protección contra DTD, entidades externas, expansión, depth/nodes/attributes o timeouts.
- No existe detección de MIME/magic bytes.
- No existe catálogo ejecutable de versiones soportadas.
- SAX aparece de forma transitiva por SVGO en bun.lock:1966,2078; no es una capacidad CFDI.

Estado: ABSENT_IN_REPO, Confidence HIGH.

### 9.2 Código legacy accesible

El único antecedente material está en F:/HemiaBalanceOs/contable-os-legacy.

| Área legacy | Evidencia | Capacidad | Reutilización segura |
| --- | --- | --- | --- |
| XML manual | XMLReader.tsx:360-570, 780-817 | input múltiple, file.text y DOMParser en browser | Sólo inventario de campos/casos |
| Pagos | ingresosParsing.ts:252-381, en particular :309 y :317-338 | Reconoce variantes de namespace | No: toma sólo primer Pago y primer DoctoRelacionado |
| Persistencia | queriesService.ts:53 y :201 | Firestore por userId; dedupe consultivo | No: no atómico, sin tenant/RFC/período |
| Reconciliación | PaymentMapping.tsx y PaymentReconciliation.tsx | UX y agregados locales | Sólo referencia UX |
| Excel | excelExport.ts:442-748 | Exportación browser-side | Rescatar columnas, reimplementar como job |
| Certificados | cerParser.ts y cerService.ts | Lee .cer y guarda metadatos | No usar para custodia e.firma |

No hay ZIP, backend, SAT Web Service, storage, jobs, hash, cuarentena ni límites. La lógica legacy autoexcluye algunos CFDI y cancelados, usa parseFloat y mezcla UI, parsing y persistencia; contradice decisiones funcionales actuales. No debe portarse.

### 9.3 Hechos oficiales SAT

- El portal declara recuperación de XML en versiones 3.0, 3.2, 3.3 y 4.0, además de retenciones.
- CFDI 4.0 es la única versión válida para emisión desde 2023-04-01.
- El Web Service usa e.firma para generar el token.
- La secuencia oficial es solicitud → verificación → identificadores de paquetes → descarga.
- Los estados, CodEstatus y Mensaje del SAT son datos externos y no deben usarse como estado interno.

Estos hechos no resuelven qué subconjunto histórico soportará el primer parser; esa decisión sigue pendiente.

## 10. Estado real de DB y migraciones

### 10.1 Esquema versionado actual

Existen 17 entidades TypeORM. El dominio de clientes agrega:

- client_accounts;
- legal_entities;
- account_assignments;
- fiscal_years;
- periods.

Las cuatro migraciones versionadas son:

- 1787601284711-Migration.ts;
- 1787690000000-IdentityIntegrity.ts;
- 1787690100000-ClientAccountsDomain.ts;
- 1787690200000-ClientAccountSearchTrigram.ts.

No existe migración ejecutable de descarga o ingesta CFDI.

### 10.2 Modelo objetivo frente a implementación

| Capacidad/tabla objetivo | Documento | Entity TypeORM | Migración | Servicio/controller/test | Estado |
| --- | --- | --- | --- | --- | --- |
| stored_objects | CORRECTED_POSTGRESQL_DATA_MODEL.md:551-570 | No | No | No | DOCUMENTED_ONLY |
| credential_records | :576-595 | No | No | No | DOCUMENTED_ONLY |
| sat_download_jobs, packages | :605-645 | No | No | No | DOCUMENTED_ONLY |
| ingestion_jobs, ingestion_items | :651-690 | No | No | No | DOCUMENTED_ONLY |
| cfdis | :725-752 | No | No | No | DOCUMENTED_ONLY |
| concepts, taxes, relations | :759-810 | No | No | No | DOCUMENTED_ONLY |
| payments, payment_documents | :811-841 | No | No | No | DOCUMENTED_ONLY |
| period_cfdis, work_decisions | :847-886 | No | No | No | DOCUMENTED_ONLY |
| incidents | :893-912 | No | No | No | DOCUMENTED_ONLY |
| Identidad, organización, membresía, rol, permiso, audit | Modelo + repo | Sí | Sí | Sí, pruebas parciales | IMPLEMENTED |
| Cuenta, entidad, asignación, ejercicio, período | Modelo + repo | Sí | Sí | Sí, E2E | IMPLEMENTED |

“IMPLEMENTED” significa código y migración versionados; no confirma que una base desplegada esté al día.

### 10.3 Matriz física exacta del modelo documental

Todas las filas de esta matriz siguen en estado DOCUMENTED_ONLY.

| Tabla/grupo | PK y scope/FK documentados | Unique, checks e índices | Estado, retry/lease | Retención/sensibilidad | Delta obligatorio antes de migración |
| --- | --- | --- | --- | --- | --- |
| stored_objects | PK id; UNIQUE organization_id,id; FK opcional completa a legal_entity | object_key único; índice y unique parcial por org/entity/kind/hash; checks scope/size/encryption | active, quarantined, expired, deleted | retention_until; encryption_class standard/fiscal/credential/export | No representa pending_upload/uploaded/available/rejected; falta upload intent, idempotencia/fingerprint y transición confirmada |
| credential_records | PK; FK completa a entity; objetos cer/key ligados sólo por organization_id | Una active por org/entity; checks status/validity | pending_validation, active, expired, revoked, invalid, replaced | Credencial altamente sensible; password fuera de tabla por diseño | Obligar cer/key al mismo account/entity y clase credential; definir custodia/KMS/step-up |
| sat_download_jobs | PK; FK completa a entity; credential ligada sólo por organization_id | Idempotency única org/entity/key; range/scope/attempt checks; índice worker | attempt_count y next_attempt_at; sin lease/heartbeat/worker_id | Mensajes/códigos SAT y parameters_snapshot requieren redacción | FK credential same-entity; lease/heartbeat; fingerprint/replay; política cancel/retry |
| sat_download_packages | PK; FK job/object por organization_id | Único job+sat_package_id; índice status/expiry | pending, downloading, downloaded, imported, expired, failed | expires_at, expected_sha256 | Encadenar job/package/object al mismo RFC; estados/retries y checksum verificado |
| ingestion_jobs | PK; FK completa a entity; SAT/package/upload ligados sólo por organization_id | Idempotency única org/entity/key; source/status/count checks; índice status/created_at | Sólo queued/processing/completed/completed_with_errors/failed/cancelled; sin attempts, next_attempt, lease, heartbeat, worker, cancel_requested | Sin retención propia ni updated_at | Origen exactamente uno; workflow fingerprint; campos durable worker; counters para seis resultados; state machine aprobada |
| ingestion_items | PK; FK job/object por organization_id; FK CFDI se promete después | Único job+ordinal; check ordinal/status; índice job/status | pending, processed, duplicate, invalid, rejected, failed | safe_filename/hash/error; sin regla de redacción física | Estados foreign/unsupported/internal_error; checks cfdi_id/error; FKs same-scope; resultado y observación completos |
| cfdis | PK; FK completa a entity; xml_object sólo por organization_id | Único legal_entity_id+uuid; checks tipo/dirección/xml; índices fecha/contraparte/folio | record_status active/quarantined/invalid/archived, separado de SAT | XML fiscal y PII; no hay trigger de inmutabilidad | UUID canónico; hash conflict; objeto same-scope; first_seen_source; original/campos inmutables |
| concepts/taxes/relations/payments | PKs; FKs por organization_id; triggers prometidos para coherencia interna | Líneas lógicas únicas, checks numéricos e índices analíticos | Sin state machine propia | Datos fiscales derivados | Validar FKs same-CFDI, UUID canónico, versiones/complementos y no usar float |
| period_cfdis/work_decisions | PKs; FKs completas a period y CFDI; decisiones por organization_id | Participación única por period/cfdi/type; versión única; checks tipo/revisión/decisión | work_status pending/reviewed; inclusion pending/included/excluded | Decisiones auditables | Regla automática/revisable por evento; puntero latest mediante constraint probado; novedad post-cierre |
| incidents | PK; FK obligatoria a period y opcional a CFDI | Checks origin/severity/status/resolution; índices period/assignee | open, in_progress, resolved, accepted_exception, cancelled | description/resolution pueden contener PII | No puede representar hash conflict pre-período: agregar scope legal_entity/job/item o period nullable con check; reconciliar estados |

El DDL documentado no contiene todavía una tabla de upload intents/idempotency records. Por ello no puede sostener el flujo firmado init → upload → confirm → job ni replay determinista sin una ampliación.

### 10.4 Brechas del DDL objetivo antes de migrarlo

1. credential_records, sat_download_jobs, ingestion_jobs y cfdis usan varias FKs acotadas sólo por organization_id. Esto evita cruce entre tenants, pero permite asociar credencial, objeto, paquete o entidad de cuentas/RFC distintos dentro del mismo tenant.
2. ingestion_jobs declara source, pero no impone exactamente un origen compatible.
3. UNIQUE (legal_entity_id, uuid) expresa la identidad lógica, pero char(36) no impone UUID canónico ni mayúsculas.
4. El mismo UUID con hash distinto no tiene transición o constraint explícito.
5. La inmutabilidad del XML está documentada, no impuesta.
6. ingestion_items permite observaciones múltiples, pero necesita checks estado → cfdi_id/error_code.
7. cfdis.source requiere semántica estable; debería representar first_seen_source o moverse a observaciones, nunca sobrescribirse con la última ingesta.
8. incidents exige period_id NOT NULL; un UUID/hash conflict puede existir antes de asignación a período y no debe forzarse a uno arbitrario.
9. Los estados/counters del DDL no expresan los seis resultados de item ni los campos de lease/retry/cancel requeridos.
10. No existe soporte físico para upload intent, request fingerprint y replay idempotente del flujo multi-paso.

### 10.5 Procedencia y períodos

El modelo propuesto sí permite:

- un CFDI lógico por legal_entity_id + UUID;
- varios ingestion_items apuntando al mismo CFDI;
- un objeto/hash distinto por observación;
- manual primero y SAT después sin duplicar el CFDI;
- el mismo CFDI participando en varios períodos mediante period_cfdis.

Pero esas propiedades dependen todavía de constraints, locks/upsert y contratos no implementados.

## 11. Permisos, MFA, reautenticación y aislamiento

### 11.1 Catálogo real

El catálogo tiene 27 permisos. Los relevantes son:

- credentials.manage;
- sat.download;
- payroll.view;
- cfdi.review;
- cfdi.exclude;
- exports.create;
- audit.view.

No existen claves para ingestion.view/create/retry/cancel, cfdi.view/download, sat.view/retry/cancel, credentials.view, processes o incidents.

| Acción futura | Permiso actual más cercano | Adecuación |
| --- | --- | --- |
| Crear carga manual | cfdi.review | Demasiado amplio/ambiguo |
| Ver job/items | Ninguno | Falta |
| Reintentar/cancelar job | Ninguno | Falta |
| Listar/ver CFDI | clients.view o cfdi.review | Mezcla consulta y mutación |
| Descargar XML original | Ninguno | Falta |
| Solicitar SAT | sat.download | Existe, pero falta ciclo granular |
| Gestionar e.firma | credentials.manage | Existe |

#### Matriz ejecutable actual

| Clave actual | Roles default del catálogo | MFA-sensitive | Caller/controller de esa capacidad | Evidencia de test |
| --- | --- | --- | --- | --- |
| credentials.manage | owner, accountant | Sí | Ninguno; no hay módulo de credenciales | Catálogo/guard genérico; sin E2E de credenciales |
| sat.download | owner, accountant | Sí | Ninguno; no hay controller SAT | Catálogo; el guard no prueba esta acción end-to-end |
| payroll.view | owner, accountant | No | Ninguno live para nómina | Navegación demo; sin API |
| cfdi.review | owner, accountant, collaborator | No | Ninguno; sólo UI demo | Catálogo/navegación; sin API |
| cfdi.exclude | owner, accountant | No | Ninguno; sólo UI demo | Catálogo; sin API |
| exports.create | owner, accountant | Sí | Ninguno; sólo UI demo | Catálogo; sin API |
| clients.view | owner, accountant, collaborator | No | Controllers y vistas live de clientes | Unit/E2E de clientes |
| fiscal_years.view | owner, accountant, collaborator | No | FiscalYearsController y vistas live | Unit/E2E y navegación |

Owner recibe el catálogo completo por la política actual; accountant/collaborator usan las listas de permission-catalog.ts:169-198. No existen overrides membership_permissions. Una clave presente en catálogo sin caller no constituye enforcement funcional CFDI.

### 11.2 MFA y reautenticación

- credentials.manage y sat.download están en MFA_SENSITIVE_PERMISSION_KEYS.
- La afirmación documental de que las claves MFA divergen ya quedó obsoleta; el código actual usa las claves correctas.
- No existe autenticación reciente: me.controller.ts:32 devuelve reauthenticationRequiredActions vacío.
- AuditDecision define REAUTHENTICATION_REQUIRED, pero no existe flujo que lo produzca.

La carga manual no debe quedar bloqueada por la futura e.firma, pero la carga/uso de credenciales y la descarga SAT no deben habilitarse sin step-up/reautenticación.

### 11.3 Asignación y no enumeración

La base actual sí implementa account_assignments y 404 no enumerante. La documentación v3.3 que afirma lo contrario quedó desactualizada.

No existe membership_permissions ni overrides por membresía. Los permisos efectivos actuales provienen de role_permissions más el scope de cuenta.

### 11.4 RLS

No se encontró:

- ENABLE ROW LEVEL SECURITY;
- CREATE POLICY;
- SET LOCAL de contexto tenant;
- rol API/worker versionado sin BYPASSRLS;
- prueba RLS.

Estado: sin policies/RLS/SET LOCAL versionados en este repositorio, Confidence HIGH; estado de roles y policies de una base externa: UNKNOWN.

## 12. Controles de archivo por etapa

| Etapa | Control actual | Brecha/requisito propuesto P0, todavía no implementado |
| --- | --- | --- |
| BEFORE_STORAGE | Sesión, CSRF, patrón tenant/permiso, DTO whitelist | Falta endpoint, permiso ingestion.create, Idempotency-Key, rate/concurrency y safe key. Multipart puede validar bytes/MIME/hash durante stream; una URL firmada sólo puede validar intención, tamaño/checksum declarados y scope antes de recibir bytes |
| AFTER_STORAGE_BEFORE_PARSE | Ninguno | Falta verificar tamaño/hash/MIME/magic reales, objeto private/quarantined, scope completo, cifrado, scanner/política, TTL, inmutabilidad y auditoría |
| DURING_EXTRACTION | Ninguno | Falta negar traversal, paths absolutos/UNC, links, ZIP anidado/cifrado, exceso de entries/bytes/ratio/depth y cleanup |
| DURING_PARSE | Ninguno | Falta negar DTD/XXE/red, limitar bytes/depth/nodes/attributes/text/CPU/memoria, namespaces/versiones y redacción de errores |
| BEFORE_DOMAIN_COMMIT | Ninguno | Falta revalidar tenant/RFC/estado, upsert y lock por entidad+UUID, hash conflict, partial success y participaciones |

Requisito propuesto de trazabilidad: job_id, item_id, object_id, correlation_id, organization/account/entity, SHA-256, tamaño, MIME/version detectados, ordinal, nombre seguro, código estable, etapa, timestamps y attempts. La política propuesta prohíbe XML completo, password, llave privada, URL firmada y fragmentos del documento en logs/audit.

## 13. Límites actuales

| Límite | Evidencia | Valor actual verificable | Etiqueta |
| --- | --- | --- | --- |
| JSON/urlencoded | Nest platform-express declara default 100 KiB; main.ts no lo reemplaza | 100 KiB por default de dependencia; no aplica a multipart | REPO_LIMIT |
| Multipart fileSize/files | Multer transitivo sin configuración | Ningún máximo activo verificable en la app | UNKNOWN |
| Frontend count/bytes | accept .xml,.zip y multiple; sin handler | Ningún límite efectivo; accept es sólo hint | REPO_LIMIT |
| Proxy/reverse proxy | Sin configuración versionada | No verificable | UNKNOWN |
| Storage/bucket | Sin configuración versionada | No verificable | UNKNOWN |
| Worker memory/CPU | Sin despliegue versionado | No verificable | UNKNOWN |
| Concurrencia/retries | Sin job runner | No verificable | UNKNOWN |

No aparecen claves UPLOAD, INGESTION, XML, ZIP, S3 u OBJECT_STORAGE en env.validation.ts. No se inspeccionaron valores de entorno.

## 14. Observabilidad y operación

### 14.1 Presente

- correlation_id por request;
- filtro global de excepciones;
- Horus opcional para errores;
- Logger de Nest;
- audit_events con organización, actor, objeto y correlación;
- fallback observable del cache Redis.

### 14.2 Ausente para CFDI

- health/readiness de API, worker, DB, Redis y storage;
- métricas de jobs, edad de cola, throughput, duración, retries y resultados por item;
- tracing API → storage → worker → parser → DB;
- lease/heartbeat y detección de jobs huérfanos;
- alertas y runbooks;
- SLO/RPO/RTO;
- logs con catálogo de redacción específico;
- eventos auditados de DENY, MFA_REQUIRED, REAUTHENTICATION_REQUIRED y OUT_OF_SCOPE. El enum existe, pero los callers actuales sólo persisten ALLOW.

## 15. Estado real de tests

### 15.1 Cobertura reutilizable

- 404 cross-tenant y por asignación en client-accounts.e2e-spec.ts.
- Scope de cuentas en client-account-scope.service.spec.ts.
- Guards de permisos/MFA.
- CSRF, CORS, correlación, filtro global y configuración de DB.
- Sesión, cache Redis y revocación de asignaciones.
- Navegación y permisos del frontend.

### 15.2 Cobertura inexistente por falta del módulo

| Caso | Estado | Infra necesaria |
| --- | --- | --- |
| XML válido/malformado/truncado/XXE | MISSING | Parser seguro aislado |
| XML extranjero/versión no soportada | MISSING | Validador RFC/versiones |
| UUID mismo hash / hash distinto | MISSING | DB, locks, objetos e incidentes |
| ZIP bomb/traversal/encrypted/nested/MIME falso | MISSING | Extractor seguro y límites |
| Éxito parcial | MISSING | Job/items y transacciones por item |
| Un CFDI en varios períodos | MISSING | period_cfdis |
| Tenant B accede a job/objeto A | MISSING | FKs, scope, RLS y endpoints |
| Assignment revocado durante job | MISSING | Política de autorización worker |
| Browser/API/worker reiniciado | MISSING | Job durable, lease y polling |
| Storage sube y confirmación falla | MISSING | Idempotencia y reconciliación |
| Retry doble/cancelación concurrente | MISSING | State machine y locking |
| Dos uploads con misma key | MISSING | Registro idempotente |
| URL firmada vencida/de otro tenant | MISSING | Signer y autorización |
| SAT códigos/paquetes/reintentos | MISSING | Adapter SAT y fixtures contractuales |

## 16. Matriz frontend → API → job → tabla → permiso

| Flujo | Frontend live | API | Job/worker | Modelo documentado/candidato, no implementado | Permiso ejecutable | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| XML individual | No | No | No | stored_objects + ingestion_jobs/items | Falta ingestion.create | NOT_IMPLEMENTED |
| ZIP | No | No | No | stored_objects + ingestion_jobs/items | Falta ingestion.create | NOT_IMPLEMENTED |
| SAT on-demand | No | No | No | credential_records + sat_download_jobs/packages | sat.download existe y es MFA-sensitive, pero ningún endpoint CFDI/SAT lo ejerce | NOT_IMPLEMENTED |
| Ver proceso | Demo | No | No | ingestion_jobs/items | Falta ingestion.view | NOT_IMPLEMENTED |
| Reintentar/cancelar | Demo sin handler | No | No | ingestion_jobs | Faltan retry/cancel | NOT_IMPLEMENTED |
| Listar CFDI | Demo | No | No | cfdis | Falta cfdi.view | NOT_IMPLEMENTED |
| Ver detalle | Demo | No | No | cfdis + detalles | Falta cfdi.view | NOT_IMPLEMENTED |
| Descargar original | Demo visual | No | No | stored_objects | Falta cfdi.download | NOT_IMPLEMENTED |
| Participar en períodos | Demo | No | No | period_cfdis | Falta contrato | NOT_IMPLEMENTED |
| Incidentes | Demo | No | No | incidents | Faltan permisos | NOT_IMPLEMENTED |
| Exportación | Demo | No | No | export_jobs/objects | exports.create existe | NOT_IMPLEMENTED |

## 17. Hallazgos priorizados

### CFDI-AUD-001 — P0-BLOCKER — Dominio durable inexistente

- **Evidencia:** app.module.ts:61-68, migración ClientAccountsDomain.ts:11-174 y las 17 entidades actuales no incluyen stored_objects, jobs, items o cfdis.
- **Riesgo:** no existe autoridad para idempotencia, partial success, reinicio, provenance ni dedupe.
- **Impacto:** ninguna carga real puede ser confiable o recuperable.
- **Recomendación:** cerrar primero contratos/invariantes y crear una vertical física mínima con objetos, job, items, CFDI y participaciones.
- **Dependencia:** storage, worker, parser y DDL definitivo.
- **Momento:** antes del primer upload real.
- **Confidence:** HIGH.

### CFDI-AUD-002 — P0-BLOCKER — No existe job runner durable

- **Evidencia:** sin tabla, cola, worker, entrypoint, lease, heartbeat, retry o script; Redis sólo sirve sesiones.
- **Riesgo:** cerrar navegador/API o matar worker pierde o duplica trabajo.
- **Impacto:** incumple durabilidad, idempotencia y recuperación exigidas.
- **Recomendación:** elegir autoridad del job y definir state machine, locking, attempts, cancelación y reconciliación.
- **Dependencia:** decisión de arquitectura y topología de despliegue.
- **Momento:** antes de ZIP y antes de declarar completo el XML individual.
- **Confidence:** HIGH.

### CFDI-AUD-003 — P0-BLOCKER — No existe object storage ni contrato de upload

- **Evidencia:** sin adapter, bucket, URL firmada, multipart, streaming o cuarentena.
- **Riesgo:** buffering, pérdida del original, exposición fiscal o acoplamiento al filesystem del API.
- **Impacto:** no puede conservarse el XML original inmutable ni desacoplarse API/worker.
- **Recomendación:** aprobar contrato híbrido y una interfaz de storage con adaptadores dev/prod.
- **Dependencia:** operaciones, seguridad y arquitectura.
- **Momento:** antes del primer endpoint de carga.
- **Confidence:** HIGH.

### CFDI-AUD-004 — P0-BLOCKER — Parser XML/ZIP seguro ausente

- **Evidencia:** sin dependencia directa ni código; DOMParser legacy es local al navegador y no tiene límites, validación ni contrato server-side verificables.
- **Riesgo:** XXE, zip bomb, traversal, agotamiento de CPU/memoria, resultados fiscales incorrectos.
- **Impacto:** ingreso de contenido hostil o corrupción silenciosa.
- **Recomendación:** parser streaming/limitado, DTD/externals off, extractor con preflight y corpus contractual.
- **Dependencia:** versiones soportadas y límites.
- **Momento:** antes de procesar bytes no confiables.
- **Confidence:** HIGH.

### CFDI-AUD-005 — P0-REQUIRED — Frontend CFDI es demo y apiClient no soporta upload

- **Evidencia:** CfdiActions declara que no envía; live sólo soporta overview; api-client.ts fuerza JSON.
- **Riesgo:** conectar el input actual directamente produciría solicitudes inválidas y UX engañosa.
- **Impacto:** upload sin progreso, recuperación ni resultados parciales.
- **Recomendación:** crear cliente especializado para upload/202/polling y rutas live después del contrato.
- **Dependencia:** API y permisos.
- **Momento:** primera vertical manual.
- **Confidence:** HIGH.

### CFDI-AUD-006 — P0-REQUIRED — Permisos y reautenticación incompletos

- **Evidencia:** sólo sat.download, credentials.manage y cfdi.review/exclude; me.authorization devuelve reauthenticationRequiredActions vacío.
- **Riesgo:** consulta, mutación, retry, cancelación y original XML quedan mezclados; e.firma carece de step-up.
- **Impacto:** privilegio excesivo o bloqueo incorrecto.
- **Recomendación:** catálogo granular, guards, seeds, roles, MFA y reauth probados antes de rutas.
- **Dependencia:** matriz aprobada por producto/seguridad.
- **Momento:** junto con la primera ruta; SAT no se habilita sin reauth.
- **Confidence:** HIGH.

### CFDI-AUD-007 — P0-REQUIRED — El DDL objetivo permite cruces dentro del mismo tenant

- **Evidencia:** CORRECTED_POSTGRESQL_DATA_MODEL.md:576-748 enlaza varios padres sólo por organization_id.
- **Riesgo:** un bug puede asociar job/credencial/objeto/paquete de RFC distintos de la misma organización.
- **Impacto:** contaminación fiscal no cubierta por el aislamiento cross-tenant.
- **Recomendación:** FKs compuestas con organization/account/legal_entity en toda la cadena o constraint triggers explícitos y tests negativos.
- **Dependencia:** DDL definitivo.
- **Momento:** antes de escribir la migración.
- **Confidence:** HIGH.

### CFDI-AUD-008 — P0-REQUIRED — Provenance, UUID/hash e inmutabilidad no están cerrados físicamente

- **Evidencia:** source no impone origen exclusivo; UUID char(36) no canónico; mismo UUID/hash distinto sin transición; original inmutable sólo en prosa.
- **Riesgo:** reemplazo del original, dedupe inconsistente o pérdida de observaciones manual/SAT.
- **Impacto:** evidencia fiscal y trazabilidad no confiables.
- **Recomendación:** checks de origen/UUID/items, upsert con lock, hash conflict + incidente y restricciones de actualización.
- **Dependencia:** contrato de provenance.
- **Momento:** antes de persistencia.
- **Confidence:** HIGH.

### CFDI-AUD-009 — P0-REQUIRED — No hay controles ni límites de archivos

- **Evidencia:** sin límites app/env/proxy versionados, MIME/magic, SHA-256, cuarentena, scanner o límites ZIP/XML.
- **Riesgo:** DoS, malware, path abuse y costos no acotados.
- **Impacto:** exposición de API, worker, storage y datos.
- **Recomendación:** política por etapa, configuración central validada y perfil conservador medido en piloto.
- **Dependencia:** producto, seguridad y operaciones.
- **Momento:** antes del primer upload.
- **Confidence:** HIGH para repo; LOW para infraestructura externa.

### CFDI-AUD-010 — P0-REQUIRED — Sin RLS versionado y timing documental contradictorio

- **Evidencia:** no hay policies RLS ni SET LOCAL versionados en este repositorio; el modelo exige RLS antes de datos productivos, pero el plan lo desplaza a una etapa posterior.
- **Riesgo:** un fallo de scope en API/worker queda sin defensa en profundidad.
- **Impacto:** lectura o escritura fiscal cruzada.
- **Recomendación:** adoptar RLS en la primera vertical fiscal y probar roles sin BYPASSRLS.
- **Dependencia:** decisión de arquitectura y roles DB reales.
- **Momento:** antes de datos fiscales productivos.
- **Confidence:** HIGH para repo; LOW para roles desplegados.

### CFDI-AUD-011 — P0-REQUIRED — Falta matriz de pruebas del pipeline

- **Evidencia:** no hay tests CFDI/upload/job/storage/parser/SAT.
- **Riesgo:** fallos de parcialidad, aislamiento, concurrencia y seguridad llegarían a producción.
- **Impacto:** pérdida, duplicación o exposición de documentos.
- **Recomendación:** implementar contract/unit/integration/E2E y fault injection por cada etapa.
- **Dependencia:** contratos y adapters.
- **Momento:** junto con cada slice; no al final.
- **Confidence:** HIGH.

### CFDI-AUD-012 — P1-OPERATIONS — Observabilidad y recuperación insuficientes

- **Evidencia:** correlación/Horus existen; no hay métricas, health de worker/storage, SLO, alertas ni runbook.
- **Riesgo:** jobs estancados o pérdida silenciosa no se detectan.
- **Impacto:** soporte reactivo y recuperación manual.
- **Recomendación:** métricas de estado/edad/attempts/resultados, health, alertas y reconciliador.
- **Dependencia:** worker y estados.
- **Momento:** antes de piloto con datos reales.
- **Confidence:** HIGH.

### CFDI-AUD-013 — P1-HARDENING — Auditoría no redacta por catálogo ni registra denegaciones

- **Evidencia:** AuditService acepta metadata arbitraria; filtro registra message/stack; enum de decisiones existe pero callers sólo persisten ALLOW.
- **Riesgo:** un error futuro puede enviar XML, rutas o datos sensibles a logs/Horus; los intentos denegados no quedan trazados.
- **Impacto:** fuga de PII/fiscal y baja investigabilidad.
- **Recomendación:** allowlist/redactor central, errores estables y auditoría de deny/MFA/reauth/out-of-scope.
- **Dependencia:** catálogo de errores y eventos.
- **Momento:** antes de parser/SAT.
- **Confidence:** HIGH.

### CFDI-AUD-014 — DOCUMENTATION_CONFLICT — Documentos mezclan estado histórico y actual

- **Evidencia:** v3.3 dice que account_assignments no existe y que MFA diverge; ambas afirmaciones ya están resueltas. El modelo usa owner/admin de forma distinta al código y difiere en estados de período.
- **Riesgo:** implementar desde una sección histórica puede reintroducir errores.
- **Impacto:** migraciones, permisos y UI inconsistentes.
- **Recomendación:** marcar decisiones cerradas y emitir un ADR/contrato único antes de implementación.
- **Dependencia:** aprobación de arquitectura/producto.
- **Momento:** antes del prompt de implementación.
- **Confidence:** HIGH.

### CFDI-AUD-015 — TECH_DEBT — Toolchain local no permite migration:show

- **Evidencia:** npm/bun ejecutan typeorm-ts-node-commonjs, que falla con ERR_REQUIRE_ESM al requerir yargs; npm ls reporta workspace incompleto/extraneous.
- **Riesgo:** este entorno local no puede comprobar el esquema desplegado con el comando documentado; el fallo no demuestra un defecto de la infraestructura productiva.
- **Impacto:** la auditoría sólo confirma migraciones versionadas, no aplicadas.
- **Recomendación:** reparar instalación/lockfile/CLI en una tarea separada sin mezclarlo con CFDI.
- **Dependencia:** mantenimiento de toolchain.
- **Momento:** antes de validar migraciones CFDI.
- **Confidence:** HIGH.

### CFDI-AUD-016 — NOT_REQUIRED — No introducir arquitectura especulativa

- **Evidencia:** ARCHITECTURE.md exige monolito modular y PostgreSQL durable; no hay volumen medido.
- **Riesgo:** microservicios, CQRS, sharding, EAV o particionado temprano aumentan costo sin resolver P0.
- **Impacto:** retraso y mayor superficie operativa.
- **Recomendación:** módulo/worker en el mismo repositorio, repositorios específicos y medir antes de particionar.
- **Dependencia:** ninguna.
- **Momento:** durante diseño.
- **Confidence:** HIGH.

## 18. Bloqueos para el siguiente prompt definitivo

1. Contrato de upload aún candidato, no aprobado.
2. Autoridad y mecanismo durable del job aún no aprobados.
3. Proveedor/topología de object storage no definidos.
4. Correcciones físicas de provenance y same-tenant FKs no aprobadas.
5. Catálogo granular de permisos y política de reauth no aprobados.
6. Perfil productivo de límites/concurrencia no aprobado.
7. Estados y errores propuestos, pero aún no convertidos en contrato aprobado.
8. Estrategia RLS y roles DB no aprobados.
9. Scanner/retención de cuarentena no definidos.
10. Versiones CFDI/complementos del primer slice no definidas contra corpus oficial.

## 19. Hechos no verificables

| Hecho | Motivo | Tratamiento |
| --- | --- | --- |
| Migraciones realmente aplicadas en PostgreSQL | migration:show falla antes de conectar por incompatibilidad TypeORM/yargs | UNKNOWN |
| Configuración real de reverse proxy | No versionada | UNKNOWN |
| Bucket, cifrado, lifecycle o KMS productivo | No versionado | UNKNOWN |
| Redis productivo durable/no eviction | No versionado; el código lo trata como opcional | UNKNOWN |
| Roles DB y BYPASSRLS | No versionados | UNKNOWN |
| Recursos CPU/memoria y supervisión de procesos | Sin manifests de despliegue | UNKNOWN |
| Volumen real por RFC y corpus representativo | Sin telemetría/dataset | UNKNOWN |
| Especificación SAT posterior a fuentes consultadas | Requiere verificación al implementar | EXTERNAL |

## 20. Comandos y validaciones de auditoría

| COMMAND | RESULT | DURATION | OBSERVATION |
| --- | --- | --- | --- |
| git status --short | PASS | menor a 1 s | Cuatro archivos modificados preexistentes |
| git branch --show-current | PASS | menor a 1 s | develop |
| git rev-parse HEAD | PASS | menor a 1 s | a53de839eddf7febbbd611c63f514e611a3cf8b6 |
| git diff --stat | PASS | menor a 1 s | 4 files, 397 insertions, 86 deletions |
| git ls-files --others --exclude-standard | PASS | menor a 1 s | Vacío al inicio |
| rg de módulos/entities/controllers/migraciones | PASS | 1-2 s por lote | No existe dominio CFDI ejecutable |
| rg de queue/storage/parser/deploy | PASS | 1-2 s por lote | Sólo dependencias transitivas; ninguna integración |
| rg de RLS/SET LOCAL | PASS, sin coincidencias | menor a 1 s | RLS ausente en repo |
| rg de reauth | PASS | menor a 1 s | Sólo enum, tipo frontend y arreglo vacío |
| git log/blame de CfdiActions | PASS | menor a 1 s | Componente demo introducido en cebcbf3 |
| npm --prefix apps/api run typeorm -- migration:show | FAIL | 4.2 s | ERR_REQUIRE_ESM TypeORM/yargs antes de conectar |
| bun run --cwd apps/api typeorm migration:show | FAIL | 0.4 s | Mismo ERR_REQUIRE_ESM |
| npm ls --depth=0 | FAIL | 23.1 s | Workspaces unmet y node_modules/.bun extraneous |
| Lectura DOCX con runtime bundled | PASS | No capturada | Extracción sólo lectura; no se creó DOCX/PDF |
| Consulta de fuentes oficiales SAT | PASS | 1-2 s | Flujo, e.firma, versiones y estados externos verificados |

No se ejecutaron lint, build ni tests generales: el lint de API usa --fix, el test web genera .test-dist y los builds generan artefactos. Para respetar el alcance read-only y la regla de crear sólo dos archivos, se priorizó inspección estática y comandos sin salida persistente.

La validación Git final se registra en la respuesta de cierre y debe confirmar que esta tarea sólo agregó los dos informes.
