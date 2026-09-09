# Runbook del worker durable CFDI

- Versión: 1.2
- Fecha: 2026-09-03
- Fase aplicable: Fase 0 desarrollo `ACCEPTED`, release `BLOCKED`; Fase 1 XML
  `IN_PROGRESS`
- Audiencia: desarrollo, SRE/operación y respuesta a incidentes

## 1. Propósito y límites

Este runbook opera la plataforma durable compartida y el handler productivo
`manual_xml` de Fase 1: claim, lease, heartbeat, retry, Redis wakeup, object
storage, scanner, parser seguro, persistencia fiscal, reconciliadores, health y
métricas. El registry no contiene handlers ZIP/SAT ni placeholders de fases
posteriores.

PostgreSQL es la única autoridad. No reconstruyas estado desde Redis, logs,
storage o memoria del worker. No uses `DROP DATABASE`, `TRUNCATE` general,
`migration:revert`, `synchronize=true` ni actualización manual de estados para
“desatascar” producción/desarrollo con datos que deban conservarse.

## 2. Invariantes operativas

- Lease: 90 s; heartbeat: 20 s.
- `WORKER_MAX_ATTEMPTS=4`: cuatro ejecuciones presupuestadas en el ciclo normal;
  `WORKER_MAX_RETRIES=3`: tres reintentos automáticos con backoff 10, 30 y 120 s
  más jitter. `attempt_count` es evidencia de claims y puede superar 4 tras
  shutdown/reclaim; `automatic_retry_count` es el presupuesto terminal.
- Polling PostgreSQL permanece activo aun con Redis saludable.
- Redis caído aumenta latencia, pero no falla readiness.
- Scanner deshabilitado/no disponible en producción falla cerrado.
- `balanz_api` y `balanz_worker` son grupos `NOLOGIN`; los LOGINs dedicados de
  despliegue no son owner/superuser, no heredan migrator y no tienen
  `BYPASSRLS`.
- Claim cross-tenant ocurre sólo en la función definer restringida.
- El claim y su evento de auditoría se confirman atómicamente.
- Completar exige el `lease_token` vigente; `worker_id` conserva procedencia y
  `version` es una revisión monotónica observable, no un CAS de ownership.
- Logs y métricas no contienen datos fiscales, object keys ni secretos.

## 3. Preparación de desarrollo

### 3.1 Preflight seguro

