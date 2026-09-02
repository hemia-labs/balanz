# Contrato técnico de la plataforma de ingesta CFDI

- Versión contractual: `p0.1`
- Fecha: 2026-08-28
- Fase 0: `BLOCKED`
- Fases 1–8: `NOT_STARTED`

## 1. Propósito y límite público

Este contrato define las interfaces internas y garantías durables que Fase 0
debe entregar a las futuras verticales XML, ZIP, SAT, exportación y lifecycle.
No es un contrato de producto para cargar CFDI.

En Fase 0 **no existe ni se debe registrar**:

- endpoint de carga XML o ZIP;
- endpoint de creación de una ingesta fiscal por usuario;
- parser funcional, validación XSD o handler XML de producción;
- lista, detalle o descarga real de CFDI;
- endpoint SAT, e.firma, mesa mensual o exportación;
- UI de cualquiera de esas capacidades.

Las rutas de Fase 1 que aparezcan en documentos de arquitectura son únicamente
reservas `FUTURE / NOT_STARTED`; no forman parte de OpenAPI ni del runtime de
Fase 0. Los únicos endpoints nuevos permitidos en Fase 0 son probes técnicos de
API/worker y, si la arquitectura existente lo requiere, exposición de métricas
protegida por el control operativo vigente.

## 2. Vocabulario e invariantes

| Término     | Significado contractual                                                  |
| ----------- | ------------------------------------------------------------------------ |
| objeto      | bytes privados más metadata, scope, hash, tamaño y lifecycle             |
| upload      | intención/recepción durable de un objeto; no equivale a CFDI válido      |
| job         | unidad durable reclamable por un worker                                  |
| item        | unidad técnica observada dentro de un job; no es dominio CFDI en F0      |
| claim       | asignación atómica y temporal de un job a un worker                      |
| lease       | derecho temporal a hacer heartbeat/transición; no ownership permanente   |
| wakeup      | señal best-effort para reducir latencia, sin autoridad ni payload fiscal |
| fingerprint | representación canónica versionada de una solicitud idempotente          |

Invariantes:

1. Todo objeto/upload/job/item tiene `organization_id`, `client_account_id` y
   `legal_entity_id`; su integridad se protege con FKs compuestas.
2. IDs del cliente nunca deciden scope sin resolución server-side.
3. Toda query fiscal normal ocurre dentro de una transacción con `SET LOCAL
app.organization_id` y, cuando aplique, `SET LOCAL app.membership_id`, más
   FORCE RLS; contexto ausente o inválido falla cerrado.
4. Los bytes confirmados son inmutables y su path/key es opaco.
5. PostgreSQL es la única autoridad de jobs; Redis sólo despierta.
6. Una transición terminal requiere lease vigente y versión esperada.
7. Logs/métricas nunca incluyen RFC, UUID fiscal, nombre, razón social, XML,
   filename, idempotency key completa, signed URL ni secretos.

## 3. Identificadores, tiempo y concurrencia

- IDs técnicos son UUID y se serializan en formato canónico minúsculo.
- Timestamps son `timestamptz`/ISO-8601 UTC en límites de proceso.
- `version` es un entero positivo incrementado en cada mutación protegida.
- `correlation_id` se propaga desde request/proceso o se genera en el primer
  boundary; no es una idempotency key.
- Comandos mutables usan `expectedVersion` cuando pueden competir; un mismatch
  produce `JOB_STATE_CONFLICT` o el código específico equivalente.
- Ningún caller puede suministrar `worker_id`, `attempt_count`, lease o estado
  terminal como datos de producto.

## 4. Contrato durable de datos

Fase 0 crea sólo estas tablas fiscales:

| Tabla               | Responsabilidad                                               | No representa                    |
| ------------------- | ------------------------------------------------------------- | -------------------------------- |
| `stored_objects`    | ubicación privada, integridad, alcance y lifecycle de bytes   | CFDI parseado                    |
| `ingestion_uploads` | intención/confirmación/expiración e idempotencia de recepción | validez fiscal                   |
| `ingestion_jobs`    | estado, stage, retry, lease, cancelación y correlación        | un tipo ficticio de prueba       |
| `ingestion_items`   | seguimiento técnico y resultado de unidades                   | conceptos/impuestos/pagos/nómina |

Las columnas exactas viven en migraciones append-only, pero el contrato exige:
scope completo, FKs compuestas, checks/uniques/índices, estado canónico,
idempotency key/fingerprint donde corresponda, `worker_id`/`locked_by`,
`lease_expires_at`, `heartbeat_at`, `attempt_count`, `next_attempt_at`,
`cancel_requested_at`, `started_at`, `completed_at`, `last_error_code`,
`correlation_id`, versión y timestamps.

