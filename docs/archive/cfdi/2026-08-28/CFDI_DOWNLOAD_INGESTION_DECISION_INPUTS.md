# Insumos de decisión para descarga e ingesta CFDI

## 1. Propósito y resultado

Este documento convierte la evidencia del repositorio en opciones, contratos candidatos y decisiones explícitas. No autoriza implementación ni sustituye un ADR, threat model o contrato aprobado.

**Definition of Ready actual: NOT_READY.**

Existe información suficiente para evitar otra auditoría amplia, pero aún no para emitir un prompt definitivo de implementación: hay decisiones abiertas de arquitectura, seguridad, operaciones, producto y especificación SAT. Cuando se cierren las filas pendientes del handoff final, el siguiente prompt puede dividirse en una vertical manual XML y una vertical ZIP sin rediseñar el futuro flujo SAT.

## 2. Decisiones ya cerradas

Estas decisiones proceden del prompt de auditoría y de control_mensual_cfdi v3.3. No deben reabrirse en el siguiente prompt.

| ID | Decisión cerrada | Autoridad y evidencia |
| --- | --- | --- |
| LOCK-001 | La carga manual XML/ZIP es P0. | Prompt adjunto, líneas 87-91 |
| LOCK-002 | La descarga real SAT on-demand es P0. | Prompt adjunto, líneas 89-91 y 177-179 |
| LOCK-003 | Se puede implementar manual primero, pero el MVP no queda completo sin SAT durable y recuperable. | Prompt adjunto, líneas 93-95 |
| LOCK-004 | XML es el original primario; PDF queda fuera de P0. | Prompt adjunto, líneas 97-99 |
| LOCK-005 | Manual acepta un XML individual o un ZIP. | Prompt adjunto, líneas 101-107 |
| LOCK-006 | ZIP tiene éxito parcial; un elemento inválido no revierte los válidos. | Prompt adjunto, líneas 105-107 y 145-149 |
| LOCK-007 | Resultados visibles: incorporated, duplicate, foreign, invalid, unsupported e internal_error. | Prompt adjunto, líneas 109-119; traducción contractual al inglés estable |
| LOCK-008 | ZIP se procesa asíncronamente; cerrar el navegador o reiniciar API/worker no pierde el job. | Prompt adjunto, líneas 121-127 |
| LOCK-009 | Todo efecto es idempotente. | Prompt adjunto, línea 129 |
| LOCK-010 | Existe un CFDI lógico por legal_entity_id + UUID normalizado. | Prompt adjunto, líneas 131-133 |
| LOCK-011 | El XML original es inmutable y no aparece completo en logs o auditoría. | Prompt adjunto, líneas 135-137 |
| LOCK-012 | Manual y SAT convergen en validación, parsing, dedupe y persistencia compartidos. | Prompt adjunto, líneas 145-153 |
| LOCK-013 | Manual primero y SAT después no duplican el CFDI; se conservan procedencias y observaciones. | Prompt adjunto, líneas 139-143 |
| LOCK-014 | Un CFDI puede participar en varios períodos. | Prompt adjunto, línea 139 |
| LOCK-015 | Foreign, invalid y unsupported no entran al dominio fiscal; los válidos sí se conservan aunque otros fallen. | Prompt adjunto, líneas 145-149 |
| LOCK-016 | La entidad fiscal/RFC es la unidad fiscal; una cuenta puede tener varios RFC. | Prompt adjunto, líneas 79-83 |
| LOCK-017 | La asignación es a nivel cuenta y se hereda a sus entidades. | Prompt adjunto, línea 85 |
| LOCK-018 | Tenant y RFC enviados por el frontend nunca son autoridad. | Prompt adjunto, líneas 157-159 |
| LOCK-019 | Se validan sesión, organización, membresía, permiso, asignación y estado del recurso; fuera de scope se oculta normalmente con 404. | Prompt adjunto, líneas 161-175 |
| LOCK-020 | Estado interno, estado/código/mensaje SAT y texto accionable de UI son conceptos separados. | Prompt adjunto, líneas 181-189 |
| LOCK-021 | La arquitectura sigue como monolito modular; un worker puede ser proceso separado en el mismo repositorio. | Prompt adjunto, líneas 191-193 |
| LOCK-022 | PostgreSQL es la autoridad durable; Redis puede despertar/acelerar, nunca ser la única autoridad del job. | Prompt adjunto, líneas 195-197 |
| LOCK-023 | No introducir microservicios, CQRS, buses, repositorios genéricos, sharding o particionado sin evidencia. | Prompt adjunto, líneas 191-197; ARCHITECTURE.md |
| LOCK-024 | SAT P0 es on-demand; la sincronización programada/desatendida queda para después. | Prompt adjunto, líneas 177-180 |
| LOCK-025 | El producto no determina deducibilidad, ingreso acumulable ni impuesto definitivo. | Prompt adjunto, línea 151 |
| LOCK-026 | PUE no significa pago comprobado. | Prompt adjunto, línea 153 |
| LOCK-027 | PPD sin complemento es una advertencia dependiente de la fecha de corte. | Prompt adjunto, línea 155 |
| LOCK-028 | Nómina requiere autorización específica. | Prompt adjunto, línea 157 |

## 3. Contradicciones documentales que deben corregirse

| ID | Contradicción | Evidencia | Resolución recomendada |
| --- | --- | --- | --- |
| DOC-001 | v3.3 dice que account_assignments no existe | La migración 1787690100000 y servicios/E2E ya lo implementan | Marcar esa sección como histórica |
| DOC-002 | v3.3 reporta divergencia en claves MFA | permission-catalog.ts:35-48 ya usa las claves exactas | Marcar como resuelto |
| DOC-003 | El modelo objetivo habla de owner/admin como roles tenant | El código distingue owner contractual, roles tenant y admin de plataforma | Usar la semántica actual y corregir el DDL/documento |
| DOC-004 | RLS se exige antes de datos productivos y también se posterga a etapa 10 | CORRECTED_POSTGRESQL_DATA_MODEL.md:164 y :1779-1784 | Aprobar RLS en la primera vertical fiscal |
| DOC-005 | Los estados de período difieren | Código: preparation/review/changes_detected; modelo: preparing/in_review/has_updates | Elegir un catálogo canónico y mapear UI |
| DOC-006 | La IA contiene pantallas y acciones CFDI | El propio documento dice que la estructura no implica SAT/storage/persistencia; el código live no las soporta | Etiquetar rutas como DEMO hasta conexión real |
| DOC-007 | El input demo permite múltiples XML | Decisión cerrada: un XML individual o ZIP | Quitar multiple en el flujo live |
| DOC-008 | El DDL define source pero no origen exclusivo | v3.3 exige exactamente un origen por job | Añadir constraints y semántica first-seen/observations |

## 4. Recomendación técnica inicial

Lo siguiente es una **recomendación**, no una decisión aprobada.

1. Mantener un monolito modular con un proceso worker separado dentro del mismo repositorio.
2. Usar PostgreSQL como registro durable del job, con lease, heartbeat, locking y reintentos; Redis sólo como wakeup opcional.
3. Definir un ObjectStorage port con adapter filesystem aislado para desarrollo y adapter S3-compatible privado para ambientes administrados.
4. Adoptar transferencia híbrida: multipart streaming para XML individual pequeño y URL firmada para ZIP; ambos crean el mismo stored_object.
5. Hacer converger manual XML, manual ZIP y paquetes SAT después de la etapa de objeto disponible.
6. Corregir FKs same-tenant, origen exclusivo, UUID canónico, hash conflict e inmutabilidad antes de escribir migraciones.
7. Aplicar RLS desde la primera vertical fiscal, además de FKs compuestas y scope de aplicación.
8. Separar permisos de ver, crear, descargar, reintentar, cancelar y administrar credenciales; exigir MFA+reauth sólo donde corresponda.
9. Implementar parsing seguro por versiones explícitas, con unsupported como resultado normal y sin autoexclusiones fiscales.
10. Entregar cada slice con fault injection, métricas, redacción y reconciliación; no posponer durabilidad/seguridad hasta SAT.

## 5. Límites de módulos recomendados

