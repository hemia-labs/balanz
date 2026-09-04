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

Las migraciones crean únicamente los grupos `NOLOGIN` `balanz_api` y
`balanz_worker`. Después de aplicar 060/061/062/063, aprovisiona los LOGINs dedicados
con el script dev-only e idempotente:

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

### 9.1 Bootstrap único de aislamiento en el host legacy

El primer cutover desde el release legacy allowlisted requiere una ventana
operativa y autoridad root fuera del workflow. El operador ejecuta únicamente
el `bootstrap-runtime-isolation.sh` del artefacto revisado; el script acepta el
deploy root exacto `/srv/apps/balanz`, el release legacy
`e3d4f432dca1df6bbd0877d86e60bd52d8c15325` y el acknowledgement exacto que
publica su mensaje de uso. La secuencia obligatoria es:

1. Verificar backup/schema dump, ventana, Node `22.22.0`, Bun `1.3.2`, systemd y
   el hash del ecosystem legacy mediante el propio preflight del script.
2. Como root, ejecutar el modo `quiesce`. Éste crea identidades distintas
   (`balanz-deploy`, `balanz-web`, `balanz-api`, `balanz-worker` y
   `balanz-migrator`), grupos/ACL mínimos y sudoers acotado; detiene y deshabilita
   el PM2 legacy, elimina procesos/listeners, transfiere la clave autorizada al
   control plane, bloquea `deploy` y purga el env legacy local. No continuar si
   no existe el sentinel root-only `.legacy-runtime-quiesced-v1`.
3. Desde el plano administrativo de PostgreSQL/Vault, rotar o revocar la
   credencial runtime legacy. Comprobar que ya no autentica. No reutilizarla ni
   escribir su valor en consola, ticket, sentinel o reporte.
4. Como root y sólo después de esa comprobación externa, crear
   `.legacy-runtime-credentials-revoked-v1` como archivo regular
   `root:root:0400` con exactamente tres líneas: el literal
   `LEGACY_RUNTIME_CREDENTIALS_REVOKED_V1`, el SHA legacy anterior y un
   identificador no secreto de la evidencia de revocación (por ejemplo, un ID
   de cambio). El sentinel no sustituye la revocación real.
5. Ejecutar el mismo bootstrap en modo `finalize`. Éste valida los dos
   sentinels, ausencia de credenciales históricas, identidades/privilegios,
   instala la unidad root-owned `balanz-pm2.service`, habilita boot recovery y
   crea `.runtime-isolation-bootstrap-v1`. Sólo entonces se usa por SSH
   `balanz-deploy`; la identidad `deploy` no se rehabilita.

El modo `quiesce` deja el servicio intencionalmente fuera de línea. Antes de la
primera mutación crea evidencia de progreso `root:root:0400` bajo el directorio
`/var/lib/balanz-runtime-isolation` `0700`, ligada al release, hash del ecosystem
y SHA-256 del `authorized_keys` original. Si falla después de purgar la identidad
legacy, no reiniciar ese runtime: conservar evidencia, corregir exactamente la
causa y repetir el mismo comando `quiesce`. La reentrada sólo acepta la clave ya
transferida si coincide con el fingerprint root-only y no vuelve a operar el PM2
legacy. Al completar, el sentinel de quiescencia sustituye el progreso. Si ya
existe ese sentinel, no se repite la rotación: se comprueba la revocación, se
instala la attestation y se ejecuta `finalize`. Si `finalize` falla después de
crear `.pm2`, el mismo comando es reentrante sólo cuando el directorio sigue
vacío, regular, `balanz-deploy:balanz-deploy:0700`; contenido inesperado falla
cerrado. Se conservan ambos sentinels, no se crean secretos bajo el release y no
se inicia el workflow hasta completar el bootstrap. Nunca se elimina un
sentinel para simular un estado anterior.

### 9.2 Despliegues normales

1. Registrar rama/SHA/status y backup/schema dump.
2. Validar configuración productiva sin mostrar secretos.
3. Rechazar symlinks que salgan del release, instalar con Bun `1.3.2` y el PM2
   `7.0.4` release-local fijado en ambos locks sin lifecycle scripts, y repetir
   el escaneo antes de ejecutar cualquier artefacto remoto.
4. Ejecutar `bun run release:prepare` como job efímero bajo `balanz-migrator`,
   cerrar ese job y verificar que su credencial fue eliminada.
5. Desplegar código compatible e iniciar web, API y worker bajo UIDs distintos.
6. Verificar probes, RLS, claim, Redis fallback y adapters.
7. Observar queue age, leases, errores y reconciliación.

Rollback preferido: detener nuevo release y volver a binario compatible sin
revertir migraciones aditivas. Si una migración necesita corrección, crear una
nueva migración forward. Nunca borrar tablas/objetos como rollback rutinario.
`start:api:prod` y `start:worker:prod` nunca reciben ni ejecutan la credencial de
migración; sólo usan sus LOGINs runtime separados y `NOBYPASSRLS`.

En el despliegue inicial de Fase 0, las firmas legacy del worker permanecen
revocadas. Antes de ejecutar las migraciones forward, el despliegue elimina
`balanz-worker-dev` de PM2 y persiste esa ausencia. PostgreSQL conserva los jobs
como autoridad durable; no se reclaman trabajos mientras no exista un worker
compatible y los leases vencidos se recuperan cuando éste vuelve a operar.

Tras migrar, el release anterior sólo queda habilitado como rollback si su API
se reinicia en frío y supera el probe contra el esquema forward. La evidencia
queda ligada por hash al binario y a `ecosystem.config.cjs`. Un rollback
automático restaura únicamente `balanz-web-dev` y `balanz-api-dev`; nunca inicia
un worker legacy. Si la evidencia falta, cambia o el API anterior no arranca,
el despliegue falla cerrado y deja los procesos administrados detenidos para
intervención del operador. La misma detención ocurre si el reinicio en frío que
genera la evidencia no supera su probe después de migrar.

El ecosystem se evalúa desde la raíz read-only del release y sólo invoca
`scripts/deploy/run-isolated-runtime.sh`. El wrapper usa `env -i`, cambia al cwd
de cada aplicación y ejecuta `/usr/local/bin/node` como `balanz-web`,
`balanz-api` o `balanz-worker` mediante sudo no interactivo. Web no tiene archivo
de secretos. API y worker reciben exclusivamente
`/srv/apps/balanz/runtime-config/<release>/<perfil>/runtime.env`, archivos
regulares externos al release, owner `balanz-deploy`, grupo de perfil y modo
`0640`. El migrator recibe su propio `runtime.env` `0640` sólo durante el job y
los traps/cleanup verifican su eliminación. Producción ignora `.env*` del
repositorio y todos los scripts de build/migración rechazan que aparezcan en el
release. El ecosystem no usa `node_args`, `env_file` ni contiene secretos.

`balanz-pm2.service` usa el PM2 fijado en el release activo y el PM2 home privado
de `balanz-deploy`. En el primer cutover, cualquier fallo de readiness detiene
la unidad, elimina todo proceso del control plane y deja vacíos tanto
`dump.pm2` como `dump.pm2.bak`; `current` permanece en el candidato validado y
nunca vuelve a apuntar ni arrancar el legacy quiescido. Corregida la causa, el
mismo candidato puede reintentarse y sólo queda activo después de que API y
worker superen sus probes.

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