Desde la raíz del repositorio:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
docker version
docker compose version
```

Antes de migrar una base de desarrollo existente, registra el estado Git,
confirma `NODE_ENV`, host y nombre exacto de DB, ejecuta `migration:show` y crea
un schema-only dump o backup cuando esté disponible. Usa una DB/esquema de test
inequívocamente separado para pruebas destructivas o de aislamiento.

```powershell
npm run infra:cfdi:config
Set-Location apps/api
npm run migration:show
npm run migration:preflight
```

Nunca copies DSN, password, XML, RFC o nombres de clientes al ticket/reporte.

### 3.2 Infraestructura real

Levanta `infra/cfdi-phase0/compose.yaml`; debe incluir
PostgreSQL de test/desarrollo aislado, Redis, MinIO y ClamAV. Verifica con
`docker compose ps` y logs de servicio antes de ejecutar integración. No
reemplaces ni borres la base de desarrollo existente.

MinIO se construye desde `infra/cfdi-phase0/minio/Dockerfile`, fijado al tag
upstream firmado `RELEASE.2025-10-15T17-29-55Z`. Verifica firma/procedencia y el
digest resultante en el proceso de build. No sustituyas ese build por la imagen
precompilada `2025-09` identificada como vulnerable ni avances el tag sin
revisión de seguridad y pruebas S3.

El comando canónico también debe quedar en el README de infraestructura:

```powershell
docker compose --env-file infra/cfdi-phase0/.env -f infra/cfdi-phase0/compose.yaml up -d --wait
docker compose --env-file infra/cfdi-phase0/.env -f infra/cfdi-phase0/compose.yaml ps
```

Si el host no tiene Docker ni Podman, documenta los comandos/version checks y
marca las pruebas reales de Redis/MinIO/ClamAV como bloqueadas hasta usar un
host aprovisionado. No las sustituyas con mocks ni declares Fase 0 `DONE`.

El teardown de tests elimina sólo contenedores/volúmenes inequívocamente
creados por esa suite. Los objetos de prueba se borran del bucket/directorio;
no se vacía un bucket compartido.

### 3.3 Migración y seeds

```powershell
Set-Location apps/api
npm run migration:show
npm run migration:preflight
npm run migration:run
npm run seed:run
npm run seed:run
npm run qa:migrations
npm run test:integration:fiscal
```

Si cualquiera de las migraciones CFDI 060/061/062/063 está pendiente, tanto el
preflight como `migration:run` exigen el superuser/migrator efímero dedicado.
No sustituyas esa identidad con el LOGIN de API o worker ni conserves su env
después de `release:prepare`. El runner usa `transaction: all`; cualquier error
revierte DDL, memberships y privilegios transitorios.

La segunda ejecución debe terminar sin duplicados/cambios inesperados. Después,
inspecciona tablas, constraints, índices, policies, owners, grants, funciones y
atributos de roles. Ejecuta esta validación con PostgreSQL real, no SQLite/mock.
El validador runtime (LOGINs efímeros, RLS, claims concurrentes y shutdown) se
ejecuta únicamente sobre una DB `test_*`/`*_test` con
`QA_ALLOW_FISCAL_RUNTIME_VALIDATION=true`; nunca sobre `accounting_dev`.

### 3.4 LOGINs runtime de desarrollo

API y worker se conectan a la misma base PostgreSQL existente: `accounting_dev`
en desarrollo compartido. `database/postgres-api` y `database/postgres-worker`
son paths de secretos en Vault; cada uno contiene una identidad de conexión
distinta a esa base. El aislamiento se aplica mediante LOGINs y permisos por
proceso. Cerrar `TD-004` no requiere crear otra base de datos.

| Proceso | Path de Vault | LOGIN dedicado de ejemplo | Grupo de permisos | Base compartida |
| --- | --- | --- | --- | --- |
| API | `database/postgres-api` | `balanz_api_login` | `balanz_api` | `accounting_dev` |
| Worker | `database/postgres-worker` | `balanz_worker_login` | `balanz_worker` | `accounting_dev` |

Un administrador debe crear ambos secretos con el mismo `db_host`, `db_port`
y `db_database` que usa el migrator, y con `db_username` y `db_password`
distintos entre API y worker. El provisionador comprueba esa coincidencia y
rechaza credenciales que apunten a otro destino. Cada runtime recibe acceso
únicamente a su propio secreto.

Infraestructura aprovisiona los grupos `NOLOGIN` `balanz_api` y `balanz_worker`.
La migración histórica 061 conserva su bootstrap condicional original y valida
sus atributos seguros. No se reescribe porque ya fue aplicada; las migraciones
asignan los permisos de aplicación, pero no crean sus LOGINs.
Si no aprovisionas los LOGINs desde Ansible, después de aplicar las migraciones
puedes usar el script dev-only e idempotente:

```powershell
Set-Location apps/api
$env:CFDI_PROVISION_RUNTIME_LOGINS='true'
npm run db:runtime:provision
Remove-Item Env:CFDI_PROVISION_RUNTIME_LOGINS
```

Con Vault habilitado, el script lee `database/postgres-api` y
`database/postgres-worker`; sin Vault toma `DB_API_USERNAME/PASSWORD` y
`DB_WORKER_USERNAME/PASSWORD` desde el entorno local. Nunca imprime passwords.
Exige credencial migrator/superuser de desarrollo, LOGINs distintos con mínimo
16 caracteres, `NOINHERIT`, una sola membership directa con `ADMIN=false`,
`INHERIT=false`, `SET=true`, y sin `BYPASSRLS`, owner, ACL directa sobre ningún
objeto del schema `public`,
`CREATE` de schema ni otros roles. Al final conecta con cada LOGIN y ejecuta el
mismo guard de runtime/`SET LOCAL ROLE` que usan API y worker. La bandera no se
acepta fuera de development/test ni con un scope Vault distinto de `dev`.
El guard también rechaza `CREATE` sobre la base actual. No revoca `TEMP` a
`PUBLIC` porque es un default de cluster compartido; en su lugar mantiene
`search_path=public`, funciones definer con resolución fija y bloquea cualquier
ACL directa del `LOGIN` sobre objetos de `public` (schema, tablas, columnas,
secuencias, funciones y tipos), además de privilegios por defecto.

Cada conexión selecciona desde el startup PostgreSQL el único grupo fijo del
perfil (`-c role=balanz_api|balanz_worker`); el guard exige `session_user` igual
al LOGIN y `current_user` igual al grupo antes de aceptar tráfico. La migración
063 retira `DELETE`, grants de secuencias y mutaciones no utilizadas sobre
tablas de catálogo. Los GUCs fiscales siguen exclusivamente delimitados por
`SET LOCAL` dentro de transacción.

El provisioner es la única ejecución autorizada para resolver ambas credenciales
runtime. Al terminar, retira su identidad y su ambiente del host. No arranques
API/worker desde ese shell. Cada despliegue usa después su propio secret/env:

- API: `DB_API_*` o `database/postgres-api`; nunca worker/migrator.
- Worker: `DB_WORKER_*` o `database/postgres-worker`; nunca API/migrator.

Con Vault, entrega AppRoles distintos. La policy del worker permite sólo su
PostgreSQL y `cache/redis` si está habilitado; deniega `database/postgres-api`,
`auth/jwt`, `auth/mfa` y `email/ses`. La API deniega
`database/postgres-worker`. `SECRETS_SYSTEM` conserva la taxonomía Vault
realmente aprovisionada y es obligatorio explícito en producción; no inventes
un namespace `worker` para aparentar aislamiento.

### 3.5 Creación manual de usuarios PostgreSQL (sin archivos `.env`)

Este procedimiento documenta el aprovisionamiento manual equivalente al que
administra Ansible en `hemia-infra`. Requiere PostgreSQL 16 o superior, la base
`accounting_dev` existente y los grupos `NOLOGIN` `balanz_api` y
`balanz_worker` ya creados. Las migraciones de Balanz deben asignar los permisos
sobre tablas y funciones y las políticas RLS antes del arranque de los runtimes.

Conéctate como administrador a `accounting_dev` y ejecuta el siguiente SQL
para usuarios nuevos. Sustituye los placeholders por contraseñas distintas
de al menos 16 caracteres mediante tu herramienta administrativa; no guardes
las contraseñas reales en Git ni en esta documentación. `CREATE ROLE` fallará
si el usuario ya existe: en ese caso revisa su configuración o reconcíliala
con Ansible, sin eliminarlo ni recrearlo.

```sql
CREATE ROLE balanz_api_login
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  NOINHERIT
  PASSWORD '<password-api>';