| Módulo | Responsabilidad | No debe hacer |
| --- | --- | --- |
| object-storage | Crear/confirmar objetos, streaming, hash, quarantine, signed URLs, lifecycle metadata | Interpretar CFDI o decidir períodos |
| ingestion | Crear jobs/items, idempotencia, state machine, orchestration, resultados parciales | Conocer SOAP SAT |
| cfdi-domain | Normalización UUID/RFC, parser por versión, validación, dedupe, persistencia fiscal y participaciones | Custodiar e.firma |
| sat-download | Credenciales mediante port seguro, autenticación, solicitud, polling, paquetes y mapeo oficial | Duplicar parser/persistencia |
| authorization | Scope, permisos, MFA/reauth, no enumeración y contexto worker | Confiar en tenant del payload |
| worker entrypoint | Claim/lease/heartbeat, ejecución, retry/cancel y shutdown seguro | Ser una autoridad distinta de PostgreSQL |
| processes query | Lectura paginada de jobs/items/incidentes | Mutar dominio mediante GET |

No se recomienda un repositorio genérico. Cada agregado necesita queries, locks e invariantes específicas.

## 6. Alternativas de job y worker

### 6.1 Comparación

| Criterio | A. PostgreSQL jobs + lease/locking | B. BullMQ/Redis + PG domain | C. Infra actual |
| --- | --- | --- | --- |
| Autoridad durable | PostgreSQL | Redis para queue + PostgreSQL para dominio | No existe |
| Encaje documental | Alto | Medio | Nulo |
| Dependencia nueva | No necesariamente | BullMQ y Redis durable | Ninguna, pero no resuelve |
| Reinicio worker | Reclaim por lease | Semántica BullMQ + reconciliación | Pierde trabajo |
| Transacción job/dominio | Más directa | Dual-write o outbox/reconciliación | No aplica |
| Operación | Un datastore durable, worker nuevo | Redis productivo, worker y PG | Imposible |
| Riesgo principal | Lock/lease incorrecto | Dos fuentes y configuración eviction/persistencia | Sin durabilidad |

### 6.2 Recomendación

**Recomendación pendiente de DEC-ARCH-01:** opción A.

- ingestion_jobs es la autoridad.
- El worker reclama con SELECT ... FOR UPDATE SKIP LOCKED o una operación atómica equivalente.
- lease_expires_at, heartbeat_at, attempt_count, next_attempt_at y worker_id son persistentes.
- Redis, si se usa, sólo publica wakeups; el polling de PostgreSQL garantiza recuperación.
- Cada item se confirma en una transacción acotada.
- Shutdown deja de reclamar, termina o libera en forma segura.
- Un reconciliador recupera jobs con lease vencido y objetos huérfanos.
- Los efectos externos que no puedan perderse requieren outbox; no se añade un bus genérico.

## 7. Multipart vs URL firmada vs híbrido

| Alternativa | Ventajas | Desventajas | Uso recomendado |
| --- | --- | --- | --- |
| Multipart vía API | Autorización simple, una llamada, adecuada para XML pequeño | Mantiene conexión, consume ancho de banda/API, exige streaming y límites | XML individual hasta límite aprobado |
| URL firmada | Descarga carga del API, progreso del cliente, mejor para ZIP | Flujo de init/complete, objetos huérfanos, CORS/bucket y autorización de confirmación | ZIP y objetos mayores |
| Híbrido | UX simple para XML y escalable para ZIP/SAT | Dos contratos de transporte y más tests | Recomendado |

**Recomendación pendiente de DEC-ARCH-02:** adoptar el híbrido; la tabla no constituye aprobación.

### 7.1 Invariantes comunes

- La API deriva organization/account/legal_entity de sesión y ruta validada.
- La URL firmada sólo permite una key generada por servidor, tamaño/content-type acotados y expiración corta.
- Confirmar upload revalida scope, estado, tamaño, hash y object key.
- El objeto nace private/quarantined y nunca público.
- Idempotency-Key cubre inicio, confirmación y creación del job.
- Un objeto no puede enlazarse a otro RFC dentro del mismo tenant.
- El worker sólo procesa objetos available y de su scope.

### 7.2 Idempotencia durable

**Recomendación pendiente de DEC-ARCH-06:** separar la idempotencia por operación y ligar cada clave a un fingerprint.

| Operación | Clave/fingerprint candidato | Replay |
| --- | --- | --- |
| XML directo + creación de job | Una workflow key; fingerprint de entity, source y metadata declarada, completado con hash/tamaño detectados | Misma key/fingerprint devuelve el mismo objectId/jobId y respuesta original |
| Inicio de ZIP firmado | upload-init key; fingerprint de entity, kind, filename seguro, tamaño y checksum declarado | Devuelve el mismo uploadId/objectId mientras sea válido |
| Confirmación de ZIP | uploadId + versión/ETag/checksum del objeto | Confirmación repetida devuelve el mismo estado; distinta evidencia es conflicto |
| Creación de job ZIP | job-create key; fingerprint de entity, source y objectId confirmado | Devuelve el mismo jobId |
| Solicitud SAT futura | Clave por entity, scope, rango, parámetros y credencial versionada | Devuelve la misma solicitud lógica según política SAT |

Reglas:

- La clave es opaca, normalizada y acotada; el contrato debe elegir varchar/char coherente, no depender de padding.
- La DB necesita UNIQUE por organization, legal_entity, operation y key, o uniques equivalentes en tablas específicas.
- Se persisten request_fingerprint, response_status, response_body mínimo/replayable y timestamps.
- Misma clave + mismo fingerprint reproduce determinísticamente la respuesta.
- Misma clave + fingerprint distinto responde IDEMPOTENCY_CONFLICT 409.
- Dos requests concurrentes compiten por el unique; ninguno crea un segundo objeto/job.
- El DDL actual sólo tiene idempotency_key en jobs y no puede sostener init/confirm. Debe agregarse ingestion_uploads o soporte equivalente antes de aprobar el contrato.

## 8. Object storage

### 8.1 Port mínimo

| Operación | Resultado esperado |
| --- | --- |
| initiateUpload(scope, metadata, limits) | objectId, método de transferencia y expiración |
| putStream(objectId, stream) | bytes, hash y MIME detectado |
| confirmUpload(objectId, proof) | objeto durable quarantined |
| openReadStream(objectId) | stream privado sólo para worker autorizado |
| promote(objectId) | available tras controles |
| quarantine(objectId, reason) | estado y TTL |
| issueDownload(objectId, actor, ttl) | URL/token de un solo alcance |
| deleteExpired(objectId) | borrado auditable |

### 8.2 Adapter de desarrollo y producción

- Desarrollo: directorio dedicado fuera de public, permisos mínimos, nombres generados, sin usar el nombre del usuario como path.
- Producción: storage compatible con objetos privados, cifrado, lifecycle, tags/scope y URL firmada.
- La elección de proveedor, KMS, bucket policy, versioning y replicación es de operaciones/seguridad; no está resuelta por el repo.

## 9. Modelo físico y procedencia

### 9.1 Cambios necesarios al modelo objetivo

1. Agregar claves únicas compuestas que incluyan organization_id, client_account_id, legal_entity_id e id en los padres fiscales.
2. Encadenar job → credential, SAT job/package, upload object; item → object; cfdi → xml object con esas FKs.
3. Agregar ck_ingestion_jobs_origin:
   - manual_xml y manual_zip requieren upload_object_id y niegan SAT package;
   - sat_package requiere sat_download_job_id y package_id coherentes;
   - cualquier metadata-only necesita contrato explícito.
4. Usar tipo uuid para folio fiscal cuando sea posible, o CHECK de representación canónica mayúscula.
5. Mantener UNIQUE (legal_entity_id, normalized_uuid).
6. Definir cfdis.first_seen_source o retirar source de la entidad principal; cada ingestion_item conserva su observación.
7. Agregar checks:
   - incorporated y duplicate requieren cfdi_id;
   - foreign, invalid, unsupported e internal_error requieren error_code y no crean CFDI;
   - cada item tiene object/hash/ordinal trazables.
8. Proteger original y campos fiscales contra reemplazo; sólo permitir enriquecimientos one-way explícitos.
9. Mantener importes como numeric/decimal; no portar parseFloat del legacy.
10. Conservar FKs de period_cfdis para que un CFDI participe en N períodos dentro de su mismo RFC.

