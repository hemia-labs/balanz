# Instrucciones del backend

Hereda las reglas de `../../AGENTS.md`. Para cambios en `apps/api`, consulta las secciones
relevantes de `../../docs/architecture/ARCHITECTURE.md`; el código y las pruebas vigentes son la
evidencia del estado actual.

- Mantén el monolito modular organizado por capacidad de negocio en `src/modules/<feature>`.
- Reutiliza un módulo y patrón existente antes de crear carpetas o capas. Ninguna subcarpeta es
  obligatoria si no tiene contenido real.
- Controllers: contrato HTTP, DTOs, guards y delegación. Sin queries ni reglas de negocio.
- Services: reglas del caso de uso, transacciones y coordinación. Usa TypeORM directamente; no
  agregues repositorios que sólo deleguen sus métodos.
- Crea ports/adapters únicamente para una frontera externa real o una sustitución que exista hoy.
- Obtén tenant y membresía de la sesión autenticada, nunca del body o query del cliente. Toda
  operación tenant-scoped debe aplicar ese contexto.
- Usa DTOs de entrada y respuestas explícitas; no expongas entidades, secretos ni PII.
- Protege invariantes con constraints y migraciones. Usa transacciones y locks cuando exista una
  carrera real; los efectos externos ocurren después del commit.
- PostgreSQL conserva el estado durable. Redis sólo puede acelerar cache o wakeups con fallback.
- No ejecutes migraciones, seeds, mantenimiento ni pruebas externas contra servicios reales sin
  solicitud explícita.

Validación mínima:

```bash
bun run --cwd apps/api lint
bun run --cwd apps/api test --runInBand
bun run --cwd apps/api build
```