No se introducen `cfdi_id`, versiones de parser/CFDI ni candidatos de UUID o
RFC en Fase 0. Esos resultados de dominio se añadirán en la migración
append-only de Fase 1 sin alterar la identidad del objeto/job original.

## 5. Estados y transiciones

### 5.1 Objeto

Estados: `pending_upload`, `uploaded`, `quarantined`, `available`, `rejected`,
`deleted`.

| Origen           | Destino permitido | Condición                                 |
| ---------------- | ----------------- | ----------------------------------------- |
| `pending_upload` | `uploaded`        | stream cerrado y hash/tamaño registrados  |
| `uploaded`       | `quarantined`     | pendiente de scanner o análisis           |
| `quarantined`    | `available`       | scanner clean y controles de integridad   |
| `quarantined`    | `rejected`        | malware, mismatch o política terminal     |
| no terminal      | `deleted`         | lifecycle autorizado y borrado verificado |
| `available`      | `deleted`         | sólo policy/reconciliador auditable       |

`deleted` es terminal. Ninguna transición permite reemplazar bytes bajo la
misma identidad/key.

### 5.2 Upload

Estados: `pending`, `receiving`, `uploaded`, `confirmed`, `expired`, `failed`,
`cancelled`.

`pending/receiving` puede expirar después de 24 horas. `uploaded` sólo afirma
que el stream y su integridad técnica terminaron; `confirmed` enlaza la
intención con el objeto durable y la operación aprobada. Ningún estado afirma
que el contenido sea CFDI válido. `expired`, `failed` y `cancelled` no pueden
reabrirse silenciosamente ni perder la respuesta idempotente/procedencia.

### 5.3 Job

Estados: `awaiting_upload`, `queued`, `processing`, `completed`,
`completed_with_issues`, `failed_retryable`, `failed_final`,
`cancel_requested`, `cancelled`.

Etapas reservadas: `scanning`, `extracting`, `parsing`, `persisting`. En Fase 0
sólo la plataforma y handlers de test pueden recorrerlas; no existe handler
fiscal de producción.

| Comando            | Precondición                                      | Efecto durable                                                                                                               |
| ------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| enqueue            | objeto/intención confirmados y operación conocida | `queued`, intento disponible                                                                                                 |
| claim              | claimable, `next_attempt_at <= now`, no cancelado | `processing`, worker, lease 90 s, intento                                                                                    |
| heartbeat          | mismo worker/lease/version, no expirado           | `renewed` si extiende heartbeat/lease; `cancel_requested` si debe abortar cooperativamente; `lease_lost` si perdió autoridad |
| complete           | mismo worker/lease/version                        | estado terminal, timestamps, resultado                                                                                       |
| fail retryable     | mismo worker/lease/version e intentos disponibles | `failed_retryable`, error y backoff                                                                                          |
| requeue            | retry vencido o lease recuperable                 | `queued`, ownership limpio                                                                                                   |
| request cancel     | estado cancelable y versión válida                | `cancel_requested_at`, estado canónico                                                                                       |
| acknowledge cancel | boundary seguro y lease válido                    | `cancelled`, ownership limpio                                                                                                |

`WORKER_MAX_ATTEMPTS=3` representa como máximo tres **ejecuciones totales**,
incluida la inicial. Los backoffs 10 y 30 segundos con jitter preceden a las
ejecuciones 2 y 3. El valor 120 permanece reservado en la configuración por
compatibilidad, pero no autoriza ni programa una cuarta reclamación. Tras fallar
la ejecución 3 el error no vuelve a cola automáticamente. Esta decisión aplica
la precedencia de la instrucción directa sobre la formulación ambigua del
material maestro. Perder lease produce `JOB_LEASE_LOST` y prohíbe publicar
resultado.

### 5.4 Item

Estado técnico: `pending`, `processing`, `terminal`. Resultados reservados:
`incorporated`, `duplicate`, `foreign`, `invalid`, `unsupported`,
`internal_error`. En Fase 0 estos resultados son vocabulario futuro/test; no
afirman que exista clasificación CFDI.

## 6. Ports internos de Fase 0

Las firmas concretas pueden adaptarse al lenguaje sin debilitar estas
pre/postcondiciones. Todos los métodos aceptan un contexto técnico con
`correlationId`; los que tocan datos tenant reciben un scope ya autorizado, no
lo extraen de payload de usuario.

### 6.1 `ObjectStoragePort`