#### Registro mínimo de procedencia

| Campo/capacidad | Dónde viviría | Regla |
| --- | --- | --- |
| origin | ingestion_job.source | manual_xml, manual_zip, sat_package o metadata; exactamente uno |
| requested_by | ingestion_job.requested_by_membership_id | Nullable sólo para service identity documentada; no se deriva del objeto |
| observed_at | ingestion_item.created_at | Una fila por observación, incluso duplicate |
| first_seen_at/source | cfdis.first_seen_at + first_seen_source | Inmutable después de crear el CFDI |
| last_observed_at | Derivado MAX de items o materializado con regla | Nunca sustituye first_seen ni borra observaciones |
| upload/object | item.object_id, hash, size, MIME, safe filename | Scope completo y original identificado |
| SAT request/package | job.sat_download_job_id y sat_download_package_id | Ambos coherentes con entity y object |
| cutoff | sat_download_job.cutoff_at; snapshot en observación si afecta reglas | No inferir desde hora de procesamiento |
| XML availability | cfdi.metadata_only + xml_object_id | metadata puede enriquecerse one-way a XML; no volver a metadata |
| official SAT state | Campos SAT separados con checked_at | No altera el estado interno por traducción implícita |
| parser contract | parser_version, cfdi_version, complement_versions | Reproducible y consultable sin guardar XML en logs |
| correlation | correlation_id en job/audit/worker | Une request y proceso sin usar PII como label |

El DDL actual no contiene todos estos campos, especialmente first_seen_source, parser_version, complement_versions y una observación explícita de cutoff. Deben aprobarse como columnas o metadata tipada/allowlisted; no como JSON libre sin contrato.

### 9.2 Mismo UUID y hash

**Recomendación pendiente de DEC-ARCH-04:** aprobar la política de no reemplazo descrita en esta matriz.

| Caso | Resultado recomendado | Dominio | Evidencia conservada |
| --- | --- | --- | --- |
| UUID nuevo, XML válido | incorporated | Crear CFDI y original | item, object, hash, source |
| UUID existente, mismo hash | duplicate | No crear ni reemplazar | Nueva observación/item |
| UUID existente, hash distinto | invalid con CFDI_UUID_HASH_CONFLICT | No reemplazar; abrir incidente | Ambos object metadata/hashes; bytes conflictivos en cuarentena por TTL |
| Sin UUID válido | invalid | No crear CFDI | item/error; objeto según retención |
| RFC fuera de entidad permitida | foreign | No crear CFDI | item/error redactado |
| Versión no soportada | unsupported | No crear CFDI fiscal en P0 | item/version/hash; original según política |

La comparación de hash debe ser por legal_entity y no una deduplicación global cross-tenant, que crearía un side-channel.

### 9.3 Participación en períodos

period_cfdis representa participación, no propiedad. El parser puede producir candidatos de período, pero la política debe:

- crear la participación por reglas fiscales explícitas;
- permitir más de una participación tipada;
- registrar quién/qué regla la creó;
- no mover el CFDI al cambiar de período;
- conservar decisiones manuales en work_decisions append-only.

#### Matriz candidata de eventos y períodos

| Evento | Participación candidata | Automático/revisable | Riesgo que debe probarse |
| --- | --- | --- | --- |
| CFDI emitido | issued en período derivado de fecha fiscal/zona aprobada | Automático, fecha/regla versionada | Límites de mes, zona y emisión tardía |
| CFDI recibido | received en período derivado por regla aprobada | Automático con revisión | Fecha de emisión vs recepción/certificación |
| Complemento de pago | payment en período de paid_at; relación al CFDI base sin moverlo | Automático, relaciones revisables | Múltiples Pago/DoctoRelacionado, monedas y parcialidades |
| Nómina | payroll sólo con payroll.view/autorización específica | Automático en scope autorizado; revisable | Exposición de datos personales y período de pago |
| Cancelación SAT | Mantiene participaciones; actualiza estado oficial y genera novedad | Automático, revisión si afecta cierre | No borrar original ni decisiones |
| Sustitución/relación | related_update en períodos afectados según regla | Automático candidato; revisión | Ciclos, UUID aún no presente y varios períodos |
| Revisión/exclusión manual | Nueva work_decision versionada en cada participación | Manual | No convertir criterio en hecho fiscal global |
| Cierre | Snapshot de participaciones/decisiones | Automático al cerrar, con guard | Cambios concurrentes y versión latest |
| Observación posterior al cutoff/cierre | Incrementa source_revision y marca novedad; no mueve CFDI | Automático con atención humana | Reapertura, doble alerta y dedupe |

La regla exacta de fecha para issued/received/payment y la semántica post-cierre quedan en DEC-ARCH-08 y DEC-PROD-05; no deben improvisarse en el parser.

## 10. Matriz de permisos candidata

Los nombres son candidatos; deben aprobarse antes de tocar seeds/roles.

| Acción | Clave candidata | Owner | Accountant | Collaborator | MFA | Reauth |
| --- | --- | --- | --- | --- | --- | --- |
| Ver jobs/items | ingestion.view | Sí | Sí | Sí si asignado | No | No |
| Ver centro global de procesos | processes.view o reutilizar ingestion.view con scope | Sí | Sí | Decisión | No | No |
| Crear carga manual | ingestion.create | Sí | Sí | Opcional por producto | No por defecto | No |
| Reintentar carga | ingestion.retry | Sí | Sí | No por defecto | No | No |
| Cancelar carga | ingestion.cancel | Sí | Sí | No por defecto | No | No |
| Ver CFDI | cfdi.view | Sí | Sí | Sí si asignado | No | No |
| Descargar XML original | cfdi.download | Sí | Sí | Decisión | Recomendado | Decisión seguridad |
| Revisar | cfdi.review existente | Sí | Sí | Actual: sí | No | No |
| Clasificar | cfdi.classify o semántica acotada dentro de cfdi.review | Sí | Sí | Decisión | No | No |
| Ejecutar acción masiva | cfdi.bulk más el permiso de la acción subyacente | Sí | Sí | No por defecto | Según acción | Según acción |
| Excluir con motivo | cfdi.exclude | Sí | Sí | No por defecto | No | No |
| Ver nómina | payroll.view existente | Sí | Sí | No | Según política de sesión | No |
| Exportar / ZIP de XML | exports.create existente + autorización sobre cada CFDI | Sí | Sí | No | Sí actualmente | Decisión seguridad |
| Ver jobs SAT | sat.view | Sí | Sí | No | Sí | No para lectura |
| Solicitar descarga SAT | sat.download existente | Sí | Sí | No | Sí | Sí |
| Reintentar/cancelar SAT | sat.retry / sat.cancel | Sí | Sí | No | Sí | Sí si usa credencial |
| Ver metadata de credencial | credentials.view | Sí | Sí según política | No | Sí | No |
| Cargar/rotar/eliminar credencial | credentials.manage existente | Sí | Decisión | No | Sí | Sí |
| Ver incidentes | incidents.view | Sí | Sí | Sí si asignado | No | No |
| Resolver incidente | incidents.manage | Sí | Sí | No por defecto | No | No |

Admin de plataforma no hereda acceso fiscal por su etiqueta. El acceso de soporte requiere grant temporal explícito y auditoría.

Los defaults Owner/Accountant/Collaborator son decisión PRODUCT (DEC-PROD-04). MFA, reauth, step-up y composición de permisos en acciones masivas son decisión SECURITY (DEC-SEC-04). El hard cap de seguridad no puede ser debilitado por un rol o una preferencia comercial.

## 11. MFA y reautenticación

### 11.1 Estado actual

- MFA TOTP y enforcement por claves sensibles sí existen.
- credentials.manage y sat.download ya son sensibles.
- No existe reauthenticated_at, token step-up ni ventana.
- reauthenticationRequiredActions siempre se devuelve vacío.

### 11.2 Contrato candidato

