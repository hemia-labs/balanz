# CFDI Phase 4 — validación local y límites de entrega

La evidencia inicial del 2026-09-10 se conserva debajo. El estado vigente del cierre PR25 está en la sección final del 2026-09-15; su integración adicional está BLOCKED y no hereda un PASS por la ejecución histórica.

Fecha: 2026-09-10. Alcance autorizado: implementación y certificados sintéticos en infraestructura aislada con servidor SAT controlado. No se utilizaron e.firmas reales ni solicitudes autenticadas al SAT; no hubo despliegue, merge o habilitación administrada.

## Identidad de la entrega
- BASE_SHA: 0d5f0db1c2108fe3c9149660c3f7ed192414338f.
- INHERITED_PHASE_3_SHA: 34eb7254821661dfda57cb9adf886999717a1e20. PR #24 ya integrada al iniciar; no se alteró esa rama/PR.
- WORK_BRANCH: codex/cfdi-phase4-sat, worktree aislado.
- VALIDATED_CODE_SHA: e11b13b439dff0b60e20315bf60e1fb666f8a94f. El commit posterior de cierre contiene documentación solamente.
- PHASE_4_IMPLEMENTATION: PARTIAL. Núcleo durable implementado y validado localmente; soporte real no acreditado por las lagunas del perfil y contrato indicadas abajo.
- LOCAL_CONTRACT_INTEGRATION: PASS. REAL_SAT_ACCEPTANCE: NOT_RUN. REAL_CREDENTIALS_ENABLED: NO. RELEASE_STATUS: BLOCKED.
- CI_YML_CHANGED: NO. DEPLOY_DEV_YML_CHANGED: NO. HISTORICAL_MIGRATIONS_MODIFIED: NO.

## Funcionalidad entregada
Proceso PostgreSQL con solicitud y paquetes independientes, filtros tipados e inmutables, folio protegido, journal previo al envío, lease/fencing, autorización contextual v2 por proceso/versión/operación y TOTP fresco. La autorización nueva continúa el mismo proceso; efirma.prepare no autoriza SAT. El token SAT queda en memoria y el vencimiento absoluto de custodia no se renueva. Esperar al SAT no consume retry técnico.

Adaptador real para autenticación, emitidos, recibidos, folio, verificación y descarga. XMLDSig con referencias y canonicalización estándar; SHA1 limitado a compatibilidad SAT. Endpoints HTTPS del servidor y allowlist exacta; servidor loopback sólo en QA explícito. Respuestas acotadas y sanitizadas. SOAP/base64 incremental con backpressure, hash/tamaño reales, rechazo de DTD, entidades, contenido inesperado y fragmentos corruptos antes de marcar integridad.

Un envío posiblemente aceptado sin respuesta queda external_submission_unknown y no se repite. Los intentos inciertos de descarga cuentan; máximo dos intentos externos por paquete. Un retry exige acción explícita y no descarga nuevamente bytes íntegros. El retry técnico no descuenta por segunda vez un fallo registrado; backoff y presupuesto se verifican. Reprocesamiento local explícito máximo diez veces por paquete, con nueva ingesta y resultados anteriores conservados.

Paquetes con perfil sat_package_v1 independiente del manual: 50 MiB comprimidos, 250 MiB descomprimidos, 2,000 regulares, ratio 50:1, profundidad 2, ruta 240, XML 5 MiB, ZIP32 STORE/DEFLATE y headers acotados. Escaneo raíz y XML, extractor compartido, parser/dedupe/procedencia CFDI existentes; source sat_package sin upload manual ficticio ni jobs manual_xml hijos. Los resultados válidos sobreviven a entradas inválidas. Objeto perdido afecta a su paquete. Metadata incremental tipada por UUID/paquete, inmutable para runtime; no crea CFDI sin XML ni sustituye originales.

API autenticada/CSRF bajo /api/v1/sat-download-jobs: creación idempotente, listado/consulta, paquetes/items paginados, grants/autorizaciones, retry técnico/paquete y cancelación local. sat.download y credentials.manage; asignaciones vigentes y regla tenant-wide del titular. Los enlaces CFDI requieren cfdi.view. Nómina no se ofrece. UI fiscal con filtros, autorización, estados de espera/acción, paginación, resultados, incidencias, retry/cancel y recuperación por IDs; ningún secreto se persiste en navegador. Metadata y CFDI incorporados se muestran separados.