CREATE ROLE balanz_worker_login
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  NOINHERIT
  PASSWORD '<password-worker>';

ALTER ROLE balanz_api_login SET search_path TO public;
ALTER ROLE balanz_worker_login SET search_path TO public;

GRANT balanz_api
  TO balanz_api_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

GRANT balanz_worker
  TO balanz_worker_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

GRANT CONNECT ON DATABASE accounting_dev TO balanz_api_login;
GRANT CONNECT ON DATABASE accounting_dev TO balanz_worker_login;
```

Los LOGINs no deben ser propietarios de la base ni de objetos, recibir grants
directos sobre `public`, tener `CREATE` en la base o schemas de aplicación,
ni pertenecer a otros grupos. Cada grupo runtime debe tener únicamente su
LOGIN correspondiente. Los permisos de objetos se administran a través de
`balanz_api` y `balanz_worker`, mediante las migraciones.

Después, actualiza manualmente los secretos de Vault:

| Path lógico | `db_username` | `db_password` |
| --- | --- | --- |
| `database/postgres-api` | `balanz_api_login` | Contraseña usada para API |
| `database/postgres-worker` | `balanz_worker_login` | Contraseña usada para worker |

Ambos deben incluir `db_database=accounting_dev`, el mismo `db_host` y
`db_port` del migrador y `db_logging=false` (booleano). `db_port` es numérico.
El secreto `database/postgres` conserva la identidad administrativa para
migraciones. API y worker consumen sólo su propio secreto, con
`SECRETS_ENABLED=true`; no necesitan credenciales en archivos `.env` locales.

Para PROD, usa `accounting_prod` en los dos `GRANT CONNECT` y en
`db_database`, contraseñas distintas de DEV y el scope Vault `prod`.
Los roles PostgreSQL existen a nivel de clúster: DEV y PROD con estos mismos
nombres deben usar clústeres separados. Al arrancar, cada proceso selecciona
su grupo (`current_user`) manteniendo el LOGIN dedicado como `session_user`;
el guard comprueba sus privilegios antes de aceptar tráfico.

## 4. Arranque y parada

### 4.1 Arranque de desarrollo

Con infraestructura y migraciones listas:

```powershell
Set-Location apps/api
# Una sola vez: copia la plantilla y completa valores sin imprimirlos.
Copy-Item .env.worker.example .env.worker.local
npm run start:worker:dev
```

El script productivo equivalente es `npm run start:worker:prod` y debe arrancar
el entrypoint compilado del worker, no `main.ts` de la API. El proceso valida
toda configuración antes de marcar readiness.

El orden de archivos es `.env.worker.local`, `.env.worker`, `.env.local`,
`.env`; el primer valor definido gana. No uses la plantilla/catálogo completo
como runtime. El perfil worker rechaza valores no vacíos `DB_API_*`, `JWT_*`,
`MFA_*`, `EMAIL_*`, configuración HTTP/cookie/auth o migrator. La API tiene
comandos explícitos `start:api:dev`/`start:api:prod`, prioriza
`.env.api.local` y rechaza `DB_WORKER_*` y migrator.

Secuencia esperada:

1. Cargar configuración redactada y generar `worker_id` técnico.
2. Conectar PostgreSQL con el LOGIN dedicado del worker (por ejemplo
   `balanz_worker_login`) y comprobar membresía exclusiva en el grupo
   `balanz_worker`, claim/grants y ausencia de owner/superuser/`BYPASSRLS`.
3. Inicializar storage y scanner requeridos.
4. Abrir liveness/readiness del worker.
5. Intentar suscripción Redis; si falla, registrar degradación acotada.
6. Iniciar polling, reconciliadores y claim hasta `WORKER_CONCURRENCY`.

Fase 0 no debe crear un job ficticio para que el arranque “se vea activo”.

### 4.2 Verificación posterior

- Liveness responde sin consultar Redis.
- Readiness confirma PostgreSQL y adapters autoritativos/obligatorios.
- API requiere PostgreSQL y storage; scanner caído produce `degraded`/HTTP 200
  para mantener consultas existentes. Worker requiere también scanner y su
  supervisor; scanner caído produce HTTP 503. La respuesta del scanner incluye
  `required` para distinguir ambos procesos. Los futuros handlers/endpoints de
  carga deben aplicar admisión y escaneo fail-closed; readiness no los sustituye.
- `HEALTH_STORAGE_PROBE_INTERVAL_MS` limita a 30 s por defecto la reutilización
  de una sonda física exitosa. Al vencer, readiness espera una sonda nueva y
  falla si expira o falla. PostgreSQL/scanner mantienen caché de hasta 1 s.
  Storage fallido reintenta con esa ventana breve, conservando una sola sonda
  física en curso, incluso durante timeout/cleanup.
- Con sondas sanas cada 30 s, S3 ejecuta unas 14.400 solicitudes por proceso/día
  (cinco operaciones por sonda), frente a 86.400 con consultas cada 5 s sin esa
  caché. Es una estimación sin reintentos; mide frecuencia y duración mediante
  `object_storage_operation_duration_seconds{stage="health"}`.
- `WORKER_QUEUE_METRICS_INTERVAL_MS` muestrea la edad de cola cada 30 s por
  proceso, incluidos intentos fallidos. Polling, wakeups y reconciliación
  comparten la consulta en curso; los claims mantienen su frecuencia original.
  `ingestion_queue_refresh_duration_seconds` mide duración, cantidad y resultado.
- `worker_heartbeats_total` contabiliza renovaciones, cancelaciones, pérdida de
  lease y fallos; no se inserta `ingestion.job.heartbeat` por cada evaluación.
  La renovación y su fencing siguen en PostgreSQL; cancelación, completion,
  retries y reconciliación conservan sus eventos de auditoría.
- Métrica/log muestra polling activo y capacidad libre.
- Redis disponible produce wakeup rápido; apagado conserva claims por polling.
- No hay errores `RLS_CONTEXT_*`, leases vencidos repetidos ni handler faltante.
- Un log canario no expone configuración o datos sintéticos sensibles.

### 4.3 Shutdown seguro

Envía `SIGTERM`/señal del orquestador; no mates primero PostgreSQL. El worker:

1. marca not-ready y deja de reclamar;
2. cancela timers/subscriber/reconciliadores nuevos;
3. notifica `AbortSignal` a handlers activos;
4. mantiene heartbeat sólo durante la ventana segura; si heartbeat devuelve
   `cancel_requested`, aborta cooperativamente y confirma `cancelled` sólo con
   el `lease_token` vigente; `worker_id` y `version` conservan procedencia y
   revisión observable;
5. completa únicamente resultados con lease vigente o libera el lease y vuelve
   a `queued` sin incrementar `automatic_retry_count`;
6. cierra Redis, scanner/storage y pool DB;
7. termina antes de `WORKER_SHUTDOWN_GRACE_MS`.

Si el proceso es terminado forzosamente, espera al vencimiento de lease y deja
que otro worker/reconciliador recupere; un lease vencido sí consume un reintento
automático. No edites `locked_by` manualmente.

## 5. Señales y diagnóstico

Empieza por IDs técnicos y ventana temporal:

- `correlation_id`, `job_id`, `object_id`, `worker_id`;
- job type, state, stage, attempt, lease/heartbeat age;
- queue age, claims/completions/failures/recoveries;
- storage/scanner latency/result;
- Redis publish/subscription/fallback;
- reconciler examined/repaired/skipped/error;
- liveness/readiness y restarts.

Las series canónicas mínimas que deben estar presentes con los nombres exactos
son:

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
worker_heartbeats_total
ingestion_queue_refresh_duration_seconds
worker_lease_reclaims_total
object_storage_failures_total
redis_wakeup_failures_total
```