- POST /auth/reauthenticate valida password + TOTP cuando la sesión tiene MFA.
- La sesión registra reauthenticated_at o emite un token step-up corto ligado a session_id, organization_id y purpose.
- Cambiar organización, credencial, sesión o factor invalida el step-up.
- La API evalúa permiso, MFA y reauth; el frontend sólo refleja.
- Hipótesis a validar: ventana de 10 minutos para credentials.manage y acciones SAT que firman/usan e.firma.
- No almacenar password de e.firma en sesión, job, logs o frontend después del uso autorizado.

## 12. RLS

### 12.1 Opciones

| Opción | Beneficio | Costo/riesgo |
| --- | --- | --- |
| Primera vertical fiscal | Defensa desde el primer objeto/job/CFDI | Requiere contexto transaccional y roles ya |
| Antes de SAT | Menor trabajo inicial | Manual sólo sería aceptable en entorno no productivo con gate |
| Hardening posterior | Velocidad aparente | No recomendado: datos fiscales quedan sin defensa DB |

### 12.2 Recomendación

**Recomendación pendiente de DEC-SEC-01:** RLS en la primera vertical fiscal.

Primera vertical fiscal:

- policies en organizations/memberships/client_accounts/legal_entities y en stored_objects, ingestion_jobs/items, cfdis y period_cfdis; proteger sólo tablas hijas deja rutas indirectas por padres;
- luego policies de credential_records y sat_download_jobs en la misma vertical SAT;
- SET LOCAL de organization, membership y account scope dentro de cada transacción; GUC ausente o inválida falla cerrado;
- refactorizar operaciones que hoy usan Repository fuera de una transacción —por ejemplo client-account-scope.service.ts:18-21 y lecturas de servicios—: SET LOCAL no puede sobrevivir de forma segura al pooling entre requests; algunas mutaciones ya usan DataSource.transaction y sirven como patrón parcial;
- roles API y worker sin BYPASSRLS y que no sean owner de las tablas, o usar FORCE ROW LEVEL SECURITY con una justificación probada;
- jobs de sistema con identidad de servicio y scope explícito;
- limpiar el contexto al liberar la conexión; nunca usar SET de sesión persistente en el pool;
- tests positivos/negativos con GUC ausente, tenant B, cuenta B del mismo tenant, assignment revocado, table owner y worker;
- FKs compuestas permanecen obligatorias: RLS no reemplaza integridad.

El estado de roles, ownership y policies en una base desplegada sigue UNKNOWN porque no se pudo introspectar. Esta recomendación describe el contrato a aprobar, no afirma que ya exista.

## 13. Límites candidatos

No son límites del repo ni decisiones aprobadas. El perfil “recomendado” es una hipótesis conservadora que debe probarse con un corpus real.

| Recurso | Mínimo | Recomendado | Máximo a evaluar | Etiqueta | Config candidata | Motivo |
| --- | --- | --- | --- | --- | --- | --- |
| XML individual | 2 MiB | 5 MiB | 10 MiB | SECURITY_RECOMMENDATION + PRODUCT_DECISION | INGESTION_XML_MAX_BYTES | Acota payload, CPU y memoria; validar corpus |
| XML en selección directa | 1 | 1 | 1 | PRODUCT_DECISION | INGESTION_DIRECT_MAX_FILES | Decisión cerrada: lote usa ZIP |
| ZIP comprimido | 25 MiB | 50 MiB | 100 MiB | SECURITY_RECOMMENDATION + PRODUCT_DECISION + INFRA_LIMIT | INGESTION_ZIP_MAX_COMPRESSED_BYTES | Red, storage y ventana de transferencia |
| ZIP total descomprimido | 100 MiB | 250 MiB | 500 MiB | SECURITY_RECOMMENDATION + PRODUCT_DECISION + INFRA_LIMIT | INGESTION_ZIP_MAX_UNCOMPRESSED_BYTES | Defensa contra zip bomb |
| Entries ZIP | 500 | 2,000 | 5,000 | SECURITY_RECOMMENDATION + PRODUCT_DECISION + INFRA_LIMIT | INGESTION_ZIP_MAX_ENTRIES | Cardinalidad de CPU/DB |
| Ratio compresión entry/global | 20:1 | 50:1 | 100:1 | SECURITY_RECOMMENDATION | INGESTION_ZIP_MAX_COMPRESSION_RATIO | XML comprime mucho; medir sin perder defensa |
| Profundidad de carpeta | 0 | 2 | 4 | SECURITY_RECOMMENDATION | INGESTION_ZIP_MAX_PATH_DEPTH | Reduce path abuse |
| Path normalizado | 120 | 240 | 512 caracteres | SECURITY_RECOMMENDATION | INGESTION_ZIP_MAX_PATH_LENGTH | Evita diferencias de plataforma |
| Depth XML | 32 | 64 | 128 | SECURITY_RECOMMENDATION | INGESTION_XML_MAX_DEPTH | Limita stack/CPU |
| Nodos XML | 50 mil | 200 mil | 500 mil | SECURITY_RECOMMENDATION + PRODUCT_DECISION + INFRA_LIMIT | INGESTION_XML_MAX_NODES | Presupuesto CPU/memoria |
| Atributos totales / elemento | 20 mil / 64 | 100 mil / 128 | 250 mil / 256 | SECURITY_RECOMMENDATION | INGESTION_XML_MAX_ATTRIBUTES | Evita payload patológico |
| Texto por nodo | 256 KiB | 1 MiB | 2 MiB | SECURITY_RECOMMENDATION | INGESTION_XML_MAX_TEXT_BYTES | Evita nodos gigantes |
| Parsing por XML | 2 s | 5 s | 10 s | SECURITY_RECOMMENDATION + INFRA_LIMIT | INGESTION_XML_PARSE_TIMEOUT_MS | Aísla agotamiento CPU |
| Memoria worker | 128 MiB | 256 MiB | 512 MiB | SECURITY_RECOMMENDATION + INFRA_LIMIT | INGESTION_WORKER_MEMORY_LIMIT_MB | Requiere streaming y límite de proceso |
| Jobs activos por usuario | 1 | 2 | 3 | SECURITY_RECOMMENDATION + PRODUCT_DECISION | INGESTION_MAX_ACTIVE_JOBS_PER_USER | Abuso y UX |
| Jobs activos por tenant | 2 | 4 | 8 | SECURITY_RECOMMENDATION + PRODUCT_DECISION + INFRA_LIMIT | INGESTION_MAX_ACTIVE_JOBS_PER_TENANT | Fairness y pools |
| Retries automáticos | 2 | 3 | 5 | SECURITY_RECOMMENDATION + PRODUCT_DECISION + INFRA_LIMIT | INGESTION_MAX_RETRY_ATTEMPTS | Evita tormenta de reintentos |
| Cuarentena | 24 h | 7 días | 30 días | SECURITY_RECOMMENDATION + PRODUCT_DECISION | INGESTION_QUARANTINE_RETENTION_HOURS | Diagnóstico vs privacidad/costo |

Proxy, API y storage deben aceptar el límite elegido más overhead, pero no un techo mayor que el worker jamás procesará. El streaming sigue siendo obligatorio aunque el archivo quepa en memoria. SECURITY/OPERATIONS fijan el hard cap técnico; PRODUCT sólo puede elegir una cuota comercial igual o menor, nunca debilitar el hard cap.

## 14. Versiones CFDI y complementos

### 14.1 Opciones

| Perfil | Incluye | Ventaja | Riesgo |
| --- | --- | --- | --- |
| V1 estrecho | CFDI 4.0 + TFD vigente | Menor superficie para la primera vertical | Pagos/nómina/histórico quedan unsupported |
| V1 operativo | CFDI 4.0 + TFD + Pagos 2.0; Nómina 1.2 si P0 lo requiere | Cubre control mensual moderno | Mayor corpus y reglas |
| Histórico | 3.0/3.2/3.3/4.0 y complementos por época | Alinea rangos SAT amplios | Mucha complejidad antes de medir necesidad |

### 14.2 Recomendación

- Aprobar una allowlist explícita por namespace+version, nunca detectar sólo por prefijo.
- Primer parser: CFDI 4.0 y Timbre Fiscal Digital; agregar Pagos 2.0 en el mismo milestone si la conciliación PPD es requisito de salida.
- Tratar versiones/complementos desconocidos como unsupported, conservar resultado y no improvisar campos.
- Preservar el original válido según política incluso si un complemento aún no se interpreta.
- Añadir 3.3/histórico sólo contra corpus y rango SAT/producto aprobados.
- Descargar XSD/catálogos oficiales en build/vendor controlado o un artifact versionado; no permitir fetch de red durante parsing.

