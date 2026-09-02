# Matriz de configuración de la plataforma CFDI

- Versión: 1.1
- Fecha: 2026-08-28
- Carácter: contrato normativo de Fase 0

## 1. Reglas generales

Toda variable se valida al arrancar antes de aceptar tráfico o reclamar jobs.
Una cadena vacía no satisface un requisito productivo. Los secretos provienen
del secret manager/IAM del ambiente; `.env.example` sólo contiene valores
locales no sensibles. Logs, health y errores nunca imprimen configuración
secreta.

Los defaults de esta matriz son de desarrollo. Producción no hereda un default
inseguro: storage local, scanner bypass, HTTP a S3/MinIO, cifrado distinto de
SSE-KMS o credenciales incompletas deben impedir el arranque. Las capacidades
XML/ZIP siguen `NOT_STARTED`; sus límites se validan desde Fase 0 para evitar
un cambio inseguro al activarlas.

### 1.1 Perfiles de proceso y credenciales

La configuración runtime no es un grafo compartido. El entrypoint API aplica el
perfil inmutable `api`; el entrypoint worker aplica `worker`. Los archivos
preferidos son `.env.api.local` y `.env.worker.local`, respectivamente, con
plantillas sin secretos en `.env.api.example` y `.env.worker.example`.
`.env.example` es sólo el catálogo completo para tooling explícito.

| Proceso | Puede cargar | Rechaza/no carga | Identidad PostgreSQL |
| ------- | ------------ | ---------------- | -------------------- |
| API | app, auth, cookies, email, Redis, plataforma fiscal y su scope Vault | `DB_WORKER_*`; credencial migrator | sólo `DB_API_*` o `database/postgres-api` |
| Worker | Redis wakeup, plataforma fiscal, Horus y su scope Vault | `DB_API_*`, `JWT_*`, `MFA_*`, `EMAIL_*`, app/cookies/auth y credencial migrator | sólo `DB_WORKER_*` o `database/postgres-worker` |
| Release/provisioner explícito | migraciones/seeds y, sólo el provisioner con doble gate, ambos LOGINs runtime | no es un proceso servidor | `DB_USERNAME/PASSWORD` y paths estrictamente requeridos por el comando |

Un valor no vacío de otro perfil hace fallar el arranque; no se ignora ni se
serializa en `ConfigService`. API y worker tampoco reciben `DB_USERNAME` ni
`DB_PASSWORD`. Cuando Vault está activo en producción,
`SECRETS_ENVIRONMENT=prod` y `SECRETS_SYSTEM` deben ser explícitos. El system
puede conservar la taxonomía desplegada existente (por ejemplo `api`); el
aislamiento real lo imponen un AppRole/policy diferente por proceso y los paths
anteriores. La policy worker debe denegar `database/postgres-api`, `auth/jwt`,
`auth/mfa` y `email/ses`; la API debe denegar `database/postgres-worker`. Sólo el
provisioner efímero autorizado puede resolver ambos paths runtime.

## 2. Ambiente y Redis wakeup