Nunca uses RFC, UUID fiscal, filename, razón social o contenido como búsqueda o
label compartido. Si hace falta examinar un recurso fiscal, usa el procedimiento
de acceso JIT/autorizado cuando exista; platform admin no tiene acceso implícito.

Consultas de diagnóstico deben ejecutarse con rol read-only autorizado y
parámetros, dentro del tenant cuando aplique. Evita `SELECT *`; limita columnas
a IDs/estado/timestamps/códigos y aplica `LIMIT`.

## 6. Incidentes y acciones

### 6.1 Redis no disponible

Síntomas: fallo de conexión/publish/subscribe, incremento de wakeup failures y
latencia cercana al poll.

Acciones:

1. Confirma que PostgreSQL/worker readiness siguen sanos.
2. Verifica que polling continúa y queue age no crece sin límite.
3. Revisa DNS/red/credencial/prefijo sin imprimir secretos.
4. Reinicia/repara Redis de forma independiente.
5. Confirma resuscripción y wakeup; no reencoles jobs ni cambies DB.

Escala si polling se detiene o queue age supera el umbral. Redis caído por sí
solo no justifica marcar API/worker no-ready.

### 6.2 PostgreSQL no disponible

Síntomas: readiness falla, claim/heartbeat no puede confirmar autoridad.

Acciones:

1. El worker debe dejar de reclamar y no publicar resultados.
2. Preserva procesos; verifica conectividad, pool y estado del servicio.
3. Restaura PostgreSQL siguiendo su runbook/backup autorizado.
4. Al volver, observa leases vencidos y recovery idempotente.
5. Verifica que ningún worker stale complete después de perder lease.

No uses Redis como cola alternativa y no “reconstruyas” jobs desde objetos.

### 6.3 ClamAV caído, timeout o no saludable

1. Confirma que archivos permanecen `quarantined`/no disponibles.
2. En producción, no habilites `bypass`; pausa claims que requieran scanner si
   el diseño no puede sostenerlos sin generar retry storm.
3. Revisa daemon, firmas, límites, socket TCP y recursos.
4. Restablece health y deja que backoff/retry durable continúe.
5. Verifica clean y EICAR sólo en entorno controlado.

`MALWARE_DETECTED` es terminal y activa el procedimiento de seguridad; no
registres el filename o firma cruda en canales no restringidos.

### 6.4 Object storage no disponible o hash mismatch

1. Detén transiciones a `available`; conserva fila/estado/procedencia.
2. Revisa health, timeout, permisos mínimos, bucket/root y cifrado sin exponer
   key/credencial.
3. Para mismatch, no sobrescribas ni vuelvas a etiquetar el objeto; rechaza y
   preserva evidencia conforme a retención.
4. Cuando storage vuelva, ejecuta reconciliador en dry-run/observación si está
   disponible y después modo normal idempotente.
5. Comprueba objeto por `head`, hash/tamaño y referencias antes de eliminar.

### 6.5 Queue age alta o jobs sin progreso

1. Segmenta métricas por job type/stage/error, nunca por tenant fiscal como
   label.
2. Compara jobs claimable con concurrencia y número de workers ready.
3. Revisa `next_attempt_at`, attempt, lease/heartbeat y handler registrado.
4. Descarta dependencia caída, retry storm o starvation/fairness.
5. Escala capacidad sólo después de medir DB/storage/scanner; no eleves
   concurrencia por encima de 32 ni cambies lease bloqueado.

Un job `processing` con lease vigente no está huérfano. Uno con lease vencido se
recupera mediante flujo normal, no por update manual.

### 6.6 Leases vencidos o doble ejecución aparente

1. Identifica `worker_id`, `lease_token`, `version` y timestamps técnicos;
   recuerda que el token vigente cerca ownership y la versión sólo registra una
   revisión monotónica.
2. Confirma clock UTC y pausas/restarts del worker.
3. Comprueba que sólo el owner vigente hizo heartbeat/completion.
4. El worker stale debe registrar `JOB_LEASE_LOST` y abandonar resultado.
5. Ejecuta test concurrente/recovery antes de volver a desplegar una corrección.

Si dos completions durables existen para el mismo intento, es incidente de
integridad: pausa nuevos claims, preserva evidencia y escala inmediatamente.

### 6.7 `HANDLER_NOT_REGISTERED`

Fase 1 registra únicamente `manual_xml`. El error indica un job de fuente no
soportada o un despliegue API/worker incompatible. No registres un handler vacío
para silenciarlo. Identifica el origen, detén el productor indebido, conserva el
job y corrige mediante forward-fix.

### 6.8 Fallo RLS/contexto

1. Trata `RLS_CONTEXT_REQUIRED/INVALID` como fail-closed y posible incidente.
2. Verifica que la operación abrió transacción y usó exactamente `SET LOCAL
app.organization_id` y, cuando corresponda, `SET LOCAL app.membership_id`
   tras resolver scope server-side.
3. Inspecciona roles/policies/FORCE/grants con credencial administrativa
   autorizada, no cambies runtime a owner/BYPASSRLS.
4. Confirma grupos `NOLOGIN` `balanz_api`/`balanz_worker`, LOGINs dedicados con
   membresía exclusiva y ausencia de migrator/owner/BYPASSRLS.
5. Ejecuta regresión A/B, sin contexto, inválido, owner, API y worker.
6. Si hubo acceso cross-tenant, activa respuesta a incidente de datos.

### 6.9 Redis wakeup funciona pero no hay job

Es esperado ante señal duplicada, tardía o falsa. El worker consulta PostgreSQL,
no encuentra claim y vuelve al loop. No loggea el mensaje completo ni crea una
fila. Un volumen anómalo se trata con rate/ACL de Redis, no desactivando polling.

### 6.10 Fallo de scanner/parser XML

- Scanner caído, timeout o storage caído conservan el objeto en cuarentena y
  usan el presupuesto durable; no marques `clean` ni cambies a bypass.
- Malware, DTD/XXE, expansión, XML malformado, versión no soportada, UUID
  inválido y RFC ajeno son resultados de contenido no reintentables.
- Un complemento de namespace desconocido incorpora sólo el core y abre
  `COMPLEMENT_UNSUPPORTED`; una versión no soportada de TFD/Pagos/Nómina se
  rechaza como `unsupported`.
- Ante `CFDI_UUID_HASH_CONFLICT`, preserva el original, mantén el conflictivo en
  cuarentena/hold y escala el incidente alto. Nunca reemplaces object key ni
  CFDI por una corrección manual.