La lista final requiere PRODUCT y EXTERNAL_SAT_SPEC.

## 15. Estados candidatos

Estos estados no coinciden todavía con todos los CHECK del DDL documental. Son una propuesta pendiente de DEC-ARCH-05; la migración y los contratos deben usar un solo vocabulario.

### 15.1 Object

| Estado | Significado |
| --- | --- |
| pending_upload | Metadata creada, bytes aún no confirmados |
| uploaded | Bytes completos, tamaño/hash pendientes de verificación final |
| quarantined | Privado; esperando controles |
| available | Aprobado para worker |
| rejected | No procesable; conserva metadata y TTL |
| deleted | Bytes eliminados de forma auditable |

### 15.2 Ingestion job

| Estado | Terminal | Significado |
| --- | --- | --- |
| awaiting_upload | No | Falta confirmación del objeto |
| queued | No | Durable y reclamable |
| scanning | No | Controles de objeto |
| extracting | No | ZIP bajo límites |
| parsing | No | Lectura/validación por item |
| persisting | No | Commit idempotente por item |
| cancel_requested | No | Worker debe detener en boundary seguro |
| completed | Sí | Todos los items terminales sin error operativo |
| completed_with_errors | Sí | Éxito parcial con resultados no incorporated/duplicate |
| failed_retryable | No | El intento falló y puede volver a queued; pasa a failed_terminal al agotar política o por error no retryable |
| failed_terminal | Sí | Error del job no recuperable |
| cancelled | Sí | Cancelado sin revertir items ya incorporados |

### 15.3 Ingestion item

Los resultados terminales de producto son exactamente:

- incorporated;
- duplicate;
- foreign;
- invalid;
- unsupported;
- internal_error.

Se pueden usar estados internos received/validating/persisting, pero la UI y el contrato final muestran una de las seis categorías.

### 15.4 SAT job

Estados internos candidatos: queued, authenticating, requested, polling, packages_available, downloading, ingesting, completed, failed_retryable, failed_terminal, cancel_requested y cancelled.

Campos oficiales separados:

- sat_request_id;
- sat_status_code;
- sat_status_message;
- sat_request_state;
- package_ids;
- last_sat_response_at.

La UI deriva mensajes accionables sin traducir el código oficial a un enum interno.

### 15.5 Incident

open, acknowledged, resolved y dismissed, siempre con historial append-only. Hash conflict y fallos de seguridad no se resuelven reemplazando el original.

El incidente de ingesta debe poder vivir en scope legal_entity/job/item sin period_id. El DDL actual exige period_id NOT NULL y usa open/in_progress/resolved/accepted_exception/cancelled; debe ampliarse o la propuesta debe adoptar ese catálogo. Nunca se asigna un período arbitrario a un hash conflict.

### 15.6 Reconciliación obligatoria con el DDL documental

| Agregado | DDL actual | Propuesta de este documento | Acción antes de migrar |
| --- | --- | --- | --- |
| stored_objects | active/quarantined/expired/deleted | pending_upload/uploaded/quarantined/available/rejected/deleted | Aprobar lifecycle y mapear active/expired o reemplazar CHECK |
| ingestion_jobs | queued/processing/completed/completed_with_errors/failed/cancelled | Estados por scanning/extracting/parsing/persisting, retry y cancel request | Aprobar granularidad; agregar attempts/lease/heartbeat/next_attempt/worker/cancel |
| ingestion_items | pending/processed/duplicate/invalid/rejected/failed | Seis resultados de producto + estados internos | Agregar incorporated/foreign/unsupported/internal_error o separar processing_status/result |
| sat_download_jobs | credential_required/queued/authenticating/requested/polling/packages_ready/downloading/importing/completed/completed_with_issues/failed_retryable/failed_final/expired/cancelled | packages_available/ingesting/failed_terminal/cancel_requested, entre otros | Elegir nombres canónicos; conservar código/estado oficial por separado |
| sat_download_packages | pending/downloading/downloaded/imported/expired/failed | Sin catálogo detallado distinto | Mantener si cubre checksum/retry; agregar attempts/error retryability si no |
| incidents | open/in_progress/resolved/accepted_exception/cancelled; period obligatorio | open/acknowledged/resolved/dismissed; scope pre-período | Rediseñar scope y reconciliar nombres |

Los counters de ingestion_jobs deben derivarse o mantenerse transaccionalmente para incorporated, duplicate, foreign, invalid, unsupported e internal_error; valid_items/invalid_items/rejected_items no bastan sin una tabla de mapeo estable.

## 16. Catálogo candidato de errores estables

| Código | Capa | HTTP/resultado | Retryable | Exposición segura |
| --- | --- | --- | --- | --- |
| RESOURCE_NOT_FOUND | Auth/scope | 404 | No | Recurso no disponible |
| PERMISSION_REQUIRED | Auth | 403 | No | Permiso insuficiente |
| MFA_REQUIRED | Auth | 403 | Sí tras MFA | Requiere MFA |
| REAUTHENTICATION_REQUIRED | Auth | 403 | Sí tras step-up | Confirma tu identidad |
| IDEMPOTENCY_KEY_REQUIRED | API | 400 | Sí | Falta clave de idempotencia |
| IDEMPOTENCY_CONFLICT | API | 409 | No con payload distinto | La clave ya corresponde a otra solicitud |
| FILE_TOO_LARGE | Upload | 413 / invalid | No | Archivo supera límite |
| FILE_COUNT_EXCEEDED | Upload | 400 / invalid | No | Usa un XML o ZIP |
| MEDIA_TYPE_INVALID | Upload | 415 / invalid | No | Tipo de archivo no permitido |
| OBJECT_HASH_MISMATCH | Storage | invalid | No | El archivo no coincide con la confirmación |
| OBJECT_STORAGE_UNAVAILABLE | Storage | failed_retryable | Sí | Servicio temporalmente no disponible |
| MALWARE_DETECTED | Scan | invalid | No | Archivo rechazado |
| ZIP_ENCRYPTED | Extract | invalid | No | ZIP cifrado no soportado |
| ZIP_PATH_INVALID | Extract | invalid | No | ZIP contiene rutas no permitidas |
| ZIP_LIMIT_EXCEEDED | Extract | invalid | No | ZIP excede límites de seguridad |
| ZIP_CRC_INVALID | Extract | invalid | No | ZIP dañado |
| XML_MALFORMED | Parse | invalid | No | XML no válido |
| XML_SECURITY_VIOLATION | Parse | invalid | No | XML rechazado por seguridad |
| CFDI_VERSION_UNSUPPORTED | Parse | unsupported | No | Versión no soportada |
| CFDI_UUID_INVALID | Validate | invalid | No | Folio fiscal inválido |
| CFDI_RFC_FOREIGN | Validate | foreign | No | CFDI no corresponde a esta entidad |
| CFDI_DUPLICATE | Persist | duplicate | No | Ya incorporado |
| CFDI_UUID_HASH_CONFLICT | Persist | invalid + incident | No automático | Conflicto de original |
| JOB_LEASE_LOST | Worker | failed_retryable | Sí | Reintentando |
| JOB_NOT_RETRYABLE | API | 409 | No | El proceso no admite reintento |
| JOB_STATE_CONFLICT | API | 409 | Depende | El proceso cambió de estado |
| PARSER_INTERNAL_ERROR | Worker | internal_error | Sí acotado | Error interno sin contenido |
| SAT_AUTH_FAILED | SAT | failed_terminal o retryable según código | Depende | Revisa credencial |
| SAT_RATE_LIMITED | SAT | failed_retryable | Sí | El SAT pidió esperar |
| SAT_REQUEST_REJECTED | SAT | failed_terminal | No automático | Mostrar código oficial redactado |
| SAT_PACKAGE_DOWNLOAD_FAILED | SAT | failed_retryable | Sí | Reintentando paquete |

Stack, XML, path original hostil, llave, password, token SAT y URL firmada nunca forman parte del mensaje público o audit metadata.

## 17. Contratos API candidatos