## Esquema y operación
Una migración nueva: 1787691100000-PhaseFourSatOnDemand. Crea sat_download_jobs, sat_requests, sat_packages, sat_metadata_observations y amplía grants/custodia para propósitos SAT v2. FKs compuestas, scope, ENABLE/FORCE RLS, ACL restringidas, índices de agenda/paginación, auditoría de estados e invariantes de identidad y presupuestos. Se aplicó únicamente en bases desechables test_sat_*; estado aplicado en ambientes compartidos: UNKNOWN. No se cambió synchronize ni el historial.

Se reutiliza release:prepare → db:prepare → migration:preflight → migration:run → seed:run. Secretos/trust bundles/identidades se configuran externamente, no por seeds/migraciones. El cleanup reutiliza reconciliador durable y protege procesos activos, originales CFDI, cuarentena e incidentes. Raíces SAT tienen retención inicial 30 días; escrituras abandonadas después de una hora, sin lease activo, pueden limpiarse. Backups/versionado no equivalen a borrado físico. Custodia conserva sus diez minutos, cleanup y generación externa invalidada al restore de F3.

## Evidencia ejecutada
| Verificación | Resultado real |
|---|---|
| sat-contract.spec.ts y sat-security.spec.ts | 35 pruebas nuevas PASS |
| efirma-envelope, efirma-certificate, efirma-reauth, cfdi-access-grant, manual-zip-job.handler, zip-extractor, zip-cleanup, sessions.service, s3-object-storage.contract | 114 regresiones PASS |
| manual-xml-job.handler y cfdi-xml-parser | 76 regresiones PASS |
| Total backend focalizado | 225 pruebas / 13 suites PASS; no Full |
| sat-state y sat-client frontend | 7 nuevas PASS |
| credential-state y submit-custody frontend | 7 regresiones PASS |
| Total frontend focalizado | 14 PASS, registradas las nuevas en package.json y tsconfig.tests.json |
| sat.external.ts | 1 integración PASS, 50 comprobaciones, 24 firmas verificadas, 4 envíos controlados, 5 intentos de descarga |
| efirma-review.external.ts | 1 regresión de esquema/lifecycle de migraciones PASS en DB desechable |
| ESLint de TypeScript modificado API/frontend | PASS |
| TypeScript API --noEmit y compilación de tests frontend | PASS |
| Build API (Nest) | PASS |
| Build frontend (Next, incluye TypeScript) | PASS, 15 páginas generadas |
| SHA-256 de snapshots públicos | 7 archivos recuperados verificados contra sources.json |
| Browser smoke | NOT_RUN; no frontend/API de navegador escuchando en puertos locales 5181/3010. No se reconstruyó el ambiente |
| SAT autenticado real | NOT_RUN, no autorizado |

La integración usa PostgreSQL, Vault response wrapping/Transit, MinIO privado, ClamAV y parser CFDI reales; logins PostgreSQL API/worker y AppRoles/capacidades de storage restringidos. El servidor controlado verifica digest y contenido realmente firmado, incluidas fechas locales; retorna fixtures contractuales. Se demuestra idempotencia, concurrencia, unwrap único, espera sin retry, reautorización sin reenvío, dos paquetes/dedupe/éxito parcial XML, metadata sin CFDI ficticio, cancelación, tenant ajeno denegado, presupuesto de descarga/tercer intento rechazado, respuesta de envío perdida, reinicio con objeto íntegro, pérdida de fencing sin nueva llamada ni publicación terminal, recuperación con nueva autorización después de consumo, filtros inmutables y cleanup idempotente que conserva CFDI original.

Comandos reproducibles desde apps/api: bun x jest --runInBand --runTestsByPath con las 13 suites nombradas arriba; RUN_EFIRMA_INTEGRATION=true bun x jest --testRegex='test/external/(sat|efirma-review)\.external\.ts$' --runInBand --detectOpenHandles. Requiere exclusivamente infraestructura QA local del contrato existente. Desde apps/web: bun x tsc -p tsconfig.tests.json y node --test sobre los cuatro archivos compilados indicados. Builds mediante bun run build en cada aplicación.

