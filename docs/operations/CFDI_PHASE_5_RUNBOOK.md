# Mesa mensual — operación y nota para integraciones

Fecha: 2026-09-15. Desarrollo autorizado; no autoriza deploy/merge ni credenciales reales. F4 PARTIAL. REAL_CREDENTIALS_ENABLED=NO, REAL_SAT_ACCEPTANCE=NOT_RUN, RELEASE_STATUS=BLOCKED.

## Nota de despliegue

ci.yml y deploy-dev.yml permanecen intactos. Reutilizar el orden existente release:prepare → db:prepare → migration:preflight → migration:run → seed:run. No agregar runners, builds, cron ni otra ejecución de migraciones. El worker forma parte del mismo release. No hay dependencias nuevas, Vault/S3/ClamAV nuevos, trust bundles ni secretos de Fase 5.

Una migración append-only: 1787691200000-PhaseFiveMonthlyWorkspace. Mantener todas las anteriores. Usa roles balanz_api/balanz_worker existentes y el propietario NOLOGIN de reconciliación. La identidad de migraciones debe conservar su capacidad actual de gestionar FKs, policies, funciones y ACL; las identidades runtime no necesitan DDL ni BYPASSRLS. Los permisos de aplicación se sincronizan por seed:run, separados del esquema. No se aprovisionan identidades/secretos remotos desde esta fase.

La API y worker deben apuntar al mismo esquema actualizado. El worker activo ejecuta la reconciliación mensual dentro de su ciclo existente; no requiere Redis para autoridad. La interfaz recupera períodos/decisiones por API. SAT_ENABLED y EFIRMA_ENABLED conservan su configuración desactivada; la mesa no invoca SAT ni solicita credenciales. Las necesidades heredadas de roles runtime, release integrado y aceptación SAT no quedan cerradas por esta validación local.

## Controles y diagnóstico acotado

| Síntoma | Acción |
| --- | --- |
| Otra persona/pestaña edita | Consultar editor y vencimiento; esperar hasta 120 s sin actividad o usar takeover autorizado con motivo/MFA/reauth. No modificar lease directamente |
| Versión obsoleta / información cambió | Actualizar y comparar datos; guardar sólo con versión vigente. Los lotes no reaplican éxitos al hacer replay |
| Pérdida de conexión al guardar | Lo confirmado permanece en servidor. Reabrir por IDs/URL; el texto sin confirmar es sólo memoria. No copiar borradores fiscales a cachés persistentes |
| Cambio de permisos/sesión | La API deniega y UI invalida instancia. No conceder permisos para sortear el rechazo; obtener autorización conforme al modelo |
| FISCAL_PERIOD_NOT_CONFIGURED | Crear el ejercicio/período autorizado y mantener worker activo. Comprobar estado/next_attempt_at/error_code de cfdi_period_reconciliations bajo mantenimiento autorizado; no cambiar la fecha histórica |
| Reconciliación failed | Si existe intención, retry reutiliza fechas persistidas. Si es legado sin intención, requiere original limpio/íntegro disponible; un original ausente no se reemplaza ni se reconstruye artificialmente |
| Fuentes pendientes o envío SAT incierto | Resolver por el proceso de ingesta/SAT correspondiente o aceptar alcance incompleto con exceptions.accept + MFA/reauth + motivo. La mesa no reenvía solicitudes ni altera el estado externo |
| Listo para cerrar perdió vigencia | Preparar otra vez, revisar novedades/fuentes. No confirmar el fingerprint anterior |
| Cierre con novedades | Consultar altas/cambios y evidencia; solicitar reapertura con motivo. El snapshot publicado permanece inmutable |
| Cerrado heredado sin snapshot | Mostrar condición histórica; no inventar evidencia ni migrar retroactivamente el cierre |

## Durabilidad, conservación y recuperación

El worker reclama como máximo 25 reconciliaciones mediante función de mantenimiento, lease 60 s, fencing y SKIP LOCKED. Espera por período aún inexistente: próximo intento en un minuto; error recuperable: cinco minutos. Los límites no renuevan una autoridad editorial. Las escrituras de participación/estado/auditoría son transaccionales; ON CONFLICT conserva idempotencia. Un claim perdido no publica una participación ni resultado terminal.