| Variable                   | Tipo/rango                    | Desarrollo                | Producción                      | Secreto | Falla/nota                                                    |
| -------------------------- | ----------------------------- | ------------------------- | ------------------------------- | ------- | ------------------------------------------------------------- |
| `NODE_ENV`                 | `development/test/production` | `development`             | explícito `production`          | no      | Controla prohibiciones; valor inválido no inicia.             |
| `SECRETS_ENABLED`          | boolean                       | `false` o Vault de dev    | según despliegue                | no      | Si es `true` en producción, exige scope `prod`.               |
| `SECRETS_ENVIRONMENT`      | `dev/qa/staging/prod`         | `dev`                     | obligatorio `prod` con Vault    | no      | Impide que un proceso productivo consuma secretos de dev.     |
| `SECRETS_SYSTEM`           | taxonomía Vault no vacía      | `api` existente           | obligatorio explícito con Vault | no      | No implica identidad; AppRole y perfil restringen paths.      |
| `REDIS_ENABLED`            | boolean                       | `true`                    | según política de sesión        | no      | Redis puede deshabilitarse; PostgreSQL conserva autoridad.    |
| `REDIS_HOST`               | host                          | `localhost`               | secret/config service           | no      | Ausencia hace Redis no disponible, no corrompe jobs.          |
| `REDIS_PORT`               | 1–65535                       | `6379`                    | explícito                       | no      | Valor inválido no inicia.                                     |
| `REDIS_PASSWORD`           | string                        | vacío local               | secret manager si aplica        | sí      | Nunca en logs.                                                |
| `REDIS_DB`                 | 0–15                          | `0`                       | explícito                       | no      | No usar para aislar ambientes sin prefijo.                    |
| `REDIS_KEY_PREFIX`         | string no vacía               | `balanz:`                 | prefijo único por ambiente      | no      | La sesión/cache conserva su prefijo existente.                |
| `REDIS_CONNECT_TIMEOUT_MS` | entero >0                     | `1000`                    | explícito medido                | no      | Timeout degrada Redis, no readiness fiscal.                   |
| `REDIS_WAKEUP_ENABLED`     | boolean                       | `true`                    | `true` salvo decisión operativa | no      | `false` deja polling activo.                                  |
| `REDIS_WAKEUP_PREFIX`      | `[A-Za-z0-9:_-]+`             | `balanz:ingestion:wakeup` | único por ambiente              | no      | Canal efectivo agrega `NODE_ENV`; sin payload fiscal.         |
| `REDIS_WAKEUP_TIMEOUT_MS`  | entero `50..5000`             | `500`                     | `500`                           | no      | Acota publicación best-effort aun con conexión medio abierta. |

Redis wakeup nunca almacena estado, usa `KEYS`, lleva RFC/filename/scope/secreto
ni publica antes del commit. `publish` y `subscribe` fallidos incrementan
métrica/log redactado y el worker continúa con polling.

## 3. Object storage

