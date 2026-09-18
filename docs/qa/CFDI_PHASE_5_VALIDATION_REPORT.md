# Validación Fase 5 — mesa mensual

## Correcciones de revisión PR26 — 2026-09-18

Base revisada: `1ea7815e7e53c2cad12991e57e0212c0c18ff53e`. Código corregido y validado: `1e6233d9995ee540d93718c11a0f7af2d19fe372`. La actualización posterior de este reporte y del contrato es exclusivamente documental.

Se atendieron los cuatro hallazgos de la revisión 5250066057:

- Registro de `PhaseFiveMonthlyWorkspace1787691200000` en el manifiesto canónico. No se modifica ni ejecuta ninguna migración.
- Catálogo frontend sincronizado con los 11 permisos nuevos. El test extrae todos los literales de la declaración, incluido `cfdi.categories.manage`, y conserva la igualdad completa/ordenada con el catálogo backend.
- Stub de bootstrap proporciona y exporta `MonthlyService`. El defecto era del montaje del test, no evidencia de un fallo del arranque real.
- El control compartido mensual permite lecturas de entidades activas o suspendidas y exige entidad activa para cualquier escritura. Archivadas/estados desconocidos siguen denegados; scope, nómina, sesión y RLS no se alteran.

Validación focalizada:

- Jest: manifiesto, contrato de permisos, bootstrap, `monthly.spec.ts` y `monthly-access.spec.ts`: **23 pruebas únicas PASS en 5 suites**. Las cuatro primeras suites pasaron en la ejecución conjunta; la nueva suite de acceso pasó tras completar los permisos del fixture de prueba, con **7 pruebas** (lecturas activa/suspendida, escritura rechazada, archivada/desconocida, acceso a cuenta revocado, tenant distinto y cierre con nómina protegida). Comando inicial: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/migration-manifest.spec.ts test/permission-frontend-contract.spec.ts test/cfdi-api.bootstrap.spec.ts test/monthly-access.spec.ts test/monthly.spec.ts`; repetición sólo de `test/monthly-access.spec.ts`.
- Frontend: `tsc -p tsconfig.tests.json` y `node --test .test-dist/lib/permissions.test.js .test-dist/lib/authorization-matrix.test.js`: **6 pruebas PASS**.
- ESLint de los archivos de código/prueba modificados, typecheck frontend, `nest build`, `next build` y `git diff --check`: **PASS**.
- Preflight existente: `node node_modules/ts-node/dist/bin.js --transpile-only src/database/scripts/preflight-fiscal-foundation.ts`, con configuración privada de la instancia temporal autorizada en `127.0.0.1:55461`, base `test_monthly_browser_6b878684d2b7`: **PASSED**, modo `EXISTING_DATABASE`, `readOnlyInspection=true`, `failures=[]`, `unknownExecuted=[]`. Reconoce la migración F5 aplicada. Sólo inspección; no migraciones, seeds ni cambios al PostgreSQL anterior.

El CI previo [35263838589](https://github.com/hemia-labs/balanz/actions/runs/35263838589) tenía 721 pruebas aprobadas y 3 fallidas; omitió migraciones incrementales/frontend. El nuevo [CI 35378253305](https://github.com/hemia-labs/balanz/actions/runs/35378253305), sobre HEAD documental `15ac2065c5404adf0adfa20c7d622766ddf17d79`, aprobó backend completo: **731 pruebas en 82 suites**, lint y build. Al avanzar detectó una divergencia TypeORM en la etapa incremental: la entidad `PeriodCfdi` no declaraba `uq_period_cfdis_scoped_period_id`, creada por la migración F5 para la FK de decisiones por período.

Corrección adicional directamente relacionada: declarar ese `@Unique` con los cinco campos existentes en `period-cfdi.entity.ts`, sin modificar el esquema ni la migración. Inspección real de sólo lectura mediante `dataSource.driver.createSchemaBuilder().log()` en la instancia QA temporal: antes proponía eliminar esa constraint; después devuelve **upQueries=0 y downQueries=0**. No se ejecuta el SQL generado ni se usa synchronize. ESLint y build API de esta corrección: PASS. La comprobación de drift del CI permanece intacta; se verificará nuevamente al publicar la corrección. Frontend quedó omitido en aquel CI por el fallo incremental, aunque su build y pruebas focalizadas locales pasaron.

No se repiten navegador, legacy ni matrices históricas: conservan la evidencia anterior, asociada a sus SHA. La regresión nueva de entidades suspendidas es de servicio con dobles de infraestructura; no se presenta como otro recorrido de navegador o integración RLS real. CI/deploy, migraciones, dependencias, custodia y SAT intactos. Sin merge ni despliegue.

**PHASE_4: PARTIAL · REAL_CREDENTIALS_ENABLED: NO · REAL_SAT_ACCEPTANCE: NOT_RUN · RELEASE_STATUS: BLOCKED.** Siguiente acción: comprobar el CI nuevo y solicitar la reevaluación humana de los cuatro hilos.

Fecha: 2026-09-15. Evidencia técnica ejecutada por el agente; no atribuye revisión humana independiente, aprobación fiscal/legal, merge ni despliegue.

## Estado y Git

| Campo | Resultado |
| --- | --- |
| PHASE_5_IMPLEMENTATION | COMPLETE para el alcance de mesa mensual autorizado |
| PHASE_5_AUTOMATED_VALIDATION | PASS, con límites indicados abajo |
| PHASE_5_LOCAL_POSTGRES_INTEGRATION | PASS |
| PHASE_5_INTEGRATION_STATUS | NOT_MERGED; revisión en PR borrador |
| BROWSER_SMOKE | PASS acotado el 2026-09-17, PostgreSQL exclusivo y UI real; ver evidencia posterior |
| LEGACY_STORAGE_RECOVERY | PASS; 33 comprobaciones PostgreSQL/MinIO/ClamAV, ver revisión posterior |
| PHASE_4 | PARTIAL |
| REAL_CREDENTIALS_ENABLED | NO |
| REAL_SAT_ACCEPTANCE | NOT_RUN |
| RELEASE_STATUS | BLOCKED por gates vigentes del MVP |
| Base inicial / F4 heredada | 4802dbeb72c28b205f5b7d6ff9e096005131b1bf |
| Develop incorporado / base final PR | 4b392b7721596cd1be5612b029fe411e40980f2b |
| WORK_BRANCH | codex/cfdi-phase5-monthly-workspace |
| VALIDATED_CODE_SHA | 6e10ce3a0d9856fc7ecb557af98f50f9a60a460c; implementación inicial validada en 1e6d893ef2c3df4630738905cbbc9fcc73fe5089 |
| POSTGRES_EXECUTED_SHA | 1e6d893ef2c3df4630738905cbbc9fcc73fe5089 |
| Delta posterior | Test legacy dirigido, documentación y correcciones reproducidas en navegador descritas al final |

PR25 estaba abierta al iniciar y fue integrada por el equipo durante el trabajo (2026-09-15, merge 4b392b7). Se incorporó origin/develop por fast-forward; no hubo diferencias de contenido ni conflictos. La nueva PR se dirige a develop, con dependencia F4 ya integrada. Se conservaron los worktrees anteriores y el cambio ajeno de apps/web/AGENTS.md en el workspace original. No reset, force-push, merge de PR ni despliegue por el agente.

## Implementación comprobada

Tabla mensual real por entidad y participación/ordinal, filtros/paginación SQL, contadores e importes exactos separados por moneda/I/E, P/T fuera de facturación. Panel reutiliza representación CFDI, navegación dentro del conjunto filtrado y referencias de pagos sin trasladar decisiones a otros meses. Abrir no revisa. Categorías opcionales de organización, historial append-only, comentarios/tratamientos manuales, lotes de máximo 100 con preview durable, selección fija, idempotencia, savepoints y resultados parciales auditados.

Lease 120 s por instancia/sesión/membresía, renovación con actividad, takeover con MFA/reauth/motivo, versiones y autosalvado serializado. Seguimiento mensual de incidencias sin alterar evidencia original; responsables autorizados y aclaración manual con cliente. Checklist automático/humano, plantillas versionadas. Cierre interno REPEATABLE READ, conjunto preparado verificado, snapshot inmutable y excepción de fuentes explícita. Novedades por conjuntos/valores, incluidas relaciones de pago y transacciones que confirman después del cierre. Reapertura conserva versiones.

Reconciliación durable por worker existente: intenciones con fechas originales, claim/fencing, creación tardía del período, idempotencia y resolución auditada. Nuevas tablas tienen scope, FKs compuestas, ENABLE/FORCE RLS y ACL restringidas. Se retiró el camino preliminar que cerraba períodos sin snapshot.

## Pruebas ejecutadas

| Grupo | Resultado final |
| --- | --- |
| Nuevas reglas/DTO backend monthly.spec.ts | 11 tests PASS |
| Acceso a cuentas/ejercicios directamente afectado | 5 tests PASS |
| Autorización, manual XML, worker y auditoría compartidos | 58 tests / 4 suites PASS |
| Total backend unitario focalizado | 74 tests / 6 suites PASS |
| Integración PostgreSQL mensual | 1 test / 1 suite PASS, 65 comprobaciones; última corrida 4.701 s, exit 0 sobre SHA exacto indicado |
| Nuevo estado editorial frontend | 5 tests PASS |
| Navegación, carga de períodos y precisión decimal frontend | 17 tests PASS |
| Total frontend focalizado | 22 tests PASS, 0 fallos |
| ESLint código nuevo y archivos compartidos afectados | PASS, sin errores |
| Typecheck API y frontend | PASS |
| Build API/worker | PASS, nest build |
| Build frontend | PASS, next build; 15 páginas generadas, rutas dinámicas conservadas |
| git diff --check | PASS |

Los conteos son de casos, no suma de reejecuciones. La integración de 65 comprobaciones es F5 y no reutiliza como propia la integración histórica F4 de 61.

Comandos desde la raíz del worktree, con el Node/Bun ya disponibles del proyecto:

~~~powershell
node apps/api/node_modules/jest/bin/jest.js --config apps/api/package.json --runInBand --runTestsByPath apps/api/test/monthly.spec.ts apps/api/test/client-accounts-access.service.spec.ts apps/api/test/authorization.service.spec.ts apps/api/test/manual-xml-job.handler.spec.ts apps/api/test/ingestion-worker-runner.spec.ts apps/api/test/cfdi-worker-audit-safety.spec.ts
$env:RUN_MONTHLY_INTEGRATION='true'
node apps/api/node_modules/jest/bin/jest.js --config apps/api/package.json --testRegex='test/external/monthly\.external\.ts$' --runInBand
node apps/api/node_modules/typescript/bin/tsc --noEmit --project apps/api/tsconfig.json
node apps/web/node_modules/typescript/bin/tsc --noEmit --project apps/web/tsconfig.json
node apps/web/node_modules/typescript/bin/tsc --project apps/web/tsconfig.tests.json
node --test apps/web/.test-dist/features/monthly/editor-session.test.js apps/web/.test-dist/features/clients/fiscal-periods-load-state.test.js apps/web/.test-dist/features/cfdi/exact-decimal.test.js apps/web/.test-dist/lib/navigation.test.js
bun run --cwd apps/api build
bun run --cwd apps/web build
~~~

ESLint se ejecutó con el binario instalado de cada app sobre sus archivos nuevos y los modificados listados en el commit. El nuevo test frontend está registrado en apps/web/package.json y tsconfig.tests.json siguiendo el runner existente. No se añadieron dependencias ni se cambió el lockfile.

## Integración real y recorrido representativo

Reutilizó Docker Linux/PostgreSQL del QA existente en 127.0.0.1:55432. Cada corrida creó únicamente una base test_monthly_<12 hex>, ejecutó el historial completo de migraciones y seeds para probar instalación nueva, y utilizó logins efímeros NOINHERIT/NOSUPERUSER/NOBYPASSRLS miembros de balanz_api y balanz_worker. Se eliminaron esa base y sus logins al finalizar. Ninguna migración se ejecutó contra una base compartida.

Los datos de dominio son sintéticos insertados por el fixture: no es una prueba de recepción XML/ZIP, ClamAV, MinIO o SAT; esos servicios no se sustituyeron por mocks para afirmar su aceptación. Esta integración comprueba PostgreSQL/servicios mensuales y reconciliación de intenciones usando el rol worker real. La recuperación legacy que requiere volver a leer un XML original no se ejecutó con storage externo en este recorrido.

Escenarios verificados: GET sin adquirir edición; dos pestañas y un solo ganador; heartbeat sin cambiar contenido; decisiones stale y replay; lote parcial y replay sin duplicación; varios pagos/meses; precisión superior al entero seguro JS; monedas/I/E/P/T; catálogo/etiqueta histórica; RLS fuera del tenant; denegación tras retirar asignación/sesión; nómina fuera de contadores y cierre completo denegado; inmutabilidad de cierres; paginación e historial; fuente SAT incierta que bloquea, reauth vencida denegada y excepción congelada sin alterar SAT; cierre vacío con confirmación humana; transacción de incorporación iniciada antes y confirmada después del cierre; reconciliación sin período, claim incorrecto, creación posterior, cambio de timezone sin reasignar historia y reejecución sin duplicar.

Recorrido solicitado: primera persona prepara y revisa; segunda retoma por takeover, atiende aclaración, resuelve incidencia y completa la revisión; cierra una nueva versión; llega relación de pago/documento, se consulta la diferencia y se reabre conservando el cierre anterior. La auditoría conserva al usuario que actúa.

Fallos encontrados durante desarrollo y corregidos antes del SHA validado: ACL mínimas del propietario de reconciliación, cast de estado SQL, trigger de llegada, referencias SQL, aislamiento de instancia de autosalvado y expectativas históricas de navegación. Los resultados FAIL intermedios no se presentan como PASS; la corrida final está indicada arriba.

## Límites y pendientes

- Browser smoke NOT_RUN: el frontend previamente abierto corresponde a otra base, no a la mesa F5. No se reconstruyó un ambiente de navegador. No hay capturas ni afirmación de validación visual/teclado real. Los tests frontend acreditan el estado editorial y contratos auxiliares, no un E2E DOM completo.
- La evidencia de PostgreSQL usa datos sintéticos y roles restringidos. No certifica despliegue administrado ni disponibilidad histórica de cada XML original. Si un original legado no está disponible/íntegro, la reconciliación falla de forma visible y no inventa pertenencia.
- No hay defectos funcionales reproducibles conocidos pendientes dentro de los caminos verificados. Falta revisión humana del diff y recorrido de navegador cuando exista entorno F5; no equivale a aceptación de release.
- Una migración nueva: 1787691200000-PhaseFiveMonthlyWorkspace. Cero migraciones históricas modificadas. ci.yml/deploy-dev.yml intactos. Sin secretos/infra compartida modificados ni nuevas políticas de purga.
- F4 sigue PARTIAL: aceptación SAT real, perfil positivo de titular e.firma/CSD, contrato metadata y aprobaciones operativas/legal de custodia, backups/versionado/restore pendientes. SAT real continúa requisito del MVP. No se habilitó real_pilot ni se usaron e.firmas reales.
- Siguiente acción: revisar PR F5 contra develop y realizar el recorrido visual cuando el entorno esté disponible; mantener gates de liberación separados. No iniciar Fase6 ni fusionar/desplegar por esta entrega.

Documentos: [ADR-CFDI-008](../architecture/decisions/ADR-CFDI-008-MONTHLY-WORKSPACE-CLOSE.md), [API](../contracts/CFDI_MONTHLY_WORKSPACE_API.md), [runbook/nota de despliegue](../operations/CFDI_PHASE_5_RUNBOOK.md), [contrato detallado mensual](../architecture/CONTROL_MENSUAL_CFDI_V3_3.md) y [roadmap](../roadmaps/CFDI_P0_MASTER_IMPLEMENTATION_PLAN.md).


## Revisión funcional/visual acotada posterior — 2026-09-15

PR: https://github.com/hemia-labs/balanz/pull/26, abierta y en borrador, base develop. HEAD inicial verificado: cc14159997c0591ec20d2707d9fc55e2ab0ba12f; no había cambios posteriores ni locales en el worktree F5. El delta desde el código validado 1e6d893ef2c3df4630738905cbbc9fcc73fe5089 era exclusivamente documental. El cambio ajeno de apps/web/AGENTS.md en el workspace principal se conservó.

### Navegador: NOT_RUN, bloqueo de herramienta

La inicialización de cua.getState() falló antes de seleccionar o abrir una página: "failed to write kernel assets: El sistema no puede encontrar la ruta especificada. (os error 3)". Un reset del kernel y un nuevo intento devolvieron el mismo error; la alternativa node_repl también falló al inicializar. Se detuvo el diagnóstico dentro del máximo de 20 minutos, sin reinstalar herramientas ni reconstruir infraestructura.

Se comprobó que Docker QA estaba disponible: PostgreSQL 55432, MinIO 59000, ClamAV 53310 y Redis 56379. Los procesos existentes en 3021/5181 no se usaron como evidencia de F5. No se inició otra API/frontend al quedar bloqueado el control del navegador. No se alteraron cuentas, autenticación ni MFA para sortearlo.

SHA recorrido en navegador: **NONE**. Quedan sin comprobar por UI filtros/indicadores, panel/Anterior/Siguiente, guardado/reload, lote, aclaración y relevo, takeover, cierre/novedades/reapertura y cambio de tenant. No hay capturas reales de esos estados y no se adjuntan imágenes simuladas. La aceptación visual/funcional del recorrido sigue pendiente.

Intervención mínima propuesta: reiniciar la aplicación Codex y restablecer su herramienta de navegador; comprobar que cua.getState() puede inicializarse. Si persiste el error, soporte de la herramienta debe corregir la ruta de assets del kernel. Esto no exige cambios en Balanz, Docker ni su base. Después se debe iniciar API/frontend de este worktree con cuentas sintéticas aisladas y completar únicamente el recorrido pendiente.

### Recuperación legacy desde storage: PASS

SHA exacto ejecutado: **7851cb86015ab7e8395ba5a64dd15cdaa0a58e97**. Este commit añade únicamente apps/api/test/external/monthly-legacy.external.ts; no modifica el código de producto. Resultado: **1 test / 1 suite PASS, 33 comprobaciones, 4.121 s, exit 0**.

Comando desde la raíz del worktree, con Node y Docker existentes en PATH:

~~~powershell
$env:RUN_MONTHLY_LEGACY_INTEGRATION='true'
node apps/api/node_modules/jest/bin/jest.js --config apps/api/package.json --testRegex='test/external/monthly-legacy\.external\.ts$' --runInBand
~~~

Evidencia específica:

- Base efímera test_monthly_<12 hex>, esquema existente sin cambios, roles API/worker NOINHERIT/NOSUPERUSER/NOBYPASSRLS; cada operación de recuperación usa el servicio real y su contexto RLS/claim.
- Objetos sintéticos desechables en MinIO privado existente, adaptador S3 real con SSE AES256 y prefijo aleatorio propio. Se escanean exactamente sus bytes mediante ClamAV y se usa el parser SAX/XSD real, sin mocks.
- Original íntegro sin intención ni participación: reconstruye fecha literal 2026-08-15T12:30:00 y conserva el instante histórico 2026-08-15T18:30:00Z, política 1.0.0 y timezone historical-unrecorded; vincula una sola participación al período agosto y resuelve el registro durable. No altera el incidente original.
- Original ausente: no crea intención ni participación, conserva incidente abierto, estado failed y PARTICIPATION_RECONCILIATION_FAILED, libera lease y programa retry. Su estado/incidente es legible mediante el rol API bajo RLS. Esta es evidencia de persistencia/lectura autorizada; no acredita su presentación en navegador.
- Restituyendo exclusivamente los bytes del objeto de prueba y adelantando sólo su reloj de retry en el fixture, recupera el mismo CFDI. Reejecuciones no duplican participaciones. No se añade un endpoint ni comportamiento nuevo.
- Al terminar se borran únicamente esos objetos, la base efímera y sus logins; no se alteran datos compartidos ni políticas del bucket. Borrado lógico de objetos de prueba no acredita purga de versiones o backups.

El fixture representa CFDI ya incorporados mediante inserciones de prueba: **no es evidencia de upload XML**. En la primera corrida el fixture sustituyó el UUID con una comparación sensible a mayúsculas aunque el parser normaliza a minúsculas; se corrigió el fixture y se verificó explícitamente la identidad del XML generado. No se encontró un defecto del código de producto en este camino. Las corridas intermedias no se suman al conteo final.

ESLint del nuevo test y git diff --check: PASS. Jest compiló y ejecutó el test TypeScript. No se repitieron los 74 tests backend, 22 frontend, 65 comprobaciones anteriores ni builds: sólo cambió la comprobación externa, sin cambios en fuentes API/frontend. CI, deploy, migraciones, dependencias, custodia y SAT permanecieron intactos.

El commit posterior a 7851cb8 actualiza exclusivamente este reporte. Su SHA final se registra en la PR y en la entrega, evitando una referencia circular dentro del propio commit. No merge ni despliegue.

**PHASE_4: PARTIAL · REAL_CREDENTIALS_ENABLED: NO · REAL_SAT_ACCEPTANCE: NOT_RUN · RELEASE_STATUS: BLOCKED.** La recuperación legacy queda acreditada localmente; falta el recorrido visual solicitado. Esta evidencia no resuelve aceptación SAT real, perfil de titular, metadata ni aprobaciones operativas del MVP.

## Reintento de navegador tras reinicio — 2026-09-17

HEAD inicial verificado: 3d97775a12b83acebfd62dcd26962deb5613c04b, worktree limpio; PR26 continúa abierta/en borrador. La herramienta de navegador ya inicializa correctamente y devuelve el navegador integrado disponible. Queda resuelto el bloqueo anterior de assets del kernel.

El recorrido permanece **NOT_RUN**: tras el reinicio no estaban disponibles los puertos QA ni API/frontend. Se intentó iniciar la instalación existente de Docker Desktop, sin cambios de configuración. Su log de arranque a las 16:54:33 UTC registra que el backend se detiene porque no puede acceder/renombrar `sailor-ingest.sock` a `sailor-ingest.sock.stale` en su directorio local `Docker/run` (`The file cannot be accessed by the system`). El pipe `dockerDesktopLinuxEngine` no existe. Diagnóstico detenido en menos de 20 minutos; no reset de Docker/WSL, reinstalación, borrado de sockets o volúmenes ni cambios compartidos.

Intervención mínima: cerrar Docker Desktop mediante **Quit** y volver a abrirlo; si persiste, reiniciar Windows y comprobar que Docker muestra el motor Linux en ejecución. No elegir **Reset to factory defaults**. Si continúa el error de socket, requiere reparación del arranque de Docker por soporte antes de retomar el QA. Verificación esperada: `docker ps` debe responder y permitir iniciar los contenedores locales existentes.

No se recorrió ningún SHA en navegador ni se obtuvieron capturas de la mesa. No hubo cambios de producto, nuevas pruebas, builds o reejecución de legacy; su PASS de 33 comprobaciones se conserva como evidencia del 2026-09-15, no como disponibilidad actual. Este reintento modifica exclusivamente el reporte y la PR. PHASE_4: PARTIAL; REAL_CREDENTIALS_ENABLED: NO; REAL_SAT_ACCEPTANCE: NOT_RUN; RELEASE_STATUS: BLOCKED.

## Preparación local tras arrancar Docker — 2026-09-17

HEAD inicial: 8e04b30c5b2afe3721c59024ba109b673c135854, sin cambios de producto posteriores. Docker Linux y el navegador vuelven a funcionar. Windows reservó el intervalo TCP 55341–55440 y rechazaba publicar 55432; se inició únicamente el servicio PostgreSQL ya definido con POSTGRES_PORT=55450, sin build, conservando el volumen existente. No se cambiaron archivos Compose ni reservas de Windows.

Frontend F5 iniciado en localhost:5185 desde este worktree; sólo se abrió login, lo cual **no acredita el recorrido mensual**. La API de la misma rama en 3025 no completó el arranque: RuntimeDatabaseGuard rechazó una identidad temporal adicional por unexpected_runtime_group_member. El cluster QA ya tiene el login balanz_api_local_f1; debe reutilizarse su credencial existente. Se eliminaron los logins creados por este intento, preservando el login y permisos preexistentes. No se desactivó el guard ni se restableció ninguna contraseña existente.

Se conserva únicamente la base sintética test_monthly_browser_a06a96c743f5 y sus objetos propios para continuar; los otros dos intentos de preparación y sus objetos fueron limpiados. No se crearon sesiones verificadas artificialmente. Se solicitó la ruta o mecanismo local para cargar la credencial API existente, sin pedir la contraseña por chat. Los archivos .env y .env.api.local del proyecto principal no contienen esa credencial. Siguiente paso: configurar la API QA con dicha identidad y la base sintética, obtener liveness y recorrer la mesa mediante login/TOTP normales.

BROWSER_SMOKE: NOT_RUN (recorrido mensual); SHA recorrido: NONE; capturas de mesa/cierre: pendientes. Legacy conserva su PASS previo y no se repitió. Sin cambios de producto, tests/builds repetidos, CI, migraciones, dependencias, custodia o SAT. PHASE_4: PARTIAL; REAL_CREDENTIALS_ENABLED: NO; REAL_SAT_ACCEPTANCE: NOT_RUN; RELEASE_STATUS: BLOCKED.

## Recorrido real con PostgreSQL exclusivo — 2026-09-17

**ENTORNO: PASS · BROWSER_SMOKE: PASS acotado · LEGACY: PASS previo, no repetido.** La preparación del entorno no se contabiliza como validación de la mesa.

### Aislamiento y SHA

HEAD inicial comprobado: `c04b653cc24d6c53acd7cf9ff7e22098b696fcf8`, worktree limpio, PR26 abierta/en borrador. El usuario cerró la búsqueda de la contraseña anterior y autorizó expresamente una instancia nueva. No se reutilizó ni modificó PostgreSQL anterior, sus roles, contraseñas o volumen. Se conservaron cambios del workspace principal.

- Contenedor `balanz-monthly-browser-6b878684d2b7`; volumen exclusivo `balanz-monthly-browser-6b878684d2b7-data`; publicación `127.0.0.1:55461`; DB `test_monthly_browser_6b878684d2b7`.
- Imagen exacta PostgreSQL 16.15/bookworm de `infra/cfdi-phase0/compose.yaml`. Preparación iniciada 18:45 UTC y runtimes saludables antes de 18:49 UTC, dentro de los 20 minutos.
- Historial existente de migraciones y seed, seguidos del provisionador existente `provision-fiscal-runtime-logins`: un API y un worker restringidos en sus grupos correspondientes, migrador separado. Ambos guard checks PASS. Sin cambios en guard, RLS, migraciones, autenticación ni MFA.
- Credenciales aleatorias en `.local/monthly-browser-20260917`, ignorado por Git y ACL exclusiva del usuario Windows y SYSTEM. Configuraciones de API/worker separadas; sin contraseña de migrador en runtime. No se utilizó Vault de otro ambiente.
- API 3025 y worker 3026 de este worktree, misma DB; frontend Next F5 5185 apuntando a `/api/v1` de 3025. MinIO 59000, ClamAV 53310 y Redis 56379 del QA local; Redis con prefijo exclusivo. `/liveness` y `/readiness` disponibles; PostgreSQL/storage/scanner/Redis/supervisor up, sin desactivar comprobaciones.

El recorrido comenzó en c04b653 y detectó los defectos siguientes. **Código corregido y recorrido final: `6e10ce3a0d9856fc7ecb557af98f50f9a60a460c`**. Se reconstruyó API, se reiniciaron sólo API/worker propios y se comprobó nuevamente readiness. Frontend sirvió las correcciones de este mismo worktree. El siguiente commit incluye únicamente documentación y capturas; su SHA se publica en la PR para evitar una referencia circular.

### Defectos reproducidos y corregidos

1. El endpoint mensual entregaba el detalle CFDI real sin pasar por `normalizeCfdiDetail`; el panel mostraba `undefined` para RFC de emisor/receptor. Se aplica el normalizador existente y se incluye la ruta scoped en la identidad del recurso. Comprobado con datos iniciales y con el XML posteriormente incorporado, incluidos conceptos.
2. Al comparar el snapshot leído de JSONB contra el objeto actual, el orden de propiedades provocaba falsas novedades inmediatamente después del cierre. `monthlyChanges` compara contenido con `node:util.isDeepStrictEqual`; no modifica fingerprints históricos, idempotencia ni snapshots. También compara correctamente una fuente/incidencia nueva sin intentar hashear una referencia anterior inexistente. Antes de incorporar el XML posterior se verificó **Cerrada, 0 altas/0 cambios/0 bajas**; después **1 alta/0 cambios/0 bajas** y la fuente de ingesta nueva.
3. La reautenticación exigida para cerrar estaba disponible únicamente en Categorías y edición. Se reutiliza el mismo control TOTP también en Cierre y novedades, con instrucciones antes de la acción. No se cambian requisitos de MFA, expiración ni permisos. Se completó el cierre tras reautenticación normal.

### Evidencia del recorrido

| Acción real en navegador | Resultado observado |
| --- | --- |
| Login de Ana y Bruno | Contraseña y TOTP normales; cuentas/factores sintéticos, sin sesiones preautorizadas |
| Cliente/RFC/período | Cliente sintético Agosto, AAA010101AAA, agosto 2026; tres documentos iniciales |
| Filtros/indicadores | Con incidencias reduce a 1 fila; Todos vuelve a 3; filtro MXN; Novedades posterior muestra sólo el nuevo XML |
| Panel y navegación | Anterior/Siguiente cambian documento; cerrar conserva filtro; abrir no marca revisado. RFC correctos después de corregir normalización |
| Guardado y reload | Ana guarda revisión/comentario; reload conserva ambos y muestra 1/3 revisadas |
| Lote | Dos participaciones seleccionadas; preview 2 aplicables/0 impedimentos; ejecución 2 aplicadas/0 impedimentos; total 3/3 |
| Aclaración y relevo | Ana deja pendiente de aclaración, asigna Bruno y comenta. Bruno inicia su sesión, lee historial/autoría y resuelve sin alterar evidencia original |
| Edición exclusiva | Segunda pestaña de la misma sesión ve editor y no puede adquirir edición; takeover con motivo y reauth vigente; escritura de la pestaña desplazada rechazada y edición desactivada |
| Checklist/cierre | Comprobaciones automáticas y dos confirmaciones humanas motivadas; preview de 3 documentos/3 participaciones; alcance interno y limitación SAT visibles; cierre 1 persistido |
| Incorporación posterior | Upload XML real desde navegador, 202; job `291c4c8a-e72d-48e0-bd86-704ea4e27621` completado, 1 incorporado, parser real y objeto clean |
| Novedades/reapertura | 3/4 revisadas, exactamente una nueva participación y una fuente completada; reapertura motivada; cierre 1 conserva sus 3 participaciones |
| Cambio de tenant/logout | Se limpian vistas al salir/cambiar a Otro despacho QA; cartera vacía sin cliente, comentarios ni filas del anterior. No se forzó latencia de red: descarte determinista de respuestas tardías cubierto por la regresión de editor ejecutada |

Los tres CFDI iniciales y la incidencia son **fixtures de dominio**, con originales sintéticos en MinIO y escaneo real; no acreditan su ingreso por upload. La cuarta incorporación sí recorrió navegador → API → storage → ClamAV → worker/parser → participación del mes. Su UUID sintético es `e21f0a5f-484f-4549-ba40-747ffde4833e`; lectura dirigida confirmó `clean`, parser `balanz-cfdi-saxes/1.0.0` y una sola participación. No acredita validación criptográfica o aceptación SAT real.

Lectura dirigida de la DB nueva: período `reopened`, un cierre v1 con tres participaciones; auditoría con tres decisiones de Ana, gestión de incidencia por Ana y Bruno, dos confirmaciones de Bruno, un cierre y una reapertura por Bruno. Sin nuevas escrituras de prueba fuera de esta instancia y sus objetos propios.

### Verificación proporcional

- Backend: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/monthly.spec.ts` desde apps/api: **13 tests/1 suite PASS**, incluidos 2 nuevos de comparación JSONB y evidencias nuevas.
- Frontend: compilación de `tsconfig.tests.json` y `node --test .test-dist/features/cfdi/types.test.js .test-dist/features/monthly/editor-session.test.js`: **10 tests PASS** (5 normalización CFDI y 5 estado editorial).
- ESLint de los cuatro archivos modificados: PASS; typecheck frontend: PASS. Build API (`nest build`, incluye TypeScript) y frontend (`next build`): PASS. `git diff --check`: PASS.
- No Full ni repetición de las suites completas de 74/22, de las 65 comprobaciones PostgreSQL o de legacy. **Legacy conserva PASS de 33 comprobaciones en 7851cb8 del 2026-09-15**, no evidencia nueva.
- CI, deploy, migraciones, dependencias, custodia y SAT intactos. No merge ni despliegue.

