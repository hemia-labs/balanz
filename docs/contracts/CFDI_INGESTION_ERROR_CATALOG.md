# Catálogo de errores de la plataforma CFDI

- Versión: 1.0
- Fecha: 2026-08-28
- Fase 0: `BLOCKED`

## 1. Reglas del contrato

Un código es estable y apto para lógica; el texto es seguro y puede cambiar por
localización. En Fase 0 sólo están activos los códigos de plataforma. Los
códigos XML/CFDI quedan reservados para evitar semántica improvisada, pero su
capacidad sigue `NOT_STARTED`.

El boundary HTTP futuro devuelve el envelope estándar de Balanz con `code`,
`message` y `correlationId`; puede agregar `details` sólo desde una allowlist.
Nunca devuelve stack, SQL, host, DSN, bucket/key, signed URL, firma de malware,
idempotency key/fingerprint completo, XML, RFC, UUID fiscal ni PII.

Retryable significa que el **orquestador** puede usar
`WORKER_MAX_ATTEMPTS=3` como máximo de tres ejecuciones totales, incluida la
inicial. Backoff 10/30+jitter precede a las ejecuciones 2 y 3. El valor 120 queda
reservado por compatibilidad y no habilita una ejecución 4. Esta es la
resolución de Fase 0 por precedencia de la instrucción directa. No autoriza
loops del cliente. Un conflicto de lease exige abandonar el resultado local.

## 2. Códigos

