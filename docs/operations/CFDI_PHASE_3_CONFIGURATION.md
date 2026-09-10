# Configuración y permisos — Fase 3

Credenciales reales: **NO habilitadas**. Legal/operación: **PENDING**. Ningún secreto concreto pertenece a este documento o al repositorio.

| Variable/configuración | Uso |
|---|---|
| `EFIRMA_ENABLED` | `false` por defecto. `true` sólo con las condiciones aisladas siguientes. |
| `NODE_ENV=test`, `EFIRMA_QA_ISOLATED=true`, `EFIRMA_CERTIFICATE_PROFILE=synthetic_v1` | Opt-in de QA; nunca seleccionable por petición. |
| `DB_HOST`, `DB_DATABASE`, `SECRETS_ENABLED`, `DB_LOGGING` | Host loopback, nombre `test_*`, secretos compartidos y logging SQL deshabilitados. Se conservan logins API/worker restringidos existentes. |
| `EFIRMA_CUSTODY_GENERATION_FILE` | Ruta absoluta, archivo UUID v4 fuera de snapshots DB/storage/Vault; mismo valor para API/worker, lectura runtime, escritura sólo operador. |
| `EFIRMA_SYNTHETIC_TRUST_FILE` | Ruta absoluta de manifiesto generado por QA; perfil, raíz y hashes de fixtures. Sólo lectura runtime. Nunca raíces sintéticas administradas. |
| `EFIRMA_VAULT_ADDR` | Vault loopback dedicado de QA, sin credenciales en URL. |
| `EFIRMA_TRANSIT_MOUNT`, `EFIRMA_TRANSIT_KEY` | Segmentos acotados; key AES-GCM, `derived=true`, no exportable, backup en claro deshabilitado. |
| `EFIRMA_PREPARER_ROLE_ID`, `EFIRMA_PREPARER_SECRET_ID` | Sólo API: identidad AppRole de preparación. |
| `EFIRMA_CONSUMER_ROLE_ID`, `EFIRMA_CONSUMER_SECRET_ID` | Sólo worker: identidad de consumo. |
| `EFIRMA_CLEANUP_ROLE_ID`, `EFIRMA_CLEANUP_SECRET_ID` | Sólo worker: identidad separada para revocación por accessor. |
| `AUTH_SESSION_IDLE_TTL_SECONDS` | Autoridad actual: mismo TTL idle que autenticación (default 1,800). No amplía los 600 segundos. |
| Storage fiscal existente | Bucket privado, SSE configurable y keys opacas; si S3, endpoint local QA. No URLs firmadas para llaves/certificados. |

Perfiles API/worker se cargan mediante `PlatformConfigModule`; con capacidad desactivada no se construye cliente Transit ni se exigen sus secretos. El adaptador de custodia usa AppRole directamente, sin caché KV ni caché de DEK/wrapping token; sólo cachea el token de autenticación durante su lease.

| Identidad | Paths/capacidades mínimas |
|---|---|
| Preparación API | `sys/wrapping/wrap`: update; `<mount>/encrypt/<key>`: update; login AppRole. Sin unwrap/decrypt. |
| Consumidor worker | `sys/wrapping/unwrap`: update; `<mount>/decrypt/<key>`: update; login AppRole. Sin encrypt/admin/export. |
| Cleanup worker | `auth/token/revoke-accessor`: update; login AppRole. No descifrado. Restringir esta identidad operativamente a Vault dedicado/namespace autorizado. |
| PostgreSQL API/worker | Roles existentes `balanz_api`/`balanz_worker`, sin BYPASSRLS. ACL nuevas en migración; definer NOLOGIN existente sólo para autorización/reconciliación tipadas. |

`credentials.manage` se reutiliza sin seed nuevo. Titular real: tenant-wide; otros roles: asignación activa y permiso efectivo, con overrides vigentes. La clave de e.firma no sustituye contraseña de aplicación ni TOTP. `cfdi.download`/grants XML no conceden acceso a estos objetos.

Configuración de mounts, identidades, políticas, backups y permisos de archivos corresponde a Terraform/Ansible/operadores fuera de este repositorio; la migración no aprovisiona secretos.
