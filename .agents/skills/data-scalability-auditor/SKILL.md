---
name: data-scalability-auditor
description: "Audita PostgreSQL, TypeORM y Redis en este proyecto: integridad relacional y por tenant, migraciones, seeds, índices, consultas, paginación, concurrencia, caché, crecimiento, retención y planes EXPLAIN. Úsala mensualmente o cuando cambien entidades o migraciones. Distingue problemas actuales, riesgos futuros razonables y optimizaciones prematuras; no la uses para una revisión general de arquitectura, seguridad o estilo NestJS."
---

# Data Scalability Auditor

Realiza una auditoría de solo lectura sobre integridad, rendimiento y crecimiento de PostgreSQL, TypeORM y Redis. Entrega un reporte Markdown basado en consultas y flujos reales; no implementes cambios durante la auditoría.

## Principio de clasificación

Clasifica cada observación antes de recomendar trabajo:

- **Problema actual demostrado**: existe un fallo reproducible, una consulta real problemática, un plan verificable, una violación posible de integridad o una métrica operativa que demuestra impacto presente.
- **Riesgo futuro razonable**: el código ya contiene el camino de crecimiento o contención, pero el impacto depende de cardinalidad, tráfico o tiempo. Declara las condiciones que lo activarían y propone medición o umbral.
- **Optimización prematura**: no existe consulta, volumen, patrón de acceso ni evidencia que justifique el cambio. No la presentes como deuda; registra por qué no conviene actuar todavía.

No conviertas posibilidades genéricas de PostgreSQL o Redis en hallazgos del proyecto.

## Frontera con otros auditores

- Revisa aquí constraints, consultas, planes, transacciones, locks, migraciones, almacenamiento y caché.
- Deriva IDOR, bypass de tenant o explotación de datos a `$security-auditor`; conserva aquí únicamente la garantía de integridad o eficiencia de la capa de datos.
- Deriva límites sistémicos y ownership de datos a `$architecture-auditor`.
- Deriva uso idiomático de repositorios o testabilidad de servicios, sin impacto de datos o escala, a `$nestjs-quality-auditor`.

No dupliques el mismo defecto en varios reportes.

## Alcance del proyecto

Revisa entidades, migraciones, seeds, configuración y servicios bajo `apps/api`, además de manifiestos y tests relevantes. Examina Redis, sesiones, rate limits, auditoría y cualquier tabla o keyspace con crecimiento continuo.

Respeta cualquier `AGENTS.md` aplicable. Registra el estado Git para distinguir cambios locales. La única escritura permitida es crear el reporte solicitado; no alteres esquemas, datos, cachés, entidades, migraciones, seeds ni configuración.

## Cobertura obligatoria

### Integridad y aislamiento de tenant

- Foreign keys, tipos compatibles, nulabilidad y acciones `ON DELETE`/`ON UPDATE` deliberadas.
- `CHECK`, `UNIQUE`, exclusiones y constraints parciales que respalden invariantes reales.
- Semántica de `NULL` en uniques e índices parciales.
- Relaciones por tenant que impidan referencias cruzadas, incluyendo FKs compuestas cuando la invariante lo requiera.
- Correspondencia entre decorators TypeORM, migraciones aplicadas y esquema esperado; no asumas que `synchronize` crea producción.

No exijas constraints duplicados si una garantía equivalente ya existe. Deriva cualquier camino explotable entre tenants a `$security-auditor`.

### Migraciones y seeds

- `up` y `down` coherentes cuando la reversión sea segura; identifica explícitamente transformaciones irreversibles.
- Cambios compatibles con despliegues graduales: expandir, backfill controlado, cambiar lectores/escritores y contraer.
- Riesgo de locks prolongados, table rewrites, defaults costosos, validación de constraints e índices en tablas grandes.
- Uso correcto de transacciones; recuerda que operaciones como índices concurrentes requieren tratamiento especial.
- Backfills reanudables, acotados e idempotentes cuando el volumen lo justifique.
- Seeds repetibles sin duplicar filas, cambiar IDs estables ni destruir datos administrados por usuarios.
- Ciclo limpio `up → seed → down → up` únicamente sobre una base efímera y aislada.