Las nuevas ingestas guardan primero intenciones con fecha literal, instante normalizado, ordinal, timezone y política. El legado sin intención puede releer una sola vez el original íntegro (máximo XML 5 MiB) con el parser existente. Nunca se usa el timezone actual para reasignar una ocurrencia histórica; historical-unrecorded es una limitación de evidencia explícita, no una zona inventada. No se altera el XML ni el evento de incidencia original; resolución y auditoría son registros propios y durables.

No se cambian retención, backups, buckets, versionado ni cleanup de XML/ZIP/custodia. El snapshot sólo referencia originales y hash, sin copiarlos. La futura exportación debe volver a verificar autorización y disponibilidad; un snapshot no concede descarga ni recupera un objeto físicamente perdido. La metadata/decisiones/cierres nuevos conservan la política vigente hasta definir retención en Fase6; no hay purga nueva.

Rollback operativo futuro: retirar acceso a las pantallas/escrituras del release afectado mediante el mecanismo de releases existente, preservar tablas y decisiones, y publicar corrección forward. No revertir/eliminar la migración ni restaurar el endpoint preliminar que cerraba períodos sin snapshot. Verificar compatibilidad API/worker antes de volver a un binario anterior; este documento no ejecuta rollback ni despliegue.

## Evidencia

El reporte [CFDI_PHASE_5_VALIDATION_REPORT](../qa/CFDI_PHASE_5_VALIDATION_REPORT.md) separa pruebas unitarias, integración PostgreSQL con roles restringidos y recorrido real de navegador PASS del 2026-09-17. Las integraciones automatizadas retiran su base/identidades efímeras al terminar; el QA exclusivo del navegador queda disponible según la sección siguiente. No usa credenciales reales ni conexiones autenticadas al SAT. SQL diagnóstico no debe registrar comentarios, XML, object keys ni secretos en logs.

## QA exclusivo del recorrido de navegador — 2026-09-17

Estos recursos son locales, temporales y exclusivos; no son configuración de despliegue. La creación fue autorizada al no disponer de la contraseña del login PostgreSQL anterior. **No buscar ni cambiar esa contraseña; no agregar roles a su cluster.**

| Recurso | Identificador |
| --- | --- |
| Worktree | `F:/HemiaBalanceOs/balanz-phase5-monthly-workspace` |
| Contenedor PostgreSQL | `balanz-monthly-browser-6b878684d2b7` |
| Volumen dedicado | `balanz-monthly-browser-6b878684d2b7-data` |
| Bind | `127.0.0.1:55461`, sin exposición externa |
| Base | `test_monthly_browser_6b878684d2b7` |
| Migrador separado | `monthly_migrator` |
| API / worker restringidos | `browser_api_6b878684d2b7` / `browser_worker_6b878684d2b7` |
| API / health worker / web | `3025` / `3026` / `5185` |
| Imagen | `postgres:16.15-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825` |

Se reutilizó la receta de `infra/cfdi-phase0/compose.yaml`, migraciones/seed actuales y `provision-fiscal-runtime-logins`. No se modifica el esquema, RLS, guard ni identidad preexistente. API/worker superaron ambos guard checks y readiness con la misma DB nueva.

Configuración **no versionada**: `.local/monthly-browser-20260917/`. ACL: usuario Windows actual y SYSTEM, sin herencia abierta. `postgres.env` y `provision-env.json` sólo para creación/mantenimiento de esta instancia; `api-env.json` y `worker-env.json` contienen únicamente la identidad runtime correspondiente. `state.json` contiene cuentas/TOTP sintéticos y PIDs. No imprimir, adjuntar o copiar esos contenidos al chat/PR. Las contraseñas fueron generadas aleatoriamente, nunca forman parte de argumentos visibles. No usa Vault compartido. El acceso al motor Docker permite inspeccionar su configuración y requiere la protección local habitual del host.

Los helpers locales permanecen en esa carpeta privada; no forman parte del release ni crean infraestructura compartida. `prepare.cjs` es el registro de preparación original: **no volver a ejecutarlo**, pues crearía nuevos recursos. `start-runtime.cjs` sólo inicia el contenedor nombrado y API/worker con los archivos existentes; rehúsa puertos ocupados y targets distintos. `inspect-result.cjs` hace lecturas limitadas de la DB nueva y actualiza el manifiesto privado de sus objetos para retirarlos. `retire-test-objects.cjs` sólo borra los cuatro objetos exactos de ese manifiesto, no lista ni vacía buckets. Su sintaxis se verificó; el retiro no se ejecutó porque se deja el entorno disponible.

