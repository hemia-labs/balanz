---
name: architecture-auditor
description: "Audita la arquitectura sistémica de este monorepo NestJS y Next.js: límites de módulos, acoplamiento, capas, responsabilidades transversales, divergencia documental, escalabilidad y abstracciones innecesarias. Úsala para una revisión arquitectónica completa, el control mensual o después de incorporar un módulo grande. No la uses para formato, estilo, bugs aislados ni una revisión general de PR."
---

# Architecture Auditor

Realiza una auditoría arquitectónica de solo lectura y entrega un reporte Markdown respaldado por evidencia. Concéntrate en decisiones sistémicas; omite observaciones cosméticas o locales que no tengan impacto arquitectónico.

## Alcance del proyecto

Revisa el sistema completo cuando sea relevante:

- `apps/api`: módulos NestJS, composición, proveedores, persistencia, flujos y responsabilidades transversales.
- `apps/web`: límites por feature, acceso a la API y dependencias que condicionen la arquitectura del backend.
- `docs`: arquitectura declarada, decisiones existentes y diferencias con la implementación.
- Configuración raíz: workspace, dependencias compartidas, scripts y límites del monorepo.

Respeta cualquier `AGENTS.md` aplicable. No modifiques código, configuración, documentación existente ni estado externo salvo que el usuario lo solicite por separado.

## Preguntas obligatorias

Evalúa, como mínimo:

1. ¿Los módulos NestJS representan capacidades de negocio claras y exponen contratos mínimos?
2. ¿Existen ciclos, imports cruzados, servicios centrales crecientes o acceso directo a detalles internos de otro módulo?
3. ¿Controllers, servicios de aplicación, dominio y adaptadores de infraestructura tienen responsabilidades diferenciadas?
4. ¿Auth, autorización, auditoría, Redis, sesiones, secretos, configuración, errores y observabilidad tienen un dueño claro y una política consistente?
5. ¿La arquitectura documentada coincide con módulos, dependencias, flujos y despliegue reales?
6. ¿Agregar un nuevo dominio obliga a modificar módulos no relacionados o duplicar decisiones?
7. ¿Hay abstracciones especulativas, wrappers sin valor, puertos duplicados o implementaciones paralelas de la misma política?
8. ¿Las decisiones actuales soportan concurrencia, múltiples instancias, evolución del esquema, fallos parciales y crecimiento del equipo?

## Método de auditoría

### 1. Establecer la línea base

- Lee instrucciones del repositorio, documentación arquitectónica, manifiestos y configuración.
- Registra rama, commit y fecha auditados cuando Git esté disponible.
- Inspecciona el estado del working tree y no atribuyas cambios locales al código consolidado.
- Si el usuario define una base de comparación, diferencia problemas preexistentes de riesgos introducidos.

### 2. Construir el mapa real

- Localiza módulos, controllers, providers, guards, interceptors, entidades, repositorios, adaptadores y configuración.
- Traza imports y exports entre módulos; identifica ciclos directos e indirectos.
- Localiza dependencias hacia Redis, base de datos, secretos, correo, autenticación y APIs externas.
- Contrasta el mapa con los documentos del proyecto.
- Usa búsquedas dirigidas con `rg`; no concluyas solo por nombres de archivos o directorios.

### 3. Trazar flujos representativos

Sigue al menos un flujo completo por capacidad crítica disponible, incluyendo autenticación, registro o aprovisionamiento, sesión/autorización y una operación principal de negocio. Recorre entrada HTTP, validación, aplicación, persistencia, efectos laterales y respuesta.

### 4. Validar cada hallazgo

Un hallazgo requiere:

- Evidencia concreta con archivo y línea, o relación verificable entre componentes.
- Explicación del mecanismo que produce el riesgo.
- Impacto sistémico o coste de evolución; no basta una preferencia de diseño.
- Arquitectura objetivo proporcionada al tamaño y necesidades observables del proyecto.
- Un fix viable, preferentemente incremental, con sus principales tradeoffs.

Descarta hipótesis que no puedan sostenerse al revisar callers, providers, módulos y pruebas. Declara incertidumbre o evidencia faltante en vez de inventar una conclusión.