Todos los contratos son candidatos. Los IDs de organización/cuenta en payload se ignoran o se rechazan; el scope se resuelve desde sesión y jerarquía.

### 17.1 XML individual por multipart streaming

POST /api/v1/legal-entities/{legalEntityId}/ingestion-jobs

Headers:

- Content-Type: multipart/form-data con boundary del cliente.
- Idempotency-Key: valor opaco de 36-64 caracteres generado por el cliente, ligado al fingerprint durable definido en 7.2.

Partes:

- source = manual_xml.
- file = exactamente un XML.

Respuesta 202:

~~~json
{
  "jobId": "uuid",
  "status": "queued",
  "statusUrl": "/api/v1/ingestion-jobs/uuid",
  "createdAt": "RFC3339"
}
~~~

La API no espera al parser; sólo responde después de objeto y job durables.

### 17.2 ZIP con URL firmada

POST /api/v1/legal-entities/{legalEntityId}/ingestion-uploads

~~~json
{
  "kind": "manual_zip",
  "filename": "lote.zip",
  "sizeBytes": 123456
}
~~~

Respuesta 201 candidata:

~~~json
{
  "uploadId": "uuid",
  "objectId": "uuid",
  "method": "PUT",
  "uploadUrl": "redacted-signed-url",
  "requiredHeaders": {
    "content-type": "application/zip"
  },
  "expiresAt": "RFC3339"
}
~~~

Después del PUT:

POST /api/v1/legal-entities/{legalEntityId}/ingestion-jobs

~~~json
{
  "source": "manual_zip",
  "uploadId": "uuid"
}
~~~

Respuesta 202 igual al XML. Confirmar revalida object key, scope, bytes y estado; nunca confía en filename/MIME del navegador.

### 17.3 Consulta y control

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | /ingestion-jobs/{jobId} | Estado, progreso, conteos y links |
| GET | /ingestion-jobs/{jobId}/items?cursor=... | Resultados paginados sin XML |
| POST | /ingestion-jobs/{jobId}/retry | 202 para error retryable |
| POST | /ingestion-jobs/{jobId}/cancel | 202 cancel_requested o 409 terminal |
| GET | /legal-entities/{legalEntityId}/cfdis?... | Lista paginada/filterable |
| GET | /cfdis/{cfdiId} | Detalle legible autorizado |
| POST | /cfdis/{cfdiId}/original-downloads | URL/token privado corto y auditado |

Todas las rutas por job/CFDI/object deben devolver 404 si están fuera de scope.

### 17.4 SAT

| Método | Ruta candidata | Función |
| --- | --- | --- |
| POST | /legal-entities/{legalEntityId}/sat-download-jobs | Solicitar on-demand |
| GET | /sat-download-jobs/{jobId} | Estado interno + campos oficiales separados |
| GET | /sat-download-jobs/{jobId}/packages | Paquetes y estado de ingesta |
| POST | /sat-download-jobs/{jobId}/retry | Reintentar sólo estados permitidos |
| POST | /sat-download-jobs/{jobId}/cancel | Solicitar cancelación interna |

El adapter SAT guarda cada paquete por ObjectStorage y crea ingestion_jobs con source sat_package. No llama un parser alterno.

### 17.5 Respuesta de job

~~~json
{
  "id": "uuid",
  "source": "manual_zip",
  "status": "completed_with_errors",
  "progress": {
    "total": 12,
    "terminal": 12,
    "incorporated": 8,
    "duplicate": 1,
    "foreign": 1,
    "invalid": 1,
    "unsupported": 1,
    "internalError": 0
  },
  "createdAt": "RFC3339",
  "updatedAt": "RFC3339",
  "canRetry": false,
  "canCancel": false
}
~~~

## 18. Seguridad por etapa

| Etapa | Requisitos P0 |
| --- | --- |
| Antes de storage | Común: scope/404, permiso, estado active, CSRF, idempotencia, rate/concurrency y safe object key. Multipart: bytes/count/MIME/magic/hash durante stream. URL firmada: sólo intención, tamaño/checksum declarados, método/key/scope y expiración |
| Después de storage | Verificar tamaño, hash, MIME/magic reales y checksum; objeto private/quarantined, scope completo, cifrado, scanner/política, TTL, sin URL firmada persistida y audit |
| Extracción | Preflight central directory, no traversal/absolute/UNC/drive/link/nested/encrypted, CRC, caps y temp aislado |
| Parsing | DTD/entidades/red off, limits, timeout/memoria, namespace/version allowlist, sin snippet en error |
| Commit | Revalidar scope/RFC/estado, lock/upsert, same-hash duplicate, different-hash incident, partial success y period participation |

La revocación de una asignación durante un job necesita una decisión explícita (DEC-SEC-05). Opciones compatibles con durabilidad: detener en el siguiente boundary y conservar parcialidad, o terminar el job ya aceptado bajo service identity/scope durable mientras el usuario revocado pierde lectura/control inmediatamente. Recomendación pendiente: terminar el trabajo ya aceptado, conservar actor solicitante + service principal y revalidar que organización/cuenta/entidad sigan activas; SECURITY debe confirmar que esto satisface LOCK-019.

## 19. Retención y cuarentena

| Artefacto | Recomendación candidata | Dueño de decisión |
| --- | --- | --- |
| XML válido original | Retención contractual/legal; inmutable y privado | PRODUCT + SECURITY |
| Paquete SAT original | Retener hasta ingestión verificada y ventana de recuperación; luego lifecycle | OPERATIONS + PRODUCT |
| XML duplicate mismo hash | Conservar observación; reutilizar canonical blob dentro del mismo RFC si política lo permite | ARCHITECTURE |
| UUID hash conflict | 7 días en cuarentena inicial, incidente y no reemplazo | SECURITY |
| Invalid/foreign/unsupported | Conservar metadata/item; bytes por TTL definido, no indefinidamente | PRODUCT + SECURITY |
| Malware/ZIP hostil | Cuarentena privada fail-closed; acceso security-only; purge auditable | SECURITY |
| Temporales extraídos | Borrar al terminar/fallar; nunca backup | OPERATIONS |
| Signed URL | 5-10 minutos, scope único, no log | SECURITY |
| Logs/audit | Códigos y metadata allowlisted; nunca XML/token/password/URL | SECURITY |

## 20. Observabilidad, SLO y piloto

### 20.1 Métricas mínimas

- jobs_created_total por source;
- jobs_terminal_total por status;
- ingestion_items_total por resultado;
- job_queue_age_seconds;
- job_duration_seconds;
- item_parse_seconds;
- worker_lease_reclaims_total;
- retry_total por error_code;
- object_bytes y quarantine_total;
- SAT request/poll/package counters por código oficial;
- auth denials por permiso/MFA/reauth/scope, sin identificadores fiscales en labels.

### 20.2 SLO candidatos de piloto

No son compromisos aprobados:

| Indicador | Hipótesis inicial |
| --- | --- |
| Crear job después de objeto durable | p95 menor a 2 s, sin contar transferencia |
| Consulta de estado | p95 menor a 500 ms |
| XML de hasta 5 MiB a terminal | p95 menor a 60 s |
| ZIP de hasta 50 MiB/2,000 entries | p95 menor a 15 min |
| Job aceptado perdido tras reinicio | 0 |
| Efectos duplicados por retry/idempotencia | 0 |
| Reclaim de lease vencido | menor a 2 min |
| Purga tras TTL de cuarentena | 99 por ciento dentro de 24 h |

El piloto debe medir p50/p95/p99, memoria pico, CPU por XML, compresión, cardinalidad por RFC, retries SAT, costo storage y tasa de unsupported antes de elevar límites.

### 20.3 Runbooks mínimos

- worker sin heartbeat;
- storage disponible pero DB commit falló;
- DB commit correcto y notificación/wakeup falló;
- job estancado;
- object upload huérfano;
- spike de invalid/malware;
- SAT rate limit o código desconocido;
- rotación/revocación de credencial;
- rollback de release sin perder jobs.

## 21. Matriz de pruebas futura