Durante iteraciones hubo fallos controlados EFIRMA_DEPENDENCY_UNAVAILABLE al preparar custodia local; no se atribuyó una causa externa específica sin evidencia ni se añadió fallback. La ejecución final pasó. El runner de lifecycle emitió un aviso de deprecación de pg por query concurrente; pasó y no se hizo refactor histórico. Estos datos no equivalen a aceptación SAT ni revisión independiente de seguridad.

## Perfil real, dependencias y lagunas exactas
sat_efirma_v1 contiene validación DER acotada/full consumption, node:crypto para llave/contraseña/correspondencia, RFC único 2.5.4.45, vigencia, PKIjs offline, trust bundle versionado/hash/fuente, política positiva por generación, algoritmos/extensiones limitados. synthetic_v1 no se convierte en real eliminando su manifiesto. No se distribuye ninguna regla positiva SAT sin sustento ni raíces inferidas del emisor. El perfil real permanece cerrado: faltan bundle verificable de raíces/intermedios y reglas oficiales positivas de generaciones e.firma versus CSD, ubicación/variantes RFC acreditadas y muestras públicas legítimas representativas. No se acredita compatibilidad con credenciales arbitrarias mediante fixtures propios.

PKCS8 implementado: PBES2/PBKDF2/AES256CBC; PRF SHA1/SHA256, iteraciones <=200000, sal 8–64, IV16, longitud derivada ausente/32, ciphertext consistente, tamaño16KiB y concurrencia2. Medición sintética del presupuesto: máximo observado 48ms SHA1 y 32ms SHA256, tres muestras cada uno, Node24.19.0. Son límites Hemia. PBES1/3DES, otros PRF/KDF/cifrados/generaciones sin sustento se rechazan. No se habilitan algoritmos legacy globalmente. local_validation_passed conserva revocation_status unknown; no hay OCSP/CRL/AIA.

Dependencias autorizadas exactas: pkijs3.4.0, asn1js3.0.10, xml-crypto6.1.2, sax1.6.1. Licencias y avisos relevantes en CFDI_SAT_CERTIFICATE_PROFILE.md; lockfile conserva versiones previas de dependencias ajenas (la reubicación de @noble/hashes corresponde a requisitos transitivos distintos, sin cambiar la versión usada por TOTP). Runtime sin cambios.

Contrato oficial: snapshots v1.5 y WSDL autenticación/solicitud/verificación recuperados con URL/fecha/hash. WSDL vivo de descarga respondió HTTP400; se implementó con el documento oficial de descarga, no se fabricó WSDL. El contrato tilde está publicado, pero el encabezado exacto de 12 columnas CFDI aplicado como perfil Hemia no quedó confirmado en fuente primaria accesible; encabezados distintos producen incidencia explícita. No se atribuye TTL oficial al token; 72 horas de paquete dependen de generación oficial y no se calculan desde la solicitud. El ejemplo de verificación contradictorio no se transforma en éxito vacío.

## Gates y siguiente acción
Revisión del código y cierre del bundle/perfiles y encabezado metadata con fuentes oficiales son necesarios antes de acreditar compatibilidad real. Sigue pendiente decisión humana operativa/legal sobre uso real de custodia temporal cifrada, restos en DB/WAL/Vault/storage/backups, versionado/borrado y procedimiento de restore con rotación externa. El diseño sintético autorizado no concede esa aprobación. Los gates heredados de Fases 0/1/2/3 se conservan, sin recertificación ni atribuir su cierre al deploy.

Siguiente acción: revisar esta PR en borrador y aportar/verificar los artefactos oficiales faltantes; después, una autorización explícita separada y configuración restringida para una primera prueba SAT real. Esta rama no se fusiona ni despliega como parte de la tarea. No hay defecto reproducible conocido en el recorrido controlado final; las lagunas del perfil real/metadata impiden declarar la fase completa.

Documentos: ADR-CFDI-007-SAT-ON-DEMAND.md; CFDI_PHASE_4_API.md; sat-v1.5/sources.json y README.md; CFDI_SAT_PACKAGE_PROFILE.md; CFDI_SAT_CERTIFICATE_PROFILE.md; CFDI_PHASE_4_DEPLOYMENT_NOTE.md; CFDI_PHASE_4_RUNBOOK.md; roadmap, matrices y contratos de ingesta actualizados. Reportes históricos sin cambios.