## 7. Reconciliadores

Todos son idempotentes, procesan batches acotados, usan edad mínima y emiten
conteos técnicos.

| Reconciliador               | Detecta                                     | Acción segura                                                     |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| leases vencidos             | job processing/cancel con lease expirado    | requeue, cancel o fallo final según intentos; auditar             |
| uploads expirados           | intención incompleta >24 h                  | expirar y marcar objeto rechazado/retención; auditar              |
| objetos huérfanos           | fila pending/uploaded sin referencia activa | verificar edad/referencias; marcar rechazo, retención y auditoría |
| objetos confirmados sin job | upload/objeto listo sin job esperado        | marcar y auditar; no sintetizar jobs automáticamente              |
| jobs huérfanos              | root object/upload ausente o terminal       | fallo final seguro y auditoría                                    |
| counters/estado             | agregados inconsistentes con items          | recalcular mediante fuente durable/versionada                     |
| lifecycle                   | `retention_until` vencido y sin hold        | marcar elegibilidad y auditar; no borrar bytes en Fase 0          |

Un segundo run sin cambios debe reportar cero reparaciones. Un fallo parcial se
reanuda; no marca éxito si storage/DB divergen.

La Fase 0 no ejecuta purga física ni borrado comercial: sólo detecta, transiciona
estados reversibles y registra elegibilidad/procedencia. La eliminación durable
con hold, retención y evidencia de storage pertenece a Fase 6 y permanece
`NOT_STARTED`.

## 8. Retry y cancelación manual de Fase 1

Las rutas de Fase 1 requieren `ingestion.retry`/`ingestion.cancel`, assignment y
ownership propio para collaborator, estado válido y RLS. Retry exige
`Idempotency-Key`, crea otro job con `retry_of_job_id` y conserva objeto/upload e
item de procedencia; no reabre el job anterior. Cancelación solicita la
transición durable y el worker la reconoce en un boundary seguro. Soporte no
debe mutar filas directamente.

## 9. Despliegue y rollback

Terraform y Ansible son la fuente de verdad del VPS: crean la identidad
`deploy`, instalan Node, Bun y PM2, preparan `/srv/apps/balanz/{releases,shared}`
y configuran la recuperación de procesos al reiniciar el host. El workflow de
GitHub Actions sólo publica versiones de la aplicación.

### Eliminación de `scripts/deploy`

El 5 de septiembre de 2026 se eliminó completo `scripts/deploy/`: 17 scripts
shell y dos scripts Node. Esos archivos dividían entre wrappers de un solo
consumidor el aislamiento del runtime, el cutover legacy, la activación, las
migraciones, el manejo de credenciales, los smoke tests y el rollback.

La eliminación se tomó porque:

- Terraform y Ansible ya garantizan usuario, paquetes, directorios y supervisor;
- los scripts de transición dejaron de ser necesarios después de estabilizar el VPS;
- GitHub Actions ya compila el workspace y transfiere directamente el árbol de
  release mediante `rsync`, por lo que no existe un archivo que descomprimir o
  verificar con una segunda implementación de hashing;
- el único consumidor de la secuencia restante es `deploy-dev.yml`, donde el
  flujo completo resulta visible y mantiene rollback y limpieza en el mismo
  contexto.

Esto no elimina controles de despliegue. El workflow conserva validación,
release inmutable, secretos fuera del release, migración efímera, pausa del
worker, cambio atómico de `current`, recarga de PM2, health checks, rollback y
limpieza. La instalación remota con Bun instala únicamente dependencias de la
aplicación excluidas del `rsync`; no provisiona el VPS.

No se debe recrear `scripts/deploy/` para envolver comandos usados una sola vez.
Un script separado sólo se justifica si tiene más de un consumidor real o una
lógica independiente que necesite pruebas propias. La lista exacta retirada y
la evidencia histórica están en `../qa/CFDI_PHASE_0_VALIDATION_REPORT.md`.

La secuencia normal es:

1. Ejecutar lint, pruebas y build en GitHub Actions.
2. Subir el árbol construido a un directorio de release único mediante `rsync`.
3. Instalar las dependencias excluidas del `rsync` con el Bun ya provisionado.
4. Escribir fuera del release la configuración separada de API, worker y
   migraciones; nunca imprimir su contenido.
5. Pausar el worker, ejecutar `bun run release:prepare` y eliminar inmediatamente
   la configuración de migración.
6. Cambiar atómicamente el enlace `current`, eliminar únicamente los procesos
   Balanz de PM2 e iniciarlos desde el ecosystem del release concreto. Verificar
   `pm_cwd`, `pm_exec_path` y `node_args` contra esa definición antes de validar
   web, liveness y readiness de API/worker. No usar `startOrReload`: puede conservar
   rutas antiguas. La recreación en modo fork implica una breve interrupción.
   Si liveness/readiness agota los reintentos, antes del rollback se consulta una
   nueva instantánea acotada y se imprimen únicamente estado, proceso, dependencia,
   obligatoriedad y código de error. Para S3, `diagnostics` identifica la operación
   fallida, el código del proveedor permitido y el estado HTTP cuando está disponible.
   Incluye la limpieza `DeleteObject`; un fallo adicional no reemplaza el original.
   `ValidateMetadata/MetadataMismatch` indica tamaño o cifrado inesperado y
   `ValidateContent/ContentMismatch` indica contenido distinto al escrito.
   No se imprime el cuerpo completo ni logs de
   aplicación. El diagnóstico conserva el código de fallo original de curl aunque
   la respuesta adicional sea inválida o el proceso ya no responda.
