---
name: nestjs-quality-auditor
description: "Audita calidad de implementación y buenas prácticas específicas de NestJS: módulos, providers, DI, controllers, servicios, request lifecycle, configuración, excepciones, async, transacciones, TypeORM, duplicación y testabilidad. Úsala para una revisión semanal o al completar un módulo. No la uses para riesgos arquitectónicos sistémicos, vulnerabilidades ni estilo superficial."
---

# NestJS Quality Auditor

Realiza una auditoría de solo lectura sobre la calidad idiomática del backend NestJS. Entrega un reporte Markdown con problemas concretos, evidencia y fixes mínimos; no implementes correcciones durante la auditoría.

## Frontera con otros auditores

Mantén los hallazgos separados:

- Revisa con esta skill problemas locales de composición NestJS, DI, ciclo de request, persistencia, asincronía, duplicación y testabilidad.
- Deriva decisiones sistémicas sobre límites de dominios, arquitectura objetivo o acoplamiento transversal a `$architecture-auditor`.
- Deriva autenticación, autorización, aislamiento de tenant, secretos, PII, inyección y cualquier vector explotable a `$security-auditor`.
- No dupliques el mismo problema en varias categorías. Si existe una dimensión local de calidad independiente, reporta solo esa dimensión y registra la derivación por separado.

No reportes formato, preferencias de nombres, orden de imports, cobertura por porcentaje ni patrones alternativos equivalentes sin impacto demostrable.

## Alcance del proyecto

Revisa principalmente `apps/api/src` y sus tests. Consulta configuración raíz, manifiestos o consumidores de `apps/web` únicamente cuando ayuden a comprobar el contrato del backend.

Respeta cualquier `AGENTS.md` aplicable. Inspecciona el estado Git y no atribuyas cambios locales al código consolidado. La única escritura permitida es el reporte solicitado; no edites fuente, tests, configuración ni dependencias.

## Cobertura obligatoria

### Módulos y providers

- Cohesión de `imports`, `providers`, `controllers` y `exports`.
- Providers registrados en el módulo que posee la responsabilidad.
- Exports mínimos y dependencias explícitas entre módulos.
- Registro duplicado que produzca instancias distintas sin intención.
- Providers globales, módulos `@Global()` o configuración global sin necesidad observable.
- `forwardRef`, imports cruzados y ciclos directos o indirectos.

No propongas dividir módulos únicamente por tamaño. Exige responsabilidades distintas, dependencias problemáticas o dificultad real de prueba y cambio.

### Inyección de dependencias

- Inyección por constructor y tokens estables cuando exista una frontera real.
- Clases creadas manualmente con `new` que deberían ser administradas por Nest.
- Uso de `ModuleRef`, service locator, estado estático o singletons manuales que oculten dependencias.
- Scopes `DEFAULT`, `REQUEST` o `TRANSIENT` coherentes con el estado y coste del provider.
- Interfaces, factories, ports o tokens con una sola implementación sin valor actual.

No exijas interfaces para cada servicio ni abstracciones especulativas para facilitar mocks.

### Controllers y servicios

- Controllers limitados a transporte: entrada, decorators, DTO, delegación y respuesta.
- Ausencia de acceso directo a repositorios, reglas de negocio extensas o coordinación compleja en controllers.
- Servicios con una responsabilidad reconocible y dependencias relacionadas.
- Separación de orquestación, persistencia y adaptadores externos solo cuando reduzca acoplamiento o permita pruebas útiles.
- Métodos duplicados, variantes divergentes del mismo flujo y helpers sin dueño claro.

### Ciclo de request de NestJS

- Uso adecuado y orden efectivo de middleware, guards, interceptors, pipes y exception filters.
- Registro global mediante APIs o tokens de Nest cuando se necesite DI.
- Pipes para transformación y validación de entrada, no para reglas de negocio con efectos laterales.
- Guards para decisiones de acceso, interceptors para concerns alrededor de la ejecución y filters para traducción consistente de excepciones.
- Middleware limitado a responsabilidades previas al routing que no requieran contexto más específico.

Reporta el mecanismo incorrecto solo cuando cause duplicación, bypass del lifecycle, DI rota, respuestas inconsistentes o dificultad concreta de prueba.

### Configuración y excepciones

- Variables de entorno validadas al arrancar y configuración agrupada por responsabilidad.
- Acceso tipado con defaults deliberados; evita casts y strings de configuración dispersos que oculten errores.
- Dependencias de configuración inyectables y fáciles de sustituir en tests.
- Excepciones de infraestructura, aplicación y HTTP traducidas en un borde consistente.
- Errores no tragados, no remapeados repetidamente y con preservación útil de causa.
- Filters que respeten excepciones conocidas y mantengan un contrato de respuesta estable.

No conviertas una preferencia por una biblioteca de configuración o jerarquía de errores en hallazgo.

### Async, transacciones y TypeORM