## Cierre técnico acotado PR25 — 2026-09-15

- INITIAL_SHA: 35945e4171e18ab006fd23a51433609c0083f2c4.
- PREVIOUS_VALIDATED_CODE_SHA: e11b13b439dff0b60e20315bf60e1fb666f8a94f. Hasta INITIAL_SHA sólo había documentación, sin commits posteriores al empezar.
- VALIDATED_CODE_SHA: 8f1f58fd8ea39832fb755f64ab82fbd7286abdf5. El commit siguiente registra documentos de este cierre.
- BASE_SHA / origin/develop inspeccionado: 0d5f0db1c2108fe3c9149660c3f7ed192414338f. PR25 abierta, borrador, base develop. Worktree Fase4 conservado; workspace principal y rama Fase3 intactos.
- PHASE_4_IMPLEMENTATION: PARTIAL. REAL_RUNTIME: PREPARED_AND_DISABLED. REAL_SAT_ACCEPTANCE: NOT_RUN. REAL_CREDENTIALS_ENABLED: NO. RELEASE_STATUS: BLOCKED.
- CI_YML_CHANGED: NO. DEPLOY_DEV_YML_CHANGED: NO. MIGRATIONS_CREATED_IN_CLOSURE: 0. HISTORICAL_MIGRATIONS_MODIFIED: NO. DEPENDENCIES_ADDED_IN_CLOSURE: NONE.

### Cambios y comentarios de revisión

1. El worker libera el lease con próximo turno al menos cinco segundos después, conservando un backoff mayor. Evita que los mismos veinte procesos locales acaparen el batch; el UPDATE conserva token/fence.
2. Sólo paquetes stored con objeto íntegro y sin ingesta entran al procesamiento local. Un failed requiere retry explícito con presupuesto; la reconciliación de downloading se conserva.
3. Cancelación/retry/admisión auditan el usuario y membresía que actúan, no el creador original del proceso.
4. technicalRetry expone elegibilidad, disponibilidad, fecha y presupuesto coherentes con la API. La UI oculta fallos terminales y deshabilita durante backoff.
5. Un XML N recibido mediante sat_package produce unsupported/SAT_PAYROLL_UNSUPPORTED antes de publicar datos fiscales; el flujo manual conserva su comportamiento. Los enlaces heredados N requieren payroll.view además de cfdi.view. Excluir N del filtro no se considera protección suficiente.
6. real_pilot compone transporte oficial HTTPS, perfil sat_efirma_v1 y autorización operativa externa acotada a entidad, generación y hash del bundle. Rechaza excepciones QA, custodias sintéticas y metadata; ninguna capacidad se habilitó. El artefacto operativo no equivale a una aprobación legal creada por software.

La custodia termina al entrar en espera SAT. Consultar otra vez requiere nueva autorización del mismo proceso; no hay renovación silenciosa ni polling remoto ilimitado. Envío incierto, presupuesto de descarga, folios y paquetes completos conservan su semántica.

### Evidencia de este cierre

| Verificación | Resultado |
|---|---|
| sat-ca-evidence, sat-review, sat-runtime, efirma-configuration, sat-contract, manual-xml-job.handler, sat-security, efirma-reauth, cfdi-access-grant | 98 pruebas / 9 suites PASS |
| sat-state y sat-client frontend | 8 pruebas PASS |
| ESLint API/frontend modificados | PASS |
| TypeScript API --noEmit / tests frontend | PASS |
| Build API | PASS |
| Build frontend (Next/TypeScript) | PASS, 15 páginas |
| diff --check | PASS |
| Integración actual sat.external.ts | BLOCKED antes de setup: no existe pipe dockerDesktopLinuxEngine; Docker no conecta al motor Linux |
| Browser smoke | NOT_RUN; ambiente no disponible, sin reconstrucción |
| SAT autenticado real / credenciales reales | NOT_RUN / NO |

Comando backend: bun x jest --runInBand test/sat-ca-evidence.spec.ts test/sat-review.spec.ts test/sat-runtime.spec.ts test/efirma-configuration.spec.ts test/sat-contract.spec.ts test/manual-xml-job.handler.spec.ts test/sat-security.spec.ts test/efirma-reauth.spec.ts test/cfdi-access-grant.spec.ts. ESLint sobre los archivos TS modificados; bun x tsc --noEmit y bun run build en API; compilación de tsconfig.tests.json, node --test para sat-state/sat-client y bun run build en web.