7. Persistir el estado de PM2. Ante un fallo, restaurar `current` y recrear el
   release anterior con su configuración original; comprobar web y liveness/readiness
   de API y worker. Los releases legacy sin worker se restauran sin éste y se
   comprueba `/api/v1` en lugar de endpoints fiscales que todavía no existían.
   La ausencia de argumentos Node en el ecosystem anterior también se verifica,
   evitando heredar el `--env-file` del release fallido. El ecosystem y el entorno
   propio del release anterior deben contener toda la configuración que requiere.

El rollback restaura la versión de la aplicación y su configuración: no revierte
migraciones. Toda migración desplegable debe seguir expand/contract y conservar
compatibilidad con el release anterior. Los archivos runtime viven en
`/srv/apps/balanz/runtime-config/<release>/{api,worker}/runtime.env`, con
directorios `0700` y archivos `0600`. Cada release tiene configuración inmutable;
PM2 resuelve su ruta desde el directorio del ecosystem, sin depender de `current`.
Ambos archivos deben estar completos antes de pausar el worker o activar el release.
`runtime-config/<release>/migration.env` es efímero y el workflow lo elimina tanto
en éxito como en fallo, junto con los archivos temporales de carga.

Conservar la configuración de todo release disponible para rollback. Durante la
transición, conservar también `shared/{api,worker}.env`: los releases antiguos
todavía los utilizan y el workflow nuevo no los modifica.

Después de los health checks y `pm2 save`, el workflow registra `.deploy-success`
mediante `infra/deploy/retain-releases.cjs` (sus pruebas y las del despliegue
residen en `infra/deploy/`)
y conserva el release actual y dos anteriores exitosos (priorizando el destino
de rollback). Elimina juntos código y configuración de los demás, incluidos los
intentos fallidos. Durante la transición se protege adicionalmente el destino de
rollback legacy sin marcador; no se lo considera exitoso sin evidencia. En el
siguiente deploy exitoso deja de necesitar esa protección. Un fallo de limpieza
se reporta como error, sin revertir el despliegue ya saludable. No se limpia tras
un despliegue fallido ni se eliminan los archivos compartidos legacy.

## 10. Evidencia y cierre del incidente

Registrar:

- inicio/fin y ambiente;
- release SHA y configuración no secreta relevante;
- correlation/job/object/worker IDs técnicos;
- métricas/probes y códigos estables;
- comandos read-only o acciones autorizadas;
- causa, alcance, corrección y prueba de regresión;
- objetos temporales de test limpiados.

El cierre exige autoridad durable convergente, queue age recuperándose, probes
esperados y ausencia de fuga en logs. Un control incompleto queda como defecto,
no como “fase futura”.

## 11. Operación Fase 2: ZIP manual

`ManualZipJobHandler` comparte `XmlObjectProcessor` con XML individual. No crea
jobs hijos. Pipeline: claim y contexto RLS → scope/raíz → lectura completa con
SHA-256 y ClamAV → cuarentena → `extracting` → inspección de central/local headers
→ reserva durable por ordinal → extracción streaming con CRC, fin DEFLATE,
bytes/ratio acumulados → escaneo y parser por objeto XML → resultados aislados
→ counters SQL → transición terminal con lease. No se invoca el parser si la
extracción real de cualquier entrada revela una amenaza estructural.

Errores de contenido XML son resultados de item; la excepción de infraestructura
interrumpe el intento y deja la autoridad durable reanudable. Reejecución verifica
objetos existentes, conserva ordinal único y omite publicación de items terminales.
Cancelación y lease se comprueban entre entradas y al finalizar. El runner mantiene
heartbeat y el presupuesto existente; `ZIP_CANCELLED` converge sin consumir retry.
El trigger terminal reconcilia también cancelación en cola y recuperación tras caída.

### 11.1 Retención y limpieza

| Objeto/estado | Tratamiento |
| --- | --- |
| ZIP limpio usado por un job | Conservar 30 días desde escaneo/retry para reprocesar el paquete completo |
| ZIP con rechazo estructural | Rechazado, no elegible para retry; conservar ventana técnica de raíz antes de cleanup |
| ZIP raíz infectado | Cuarentena, hold infinito; nunca extraer; revisión de incidente autorizada para cualquier purga |
| XML incorporado / fuente del CFDI | No eliminar; descargar mediante el contrato existente con MFA |
| XML duplicado o rechazado | Retención de Fase 1; puede limpiarse al vencer si no hay referencias/hold/incidente/job activo |
| XML infectado o en investigación | Preservar; malware y un incidente abierto excluyen cleanup automático |
| XML pendiente tras cancelación/fallo final | Resultado durable `internal_error`, bytes retenidos 1 día; retry crea otros objetos desde la raíz |
| Upload nunca confirmado / objeto huérfano pendiente | Expira admisión según configuración existente; barrido ZIP admite borrado a partir de 31 días, sin actividad/hold |

