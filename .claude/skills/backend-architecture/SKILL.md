---
name: backend-architecture
description: Arquitectura, estándares y flujos para el backend NestJS (apps/api). Usar cuando se cree, revise o modifique código en apps/api/, especialmente módulos NestJS, entidades TypeORM, DTOs, servicios, controladores, permisos, migraciones, seeds, base de datos, file upload, auth, configuración o refactors backend.
---

# NestJS Backend Guide (apps/api)

## Objetivo

Antes de modificar el backend, leer y cumplir `../../../AGENTS.md` y
`../../../apps/api/AGENTS.md`. Para arquitectura, datos, seguridad, contratos o revisión, leer las
secciones relevantes de `../../../docs/architecture/ARCHITECTURE.md`.

No mantengas aquí una fotografía del estado de la API: el código y sus pruebas son la evidencia
actual. Esta skill sólo enruta a las reglas versionadas y obliga a inspeccionar el módulo existente
más parecido antes de elegir una estructura.

No generes ni ejecutes migraciones, seeds o acciones sobre servicios externos salvo solicitud
explícita. Valida el cambio con los comandos exigidos por `apps/api/AGENTS.md`.