| Capa | Casos mínimos | Infra/fixture |
| --- | --- | --- |
| Contract API | 202, Idempotency-Key, 400/403/404/409/413/415, cursor | Supertest, storage fake |
| Authorization | tenant B, cuenta B mismo tenant, no assignment, revoked, admin plataforma | PostgreSQL + roles |
| RLS | API/worker positive y negative, sin BYPASSRLS | PostgreSQL real |
| Upload | boundary, abort, tamaño, MIME falso, hash mismatch, signed URL vencida/ajena | Storage emulator/adapter |
| XML security | DTD, XXE, entity bomb, depth, attrs, text, encoding, truncado | Corpus sintético no fiscal |
| CFDI contract | namespaces/versiones/tipos/complementos | Fixtures anonimizados o sintéticos |
| ZIP security | bomb, traversal, absolute, UNC, symlink, nested, encrypted, CRC | Corpus generado |
| Dedupe | mismo UUID/hash, hash distinto, concurrencia, manual→SAT, SAT→manual | PostgreSQL + worker |
| Partial success | mezcla de seis resultados | Job/items |
| Periods | un CFDI en N períodos y tipos | DB integration |
| Durability | browser/API/worker restart, kill mid-item, lease expiry | Worker process harness |
| Atomicity | storage ok/DB fail; DB ok/wakeup fail; retry doble | Fault injection |
| Cancel/retry | concurrente, terminal, partial committed | Worker + locks |
| SAT | auth, request, poll, codes, duplicate, packages, rate limits | Adapter fake + contract snapshots oficiales |
| Redaction | logs/Horus/audit nunca contienen XML, secret, URL o path hostil | Logger sink test |
| Observability | métricas/alerts/reconciler | Integration |

No se usan XML fiscales reales en tests de seguridad. Los fixtures deben ser sintéticos o anonimizados y versionados con procedencia.

## 22. Orden de implementación recomendado

1. Cerrar handoff y registrar ADRs/contratos.
2. Corregir modelo objetivo: FKs, origin, UUID/hash, item checks e inmutabilidad.
3. Crear permisos/seeds/guards, contexto RLS y tests de aislamiento.
4. Crear ObjectStorage port, adapter dev, adapter productivo, quarantine y límites.
5. Crear tablas/repositorio de jobs, worker, lease, heartbeat, retry/cancel y reconciliador.
6. Implementar XML individual end-to-end con parser seguro, dedupe y resultados.
7. Conectar pantalla live, apiClient especializado, 202/polling y recuperación tras recarga.
8. Implementar ZIP sobre el mismo pipeline y validar partial success/fault injection.
9. Agregar procesos, incidentes, original download y observabilidad/runbooks.
10. Implementar credenciales/reauth y adapter SAT; convertir paquetes a objetos e ingestion_jobs compartidos.

Cada paso debe dejar el repositorio compilable y probado. ZIP no debe crear un segundo parser; SAT no debe crear un segundo dominio.

## 23. Definition of Ready

### 23.1 Estado

**NOT_READY**

### 23.2 Razones

Esta evaluación se limita al prompt de implementación de **carga manual XML/ZIP**. La inexistencia de código es el punto de partida, no un criterio de rechazo; se evalúa si el contrato está suficientemente decidido.

| Requisito de DoR manual | Insumo disponible | Cierre requerido | Estado de decisión |
| --- | --- | --- | --- |
| Contrato de upload | Híbrido y contratos candidatos | DEC-ARCH-02 | PENDING |
| Job durable | PostgreSQL+lease y campos faltantes identificados | DEC-ARCH-01 y DEC-ARCH-05 | PENDING |
| Object storage | Port/lifecycle candidato | DEC-OPS-01 y DEC-ARCH-02 | PENDING |
| Procedencia/UUID/hash/incidentes | Campos, matrices y gaps físicos identificados | DEC-ARCH-03, DEC-ARCH-04 y DEC-ARCH-09 | PENDING |
| Permisos | Matriz real y candidata | DEC-PROD-04 y DEC-SEC-04 | PENDING |
| Límites/cuotas/capacidad | Perfil mínimo/recomendado/máximo | DEC-PROD-01, DEC-OPS-02 y DEC-SEC-03 | PENDING |
| Estados y errores | Catálogos candidatos + divergencia DDL documentada | DEC-ARCH-05 | PENDING |
| Idempotencia | Workflow/fingerprint/replay candidato; soporte físico ausente | DEC-ARCH-06 | PENDING |
| Retry/cancel/progreso | Estados/endpoints candidatos | DEC-PROD-06 y DEC-ARCH-07 | PENDING |
| Asignación a períodos | Matriz de eventos candidata | DEC-ARCH-08 y DEC-PROD-05 | PENDING |
| Aislamiento | FKs+RLS+tests y gaps de pooling/owner definidos | DEC-SEC-01 | PENDING |
| Parsing seguro/versiones | Controles y perfiles de versión candidatos | DEC-PROD-02 y DEC-EXT-01 | PENDING |
| Scanner/quarantine/retención | Controles y TTL candidatos | DEC-SEC-03, DEC-OPS-03 y DEC-PROD-03 | PENDING |
| Revocación durante job | Dos políticas compatibles descritas | DEC-SEC-05 | PENDING |

El estado no es READY_WITH_DECISIONS porque no quedan únicamente decisiones de producto/arquitectura: también faltan cierres de seguridad, operaciones y especificación SAT.

Las decisiones exclusivamente SAT —proveedor de credenciales, polling oficial y scheduling futuro— no bloquean el prompt manual. Sí bloquean cualquier afirmación de que el MVP SAT está listo y las interfaces manuales deben conservar la convergencia ya cerrada.

### 23.3 Condición para pasar a READY

- Resolver las filas PENDING manuales mediante los IDs del handoff.
- Convertir las decisiones en un ADR/contrato versionado.
- Definir fixtures oficiales/sintéticos y criterios de aceptación.
- Redactar el prompt de implementación por verticales, comenzando por XML individual.

Reparar migration:show es TECH_DEBT útil para validar migraciones futuras, pero no es una decisión de producto/arquitectura ni un bloqueo de información para redactar el prompt.

## 24. Preguntas legítimas para producto

1. ¿Cuál es el volumen p50/p95/máximo de XML y ZIP por RFC y por día?
2. ¿Qué versiones/complementos deben quedar incorporados en la primera salida y cuáles pueden terminar como unsupported?
3. ¿Quién puede cargar manualmente y quién puede descargar el XML original?
4. ¿Qué retención legal/contractual aplica a originales, paquetes SAT y resultados inválidos?
5. ¿Qué UX se desea para cancelación cuando ya existen items incorporados?
6. ¿Qué mensaje/acción ve el usuario ante UUID igual con hash distinto, sin exponer detalles sensibles?
7. ¿La primera salida debe incluir Pagos 2.0 y Nómina 1.2 o sólo CFDI base 4.0?
8. ¿Qué límites comerciales por plan/tenant deben coexistir con los límites de seguridad?

## HANDOFF FOR PRODUCT OWNER AND ARCHITECT