### Capturas y límites

Capturas reales del recorrido, sin contraseñas, TOTP ni secretos. Son evidencia visual complementaria; las acciones anteriores se verificaron separadamente.

- [Mesa con filtro MXN y avance](evidence/phase5/01-mesa.png).
- [Panel y decisión persistida tras reload](evidence/phase5/02-panel-guardado.png).
- [Aclaración pendiente asignada a Bruno](evidence/phase5/03-aclaracion.png).
- [Cierre 1 conservado después de reabrir](evidence/phase5/04-cierre.png).
- [Novedad y fuente posteriores al cierre](evidence/phase5/05-novedades.png).

Panel/aclaración se capturaron durante la corrección incremental incluida en 6e10ce3; mesa/cierre/novedades después de publicar ese commit localmente. No son capturas recreadas. Relevo entre personas probado secuencialmente con login propio; concurrencia probada con dos pestañas de una sesión. No matriz visual, prueba de carga masiva parcial en navegador ni carrera de red artificial; se conserva su evidencia automatizada anterior donde corresponde. Los snapshots anteriores permanecen inmutables; no se reescribieron para ocultar el fallo encontrado.

**Siguiente acción:** revisión humana de PR26 y de estas capturas. La comprobación local pendiente queda cerrada dentro de este recorrido; no habilita liberación del MVP. Entorno temporal queda disponible y su retiro exclusivo está documentado en el runbook.

**PHASE_4: PARTIAL · REAL_CREDENTIALS_ENABLED: NO · REAL_SAT_ACCEPTANCE: NOT_RUN · RELEASE_STATUS: BLOCKED.** Permanecen compatibilidad real/perfil, metadata, aceptación SAT y aprobaciones operativas/legal. No se inicia Fase6.
