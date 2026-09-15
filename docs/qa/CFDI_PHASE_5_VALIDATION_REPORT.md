# Validación Fase 5 — mesa mensual

Fecha: 2026-09-15. Evidencia técnica ejecutada por el agente; no atribuye revisión humana independiente, aprobación fiscal/legal, merge ni despliegue.

## Estado y Git

| Campo | Resultado |
| --- | --- |
| PHASE_5_IMPLEMENTATION | COMPLETE para el alcance de mesa mensual autorizado |
| PHASE_5_AUTOMATED_VALIDATION | PASS, con límites indicados abajo |
| PHASE_5_LOCAL_POSTGRES_INTEGRATION | PASS |
| PHASE_5_INTEGRATION_STATUS | NOT_MERGED; revisión en PR borrador |
| BROWSER_SMOKE | NOT_RUN |
| PHASE_4 | PARTIAL |
| REAL_CREDENTIALS_ENABLED | NO |
| REAL_SAT_ACCEPTANCE | NOT_RUN |
| RELEASE_STATUS | BLOCKED por gates vigentes del MVP |
| Base inicial / F4 heredada | 4802dbeb72c28b205f5b7d6ff9e096005131b1bf |
| Develop incorporado / base final PR | 4b392b7721596cd1be5612b029fe411e40980f2b |
| WORK_BRANCH | codex/cfdi-phase5-monthly-workspace |
| VALIDATED_CODE_SHA | 1e6d893ef2c3df4630738905cbbc9fcc73fe5089 |
| POSTGRES_EXECUTED_SHA | 1e6d893ef2c3df4630738905cbbc9fcc73fe5089 |
| Delta posterior | Sólo documentación: este reporte, ADR, contrato, runbook, norma mensual y roadmap |

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