```text
putStream({ body, objectKey?, contentType?, expectedSizeBytes?, signal? })
  -> { provider, objectKey, sha256, sizeBytes, etag?, versionId? }

openReadStream(objectKey, signal?) -> readable stream
head(objectKey)
  -> { provider, objectKey, sizeBytes, contentType?, etag?, versionId?,
       checksumSha256?, lastModifiedAt? } | null
delete(objectKey) -> void (idempotente ante ausencia)
createSignedReadUrl(objectKey, ttlSeconds?) -> { url, expiresAt }
health(signal?: AbortSignal) -> healthy | unhealthy + código técnico
```

Garantías:

- streams con backpressure; no buffer completo obligatorio;
- key generada/validada por la plataforma, bajo namespace de ambiente;
- cálculo de SHA-256 y tamaño durante escritura;
- no ACL pública; signed URL sólo de lectura, breve y no loggeable;
- delete idempotente; no sigue paths fuera de la raíz;
- adapter local prohibido en producción; S3 valida configuración al iniciar.

### 6.2 `MalwareScannerPort`

```text
scan(inputStream, { signal? })
  -> clean(durationMs, sizeBytes)
   | infected(durationMs, sizeBytes, internalSignature)
   | bypassed(durationMs, sizeBytes)     # sólo development explícito

health(signal?: AbortSignal) -> healthy | unhealthy + código técnico
```

Garantías:

- ClamAV usa protocolo `INSTREAM`; no shell ni path de usuario;
- timeout y límite de stream provienen de configuración validada y son
  obligatorios;
- `INFECTED` nunca es retryable ni expone nombre de firma al usuario;
- timeout, indisponibilidad, límite y protocolo fallan mediante errores tipados
  del adapter y se traducen con el catálogo estable;
- producción falla cerrado si scanner está deshabilitado/no configurado;
- bypass existe sólo en desarrollo mediante configuración explícita.

### 6.3 Job registry y handler

```text
register(sourceType, handler)       # sólo fuentes reales de la fase activa
claim(workerId, capacity) -> claims mínimos
heartbeat(claimToken) -> renewed | cancel_requested | lease_lost
execute(claim, abortSignal) -> outcome tipado
complete(claimToken, outcome) -> terminal | lease-lost
fail(claimToken, error) -> scheduled | terminal | lease-lost
```

El registry de producción de Fase 0 puede estar vacío. Un handler de test sólo
se registra en el módulo/entorno de test y no aparece en configuración, seeds o
release productivo.

### 6.4 Redis wakeup

Publicación ocurre best-effort **después** del commit. Canal/topic incluye un
prefijo de ambiente validado. El mensaje no contiene scope, RFC, filename,
objeto, error, secreto ni contenido fiscal; puede ser vacío o un evento técnico
versionado de cardinalidad acotada. Suscriptor trata pérdida, duplicado,
reordenamiento o falsificación como una simple invitación a consultar
PostgreSQL. No usa `KEYS`.

## 7. Claim privilegiado

La función SQL de claim es la única excepción cross-tenant de runtime. Su
contrato observable:

```text
claim_ingestion_job(worker_id, supported_source_types[])
  -> { job_id, organization_id, client_account_id, legal_entity_id,
       source_type, version, correlation_id, attempt_count, recovered,
       requested_by_membership_id?, root_object_id?, upload_id? } | no row
```

La función reclama como máximo una fila por invocación; el runner acota las
invocaciones por su concurrencia. Fija internamente lease y parámetros no
delegables, valida la allowlist de fuentes productivas, selecciona con fairness
y `SKIP LOCKED`, actualiza/retorna en una sola
transacción, tiene `search_path` fijo, no acepta tenant y no devuelve metadata
fiscal. `PUBLIC` no tiene `EXECUTE`.

El claim inserta su evento de auditoría en la misma transacción que adquiere el
lease. Si falla la auditoría no existe claim; si no existe claim no se publica
auditoría. El evento conserva IDs técnicos, worker, versión y transición, nunca
payload fiscal.

Tras claim, cada job se procesa dentro de una nueva transacción tenant-scoped
con `SET LOCAL app.organization_id` y, cuando aplique,
`SET LOCAL app.membership_id`; el privilegio definer no acompaña al handler.
`balanz_worker` es un rol de grupo `NOLOGIN` y el LOGIN dedicado de despliegue
(por ejemplo `balanz_worker_login`) lo hereda. La API usa de manera equivalente
el grupo `balanz_api` mediante un LOGIN dedicado como `balanz_api_login`; nunca
usa el migrator, un owner ni un rol con `BYPASSRLS`.

## 8. Idempotencia