| Código                             | Fase/estado                                   |   HTTP sugerido | Retry worker                 | Nivel        | Auditoría                 | Mensaje seguro                                               | Acción recomendada                                                     |
| ---------------------------------- | --------------------------------------------- | --------------: | ---------------------------- | ------------ | ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `RESOURCE_NOT_FOUND`               | F0 activo                                     |             404 | no                           | info         | acceso sensible si aplica | Recurso no disponible.                                       | Verificar selección/autorización sin revelar existencia.               |
| `PERMISSION_REQUIRED`              | F0 activo                                     |             403 | no                           | warn         | sí                        | No tienes permiso para realizar esta acción.                 | Solicitar el permiso y asignación correctos.                           |
| `MFA_SETUP_REQUIRED`               | futuro reservado                              |             403 | no                           | info         | sí                        | Configura la verificación en dos pasos para continuar.       | Completar enrolamiento MFA.                                            |
| `MFA_REQUIRED`                     | futuro reservado                              |             403 | no                           | info         | sí                        | Confirma tu identidad para continuar.                        | Completar step-up MFA.                                                 |
| `IDEMPOTENCY_KEY_REQUIRED`         | F0 estructura; ruta futura                    |             400 | no                           | info         | no                        | Falta la clave de idempotencia.                              | Reenviar con una key nueva y opaca.                                    |
| `IDEMPOTENCY_CONFLICT`             | F0 activo                                     |             409 | no                           | warn         | sí                        | La clave ya se usó para una solicitud diferente.             | Usar una key nueva; no reusar la anterior.                             |
| `IDEMPOTENCY_KEY_EXPIRED`          | F0 activo                                     |         409/410 | no                           | info         | no                        | La ventana de repetición de la solicitud expiró.             | Crear una operación nueva con key y fingerprint nuevos.                |
| `UPLOAD_ALREADY_CONFIRMED`         | F0 activo interno                             |             409 | no                           | info         | sí                        | La carga ya fue confirmada por otra operación.               | Leer el recurso durable; no volver a confirmar con otra key.           |
| `UPLOAD_NOT_CONFIRMABLE`           | F0 activo interno                             |             409 | no                           | warn         | sí                        | La carga ya no se puede confirmar.                           | Leer estado/expiración y crear otra intención si procede.              |
| `UPLOAD_PAYLOAD_MISMATCH`          | F0 activo interno                             |         409/422 | no                           | error        | sí                        | El contenido no coincide con la intención de carga.          | Mantener el objeto fuera de disponibilidad e investigar integridad.    |
| `UPLOAD_EXPIRED`                   | F0 activo durable                             |     410 interno | no                           | info         | sí                        | La carga expiró antes de confirmarse.                        | Crear otra intención; el reconciliador conserva evidencia y lifecycle. |
| `ORPHANED_PENDING_OBJECT`          | F0 activo lifecycle                           |             n/a | no                           | warn         | sí                        | El objeto pendiente no tiene una carga durable vigente.      | El reconciliador lo rechaza y aplica retención; no sintetiza un job.   |
| `INGESTION_FILE_REQUIRED`          | F1 reservado                                  |             400 | no                           | info         | no                        | Selecciona un archivo para continuar.                        | Adjuntar exactamente el archivo permitido.                             |
| `INGESTION_UNSUPPORTED_MEDIA_TYPE` | F1 reservado                                  |             415 | no                           | info         | sí                        | El tipo de archivo no es compatible.                         | Usar el formato permitido para la fase.                                |
| `INGESTION_FILE_TOO_LARGE`         | F1 reservado                                  |             413 | no                           | warn         | sí                        | El archivo supera el límite permitido.                       | Reducirlo o usar el flujo masivo cuando exista.                        |
| `INGESTION_TOO_MANY_FILES`         | F2 reservado                                  |             422 | no                           | warn         | sí                        | El paquete supera el número de archivos permitido.           | Dividir el paquete.                                                    |
| `OBJECT_HASH_MISMATCH`             | F0 activo                                     |         422/500 | no                           | error        | sí                        | No se pudo verificar la integridad del archivo.              | No reutilizar el objeto; investigar storage/transporte.                |
| `OBJECT_STORAGE_UNAVAILABLE`       | F0 activo                                     |             503 | sí                           | error        | sí                        | El almacenamiento no está disponible temporalmente.          | Reintento durable; escalar si persiste.                                |
| `MALWARE_DETECTED`                 | F0 activo                                     |             422 | no                           | warn         | sí                        | El archivo fue rechazado por seguridad.                      | No procesar ni descargar; seguir protocolo de incidente.               |
| `MALWARE_SCANNER_UNAVAILABLE`      | F0 activo                                     |             503 | sí                           | error        | sí                        | El análisis de seguridad no está disponible.                 | Mantener cuarentena; reintentar/escalar.                               |
| `MALWARE_SCANNER_TIMEOUT`          | F0 activo                                     |             503 | sí                           | warn         | sí                        | El análisis de seguridad no terminó a tiempo.                | Mantener cuarentena; reintentar dentro del presupuesto.                |
| `XML_MALFORMED`                    | F1 reservado                                  |             422 | no                           | info         | sí                        | El XML no tiene una estructura válida.                       | Corregir el documento de origen.                                       |
| `XML_SECURITY_VIOLATION`           | F1 reservado                                  |             422 | no                           | warn         | sí                        | El XML fue rechazado por seguridad.                          | No reintentar el mismo contenido; revisar origen.                      |
| `CFDI_VERSION_UNSUPPORTED`         | F1 reservado                                  |             422 | no                           | info         | sí                        | La versión del CFDI no es compatible.                        | Usar una versión admitida.                                             |
| `COMPLEMENT_UNSUPPORTED`           | F1 reservado                                  |             422 | no                           | info         | sí                        | El complemento del CFDI no es compatible.                    | Revisar la matriz soportada.                                           |
| `CFDI_UUID_INVALID`                | F1 reservado                                  |             422 | no                           | warn         | sí                        | El comprobante no tiene un identificador fiscal válido.      | Verificar el original.                                                 |
| `CFDI_RFC_FOREIGN`                 | F1 reservado                                  | 422/200 parcial | no                           | info         | sí                        | El comprobante no corresponde a la entidad seleccionada.     | Seleccionar la entidad correcta o revisar el XML.                      |
| `CFDI_DUPLICATE`                   | F1 reservado                                  | 409/200 parcial | no                           | info         | sí                        | El comprobante ya fue incorporado.                           | Consultar el resultado existente.                                      |
| `CFDI_UUID_HASH_CONFLICT`          | F1 reservado                                  |             409 | no                           | error        | sí/alerta                 | El comprobante entra en conflicto con un original existente. | Bloquear incorporación e investigar incidente.                         |
| `FISCAL_PERIOD_NOT_CONFIGURED`     | F1 reservado                                  |             422 | no                           | info         | sí                        | No existe un período fiscal compatible.                      | Configurar/abrir el período autorizado.                                |
| `JOB_LEASE_LOST`                   | F0 activo                                     |     409 interno | no                           | warn         | sí                        | El trabajo cambió de propietario y no se pudo completar.     | Abandonar resultado local; dejar que PostgreSQL recupere.              |
| `JOB_NOT_RETRYABLE`                | contrato HTTP futuro reservado                |             409 | no                           | info         | sí                        | El trabajo no admite otro intento.                           | Revisar estado/error terminal.                                         |
| `JOB_STATE_CONFLICT`               | F0 activo                                     |             409 | no                           | warn         | sí                        | El trabajo cambió de estado.                                 | Refrescar estado; no forzar transición.                                |
| `JOB_ROOT_OBJECT_UNAVAILABLE`      | F0 activo durable                             |             n/a | no                           | error        | sí                        | El objeto raíz o la carga durable no están disponibles.      | El reconciliador termina el job; investigar lifecycle/procedencia.     |
| `HANDLER_NOT_REGISTERED`           | F0 activo interno/durable                     |             500 | no                           | error        | sí/alerta                 | El tipo de trabajo no está disponible.                       | Corregir despliegue/configuración; no crear tipo ficticio.             |
| `INVALID_HANDLER_RESULT`           | F0 activo interno/durable                     |             500 | no                           | error        | sí/alerta                 | El trabajo devolvió un resultado no permitido.               | Corregir el handler y preservar el job terminal.                       |
| `UNEXPECTED_WORKER_ERROR`          | F0 activo interno/durable                     |             n/a | sí acotado                   | error        | sí                        | El trabajo falló temporalmente.                              | Aplicar retry durable; investigar al agotar intentos.                  |
| `JOB_RETRY_EXHAUSTED`              | F0 activo                                     |         422/500 | no                           | error        | sí                        | El trabajo agotó sus intentos.                               | Investigar causa y decidir retry manual autorizado.                    |
| `WORKER_SHUTDOWN`                  | F0 activo interno, no durable                 |     503 interno | sí por otro worker           | info         | no                        | El proceso está cerrando de forma segura.                    | No reclamar; liberar el lease o permitir recovery.                     |
| `JOB_CLAIM_FAILED`                 | F0 activo, sólo telemetría                    |             n/a | polling posterior            | error        | no                        | No se pudo reclamar un trabajo.                              | Verificar PostgreSQL y el claim; el loop vuelve a intentar.            |
| `WORKER_STATE_TRANSITION_FAILED`   | F0 activo, sólo telemetría                    |             n/a | depende de autoridad durable | error        | sí/alerta                 | No se pudo confirmar la transición del trabajo.              | No asumir éxito; reconciliar desde PostgreSQL.                         |
| `REDIS_WAKEUP_UNAVAILABLE`         | contrato reservado; F0 reporta status/métrica |   200 degradado | n/a                          | warn acotado | no                        | La señal rápida no está disponible; continúa el sondeo.      | Observar fallback; no fallar readiness.                                |
| `RLS_CONTEXT_REQUIRED`             | contrato HTTP futuro reservado                |         500/403 | no                           | error        | sí/alerta                 | No se pudo establecer el contexto de acceso.                 | Fallar cerrado e investigar boundary transaccional.                    |
| `RLS_CONTEXT_INVALID`              | contrato HTTP futuro reservado                |         500/403 | no                           | error        | sí/alerta                 | El contexto de acceso no es válido.                          | Fallar cerrado; revisar resolución server-side.                        |
| `CONFIGURATION_INVALID`            | F0 activo startup                             |             n/a | no                           | fatal        | sí operacional            | La configuración del servicio no es válida.                  | Corregir configuración; no iniciar inseguro.                           |
| `RECONCILIATION_CONFLICT`          | F0 activo                                     |             n/a | depende de causa             | error        | sí                        | El reconciliador encontró un estado inconsistente.           | Preservar evidencia, reintentar sólo si es seguro.                     |
| `RECONCILIATION_FAILED`            | F0 activo, sólo telemetría                    |             n/a | siguiente ciclo acotado      | error        | no                        | No terminó el ciclo de reconciliación.                       | Verificar PostgreSQL y ejecutar el siguiente ciclo idempotente.        |
| `PARSER_INTERNAL_ERROR`            | F1 reservado                                  |             500 | sí acotado                   | error        | sí                        | No se pudo procesar el documento.                            | Reintento durable; alertar al agotar intentos.                         |