| Variable                                  | Tipo/rango            | Desarrollo                                                                  | Producción                          | Secreto                | Falla/nota                                                                                              |
| ----------------------------------------- | --------------------- | --------------------------------------------------------------------------- | ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORAGE_DRIVER`                   | `local/s3`            | `local` o `s3`/MinIO                                                        | obligatorio `s3`                    | no                     | `local` en producción impide arranque.                                                                  |
| `OBJECT_STORAGE_LOCAL_ROOT`               | path no vacío         | `.local/fiscal-object-storage` desde la raíz del repo                       | prohibido                           | no                     | La base no depende del cwd; debe ser raíz dedicada, fuera de `public`, con marcador y permisos mínimos. |
| `OBJECT_STORAGE_LOCAL_WINDOWS_PRESECURED` | boolean               | `false`; `true` sólo si la raíz NTFS existente tiene DACL privada heredable | obligatorio `false`                 | no                     | Windows falla cerrado por defecto; no crea una raíz que se declare preasegurada.                        |
| `OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS`   | 15–300 s              | `60`                                                                        | 15–300, breve                       | no                     | URL futura sólo de lectura; nunca log.                                                                  |
| `S3_ENDPOINT`                             | URL HTTP(S) o vacío   | URL HTTP de MinIO permitida                                                 | vacío para AWS o HTTPS              | no                     | HTTP en producción impide arranque.                                                                     |
| `S3_REGION`                               | string no vacía       | `us-east-2`                                                                 | explícita                           | no                     | Requerida con driver S3.                                                                                |
| `S3_BUCKET`                               | string no vacía       | `balanz-cfdi-phase0-test`                                                   | explícito, preaprovisionado/privado | no                     | Ausente con S3 impide arranque.                                                                         |
| `S3_FORCE_PATH_STYLE`                     | boolean               | `true` para MinIO                                                           | según proveedor                     | no                     | No cambia privacidad.                                                                                   |
| `S3_SSE_MODE`                             | `none/AES256/aws:kms` | `AES256` para MinIO                                                         | obligatorio `aws:kms`               | no                     | Modo distinto en producción impide arranque.                                                            |
| `S3_KMS_KEY_ID`                           | string                | vacío con AES256                                                            | obligatorio con `aws:kms`           | identificador sensible | Ausente impide arranque.                                                                                |
| `S3_ACCESS_KEY_ID`                        | string                | credencial MinIO local                                                      | IAM/Vault preferido                 | sí                     | Debe aparecer junto con secret key.                                                                     |
| `S3_SECRET_ACCESS_KEY`                    | string                | credencial MinIO local                                                      | IAM/Vault preferido                 | sí                     | Nunca en repo/logs; par incompleto no inicia.                                                           |
| `S3_REQUEST_TIMEOUT_MS`                   | 100–120000            | `10000`                                                                     | explícito medido                    | no                     | Timeout produce `OBJECT_STORAGE_UNAVAILABLE`.                                                           |
| `MINIO_KMS_SECRET_KEY`                    | `nombre:base64(32 B)` | sólo Compose aislado; valor aleatorio descartable                           | prohibido                           | sí                     | Habilita SSE-S3 real en MinIO; jamás reutilizar como KMS productivo.                                    |

El bucket es privado, no usa ACL pública y no se crea implícitamente en
producción. Las object keys son opacas y no son configuración del usuario.

## 4. Malware scanner

| Variable                    | Tipo/rango      | Desarrollo                        | Producción                          | Secreto | Falla/nota                                     |
| --------------------------- | --------------- | --------------------------------- | ----------------------------------- | ------- | ---------------------------------------------- |
| `MALWARE_SCANNER_MODE`      | `clamav/bypass` | `clamav`; `bypass` sólo explícito | obligatorio `clamav`                | no      | Bypass fuera de development impide arranque.   |
| `CLAMAV_HOST`               | host no vacío   | `127.0.0.1`/Compose               | service discovery privado           | no      | No se construye comando shell.                 |
| `CLAMAV_PORT`               | 1–65535         | `3310` o puerto publicado         | explícito                           | no      | Protocolo TCP `INSTREAM`.                      |
| `CLAMAV_CONNECT_TIMEOUT_MS` | 100–30000       | `2000`                            | explícito                           | no      | Error retryable; producción queda fail-closed. |
| `CLAMAV_SCAN_TIMEOUT_MS`    | 1000–300000     | `30000`                           | explícito medido                    | no      | Timeout mantiene cuarentena.                   |
| `CLAMAV_MAX_STREAM_BYTES`   | 1–104857600     | `52428800`                        | al menos máximo permitido, hard cap | no      | Exceso falla antes/durante stream.             |

Scanner healthy es requisito para procesar de forma segura en producción. Su
caída puede volver el worker no-ready/pausar claims de scanning, pero nunca
convierte el archivo en clean ni activa bypass.

## 5. Worker durable

| Variable                        | Tipo/rango   | Valor bloqueado/default | Producción                       | Secreto | Falla/nota                                                                        |
| ------------------------------- | ------------ | ----------------------: | -------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `WORKER_CONCURRENCY`            | entero 1–32  |                     `4` | explícito según capacidad        | no      | Se aplica como límite total, con fairness.                                        |
| `WORKER_LEASE_SECONDS`          | entero       |                    `90` | `90`                             | no      | Otro valor no inicia en F0.                                                       |
| `WORKER_HEARTBEAT_SECONDS`      | entero       |                    `20` | `20`                             | no      | Debe ser < un tercio del lease.                                                   |
| `WORKER_MAX_ATTEMPTS`           | entero       |                     `3` | `3`                              | no      | Máximo de ejecuciones totales, incluida la inicial.                               |
| `WORKER_BACKOFF_SECONDS`        | lista exacta |             `10,30,120` | igual                            | no      | 10/30 preceden ejecuciones 2/3; 120 queda reservado y nunca habilita ejecución 4. |
| `WORKER_BACKOFF_JITTER_PERCENT` | 0–50         |                    `20` | explícito                        | no      | Jitter aplicado por intento.                                                      |
| `WORKER_POLL_INTERVAL_MS`       | 100–60000    |                  `5000` | explícito según SLO/carga        | no      | Polling siempre activo aun con Redis.                                             |
| `WORKER_RECONCILE_INTERVAL_MS`  | 1000–3600000 |                 `60000` | explícito                        | no      | Reconciliadores idempotentes.                                                     |
| `WORKER_SHUTDOWN_GRACE_MS`      | 1000–120000  |                 `30000` | menor que ventana de orquestador | no      | Deja de reclamar y cierra seguro.                                                 |
| `WORKER_HEALTH_HOST`            | host         |             `127.0.0.1` | interfaz privada                 | no      | No exponer probes públicamente.                                                   |
| `WORKER_HEALTH_PORT`            | 1–65535      |                  `3002` | explícito                        | no      | No comparte autoridad con API.                                                    |

`worker_id` es identidad efímera generada por proceso/replica con formato
acotado; no se configura con un secreto ni se reutiliza como credencial.

### 5.1 Decisión de conteo de intentos

El material de entrada alterna “máximo de tres intentos” y “máximo de tres
intentos automáticos”. Por precedencia, la instrucción directa de esta ejecución
fija `WORKER_MAX_ATTEMPTS=3` como **tres ejecuciones totales**, incluida la
inicial. Los valores 10 y 30 de `WORKER_BACKOFF_SECONDS` preceden a las
ejecuciones 2 y 3. El valor 120 se conserva como reserva compatible, no se
consume y no autoriza un cuarto claim. Un fallo retryable en la ejecución 3
queda terminal. Esta semántica no varía por ambiente.

## 6. Retención y reconciliación

| Variable/política                   | Tipo        | Valor F0                                            | Estado/alcance                                                             |
| ----------------------------------- | ----------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `INGESTION_INCOMPLETE_UPLOAD_HOURS` | entero fijo | `24`                                                | Upload incompleto; valor normativo del prompt maestro.                     |
| `INGESTION_DUPLICATE_BYTES_HOURS`   | entero fijo | `24`                                                | Byte redundante de duplicate; consumidor F1 reservado.                     |
| `INGESTION_ORPHAN_GRACE_MINUTES`    | entero fijo | `60`                                                | Edad mínima bloqueada; el worker no puede reducirla al reconciliar.        |
| `INGESTION_INVALID_OBJECT_DAYS`     | entero fijo | `7`                                                 | Invalid/foreign; consumidor F1 reservado.                                  |
| `INGESTION_MALWARE_QUARANTINE_DAYS` | entero fijo | `7`                                                 | Malware en cuarentena; control activo de plataforma.                       |
| `INGESTION_COMPLETED_OBJECT_DAYS`   | 1–3650      | `30` sólo para artefacto técnico con clase elegible | No autoriza borrar XML incorporado ni sustituye clases de retención.       |
| unsupported                         | clase       | 30 días                                             | Fase 1 reservada; debe añadirse como policy explícita antes de consumirla. |
| hash conflict                       | clase/hold  | 7 días, ampliable a 30                              | Fase 1, reservada.                                                         |
| temporal extraído                   | clase       | eliminación inmediata                               | Fase 2, reservada.                                                         |
| XML incorporado                     | clase       | 5 ejercicios, cliente activo                        | Fase 1/6; nunca aplicar default genérico de 30 días.                       |
| ZIP/paquete SAT procesado           | clase       | 30 días                                             | Fases 2/4, reservada.                                                      |
| organización cancelada              | clase       | ventana 45 días                                     | Fase 6, reservada.                                                         |

Una fila no elegible o con hold no se elimina. Borrado físico requiere policy,
edad, ausencia de referencias, delete de storage verificado, audit y transición
`deleted`. La configuración actual debe igualar los valores normativos antes de
declarar Fase 0 terminada.

## 7. Límites fundacionales

| Variable                                   | Tipo/rango   |       Valor bloqueado | Consumidor                          | Estado                   |
| ------------------------------------------ | ------------ | --------------------: | ----------------------------------- | ------------------------ |
| `INGESTION_XML_MAX_BYTES`                  | entero fijo  |     `5242880` (5 MiB) | XML individual                      | F1 `NOT_STARTED`         |
| `INGESTION_DIRECT_XML_MAX_COUNT`           | entero fijo  |                   `1` | multipart futuro                    | F1 `NOT_STARTED`         |
| `INGESTION_ZIP_MAX_BYTES`                  | entero fijo  |   `52428800` (50 MiB) | ZIP comprimido                      | F2 `NOT_STARTED`         |
| `INGESTION_ZIP_MAX_UNCOMPRESSED_BYTES`     | entero fijo  | `262144000` (250 MiB) | extractor                           | F2 `NOT_STARTED`         |
| `INGESTION_ZIP_MAX_ENTRIES`                | entero fijo  |                `2000` | extractor                           | F2 `NOT_STARTED`         |
| `INGESTION_ZIP_MAX_COMPRESSION_RATIO`      | entero fijo  |                  `50` | extractor                           | F2 `NOT_STARTED`         |
| `INGESTION_ZIP_MAX_DEPTH`                  | entero fijo  |                   `2` | extractor                           | F2 `NOT_STARTED`         |
| `INGESTION_ZIP_MAX_PATH_CHARACTERS`        | entero fijo  |                 `240` | extractor                           | F2 `NOT_STARTED`         |
| `INGESTION_ZIP_ALLOW_NESTED`               | boolean fijo |               `false` | extractor                           | F2 `NOT_STARTED`         |
| `INGESTION_ZIP_ALLOW_ENCRYPTED`            | boolean fijo |               `false` | extractor                           | F2 `NOT_STARTED`         |
| `INGESTION_ZIP_ALLOW_LINKS`                | boolean fijo |               `false` | extractor                           | F2 `NOT_STARTED`         |
| `INGESTION_XML_MAX_DEPTH`                  | entero fijo  |                  `64` | parser seguro                       | F1 `NOT_STARTED`         |
| `INGESTION_XML_MAX_NODES`                  | entero fijo  |              `200000` | parser seguro                       | F1 `NOT_STARTED`         |
| `INGESTION_XML_MAX_ATTRIBUTES`             | entero fijo  |              `100000` | parser seguro                       | F1 `NOT_STARTED`         |
| `INGESTION_XML_MAX_ATTRIBUTES_PER_ELEMENT` | entero fijo  |                 `128` | parser seguro                       | F1 `NOT_STARTED`         |
| `INGESTION_XML_MAX_TEXT_NODE_BYTES`        | entero fijo  |             `1048576` | parser seguro                       | F1 `NOT_STARTED`         |
| `INGESTION_XML_PARSE_TIMEOUT_MS`           | entero fijo  |                `5000` | parser seguro                       | F1 `NOT_STARTED`         |
| `WORKER_MEMORY_TARGET_MIB`                 | entero fijo  |                 `256` | capacidad del worker                | F0 activo como guardrail |
| `INGESTION_ACTIVE_JOBS_PER_USER`           | entero fijo  |                   `2` | fairness/límite de productor futuro | F1 `NOT_STARTED`         |
| `INGESTION_ACTIVE_JOBS_PER_TENANT`         | entero fijo  |                   `4` | fairness/límite de tenant           | F0/F1 guardrail          |

Las últimas políticas pueden implementarse como constantes validadas en F0 si
no se exponen como variables. No se permite elevar límites por request, tenant
o header. Registrarlos no añade parser/extractor ni una ruta de carga.

## 8. RLS

| Setting             | Fuente                         | Valor                                  | Regla                                                          |
| ------------------- | ------------------------------ | -------------------------------------- | -------------------------------------------------------------- |
| GUC organización    | constante de código/migración  | `app.organization_id`                  | UUID válido; sólo `SET LOCAL` dentro de transacción.           |
| GUC membresía       | constante de código/migración  | `app.membership_id`                    | UUID válido/autorizado cuando la policy lo use.                |
| Grupo API           | migración                      | `balanz_api` (`NOLOGIN`)               | no owner, no superuser, no BYPASSRLS; grants fiscales mínimos. |
| Grupo worker        | migración                      | `balanz_worker` (`NOLOGIN`)            | igual; sólo este grupo recibe además `EXECUTE` de claim.       |
| LOGIN API           | secret manager/DB provisioning | dedicado, p. ej. `balanz_api_login`    | miembro sólo de `balanz_api`; nunca migrator/owner/worker.     |
| LOGIN worker        | secret manager/DB provisioning | dedicado, p. ej. `balanz_worker_login` | miembro sólo de `balanz_worker`; nunca migrator/owner/API.     |
| Rol migración       | CI/operación                   | credencial separada                    | nunca usado ni heredado en runtime.                            |
| Claim `search_path` | migración fija                 | sólo schemas explícitos + `pg_catalog` | No configurable por request/ambiente.                          |

No existe `RLS_DISABLED`, tenant default ni fallback a una organización. Un GUC
ausente/vacío/inválido falla cerrado. El table owner también queda sujeto a
`FORCE ROW LEVEL SECURITY` durante pruebas de runtime.

Las variables QA `CFDI_PHASE0_TEST_DATABASE`,
`CFDI_PHASE0_USE_TEST_DATABASE`, `QA_ALLOW_TRANSACTIONAL_MIGRATION_DOWN_UP` y
`QA_ALLOW_FISCAL_RUNTIME_VALIDATION` sólo se aceptan en development/test. El
nombre debe iniciar con `test_` o terminar en `_test`; no cambian la conexión
de los procesos API/worker y no autorizan `DROP DATABASE`.

## 9. Métricas y logs

| Variable                   | Tipo/rango              | Desarrollo        | Producción                                | Secreto      | Falla/nota                                                                  |
| -------------------------- | ----------------------- | ----------------- | ----------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `METRICS_ENABLED`          | boolean locked          | `true`            | `true` obligatorio                        | no           | `false` falla validación: observabilidad de Fase 0 no puede deshabilitarse. |
| `METRICS_PATH`             | valor locked            | `/metrics`        | `/metrics` obligatorio; protegido por red | no           | Otro valor falla validación; no incluye query ni credenciales.              |
| `HEALTH_CHECK_TIMEOUT_MS`  | 100–10000               | `2000`            | explícito según red/SLO                   | no           | Timeout de una dependencia produce resultado técnico, no fuga de detalle.   |
| `DB_CONNECTION_TIMEOUT_MS` | 100–30000               | `2000`            | no mayor que health timeout               | no           | Acota adquisición del pool; no puede exceder `HEALTH_CHECK_TIMEOUT_MS`.     |
| formato de log             | constante               | JSON estructurado | JSON estructurado                         | no           | No serializar request/config/error crudo.                                   |
| correlation ID             | header/context validado | generado si falta | propagado                                 | dato técnico | Longitud/formato acotados.                                                  |

Nombres canónicos mínimos de series:

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

Labels emitidos por la aplicación: `source`, `status`, `stage`, `result`,
`provider` y `outcome`. Service/environment pertenecen al target de scrape.
Labels prohibidos: organization/account/client/legal entity, RFC, UUID fiscal,
nombre, filename, object key, job/object/correlation ID, signed URL, XML,
mensaje/código libre de excepción o secreto.

## 10. Matriz de arranque por ambiente

| Condición               | Development                                                                      | Test/integration             | Production                                       |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| storage `local`         | permitido, raíz privada; Windows exige atestación explícita de DACL preexistente | permitido para tests locales | fatal                                            |
| storage `s3` sin bucket | fatal                                                                            | fatal                        | fatal                                            |
| S3 HTTP                 | MinIO permitido                                                                  | MinIO permitido              | fatal                                            |
| SSE `AES256`            | permitido                                                                        | permitido                    | fatal; requiere `aws:kms` + key                  |
| credencial S3 estática  | sólo local controlada                                                            | fixture aislado              | IAM/Vault preferido                              |
| scanner bypass          | sólo explícito                                                                   | no para integración scanner  | fatal                                            |
| ClamAV caído            | health degradado/fail-closed del flujo                                           | test esperado                | no procesa; alerta/fail-closed                   |
| Redis caído             | polling y warning acotado                                                        | escenario obligatorio        | polling; readiness sigue verde si autoridad sana |
| PostgreSQL caído        | no ready                                                                         | test esperado                | no ready/no claim                                |
| GUC ausente/inválida    | falla cerrado                                                                    | test obligatorio             | falla cerrado/alerta                             |

## 11. Validaciones cruzadas obligatorias

- `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` aparecen juntos o ninguno.
- `S3_SSE_MODE=aws:kms` exige `S3_KMS_KEY_ID`.
- `WORKER_HEARTBEAT_SECONDS * 3 < WORKER_LEASE_SECONDS`.
- Scanner max stream no es inferior al mayor objeto escaneable de la fase.
- Límite ZIP descomprimido >= comprimido y ratio no contradice ambos caps.
- Retención de una clase no es menor que su hold vigente.
- Prefix Redis efectivo incluye ambiente y no colisiona con sesión/cache.
- Producción exige S3+HTTPS+SSE-KMS y ClamAV; nunca corrige automáticamente una
  configuración insegura.

## 12. Evidencia de validación

El reporte de Fase 0 debe registrar configuración efectiva **redactada** por
ambiente, casos negativos de startup, `.env.example` sin secretos y pruebas de
Redis disponible/apagado, MinIO, ClamAV y RLS. No debe copiar valores secretos,
DSN ni URLs firmadas al reporte.