### Volver a iniciar

MinIO 59000, ClamAV 53310 y Redis 56379 deben seguir disponibles en el QA local previamente autorizado. No recrearlos, cambiar sus credenciales ni retirar sus volúmenes. Redis usa el prefijo exclusivo `monthly-browser-6b878684d2b7:`; sus claves expiran por TTL existente, nunca ejecutar FLUSHALL/FLUSHDB.

Desde el worktree y con el Node/Docker existentes en PATH:

```powershell
# Sólo si API3025/worker3026 propios están detenidos; el helper rehúsa puertos ocupados.
node .local/monthly-browser-20260917/start-runtime.cjs
Invoke-RestMethod http://localhost:3025/liveness
Invoke-RestMethod http://localhost:3025/readiness
Invoke-RestMethod http://localhost:3026/readiness
```

Usar cwd de `apps/api` al ejecutar directamente los binarios en Windows; el helper lo establece. El frontend F5 existente quedó en 5185. Si está detenido y el puerto está libre, desde `apps/web`:

```powershell
$env:NEXT_PUBLIC_API_URL='http://localhost:3025/api/v1'
$env:NEXT_PUBLIC_DEMO_MODE='false'
node node_modules/next/dist/bin/next dev -p 5185
```

No sustituir el frontend por el de otro worktree. Las cuentas sintéticas se usan mediante login/TOTP normal con la configuración privada local; no omitir autenticación ni sembrar sesiones verificadas. Mantener `SAT_ENABLED=false`, `EFIRMA_ENABLED=false` y las comprobaciones reales de storage/scanner.

### Retirar exclusivamente este QA

1. Cerrar sus pestañas. Leer **sólo PIDs** desde `state.json`, comprobar con el administrador de procesos/CIM que corresponden a Node `dist/main.js`/`dist/worker.js` de este worktree y detener únicamente esos procesos. No matar todos los procesos Node; un PID antiguo puede haberse reutilizado. El frontend 5185 se reutilizó de esta misma rama: detenerlo sólo si ya no se necesita y después de verificar su comando/puerto.
2. Antes de retirar PostgreSQL, ejecutar `node .local/monthly-browser-20260917/inspect-result.cjs` para refrescar el manifiesto exacto de objetos propios. Requiere sólo la identidad de mantenimiento de esta instancia nueva. Si el conteo ya no es cuatro, inspeccionar la nueva evidencia antes de cambiar el manifiesto; no sustituirlo por un borrado por prefijo general.
3. Con API/worker detenidos, ejecutar `node .local/monthly-browser-20260917/retire-test-objects.cjs --delete-own-test-objects`. No elimina bucket, políticas o versiones históricas; no se afirma purga física de backups/versiones por DeleteObject.
4. Verificar nombre, etiqueta `balanz.qa=monthly-browser` y montaje antes de retirar el contenedor y su volumen **exactos**:

```powershell
docker inspect --format '{{.Name}} {{index .Config.Labels "balanz.qa"}} {{json .Mounts}}' balanz-monthly-browser-6b878684d2b7
docker stop balanz-monthly-browser-6b878684d2b7
docker rm balanz-monthly-browser-6b878684d2b7
docker volume rm balanz-monthly-browser-6b878684d2b7-data
```

5. Después de confirmar retiro y conservar la evidencia sanitizada, eliminar únicamente la carpeta privada `.local/monthly-browser-20260917`, resolviendo antes su ruta absoluta dentro de este worktree. Contiene secretos sintéticos que ya no deben conservarse. No eliminar `.local` completa ni artefactos de intentos anteriores.

No usar Docker prune, Compose down global, borrado por wildcard, ni retirar el PostgreSQL/volumen anterior. El QA anterior y sus artefactos no forman parte de este procedimiento. Estado final de esta revisión: recursos exclusivos siguen en ejecución para consulta; credenciales reales y SAT real desactivados.