Los probes F0 exponen además códigos técnicos, no persistibles, que describen
la dependencia exacta sin incluir excepciones crudas:

| Código técnico de health           | Probe                     | Efecto                                         |
| ---------------------------------- | ------------------------- | ---------------------------------------------- |
| `POSTGRES_UNAVAILABLE`             | readiness API/worker      | `down`; PostgreSQL es obligatorio              |
| `POSTGRES_FISCAL_SCHEMA_NOT_READY` | readiness API/worker      | `down`; faltan tablas o funciones 060/061      |
| `OBJECT_STORAGE_HEALTH_TIMEOUT`    | readiness API/worker      | `down`; la operación se aborta al deadline     |
| `MALWARE_SCANNER_HEALTH_TIMEOUT`   | readiness API/worker      | `down`; la operación se aborta al deadline     |
| `WORKER_SUPERVISOR_UNAVAILABLE`    | liveness/readiness worker | `down`; no existe runtime inyectado            |
| `WORKER_SUPERVISOR_NOT_RUNNING`    | liveness/readiness worker | `down`; no acepta claims                       |
| `WORKER_SUPERVISOR_STALE`          | liveness/readiness worker | `down`; no hubo actividad dentro de la ventana |

Redis no inventa un `errorCode` en el probe: se representa como dependencia
`down` no requerida y el resultado global queda `degraded`, con las métricas
`redis_wakeup_failures_total{stage="publish|subscribe"}`.

## 3. Clasificación operacional

### Mapeo desde adapters de Fase 0

