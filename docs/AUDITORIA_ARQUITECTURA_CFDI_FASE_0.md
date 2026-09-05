# Auditoría de arquitectura — CFDI Fase 0

> **Actualización:** revisión de las conclusiones originales contra la PR
> [#18 — `feat(cfdi): Phase 1 XML ingestion end to end`](https://github.com/hemia-labs/balanz/pull/18).
> Esta actualización sustituye cualquier recomendación previa de borrar
> componentes que ya tienen un consumidor productivo en Fase 1.
>
> **Actualización operativa del 5 de septiembre de 2026:** el hallazgo ARC-002
> quedó resuelto. Terraform y Ansible asumieron el estado del VPS y se retiraron
> los 19 archivos de `scripts/deploy/`; `deploy-dev.yml` conserva únicamente el
> rollout de aplicación, sus probes y rollback. El detalle está documentado en
> `docs/operations/CFDI_WORKER_RUNBOOK.md` y
> `docs/qa/CFDI_PHASE_0_VALIDATION_REPORT.md`.

## Dictamen ejecutivo actualizado

La PR 18 cambia materialmente el diagnóstico inicial. La Fase 0 ya no es una
plataforma sin producto: la PR agrega la primera vertical XML completa y conecta
los componentes que antes parecían especulativos.

**No vale la pena borrar el núcleo de `apps/api` señalado originalmente.** El
worker durable, PostgreSQL/RLS, object storage, ClamAV, Redis wakeup, el parser,
las migraciones y sus pruebas forman ahora un flujo ejecutable:

```text
HTTP multipart XML
  -> almacenamiento privado
  -> job PostgreSQL durable
  -> worker manual_xml
  -> ClamAV
  -> parser SAX + XSD local
  -> persistencia CFDI con RLS
  -> consultas y descarga temporal autorizada
```

La sobreingeniería que permanece no está principalmente en la cantidad de
componentes, sino en:

- clases demasiado grandes;
- validaciones de CI acopladas a una fase o a un conteo exacto de migraciones;
- documentación histórica mezclada con documentación vigente;
- escrituras SQL fila por fila que pueden limitar la escala de CFDI grandes;
- readiness de API y worker con dependencias que deberían evaluarse por
  proceso.

**Riesgo arquitectónico actualizado: Medio.** La arquitectura es defendible y
robusta, pero todavía necesita reducir acoplamiento operativo y tamaño de
unidades antes de seguir sumando Fases 2–8.

**Estado de integración:** no se recomienda fusionar la PR 18 mientras siga en
`Draft` y su único check requerido permanezca fallido. Este bloqueo requiere
corregir la validación; no justifica borrar el pipeline CFDI.

## Alcance verificado

### PR 18

- **Base declarada:** `codex/cfdis`.
- **Base usada por los siete commits de la PR:**
  `a4d71bd77fe0db1cdd8f7f747ec1a18ab3db1a7d`.
- **Head:** `1540f8610bdd8acd112151ee667069a4134de36a`.
- **Estado observado:** `Draft`, 0/1 checks exitosos.
- **Cambio total:** 141 archivos, 188,495 inserciones y 453 eliminaciones.
- **Explicación del volumen:** 162,341 líneas corresponden a
  `catCFDI.xsd`, un catálogo oficial de 5,984,046 bytes; no son lógica de
  aplicación.
- **`apps/api` productivo, excluyendo XSD y tests:** 48 archivos, 9,859
  inserciones y 101 eliminaciones.
- **Tests nuevos/modificados de `apps/api`:** 21 archivos, 7,766 inserciones y
  una eliminación.
- La PR 18 no agrega otra plataforma de despliegue ni otro stack de
  infraestructura: consume la fundación introducida por Fase 0.

La rama objetivo avanzó después de la base original de la PR. Antes de integrar
se debe sincronizar `codex/cfdi-phase1-xml` con el head vigente de
`codex/cfdis` y volver a ejecutar el check requerido.

### Verificaciones de esta auditoría

- Se confirmó el head remoto de la PR mediante `refs/pull/18/head`.
- Se confirmó la base de sus commits mediante el merge ref de GitHub y el grafo
  local.
- Se revisó el diff completo de `apps/api` y se rastrearon consumidores de
  storage, scanner, parser, worker, Redis y manifiesto de migraciones.
- Se comprobó que no hay `TODO`, `FIXME`, `HACK` ni stubs de implementación en
  los módulos nuevos de CFDI, parser, ingestion y migraciones.
- Se revisó el check actual en GitHub: `Isolated Phase 0 full validation` está
  fallido.
- No se ejecutaron migraciones ni operaciones contra bases o servicios
  compartidos.
- Los resultados de 61 suites/502 tests de API, integración PostgreSQL,
  ClamAV, MinIO y QA manual son evidencia registrada por la propia PR en
  `docs/qa/CFDI_PHASE_1_VALIDATION_REPORT.md`; no sustituyen el check requerido
  fallido.

## Leyenda de estados de eliminación

Sólo un elemento con estado **SE NECESITA BORRAR** es una instrucción de
eliminación. Los demás estados no autorizan borrar archivos ni funcionalidad.

| Estado | Significado |
| --- | --- |
| **SE NECESITA BORRAR — ANTES DEL MERGE** | Residuo sin consumidor ni valor documental vigente |
| **SE NECESITA BORRAR — DESPUÉS DEL CUTOVER** | Herramienta temporal; conservar hasta que exista evidencia del cutover exitoso |
| **NO BORRAR** | Parte activa del producto, seguridad, operación o prueba |
| **NO BORRAR AHORA** | Puede revisarse después de cumplir una condición explícita |
| **SIMPLIFICAR, NO BORRAR** | La capacidad es necesaria; su implementación es demasiado grande o acoplada |
| **ARCHIVAR, NO BORRAR** | Evidencia histórica útil que no debe competir con la autoridad vigente |
| **RENOMBRAR, NO BORRAR** | Contenido útil con nombre o ubicación de artefacto |

## Matriz definitiva: qué borrar y qué conservar

| Elemento revisado | Estado | Justificación verificada contra PR 18 |
| --- | --- | --- |
| `docs/architecture/PROMPT_CODEX_ROADMAP_E_IMPLEMENTACION_CFDI_BALANZ_FASE_0_1.md` | **SE NECESITA BORRAR — ANTES DEL MERGE** | Es una instrucción de desarrollo de 2,070 líneas, no documentación operativa. No tiene referencias entrantes y el roadmap, ADR, contratos y reportes ya conservan las decisiones vigentes. Git mantiene el historial. |
| `docs/architecture/CFDI_DOWNLOAD_INGESTION_CURRENT_STATE.md` | **ARCHIVAR, NO BORRAR** | Es una fotografía previa que afirma que la capacidad CFDI no existe. Sigue siendo evidencia histórica, pero necesita un encabezado de obsolescencia y ubicación bajo `docs/archive/`. |
| `docs/architecture/CFDI_DOWNLOAD_INGESTION_DECISION_INPUTS.md` | **ARCHIVAR, NO BORRAR** | Mezcla decisiones ya cerradas con preguntas legítimas de fases futuras. No debe ser autoridad actual, pero borrarlo perdería contexto todavía útil para SAT/ZIP. |
| `docs/architecture/control_mensual_cfdi (2).md` | **RENOMBRAR, NO BORRAR** | No se encontró otra copia versionada. Es una especificación de producto 3.3 con contenido único; el sufijo `(2)` es el artefacto, no el documento. |
| `docs/qa/CFDI_PHASE_0_VALIDATION_REPORT.md` y `CFDI_PHASE_1_VALIDATION_REPORT.md` | **ARCHIVAR, NO BORRAR** | Son evidencia de aceptación y de gates. Deben quedar inequívocamente históricos al cerrar cada release; por ahora explican bloqueos reales. |
| Worker durable, leases, heartbeat, retry y reconciliación | **NO BORRAR** | `IngestionWorkerModule` registra ahora `ManualXmlJobHandler`; el worker procesa el flujo XML real y protege concurrencia, reinicio y cancelación. |
| Redis wakeup | **NO BORRAR** | Lo usan la admisión y el runner. PostgreSQL permanece como autoridad y polling como fallback, de modo que Redis sólo reduce latencia sin comprometer durabilidad. |
| `ObjectStoragePort` y adapter S3 | **NO BORRAR** | Los usan upload, query y worker. S3 es la frontera productiva correcta y el port evita acoplar dominio y pruebas al SDK. |
| Adapter y pruebas de filesystem local | **NO BORRAR AHORA** | Es un adapter permitido sólo fuera de producción y mantiene desarrollo sin servicios externos. Sólo debe borrarse en un cambio atómico si todo desarrollo/CI adopta MinIO y se elimina la configuración local asociada. |
| `MalwareScannerPort`, ClamAV y pruebas EICAR | **NO BORRAR** | `ManualXmlJobHandler` invoca el scanner antes del parser. Además, el producto permite volver a descargar el original; el escaneo evita redistribuir contenido malicioso. |
| Assets XSD del SAT y `manifest.json` | **NO BORRAR** | La validación XSD local, sin red y con hashes es un control funcional y de seguridad. El catálogo de 5.98 MB explica casi todo el conteo de líneas de la PR. |
| Migraciones `060`–`071` | **NO BORRAR** | Las tablas y constraints son consumidas por la vertical XML y las migraciones están registradas como aplicadas en entornos de desarrollo. Mantener append-only en cualquier base durable. |
| `migration-manifest.ts` | **NO BORRAR** | Es consumido por preflight, show, runner y pruebas para validar identidad/orden de migraciones. El check frágil debe corregirse sin perder esta garantía. |
| Configuración XML | **NO BORRAR** | Los límites XML, de concurrencia y de acceso temporal ya tienen consumidores en parser, upload, storage y repositorios. |
| Configuración ZIP/SAT futura sin consumidor | **SIMPLIFICAR, NO BORRAR** | No se debe borrar todo `fiscal-platform.config.ts`. Conviene retirar variables ambientales que sólo fijan constantes de Fase 2+ y reintroducirlas cuando exista un caller operativo. |
| `infra/cfdi-phase0/validate-phase0-local.ps1` | **SIMPLIFICAR, NO BORRAR** | Sigue siendo el gate de integración. Debe dividirse antes de sustituirse; borrarlo hoy eliminaría la única validación full-stack. |
| `bootstrap-runtime-isolation.sh`, `quiesce-legacy-release.sh` y `smoke-legacy-cutover.sh` | **RESUELTO — ELIMINADOS** | El cutover concluyó y Terraform/Ansible administran el host; conservarlos habría mantenido una ruta legacy muerta. |
| Scripts de deploy activos, rollback y limpieza de credenciales | **RESUELTO — ELIMINADOS** | Las invariantes necesarias quedaron en el único consumidor, `deploy-dev.yml`, sin duplicar la configuración de Terraform/Ansible. |
| Tests unitarios, contrato, RLS, concurrencia, ClamAV, MinIO y reinicio | **NO BORRAR** | Cubren las fallas de mayor impacto del sistema. Se puede reducir duplicación de fixtures/helpers y separar gates, no eliminar cobertura crítica. |

## Revisión de los hallazgos originales

| Hallazgo original | Estado tras PR 18 | Resolución |
| --- | --- | --- |
| ARC-001 — plataforma sin producto | **CERRADO** | Ya existen endpoint, handler, parser, persistencia y consultas. |
| ARC-002 — despliegue artesanal grande | **CERRADO (2026-09-05)** | Se eliminó `scripts/deploy/`; el workflow conserva sólo el rollout de aplicación y la infraestructura permanece fuera del repositorio. |
| ARC-003 — documentación histórica como vigente | **VIGENTE** | Se confirma la necesidad de borrar el prompt, archivar snapshots y renombrar la especificación. |
| ARC-004 — filesystem duplica S3 | **REBAJADO** | Hay duplicación, pero está aislada por un port y aporta desarrollo local. Es una decisión condicional, no un borrado obligatorio. |
| ARC-005 — ClamAV sin flujo protegido | **CERRADO** | El handler XML lo usa y las pruebas validan clean, EICAR y fail-closed. |
| ARC-006 — arnés PowerShell monolítico | **VIGENTE** | El check fallido de PR 18 confirma acoplamiento entre validación de Fase 0 y migraciones de Fase 1. |
| DS-001 — migraciones grandes | **MONITOREAR** | Ya tienen consumidor. No reescribir si fueron aplicadas; exigir pruebas de upgrade y rollback compatible. |
| DS-002 — configuración sin consumidores | **PARCIAL** | Los límites XML ya están activos; permanecen candidatos de simplificación los valores exclusivos de ZIP/SAT. |
| DS-003 — manifiesto como segunda autoridad | **CORREGIDO** | El manifiesto agrega una garantía real. El problema es el validador de conteo exacto, no la existencia del manifiesto. |
| DS-004 — Redis e índices prematuros | **CERRADO COMO BORRADO** | Redis ya participa en el flujo y degrada a polling. Los índices deben evaluarse con `EXPLAIN`, no eliminarse sin carga representativa. |

## Hallazgos actuales en `apps/api`

### API-001 — El check requerido no es evolutivo

- **Prioridad:** Bloqueante para merge.
- **Evidencia:** la PR muestra 0/1 checks; falla `Isolated Phase 0 full
  validation`. El reporte de Fase 1 registra que el validador espera un conteo
  exacto de migraciones.
- **Impacto:** agregar una migración append-only válida de Fase 1 rompe un gate
  nominalmente de Fase 0.
- **Acción:** validar el subconjunto/invariantes de Fase 0 y permitir migraciones
  posteriores conocidas; mantener una prueba separada para el catálogo completo.
- **Borrado:** ninguno.

### API-002 — Tres unidades concentran demasiadas responsabilidades

- **Prioridad:** Alta antes de ampliar ZIP/SAT.
- **Evidencia:** `saxes-cfdi-parser.adapter.ts` tiene 1,658 líneas,
  `cfdi-worker-persistence.service.ts` 1,267 y `xml-upload.service.ts` 1,061.
- **Impacto:** cualquier cambio en complementos, persistencia o recuperación de
  upload exige razonar sobre demasiados estados en una sola unidad.
- **Acción:** extraer componentes por responsabilidad sin crear nuevos
  servicios desplegables:
  - parser estructural, extractor de dominio y validador XSD;
  - receptor multipart, coordinación durable y cleanup;
  - persistencia core, pagos, nómina, impuestos y períodos.
- **Borrado:** no eliminar funcionalidad; reducir tamaño y duplicación interna.

### API-003 — Persistencia relacional fila por fila

- **Prioridad:** Alta para escalabilidad.
- **Evidencia:** `CfdiWorkerPersistenceService.insertDetails()` ejecuta
  `await manager.query()` dentro de loops para conceptos, relaciones, impuestos,
  pagos, documentos y nómina.
- **Impacto:** un XML válido con muchos nodos puede producir cientos o miles de
  round trips SQL dentro de una transacción, alargando locks, leases y tiempo de
  worker.
- **Acción:** insertar por lotes por tabla, medir tiempo y cantidad de queries
  con fixtures grandes y mantener el fence de lease antes del commit.
- **Borrado:** ninguno.

### API-004 — Readiness debe representar al proceso

- **Prioridad:** Media.
- **Evidencia:** el scanner es usado por el worker, mientras API y worker
  comparten la infraestructura/readiness fiscal.
- **Impacto:** una caída de ClamAV puede retirar también la API aunque ésta aún
  pueda consultar datos o admitir trabajo acotado para procesarlo después.
- **Acción:** hacer obligatorio ClamAV para readiness del worker. Para API,
  decidir explícitamente entre aceptar con backpressure o rechazar nuevas cargas
  sin deshabilitar consultas existentes.
- **Borrado:** conservar scanner y checks; separar política por proceso.

### API-005 — Paginación e índices requieren evidencia de volumen

- **Prioridad:** Media/futura.
- **Evidencia:** las listas usan `COUNT(*)` y paginación `OFFSET`; la migración
  cubre bien scope/fecha/tipo, pero no todos los sorts disponibles.
- **Impacto:** páginas profundas y orden por total/creación pueden degradarse al
  crecer por tenant.
- **Acción:** no agregar índices especulativos. Capturar `EXPLAIN (ANALYZE,
  BUFFERS)` con volumen representativo y migrar a cursor cuando el SLO lo exija.
- **Borrado:** ninguno por ahora.

## Evaluación por área

| Área | Veredicto actualizado | Acción |
| --- | --- | --- |
| `apps/api` CFDI | Vertical coherente y funcional; unidades demasiado grandes | Conservar capacidades y refactorizar límites internos |
| Base de datos | Buen aislamiento, constraints y procedencia; persistencia chatty | Mantener migraciones, agregar bulk inserts y planes `EXPLAIN` |
| Object storage | S3/port plenamente justificados | Mantener; reevaluar filesystem sólo con MinIO obligatorio |
| Malware scanner | Justificado por procesamiento y redistribución del original | Mantener; separar readiness por proceso |
| Redis | Optimización opcional correctamente subordinada a PostgreSQL | Mantener mientras siga degradando a polling |
| Infra/CI | Cobertura valiosa, orquestador monolítico y gate no evolutivo | Dividir validaciones por responsabilidad/fase |
| Deploy | Simplificado después del cutover | Mantener el rollout en `deploy-dev.yml` y el provisioning en Terraform/Ansible |
| Documentación | Mucha evidencia, autoridad poco clara | Borrar un prompt, archivar snapshots y nombrar una autoridad |
| Tests | Amplios y relevantes | Mantener cobertura; compartir helpers y separar tiempos de ejecución |

## Orden recomendado

1. Corregir el check requerido y sincronizar la PR con el head actual de
   `codex/cfdis`.
2. Aplicar el estado **SE NECESITA BORRAR — ANTES DEL MERGE** al prompt maestro.
3. Marcar/mover documentos históricos sin perder la especificación de producto.
4. Separar parser, upload y persistencia en unidades internas menores.
5. Cambiar persistencia de hijos a inserts por lotes y medir el peor XML
   permitido.
6. Dividir readiness de API y worker.
7. No iniciar ZIP/SAT hasta que el gate, la modularidad y la persistencia estén
   estabilizados.
8. Mantener cerrado ARC-002: no recrear wrappers de despliegue ni mover
   provisioning de Terraform/Ansible al repositorio de la aplicación.

## Fortalezas que se deben preservar

- monolito modular NestJS con procesos API/worker separados;
- PostgreSQL como autoridad durable y Redis sólo como wakeup;
- `FORCE RLS`, contexto transaccional y FKs compuestas por tenant;
- idempotencia y deduplicación respaldadas por constraints/advisory locks;
- almacenamiento S3 privado, keys opacas y verificación repetida de hash/tamaño;
- scanner fail-closed y parser sin DTD, entidades ni red;
- XSD SAT locales con manifiesto de integridad;
- fencing de lease antes de publicar dominio fiscal;
- acceso temporal de un uso al original, ligado a sesión/MFA;
- errores, auditoría y logs sin contenido XML fiscal;
- tests de concurrencia, reinicio, tenant, malware y storage real.

## Conclusión

La recomendación original de borrar gran parte de Fase 0 ya no aplica después
de revisar la PR 18. Esos componentes dejaron de ser una plataforma futura y
ahora forman una vertical XML end-to-end.

La reducción correcta es selectiva: borrar el prompt de implementación, retirar
los scripts exclusivos del cutover cuando su ciclo termine, archivar snapshots
y simplificar unidades grandes. Borrar worker, Redis, S3, ClamAV, RLS,
migraciones, manifiesto o pruebas reduciría la robustez real del producto y
obligaría a reconstruir garantías que la Fase 1 ya utiliza.