No ejecutes migraciones o seeds contra una base compartida. Inspecciona cualquier script de QA antes de ejecutarlo y confirma que crea su propio entorno desechable.

### Consultas, índices y paginación

- Relaciona cada índice propuesto con predicates, joins y `ORDER BY` de consultas reales.
- Comprueba orden de columnas, selectividad, índices parciales, cobertura y duplicación con PKs o uniques existentes.
- Considera el coste de escritura y almacenamiento; más índices no implican mejor rendimiento.
- Detecta N+1 siguiendo loops, lazy/eager relations, resolvers y llamadas repetidas a repositorios.
- Detecta listados sin límite, límites controlados por el cliente sin máximo y cargas completas para filtrar en memoria.
- Exige orden determinista para paginación, con desempate único.
- Recomienda keyset/cursor frente a offset solo cuando profundidad, volumen o estabilidad lo justifiquen.
- Revisa conteos, joins, selects excesivos, round trips y materialización innecesaria de entidades.

Una base local pequeña no demuestra que una consulta escale. Separa evidencia del código, plan del optimizador y métricas reales.

### Concurrencia y locks

- Identifica read-modify-write, lost updates, check-then-insert y decisiones concurrentes sobre la misma invariante.
- Prefiere constraint o sentencia atómica cuando resuelva el problema antes de introducir locks de aplicación.
- Revisa límites de transacción, orden consistente de locks, duración y trabajo externo dentro de la transacción.
- Evalúa optimistic locking/version columns cuando los conflictos sean infrecuentes y detectables.
- Evalúa pessimistic locking cuando deba serializarse una decisión corta sobre filas conocidas.
- Busca deadlocks plausibles, retries ausentes y locks que no cubran todas las filas o caminos competidores.

No recomiendes locking sin describir la carrera concreta, la intercalación de operaciones y el estado incorrecto resultante.

### Redis, sesiones y caché

- Convención y cardinalidad de keys, aislamiento de ambientes/tenants y tamaño de valores serializados.
- TTL presente, unidad correcta, renovación deliberada y expiración de sesiones alineada con la fuente autoritativa.
- Invalidación en escrituras, logout, cambios de permisos y borrados; detecta datos obsoletos observables.
- Cache stampede, escrituras concurrentes, negative caching y tolerancia a Redis caído cuando sean relevantes.
- Uso de comandos bloqueantes o de cardinalidad completa; no ejecutes `KEYS` en un entorno compartido.
- Política de eviction, memoria máxima y persistencia solo si están disponibles en configuración o métricas.
- Evita guardar payloads de sesión o caché mayores de lo necesario; estima tamaño con datos representativos, no con intuición.

No propongas Redis para datos que PostgreSQL resuelve adecuadamente sin evidencia de latencia o carga.

### Crecimiento y ciclo de vida

- Identifica tablas y keyspaces append-only o de alta rotación: auditoría, sesiones, tokens, intentos, jobs y eventos.
- Estima crecimiento solo con una tasa o supuesto declarado; no inventes tráfico.
- Revisa jobs o políticas de expiración, retención, archivado, particionado y borrado por lotes.
- Considera impacto de deletes masivos, vacuum, bloat, índices y restauración.
- Recomienda particionado o archivado únicamente cuando volumen, ventana operativa o patrón de consulta lo justifiquen.

## Uso seguro de EXPLAIN

- Empieza con `EXPLAIN` sin `ANALYZE`; guarda SQL parametrizado y valores representativos sin PII.
- Usa `EXPLAIN (FORMAT JSON)` cuando facilite comparar estimaciones y nodos.
- `EXPLAIN ANALYZE` ejecuta la consulta. Úsalo solo con autorización explícita, sobre `SELECT` segura, en entorno local o réplica apropiada, con límites y timeout.
- Nunca ejecutes `EXPLAIN ANALYZE` sobre escrituras ni consultas potencialmente costosas en producción.
- Registra versión de PostgreSQL, estadísticas, cardinalidad y entorno. No extrapoles un plan de una base vacía a producción.
- Si no hay acceso seguro a la base, entrega la consulta exacta a medir y qué nodos, filas estimadas/reales, buffers y tiempos deberían revisarse.