- Promesas esperadas o retornadas; errores de tareas deliberadamente desacopladas observados y gestionados.
- Paralelismo solo para operaciones independientes y secuenciación cuando exista dependencia.
- Transacciones con límites de negocio claros y sin usar repositorios fuera del `EntityManager` transaccional.
- Efectos externos coordinados conscientemente con el commit; señala estados parciales reproducibles.
- Repositorios obtenidos mediante `@InjectRepository` o el manager correcto, sin instanciación manual.
- Query builders parametrizados, legibles y sin joins, selects o round trips duplicados innecesarios.
- Operaciones de lectura/escritura con semántica TypeORM correcta y resultados comprobados cuando importa distinguir ausencia de éxito.

Deriva inyección explotable a `$security-auditor`; aquí conserva únicamente el problema de uso o testabilidad de TypeORM si es independiente.

### Testabilidad

- Servicios construibles en `TestingModule` sin arrancar toda la aplicación ni conectarse a infraestructura real.
- Dependencias externas, reloj, aleatoriedad y efectos laterales controlables cuando una prueba determinista realmente los necesita.
- Lógica importante ejercitable sin fabricar objetos de framework innecesarios.
- Tests que validen comportamiento y contratos, no detalles privados ni wiring trivial.
- Ausencia de pruebas solo como evidencia complementaria de una rama riesgosa; nunca como hallazgo autónomo.

## Método de auditoría

1. Registra rama, commit, fecha, alcance e instrucciones aplicables.
2. Mapea módulos, imports, providers, exports, controllers, globals y tokens `APP_*`.
3. Selecciona servicios representativos y sigue sus callers, dependencias, repositorios, transacciones y tests.
4. Comprueba cómo se registran y ejecutan guards, pipes, filters, interceptors y middleware; no concluyas solo por nombres de archivos.
5. Busca patrones sospechosos con `rg`, pero valida cada coincidencia en contexto y revisa todas sus rutas de uso.
6. Ejecuta únicamente builds, type-checks o tests que no modifiquen archivos tracked. Inspecciona scripts antes de usarlos: en este proyecto `lint` y `format` escriben cambios y no deben ejecutarse durante la auditoría.
7. Revisa `git status` al terminar y registra comandos fallidos o cobertura no disponible.

## Evidencia y severidad

Un hallazgo requiere archivo y línea, comportamiento o dependencia observada, impacto concreto y un fix proporcional. Evita métricas rígidas de tamaño o complejidad como única prueba.

- **Alta**: puede producir fallos de ejecución, corrupción o estados parciales, instancias incorrectas de providers o regresiones frecuentes en múltiples flujos.
- **Media**: responsabilidad, acoplamiento o uso de NestJS/TypeORM que encarece cambios y pruebas de forma demostrable.
- **Baja**: defecto local con fricción real y fix claro. Omite observaciones cosméticas o puramente opinables.

## Formato del reporte

Guarda el resultado donde indique el usuario. Si no proporciona una ruta, usa `docs/quality/NESTJS_QUALITY_AUDIT_<YYYY-MM-DD>.md` sin sobrescribir un archivo existente.

```markdown
# Auditoría de calidad NestJS — <fecha o alcance>

## Resumen ejecutivo
<estado, riesgo de mantenibilidad y conteo por severidad>

## Alcance y línea base
- Rama/commit:
- Módulos revisados:
- Verificaciones ejecutadas:
- Limitaciones:

## Hallazgos

### NQ-001 — <título>
- **Categoría:** Módulos | DI | Controller | Servicio | Lifecycle | Configuración | Excepciones | Async/Transacción | TypeORM | Duplicación | Testabilidad
- **Error:** <comportamiento o estructura problemática>
- **Severidad:** Alta | Media | Baja
- **Evidencia:** `<archivo>:<línea>` y flujo o dependencia comprobada
- **Impacto:** <fallo, regresión, acoplamiento o coste de prueba>
- **Posible fix:** <cambio mínimo, sin implementarlo>
- **Cómo verificar:** <test, build o condición observable>

## Derivaciones
| Destino | Evidencia | Motivo de la derivación |
|---|---|---|
| `$architecture-auditor` o `$security-auditor` | `<archivo>:<línea>` | <por qué está fuera de alcance> |

## Fortalezas que conviene preservar
<usos idiomáticos y decisiones que facilitan evolución o pruebas>

## Cobertura pendiente
<módulos o comportamientos que no pudieron validarse>
```

Ordena hallazgos por severidad y dependencia del fix. Si no existen problemas de calidad demostrables, dilo y documenta qué se revisó. Las derivaciones no son hallazgos confirmados de arquitectura o seguridad: son entradas para que el auditor especializado las valide.

## Frecuencia recomendada

Ejecuta esta auditoría semanalmente o al completar un módulo NestJS. Esta skill no programa la recurrencia por sí sola.

## Criterio de finalización

Finaliza cuando hayas revisado todas las áreas obligatorias dentro del alcance, validado cada hallazgo, separado derivaciones y generado el reporte. No implementes fixes salvo una solicitud posterior y explícita.