### 5. Verificar sin mutar

Ejecuta solo comprobaciones de solo lectura y proporcionales al riesgo. Prioriza builds, type-checks y tests relevantes. No ejecutes scripts con `--fix`, migraciones contra entornos compartidos ni comandos destructivos. Registra qué se ejecutó, qué falló y qué no pudo verificarse.

## Severidad

- **Crítica**: compromete aislamiento, integridad o disponibilidad del sistema, o bloquea de forma inmediata su operación segura.
- **Alta**: defecto sistémico con alta probabilidad de regresiones, fallos entre dominios o crecimiento riesgoso.
- **Media**: deuda arquitectónica real que encarece cambios o escala, pero admite mitigación y evolución incremental.
- **Baja**: solo si existe impacto arquitectónico demostrable. No reportes estilo, formato, nombres o microoptimizaciones.

Prioriza severidad por impacto y probabilidad, no por el tamaño del cambio propuesto.

## Contrato del reporte

Entrega el reporte directamente en la respuesta por defecto. Sólo crea un archivo si el usuario lo solicita explícitamente o proporciona una ruta. Si debe crearse un archivo y no se indica una ruta, usa `docs/architecture/ARCHITECTURE_AUDIT_<YYYY-MM-DD_HHmmss>.md`; si el nombre ya existe, agrega un sufijo incremental (`_2`, `_3`, etc.). Nunca sobrescribas un archivo existente.

Usa esta estructura:

```markdown
# Auditoría de arquitectura — <fecha o alcance>

## Resumen ejecutivo
<estado actual y conclusión>

## Alcance y línea base
- Rama/commit:
- Áreas revisadas:
- Verificaciones ejecutadas:
- Limitaciones:

## Estado actual
<mapa breve de módulos, capas, flujos y dependencias transversales>

## Riesgo arquitectónico global
<nivel y justificación>

## Hallazgos

### ARC-001 — <título del error o riesgo>
- **Error:** <decisión o estructura problemática>
- **Severidad:** Crítica | Alta | Media | Baja
- **Evidencia:** `<archivo>:<línea>` y relación observada
- **Impacto sistémico:** <por qué afecta al sistema o a su evolución>
- **Posible fix:** <cambio incremental y tradeoffs>
- **Arquitectura objetivo:** <estado deseado concreto>

## Arquitectura objetivo
<dirección recomendada, límites y responsabilidades; incluye un diagrama Mermaid solo si aclara relaciones complejas>

## Top 5 decisiones recomendadas
1. <decisión ordenada por impacto/dependencias>

## ADRs que deberían crearse
| ADR propuesto | Decisión que debe fijar | Motivo | Prioridad |
|---|---|---|---|

## Fortalezas que conviene preservar
<decisiones sanas que no deben perderse durante el cambio>
```

Ordena hallazgos por severidad y dependencia de resolución. Si no hay cinco decisiones justificadas, entrega menos; no rellenes la lista. Si no encuentras problemas sistémicos, dilo explícitamente y documenta la evidencia revisada.

## Arquitectura objetivo y recomendaciones

- Prefiere evolución incremental sobre reescrituras completas.
- Mantén NestJS idiomático: módulos cohesionados, providers con dependencias explícitas, contratos estrechos y composición en el borde.
- No impongas DDD, CQRS, microservicios, event sourcing, repositorios genéricos ni buses de eventos sin una presión concreta que los justifique.
- Señala cuándo eliminar o consolidar una abstracción es mejor que crear otra.
- Separa decisiones reversibles de decisiones costosas o difíciles de revertir.
- Propón ADRs para decisiones transversales o duraderas, no para detalles de implementación.

## Frecuencia recomendada

Ejecuta la auditoría mensualmente o después de integrar un módulo grande, cambiar fronteras de dominio o modificar infraestructura transversal. Esta skill no crea una automatización recurrente por sí sola.

## Criterio de finalización

Finaliza cuando hayas trazado los límites y flujos críticos, contrastado documentación e implementación, validado cada hallazgo y generado el reporte completo. No implementes fixes durante la misma ejecución salvo petición explícita.
