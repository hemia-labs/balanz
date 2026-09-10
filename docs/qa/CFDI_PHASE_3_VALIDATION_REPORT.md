# Fase 3 — validación de reautenticación y custodia temporal

Fecha: 2026-09-09. Alcance autorizado: desarrollo y QA aislado con certificados sintéticos. Implementación: **COMPLETE para ese alcance**. Validación sintética ejecutada: **PASS**. Credenciales reales: **NO habilitadas**. Release: **BLOCKED**. Aprobación legal/operativa: **PENDING**; no se atribuye revisión humana independiente ni cumplimiento legal.

## Identificación Git

- Base/develop incorporado: `709c038ded77476268df59b02380d3fbe51ea4f8`.
- PR #22 estaba integrada al iniciar; HEAD heredado de Fase 2: `64438b6e6745b94ad848ba67d9c10c8a80cf7ed0`.
- Rama aislada: `codex/cfdi-phase3-efirma`; PR destino `develop`.
- Código validado: `01f4b14b95901c712ff8b3157d21e37f37ad8742`. El commit posterior agrega únicamente documentación.
- Workspace original conservado; no merge ni deploy. Workflows CI/deploy y migraciones históricas sin modificaciones.

## Implementación

Grant fiscal independiente de máximo 600 segundos, TOTP fresco con prevención de reutilización y sesión resultante de la rotación. Token persistido sólo como hash; intención y consumo del grant atómicos, replay contextual idempotente. Autorización actual por sesión, membresía, permiso, entidad y asignación; titular real tenant-wide. La ventana general de reautenticación de 15 minutos permanece intacta.

Recepción multipart autenticada/CSRF, archivos DER de 16 KiB máximo cada uno, contraseña de 1,024 bytes y cuerpo de 40,000 bytes. Perfil `synthetic_v1` exclusivamente de servidor aislado: cadena, atributos/extensiones acotados, RFC, vigencia, algoritmo, correspondencia de llave y contraseña. `@peculiar/x509@2.1.0` fue autorizado explícitamente; operaciones privadas y AES usan `node:crypto`. Resultado `local_validation_passed`, revocación `unknown`; no consultas SAT, CRL u OCSP.

Envelope AES-256-GCM con DEK nueva y contexto autenticado. Vault wrapping entrega un único unwrap; Transit protege el bearer persistido, sin segunda copia recuperable de DEK. Objetos privados con SSE. Expiración absoluta limitada por sesión, sin renovación por polling/retry. Consumo interno exclusivo, revocación durable, reconciliación y limpieza idempotente; tras unwrap incierto se exige nueva autorización. Generación externa invalida custodias restauradas. Contraseña y llave abierta sólo en memoria, limpieza best-effort; restos cifrados pueden existir en backups/versiones y no se confunden con acceso vigente.

Una migración append-only: `1787691000000-PhaseThreeEfirmaCustody.ts`, registrada en el manifiesto existente. Crea grants/intenciones, FKs compuestas, constraints, índices, ENABLE/FORCE RLS, ACL y funciones restringidas de autorización/reconciliación. Reutiliza stored_objects y audit_events. Sin nuevos seeds ni aprovisionamiento de secretos. Se aplicó únicamente en la base descartable de esta integración; aplicación en ambientes compartidos: **UNKNOWN**.

Frontend integrado en configuración fiscal: entidad, TOTP, entrega de archivos, estado/vencimiento, revocación y nueva autorización. Recuperación por IDs en URL, polling y limpieza de memoria al cambiar contexto. Ningún secreto en almacenamiento persistente del navegador. No presenta descarga SAT disponible.

## Evidencia ejecutada

| Verificación | Resultado real |
|---|---|
| Backend focalizado, 12 suites | **125/125 PASS** |
| Frontend focalizado, 4 archivos compilados | **43/43 PASS** |
| Integración PostgreSQL + Vault + MinIO | **1/1 PASS**, 29 comprobaciones explícitas |
| ESLint sobre archivos TypeScript afectados | PASS |
| TypeScript API `--noEmit --incremental false` | PASS |
| Frontend typecheck y compilación de tests | PASS |
| API `bun run build` | PASS |
| Frontend `bun run build` | PASS |
| `git diff --check` | PASS |
| Recorrido visual de navegador | **NOT_RUN**; no se atribuye cobertura visual a tests de transporte |

Comando backend, ejecutado en `apps/api`:

```text
bun x jest --runInBand --runTestsByPath test/efirma-envelope.spec.ts test/efirma-certificate.spec.ts test/efirma-configuration.spec.ts test/efirma-vault.spec.ts test/efirma-reauth.spec.ts test/efirma-receive.spec.ts test/cfdi-access-grant.spec.ts test/sessions.service.spec.ts test/s3-object-storage.contract.spec.ts test/zip-cleanup.spec.ts test/fiscal-observability.spec.ts test/runtime-config-profiles.spec.ts
```

Las seis suites nuevas cubren envelope/contexto/manipulación, certificados y parsing, configuración desactivada/aislamiento, wrapping con TTL absoluto y errores ambiguos, TOTP fresco/rotación/reutilización y recepción acotada. Regresiones directamente afectadas: sesiones/MFA, grants XML, storage S3, cleanup ZIP, métricas y perfiles API/worker.

Comandos frontend, ejecutados en `apps/web`:

```text
bun x tsc -p tsconfig.tests.json
node --test .test-dist/features/efirma/credential-state.test.js .test-dist/features/efirma/submit-custody.test.js .test-dist/lib/api-client.test.js .test-dist/features/ingestions/zip-upload.test.js
```

Incluyen validación de archivo, multipart/202, limpieza de FormData, aborto por tenant/logout, recuperación por IDs, vencimiento y reemplazo con nueva autorización, más regresiones de transporte y ZIP. Son pruebas automatizadas de estado/transporte; no un render E2E de React.

Integración opt-in, ejecutada en `apps/api` con `RUN_EFIRMA_INTEGRATION=true`:

```text
bun x jest --testRegex='test/external/efirma.external.ts$' --runInBand
```

Creó una base PostgreSQL `test_efirma_*` y logins API/worker sin BYPASSRLS, aplicó el historial y semillas en esa base descartable, y usó un Vault 1.20.4 dedicado efímero con tres AppRoles restringidos. La identidad de administración se usó sólo en setup, nunca como runtime. MinIO privado local y SSE real; certificados sintéticos generados en memoria. Teardown elimina recursos propios sin modificar Vault compartido.

Comprobó preparación real, Transit/wrapping, replay idempotente, denegación actual de permiso, FORCE RLS, consumo concurrente con un ganador, cleanup de referencias/objetos, reaparición tardía de objeto y reconciliación, identidad Vault sin permiso de decrypt, recuperación de lease antes de unwrap, caída inyectada después de un unwrap real sin segundo consumo, grant concurrente, preparación abandonada, expiración, revocación idempotente, rotación de sesión, generación nueva y scope ajeno. La caída posterior a unwrap es inyección controlada sobre la llamada real, no evidencia de una caída espontánea del servicio.

## Límites y pendientes

- No defectos funcionales conocidos en el alcance sintético implementado; la cobertura ejecutada es focalizada, no exhaustiva. No se ejecutaron Full, matrices históricas, pentest ni pruebas con e.firma real.
- No bloqueo externo impidió la integración local. No se verificaron infraestructura administrada, restauración física completa de backups ni eliminación de todas las versiones de un bucket versionado.
- La validación real SAT requiere perfil oficial revisado: confianza, atributos RFC, diferenciación e.firma/CSD, algoritmos y límites de PKCS8 protegido. El registro de hashes de llaves sintéticas acota el coste KDF de QA; no es un perfil para credenciales reales.
- Aprobación legal/operativa de custodia temporal, backups/retención, políticas Vault y procedimiento de restore con rotación externa: pendientes antes de credenciales reales. Delete marker no demuestra eliminación física completa.
- Gates heredados PostgreSQL API/worker compartidos, secretos runtime en Vault y cierres históricos permanecen separados y no se recertifican aquí.
- Revisión de PR y CI remoto deben evaluarse sobre el SHA publicado. Ningún PASS local equivale a aprobación humana, merge o autorización de release.

Siguiente acción: revisar la PR en borrador y sus evidencias sintéticas; mantener capacidad desactivada en ambientes administrados. No iniciar Fase 4.

## Documentos relacionados

- [ADR de custodia](../architecture/decisions/ADR-CFDI-006-TEMPORARY-EFIRMA-CUSTODY.md)
- [Contrato API](../contracts/CFDI_PHASE_3_API.md)
- [Configuración y permisos](../operations/CFDI_PHASE_3_CONFIGURATION.md)
- [Runbook de cleanup y restore](../operations/CFDI_PHASE_3_RUNBOOK.md)
- [Nota para despliegue](../operations/CFDI_PHASE_3_DEPLOYMENT_NOTE.md)
- [Roadmap](../roadmaps/CFDI_P0_MASTER_IMPLEMENTATION_PLAN.md)