| ID | Decisión | Hecho del repo | Opciones | Recomendación técnica | Impacto | Quién decide |
| --- | --- | --- | --- | --- | --- | --- |
| DEC-LOCK-01 | Prioridad manual y SAT | Ambas son P0; manual puede ir primero, MVP requiere SAT durable | No aplica — decisión cerrada | Aplicar el alcance cerrado | Roadmap y criterio MVP | ALREADY_DECIDED |
| DEC-LOCK-02 | Semántica manual | Un XML o ZIP, éxito parcial y seis resultados | No aplica — decisión cerrada | Quitar multiple del XML live y aplicar partial success | UX, API y jobs | ALREADY_DECIDED |
| DEC-LOCK-03 | Identidad/provenance | Un CFDI por entidad+UUID, original inmutable, N períodos, manual/SAT convergen | No aplica — decisión cerrada | Convertir la invariante en constraints y tests | DDL y dominio | ALREADY_DECIDED |
| DEC-LOCK-04 | Arquitectura base | Monolito modular, worker mismo repo, PG durable, Redis opcional | No aplica — decisión cerrada | No añadir microservicios/CQRS ni usar Redis como única autoridad | Operación y complejidad | ALREADY_DECIDED |
| DEC-LOCK-05 | Criterios fiscales y autorización | SAT P0 es on-demand; scheduling después; producto no determina efectos fiscales; PUE no prueba pago; PPD depende de cutoff; nómina exige permiso | No aplica — decisión cerrada | Preservar advertencias, separación de hechos y payroll.view | Reglas, UI y seguridad | ALREADY_DECIDED |
| DEC-ARCH-01 | Mecanismo durable de jobs | No existe queue/worker; PG ya es autoridad y Redis es cache opcional | A PG lease/locking; B BullMQ como transporte con PG autoridad + reconciliación | Opción A con Redis wakeup opcional | Tablas, locks, worker, reconciliación y despliegue | ARCHITECTURE |
| DEC-ARCH-02 | Contrato de transferencia | apiClient fuerza JSON; no hay multipart/signed URL | Multipart; signed URL; híbrido | Híbrido: XML multipart streaming, ZIP signed URL | Dos contratos, storage, CORS, progreso y tests | ARCHITECTURE |
| DEC-OPS-01 | Proveedor/topología de object storage | No hay storage ni infra versionada | S3-compatible managed; proveedor cloud; filesystem sólo dev | Port común, private bucket y adapter dev aislado | Costo, KMS, lifecycle, disponibilidad y local dev | OPERATIONS |
| DEC-ARCH-03 | Correcciones físicas del DDL | Modelo es documental y permite cruces same-tenant/origen ambiguo | FKs compuestas; triggers; sólo checks app | FKs compuestas + checks; triggers sólo donde FK no alcance | Migración, locks y mantenibilidad | ARCHITECTURE |
| DEC-ARCH-04 | Política UUID igual/hash distinto | El modelo no define transición; reemplazar contradice original inmutable | Rechazar+incidente; cuarentena+revisión; bloquear sólo el item | invalid + CFDI_UUID_HASH_CONFLICT, incidente y no reemplazo | Soporte, storage y evidencia | ARCHITECTURE |
| DEC-SEC-01 | Momento de RLS | Cero policies/SET LOCAL; docs se contradicen | Primera vertical; antes de SAT; posterior | Primera vertical fiscal | Roles DB, transacciones, migraciones y tests | ARCHITECTURE |
| DEC-PROD-01 | Volumen y límites comerciales | Sin telemetría; volumen por RFC pendiente | Perfil mínimo/recomendado/máximo | Iniciar perfil recomendado y ajustar con piloto | UX, rechazos, costo y capacidad | PRODUCT |
| DEC-OPS-02 | Concurrencia, retries y SLO | Sin worker/capacidad/deploy | Valores de la matriz y piloto por ambiente | 4 jobs/tenant, 3 retries como hipótesis medida | Pools, CPU, memoria, soporte y alertas | OPERATIONS |
| DEC-SEC-02 | Ventana de reautenticación | No existe reauthenticated_at; SAT/credentials son MFA-sensitive | Por acción; 5/10/15 min | 10 min como hipótesis, ligada a purpose/tenant/session | Seguridad de e.firma y fricción | SECURITY |
| DEC-SEC-03 | Scanner y quarantine | No existe scanner ni TTL | Managed/local; fail-open/fail-closed; 24h/7d/30d | Fail-closed para ZIP/sospechosos y 7 días iniciales | Privacidad, costo y respuesta a incidentes | SECURITY |
| DEC-OPS-03 | Proveedor de scanner | No hay infraestructura ni dependencia | Servicio managed; daemon aislado; contenido estructural sin AV | Adapter sustituible, health y timeout; coordinar con política security | Despliegue, disponibilidad y costo | OPERATIONS |
| DEC-SEC-04 | MFA/reauth y composición de permisos | Catálogo actual es grueso, reauth vacío y acciones masivas no existen | MFA sólo sensibles; step-up por acción; MFA amplio | Aprobar matriz candidata, mínimo privilegio y original auditado | Guards, frontend y soporte | SECURITY |
| DEC-PROD-04 | Defaults de permisos por rol | Owner/accountant/collaborator actuales no cubren ingesta/procesos | Colaborador lectura; carga opcional; sólo accountant muta | Permitir lectura asignada; decidir explícitamente carga manual de collaborator | Seeds, UX y operación del despacho | PRODUCT |
| DEC-PROD-02 | Versiones/complementos P0 | Repo soporta cero; SAT puede entregar histórico | 4.0 estrecho; 4.0+Pagos/Nómina; histórico | 4.0+TFD y Pagos 2.0 si conciliación es P0; resto unsupported | Parser, corpus, fechas y UX | PRODUCT |
| DEC-EXT-01 | Catálogo técnico SAT vigente | Fuentes oficiales confirman flujo, pero deben congelarse al implementar | Snapshot actual; verificación en implementación; proveedor tercero | Verificar WSDL/XSD/códigos oficiales y versionar contract snapshots | Adapter, retries y estados externos | EXTERNAL_SAT_SPEC |
| DEC-PROD-03 | Retención de originales/paquetes/resultados | Documentos exigen original inmutable, no fijan todos los TTL | Retención contractual y perfiles 24h/7d/30d | Definir por tipo; temporales cero, cuarentena 7d inicial | Legal, privacidad y storage | PRODUCT |
| DEC-OPS-04 | Topología y supervisión del worker | No hay Docker/PM2/K8s/CI versionado | Mismo proceso API; proceso separado; servicio administrado | Proceso separado del API, mismo repo/release y shutdown seguro | Escalado, releases, health y recovery | OPERATIONS |
| DEC-ARCH-05 | State machines, counters y errores | Estados propuestos no coinciden con CHECK/counters del DDL | Estados granulares; coarse status + stage/result; ampliar todos los CHECK | Coarse job status + current_stage; item processing_status + seis resultados; catálogo de errores estable | Migración, API, polling, métricas y UI | ARCHITECTURE |
| DEC-ARCH-06 | Idempotencia multi-paso | Jobs tienen key; upload init/confirm no tienen fingerprint/replay durable | Una workflow key; keys por operación; ledger genérico | Workflow ID con keys derivadas por operación, fingerprint y replay específico | Constraints, 409 y concurrencia | ARCHITECTURE |
| DEC-ARCH-07 | Protocolo de progreso | apiClient no expone Location/Retry-After ni polling/SSE | Polling; SSE; WebSocket | Polling P0 con ETag/Retry-After; SSE sólo si métricas lo justifican | Cliente HTTP, carga de API y recuperación | ARCHITECTURE |
| DEC-PROD-06 | Semántica de cancelación/reintento | Puede haber items incorporados antes de cancelar/fallar | Revertir; conservar parcial; nuevo job de retry; mismo job | Conservar parcial, nunca revertir CFDI válidos; retry manual enlaza un nuevo job al original | Mensajes, auditoría y soporte | PRODUCT |
| DEC-ARCH-08 | Reglas técnicas de participación por período | period_cfdis existe sólo en DDL; no hay regla de eventos/fechas | Regla por issued_at/paid_at; asignación manual; policy versionada | Policy versionada y automática con revisión; no mover el CFDI | DDL, parser y cierre | ARCHITECTURE |
| DEC-PROD-05 | Semántica de período/cutoff/novedad | Fecha de received, post-cierre y related_update no están cerradas | Emisión; certificación; recepción; combinación por evento | Aprobar matriz de eventos, cutoff y UX de novedad/reapertura | Reportes y trabajo mensual | PRODUCT |
| DEC-ARCH-09 | Scope de incidentes de ingesta | incidents exige period_id; hash conflict puede ser pre-período | incidents con period nullable; ingestion_incidents; subjects tipados | Scope explícito legal_entity/job/item con FKs; period opcional bajo CHECK | Migración, consultas y soporte | ARCHITECTURE |
| DEC-SEC-05 | Assignment revocado durante job | LOCK-019 exige scope activo; job durable puede estar en proceso | Detener en boundary; completar bajo service identity; política por etapa | Completar lo aceptado, revocar acceso del usuario y revalidar recursos activos | Aislamiento, soporte y auditoría | SECURITY |
| DEC-SEC-06 | Hard caps de seguridad | Cero límites reales; PRODUCT no puede elevar seguridad | Perfil mínimo/recomendado/máximo con hard cap separado | Adoptar recomendado como piloto y bloquear cualquier cuota superior | DoS, costos y capacidad | SECURITY |