`claim_zip_cleanup()` es un boundary SECURITY DEFINER sin argumentos libres,
propietario técnico existente y sin EXECUTE público; sólo worker lo ejecuta.
Reclama hasta 100 filas con lock/SKIP LOCKED, vuelve a verificar referencias/jobs
con un snapshot posterior al lock y persiste `cleanup_requested_at` + `rejected`.
Admisión/retry bloquean la raíz y rechazan ese marcador. El worker obtiene la key
en una transacción RLS normal, elimina bytes y publica `deleted` + auditoría.
La eliminación es idempotente: si cae entre borrar storage y actualizar SQL, el
siguiente barrido tras 5 minutos repite delete y termina la transición. Fallar
no retira el claim ni pierde la capacidad de recuperación.

En filesystem, el mismo claim limpia solamente archivos `.partial-<UUID>` del
objeto opaco autorizado, validando contención, directorios y archivos regulares;
así se recuperan escrituras interrumpidas por muerte del proceso. El delete común
de XML no cambia. En S3 se conserva el lifecycle existente para multipart
incompletos; no configure reglas que borren indiscriminadamente XML publicados o
cuarentena. Raíces y extraídos se registran en SQL **antes** de escribir bytes,
para que una caída no pierda su referencia de cleanup.

No elimine manualmente por prefijo ni vuelva disponible un objeto infectado para
forzar retry. Recupere primero job/upload/objeto por sus IDs y compruebe autoridad
durable, incidentes y hold. Cualquier purga de incidente requiere la autorización
operativa correspondiente y auditoría; esta fase no agrega una UI de purga.

### 11.2 Métricas y evidencia

Nuevas métricas sin labels: `zip_admitted_total`, `zip_uncompressed_bytes_total`,
`zip_entries_inspected_total`, `zip_structural_rejections_total`,
`zip_cleanup_failures_total`, `zip_expansion_ratio`,
`zip_extraction_duration_seconds`. Los bytes comprimidos y terminales usan
`ingestion_upload_bytes_total{source="manual_zip"}` y las métricas existentes
de jobs con source/result acotados. Bytes/entradas de extracción representan
intentos que completaron extracción, no CFDI únicos. Nunca etiquetar por ID,
filename, key, RFC, URL o firma de antivirus.

Auditoría conserva admisión, confirmación, creación/retry/cancel y resultado
terminal existentes; añade escaneo/rechazo ZIP y eliminación por objeto. Logs
y errores externos sólo usan códigos canónicos y referencias técnicas.

Integración representativa reproducible (sólo entorno QA autorizado):

```powershell
$env:RUN_ZIP_INTEGRATION='true'
bun run --cwd apps/api test --testRegex='test/external/manual-zip\.external\.ts$' --runInBand
```

El test obtiene credenciales locales Docker sin imprimirlas, crea una base y
logins efímeros, aplica migraciones, usa sesión real/API/MinIO firmado/ClamAV/
worker/parser y elimina exclusivamente sus datos. No consulta ni modifica Vault.
Requiere Node compatible con `apps/api/package.json`. El reporte de Fase 2
identifica SHA y conteos; no reemplaza Full ni certifica Fases 0/1.

Rollout: aplicar la nueva migración con el rol migrador autorizado antes de
activar API/worker/frontend. Para rollback restaurar el release de aplicación,
conservando datos y migración; jobs ZIP quedan pendientes hasta recuperar un
worker compatible. No revertir esquema para un rollback de aplicación.

### 11.3 Recuperación de confirmaciones ZIP

Antes de leer/hash del ZIP, la API reclama el upload en `receiving` usando
`version` y `updated_at`, sin mantener una transacción durante I/O. Reutiliza
`WORKER_LEASE_SECONDS` y `WORKER_HEARTBEAT_SECONDS` para este claim; todavía no
es un job del worker. `409 UPLOAD_CONFIRM_IN_PROGRESS` indica esperar/repetir
confirm con la misma key, sin retransmitir el paquete. El navegador conserva
uploadId e intención y ofrece recuperación si se agota la espera.

Tras caída de la API, el lease vencido permite reclamar nuevamente y verificar
los mismos bytes. Una versión obsoleta no puede confirmar, renovar ni liberar
el claim vigente. Un objeto ausente/error de lectura libera únicamente el claim
propio; si SQL está caído, se recupera por expiración. No borrar el objeto ni
modificar su estado manualmente para resolver una confirmación ocupada.
Uploads que nunca se confirman mantienen el cleanup durable de 24 horas.

`ZIP_EMPTY` es rechazo terminal de un paquete sin archivos regulares, incluso
si contiene carpetas; no crea items ni CFDI. Crear un ZIP con XML para continuar.