sat.external.ts añade escenarios PostgreSQL de más de veinte procesos, paquete fallido junto a otro pendiente, retry explícito y auditoría de otro usuario asignado, además de estados del DTO. Su intento compila pero falla antes de crear fixtures: failed to connect to Docker API at npipe:////./pipe/dockerDesktopLinuxEngine, system cannot find the file. Esos escenarios NO tienen evidencia de ejecución actual. Las pruebas unitarias de actor/DTO no sustituyen esa evidencia. Diagnóstico externo terminado; no se repitieron suites históricas ni se modificó infraestructura compartida.

### Perfil y contratos: evidencia disponible y pendiente

Se recuperó el ZIP oficial de CA SAT (22 certificados públicos, 37,863 bytes), con URL/fecha/SHA256 e inventario DER. AC5→ARC5 y AC6/AC7→ARC6 verifican criptográficamente; esto sustenta admitir SHA512/RSA exclusivamente para CA, manteniendo SHA256/RSA para titular. CA históricas MD5/SHA1, expiradas y tamaños no permitidos siguen rechazadas. El ZIP es evidencia pública, no trust bundle runtime ni prueba positiva e.firma/CSD.

Todavía no hay una generación de titular SAT plenamente acreditada. Falta especificación primaria con discriminador positivo e.firma/CSD, atributos/variantes RFC y formato PKCS8 Certifica de esa generación. El modelo actual exige CertificatePolicies.policyOid; si la fuente oficial establece otro mecanismo, falta implementar esa regla concreta. No se aceptará cualquier certificado que abra ni se sustituirá la evidencia con fixtures sintéticos. Perfil DOF general no acredita por sí solo un perfil fiscal SAT.

Descarga XML: el PDF SAT v1.5 versionado basta para implementar acción, estructura, campos, token y firma; WSDL vivo HTTP400 previo no se reintentó ni fabricó. La implementación añade transformación C14N inclusiva explícita al digest frente al ejemplo documental con enveloped/normalización implícita de nodeset; contrato/firma estándar probado localmente, aceptación SAT todavía NOT_RUN.

Metadata: fuente primaria confirma TXT delimitado por tilde y campos semánticos, no encabezado literal/orden/capitalización de las doce columnas implementadas, incluido FechaCertificacionSat. Parser y límites conservados. Excluida expresamente del primer piloto XML; continúa pendiente global de Fase4, no se elimina del alcance.

### Pendientes exactos y responsables

| Pendiente | Responsable que debe aportar evidencia/decisión |
|---|---|
| Motor Docker Linux/servicios QA existentes y ejecución de sat.external.ts actualizado | Equipo de desarrollo/QA local; no requiere credenciales SAT reales |
| Política/especificación oficial de una generación, RFC y discriminador positivo e.firma/CSD; certificado público representativo con procedencia autorizada; formato PKCS8 Certifica | Arquitectura/seguridad con fuente SAT primaria; sin solicitar .key o contraseña reales |
| Regla concreta si difiere de policyOid; bundle reducido versionado, fingerprints y validación offline | Desarrollo y arquitectura/seguridad después de recibir evidencia |
| Encabezado literal metadata oficial o muestra pública legítima acreditada | Responsable de contrato SAT; no bloquea piloto XML, sí cierre completo de Fase4 |
| Egress/reloj, AppRoles separados, SSE-KMS, retención/versiones y restore con generación externa | Operaciones/integraciones, sin provisionamiento en esta PR |
| Decisión humana sobre custodia cifrada, backups/borrado/restore y autorización separada de piloto pequeño | Responsables legal/operativo y titular autorizado; PENDING, sin dictamen supuesto |

Siguiente acción: reactivar únicamente QA existente y ejecutar la integración focalizada pendiente; revisar los cuatro comentarios de PR25 con esa evidencia. En paralelo obtener una política de titular concreta y cerrar regla/bundle. Sólo después de configuración verificada y aprobación humana separada podrá autorizarse una primera prueba XML real; esta tarea no la ejecuta. No se declara la fase completa ni se cierran gates heredados.