Las operaciones futuras que creen uploads/jobs exigirán header
`Idempotency-Key`; Fase 0 implementa la estructura, no una ruta pública. La key
se normaliza de manera mínima (sin case folding semántico), se limita en tamaño
y se almacena como dato sensible. El fingerprint canónico incluye operación,
versión, scope resuelto y atributos que cambian el efecto.

Resultados:

| Caso                           | Resultado contractual                                 |
| ------------------------------ | ----------------------------------------------------- |
| Primera key/fingerprint        | crea una sola intención y resultado durable           |
| Misma key/fingerprint          | replay del mismo status/referencias, sin efecto nuevo |
| Misma key/fingerprint distinto | `IDEMPOTENCY_CONFLICT`                                |
| Misma key en otro tenant       | namespace aislado; no revela el primero               |
| Carrera concurrente            | constraint/transacción elige un único ganador         |

## 9. Errores

Los códigos y su retryability están en
`docs/contracts/CFDI_INGESTION_ERROR_CATALOG.md`. Un boundary HTTP futuro usa el
envelope existente de la API y añade un código estable, mensaje seguro,
`correlationId` y detalles allowlisted. Stack, SQL, hostname, bucket/key, signed
URL, antivirus signature, XML o datos fiscales no salen al cliente.

Los handlers clasifican errores en:

- terminal por contenido/política;
- transitorio retryable dentro del presupuesto;
- conflicto de lease/versión, que no se reintenta como si el dueño siguiera
  vigente;
- bug interno, auditable y terminal al agotar intentos.

## 10. Health, readiness y métricas

### API

- Liveness: proceso/event loop capaz de responder; no depende de Redis.
- Readiness: configuración válida y dependencias autoritativas requeridas para
  aceptar tráfico. Redis no la hace fallar.

### Worker

- Liveness: loop/heartbeat supervisor activo.
- Readiness: configuración válida, PostgreSQL accesible y adapters obligatorios
  listos. Redis degradado no falla readiness. Scanner deshabilitado o no
  disponible en producción sí impide procesar de forma segura.

Los probes no revelan DSN, credenciales, nombres de bucket/key ni payloads. El
contrato mínimo de métricas usa exactamente estos nombres:

```text
ingestion_jobs_created_total
ingestion_jobs_completed_total
ingestion_jobs_failed_total
ingestion_jobs_recovered_total
ingestion_items_total
ingestion_items_by_result
ingestion_duration_seconds
ingestion_queue_age_seconds
ingestion_upload_bytes_total
ingestion_hash_conflicts_total
ingestion_cross_tenant_denials_total
ingestion_scanner_failures_total
ingestion_parser_failures_total
worker_active_jobs
worker_heartbeat_lag_seconds
worker_lease_reclaims_total
object_storage_failures_total
redis_wakeup_failures_total
```

Puede haber métricas operativas adicionales de claim, storage, scanner,
reconciliación y shutdown, pero no sustituyen ni renombran las anteriores. Sus
labels son acotados a `source/status/stage/result/provider/outcome`. El ambiente
se agrega en el target de scrape, no a partir de datos de la ingesta.

## 11. Compatibilidad y versionado

- Migraciones son append-only y compatibles hacia atrás durante rollout.
- Nuevos estados/códigos se agregan sólo con consumidores tolerantes; renombrar
  o cambiar semántica requiere ADR/migración contractual.
- Cambiar canonicalización de fingerprint incrementa su versión.
- Cambiar key format/storage adapter no cambia identidad ni procedencia.
- Cada fase extiende ports/tablas existentes sólo cuando demuestra necesidad;
  no crea una segunda cola o storage paralelo.

## 12. Reservas futuras, no implementadas

| Fase | Contrato futuro                                          | Estado        |
| ---- | -------------------------------------------------------- | ------------- |
| 1    | upload XML 5 MiB, parser, dominio/lista/detalle/descarga | `NOT_STARTED` |
| 2    | init/signed URL/confirm ZIP y resultados parciales       | `NOT_STARTED` |
| 3    | reauth purpose-bound y custodia e.firma                  | `NOT_STARTED` |
| 4    | solicitud/poll/paquetes SAT on-demand                    | `NOT_STARTED` |
| 5    | mesa mensual, decisiones y cierre                        | `NOT_STARTED` |
| 6    | exportación y lifecycle comercial                        | `NOT_STARTED` |
| 7    | operación global/soporte JIT                             | `NOT_STARTED` |
| 8    | hardening/piloto                                         | `NOT_STARTED` |

No se debe generar OpenAPI, controller, ruta, UI ni reporte de validación de
Fase 1 a partir de esta tabla hasta autorización expresa posterior.