Los adapters pueden usar códigos internos más específicos para diagnóstico,
pero un boundary durable/HTTP los traduce al catálogo estable y conserva el
código interno sólo en telemetría allowlisted:

| Código interno del adapter              | Código estable                                                      |
| --------------------------------------- | ------------------------------------------------------------------- |
| `OBJECT_STORAGE_INVALID_CONFIGURATION`  | `CONFIGURATION_INVALID`                                             |
| `OBJECT_STORAGE_INVALID_KEY`            | `RESOURCE_NOT_FOUND` y alerta interna si la key nació en plataforma |
| `OBJECT_STORAGE_LIMIT_EXCEEDED`         | `INGESTION_FILE_TOO_LARGE`                                          |
| `OBJECT_STORAGE_SIZE_MISMATCH`          | `OBJECT_HASH_MISMATCH`                                              |
| `OBJECT_STORAGE_CONFLICT`               | `JOB_STATE_CONFLICT` o conflicto específico de operación            |
| `OBJECT_STORAGE_NOT_FOUND`              | `RESOURCE_NOT_FOUND`                                                |
| `OBJECT_STORAGE_UNAVAILABLE`            | `OBJECT_STORAGE_UNAVAILABLE`                                        |
| `OBJECT_STORAGE_UNSUPPORTED_OPERATION`  | `CONFIGURATION_INVALID`                                             |
| `MALWARE_SCANNER_INVALID_CONFIGURATION` | `CONFIGURATION_INVALID`                                             |
| `MALWARE_SCANNER_UNAVAILABLE`           | `MALWARE_SCANNER_UNAVAILABLE`                                       |
| `MALWARE_SCANNER_TIMEOUT`               | `MALWARE_SCANNER_TIMEOUT`                                           |
| `MALWARE_SCANNER_PROTOCOL_ERROR`        | `MALWARE_SCANNER_UNAVAILABLE`                                       |
| `MALWARE_SCANNER_LIMIT_EXCEEDED`        | `INGESTION_FILE_TOO_LARGE`                                          |
| `MALWARE_SCANNER_ABORTED`               | `WORKER_SHUTDOWN` o estado/cancelación vigente                      |

El mapeo depende del contexto sólo donde la tabla lo indica; no convierte un
error transitorio en clean ni revela el detalle interno al usuario. Los códigos
`HANDLER_NOT_REGISTERED`, `INVALID_HANDLER_RESULT` y
`UNEXPECTED_WORKER_ERROR` sí son canónicos porque el worker puede persistirlos
en `ingestion_jobs.last_error_code`. `JOB_CLAIM_FAILED`,
`WORKER_STATE_TRANSITION_FAILED` y `RECONCILIATION_FAILED` son exclusivamente
telemetría acotada y nunca se presentan como una transición confirmada.

### Terminal por política o contenido

`MALWARE_DETECTED`, `XML_MALFORMED`, `XML_SECURITY_VIOLATION`, versiones o
complementos no soportados, RFC ajeno, hash conflict y límites de archivo no se
resuelven reintentando los mismos bytes. El job/item conserva procedencia y un
resultado terminal seguro.

### Transitorio

Storage/scanner no disponible, timeout del scanner y errores internos
clasificados explícitamente pueden usar el presupuesto durable. El código y
`attempt_count` quedan registrados antes de programar `next_attempt_at`.

### Conflicto de concurrencia

`JOB_LEASE_LOST` y `JOB_STATE_CONFLICT` no consumen ciegamente un retry del
mismo dueño: el proceso descarta su resultado, vuelve a leer autoridad y deja
que claim/reconciliación converjan.

### Seguridad/configuración

Contexto RLS o configuración inválidos fallan cerrado. En producción, scanner
deshabilitado, filesystem seleccionado, bucket/cifrado obligatorio ausentes o
roles privilegiados no se degradan a warning.

## 4. Redacción y observabilidad

Logs estructurados pueden incluir: timestamp, level, service, environment,
correlation ID, organization ID técnico, job ID, object ID, etapa, duración,
resultado, código, intento y worker ID técnico. `last_error_code` almacena el
código estable, no el mensaje crudo de dependencia. Organization ID nunca se
usa como label de métrica.

Un error de dependencia se conserva internamente sólo con campos allowlisted y
redactados. Las métricas usan únicamente las dimensiones canónicas acotadas
`source`, `status`, `stage`, `result`, `provider` y `outcome`; no etiquetan el
código/mensaje libre de excepción ni crean el alias divergente `job_type`.

## 5. Gobierno

Agregar o cambiar un código requiere actualizar este catálogo, contrato,
tests y, si cambia semántica duradera, un ADR/migración. Un código reservado no
autoriza implementar la capacidad de su fase. No se elimina un código consumido;
se depreca y se mantiene durante la ventana de compatibilidad.