## Método de auditoría

1. Registra rama, commit, fecha, alcance, versiones visibles y fuentes de evidencia disponibles.
2. Mapea entidades contra migraciones y sigue constraints, índices y relaciones por tenant.
3. Traza consultas desde controllers/jobs hasta TypeORM y SQL, incluidos límites, orden y cardinalidad resultante.
4. Revisa cada migración y seed de forma secuencial; busca dependencias entre versiones y operaciones no reanudables.
5. Traza flujos concurrentes y de caché desde la fuente autoritativa hasta creación, lectura, invalidación y expiración.
6. Ejecuta solo comprobaciones read-only o sobre infraestructura efímera confirmada. No uses migraciones, seeds, locks ni comandos Redis mutantes en entornos compartidos.
7. Valida cada conclusión con callers, consultas, constraints, tests, planes o métricas. Registra qué no pudo verificarse.
8. Revisa `git status` al terminar y no dejes artefactos tracked modificados.

## Severidad y acción

- **Alta**: integridad incorrecta, migración con riesgo serio de indisponibilidad/pérdida, contención crítica o crecimiento actualmente insostenible.
- **Media**: degradación demostrada o riesgo futuro con activadores próximos y coste relevante.
- **Baja**: impacto acotado pero medible, o riesgo futuro que conviene instrumentar.
- **Sin acción**: optimización prematura. Indica la señal o umbral que justificaría reabrirla.

La clasificación temporal y la severidad son ejes distintos: un riesgo futuro puede ser alto si su activador es concreto y próximo, pero debe conservarse como riesgo, no presentarse como incidente actual.

## Formato del reporte

Guarda el resultado en la ruta solicitada. Si no se indica una, usa `docs/data/DATA_SCALABILITY_AUDIT_<YYYY-MM-DD>.md` sin sobrescribir un reporte existente.

```markdown
# Auditoría de datos y escalabilidad — <fecha o alcance>

## Resumen ejecutivo
<estado actual, riesgos principales y optimizaciones descartadas>

## Alcance y línea base
- Rama/commit:
- PostgreSQL/TypeORM/Redis observados:
- Datos, planes o métricas disponibles:
- Verificaciones ejecutadas:
- Limitaciones:

## Hallazgos

### DS-001 — <título>
- **Clasificación:** Problema actual demostrado | Riesgo futuro razonable
- **Área:** Integridad | Migración | Seed | Índice/Consulta | Paginación | Concurrencia | Redis | Crecimiento/Retención
- **Error o riesgo:**
- **Severidad:** Alta | Media | Baja
- **Evidencia:** `<archivo>:<línea>`, consulta, plan o métrica
- **Condición de activación:** <actual o umbral futuro>
- **Impacto:**
- **Posible fix:** <cambio mínimo o instrumentación>
- **Cómo verificar:** <constraint, test concurrente, métrica o EXPLAIN seguro>

## Optimizaciones prematuras descartadas
| Propuesta | Por qué no se justifica ahora | Señal para reconsiderarla |
|---|---|---|

## Derivaciones
| Destino | Evidencia | Motivo |
|---|---|---|

## Fortalezas que conviene preservar
<constraints, consultas y políticas de datos correctas>

## Cobertura pendiente
<datos, métricas o entornos que faltaron>
```

No incluyas optimizaciones prematuras dentro de hallazgos accionables. Ordena problemas actuales antes que riesgos futuros y prioriza integridad sobre velocidad.

## Frecuencia recomendada

Ejecuta esta auditoría mensualmente y cuando cambien entidades, migraciones, seeds, consultas críticas o políticas de Redis. Esta skill no programa la recurrencia por sí sola.

## Criterio de finalización

Finaliza cuando hayas cubierto integridad, migraciones, seeds, consultas, concurrencia, Redis y crecimiento; clasificado toda recomendación; documentado límites de evidencia y generado el reporte. No implementes fixes salvo una solicitud posterior y explícita.
