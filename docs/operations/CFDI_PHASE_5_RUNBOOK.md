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

El reporte [CFDI_PHASE_5_VALIDATION_REPORT](../qa/CFDI_PHASE_5_VALIDATION_REPORT.md) separa pruebas unitarias, integración PostgreSQL con roles restringidos y browser NOT_RUN. QA crea únicamente test_monthly_<12 hex>, identidades locales efímeras y las elimina al terminar. No usa credenciales reales ni conexiones autenticadas al SAT. SQL diagnóstico no debe registrar comentarios, XML, object keys ni secretos en logs.
