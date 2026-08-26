# Reporte de implementación del módulo de clientes

## Identificación

- Fecha: 2026-08-26.
- Branch: `codex/refactor-ux-ui`.
- SHA base: `f2b5ed0b298347c138f6fbdd2bf91710ffd4517d`.
- Estado: implementación y validación pre-PR terminadas. Migraciones, seed,
  lifecycle efímero, unitarias, E2E, lint y builds pasan. Evidencia detallada en
  [`../qa/CLIENTS_MODULE_DEVELOPMENT_VALIDATION_REPORT.md`](../qa/CLIENTS_MODULE_DEVELOPMENT_VALIDATION_REPORT.md).

## Decisiones aplicadas

- El tenant sólo se obtiene de la sesión autenticada. Los DTOs tienen whitelist estricta y rechazan propiedades adicionales como `organizationId`, actor, timestamps o estado no permitido.
- El titular real se determina por `organizations.owner_user_id`; su scope se representa como `accountAccessMode = tenant` sin cargar una lista de cuentas. El resto de membresías usa `accountAccessMode = assigned` y debe tener una asignación activa comprobada en PostgreSQL.
- Las lecturas y mutaciones vuelven a validar el scope en base de datos. Las mutaciones sensibles repiten la validación dentro de la misma transacción y toman locks donde hay invariantes concurrentes.
- Los UUID se generan en la aplicación con `randomUUID()`. Las tablas nuevas no dependen de extensiones ni defaults UUID del motor.
- El borrado funcional es archivado o revocación; no se añadió reactivación ni cascadas amplias.
- El camino real de `/clients` consume exclusivamente la API. Los componentes demo continúan disponibles sólo bajo el modo demo existente.
- Se mantuvo fuera de alcance CFDI, SAT, e.firma, DIOT, IEPS y cualquier dato fiscal simulado.

## Seguridad y plataforma

- CSRF: `GET`, `HEAD` y `OPTIONS` son seguros; una mutación requiere un `Origin` exacto permitido o, si no hay `Origin`, un origen exacto obtenido de un `Referer` válido. Ausencia, URL malformada, host parecido o coincidencia por sufijo devuelve 403.
- CORS: desarrollo usa por defecto `http://localhost:3000`; producción conserva configuración explícita por entorno.
- Sesión deslizante: cada request válido avanza `lastActivityAt` en cache. La persistencia a PostgreSQL se limita mediante `AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS` (300 s por defecto), sin extender `expiresAt`, y se conservan los límites idle y absoluto.
- Correlation ID: middleware valida `x-correlation-id` como UUID o genera uno, lo expone en la respuesta, request, errores y logs, y lo propaga a auditoría mediante `AsyncLocalStorage`.
- Trust proxy: `TRUST_PROXY_HOPS` está tipado y validado; Express sólo lo habilita cuando el valor es mayor que cero.
- Cache: las mutaciones de asignaciones y el archivado invalidan las sesiones activas de las membresías afectadas por hashes exactos obtenidos de PostgreSQL, sin `KEYS` ni barridos globales.

## Migraciones creadas

### `1787690000000-IdentityIntegrity.ts`

Migración append-only con preflight de sólo lectura que aborta si encuentra huérfanos o identidades tenant inconsistentes. Añade:

- unicidad `(organization_id, id)` y `(organization_id, id, user_id)` en `memberships`;
- FK de owner de organización a usuario;
- FKs de membresía a organización y usuario;
- FKs de sesión a usuario, contexto tenant de membresía e identidad completa tenant/membresía/usuario;
- check de contexto tenant completo o totalmente nulo en sesiones;
- FKs de factores y tokens de correo a usuario;
- FK de suscripción a organización.

No se añadió una FK de auditoría que impidiera conservar evidencia histórica.

### `1787690100000-ClientAccountsDomain.ts`

Crea las cinco tablas del dominio:

| Tabla | Invariantes principales |
| --- | --- |
| `client_accounts` | Nombre normalizado, estado/fecha de archivo consistentes, `version`, código activo único por tenant. |
| `legal_entities` | Cadena tenant-cuenta por FK compuesta, RFC uppercase de 12/13 caracteres con regex, RFC activo único por tenant, `version`. |
| `account_assignments` | Cadena tenant-cuenta/membresía, responsabilidad `primary/collaborator/reviewer`, estado de revocación consistente, una asignación activa por miembro y un primary activo por cuenta. |
| `fiscal_years` | Cadena tenant-cuenta-entidad por FK compuesta, ejercicio único por entidad, rango DB 2000–2200, `version`. La aplicación limita además hasta año actual + 1. |
| `periods` | Cadena completa tenant-cuenta-entidad-ejercicio, mes 1–12 único por ejercicio y ocho estados fiscales explícitos. |

Los índices cubren listados por tenant/estado/actualización, búsqueda por nombre, RFC, asignaciones por membresía/cuenta, ejercicios por entidad/cuenta y períodos por ejercicio/estado/entidad. `synchronize` continúa deshabilitado.

Las migraciones se ejecutaron el 2026-08-26 en el entorno Vault `dev`, después de autorización explícita. El preflight de identidad pasó, ambas migraciones hicieron commit en una sola transacción y `showMigrations()` confirmó que no quedan pendientes. El seed idempotente dejó 27 permisos y 51 relaciones rol-permiso; después se invalidó la autorización cacheada de las membresías activas.

## Backend

### Módulo y contratos

Se añadió `ClientAccountsModule` con entidades TypeORM, DTOs, reglas, errores estables, mapeos explícitos, scope, servicios y controllers para cuentas, personas fiscales, asignaciones, ejercicios y períodos. Las respuestas son proyecciones explícitas; no se devuelven entidades TypeORM directamente.

Endpoints bajo el prefijo global existente de la API:

- `GET /client-accounts`
- `GET /client-accounts/available-primary-members`
- `POST /client-accounts`
- `GET /client-accounts/:clientAccountId`
- `PATCH /client-accounts/:clientAccountId`
- `DELETE /client-accounts/:clientAccountId`
- `GET /client-accounts/:clientAccountId/legal-entities`
- `POST /client-accounts/:clientAccountId/legal-entities`
- `PATCH /legal-entities/:legalEntityId`
- `DELETE /legal-entities/:legalEntityId`
- `GET /client-accounts/:clientAccountId/assignments`
- `GET /client-accounts/:clientAccountId/available-members`
- `POST /client-accounts/:clientAccountId/assignments`
- `DELETE /client-accounts/:clientAccountId/assignments/:assignmentId`
- `GET /legal-entities/:legalEntityId/fiscal-years`
- `POST /legal-entities/:legalEntityId/fiscal-years`
- `GET /fiscal-years/:fiscalYearId/periods`

La lista tiene paginación con máximo 100, orden estable y allowlist, búsqueda escapada y parametrizada, y sólo agrega la entidad fiscal primaria, asignación primaria, último ejercicio y estado del mes actual. No fabrica métricas fiscales.

### Permisos y defaults

Se añadieron:

- `fiscal_entities.view`
- `fiscal_entities.manage`
- `fiscal_years.view`
- `fiscal_years.manage`

`fiscal_entities.manage` y el permiso existente `clients.assign` requieren MFA. Los seeds son idempotentes y dejan estos defaults:

- owner: todos los permisos tenant;
- accountant: `clients.view`, `fiscal_entities.view` y `fiscal_years.view`, además de sus permisos operativos previos; no recibe `clients.manage` ni `clients.assign`;
- collaborator: los tres permisos de lectura;
- platform admin: no obtiene acceso tenant implícito.

Los controllers aplican, en orden, sesión, acceso tenant y permisos. El scope asignado nunca confía sólo en cache: consulta una asignación activa en la misma organización. Los recursos ajenos o no asignados se enmascaran como no encontrados cuando corresponde.

### Flujo atómico, auditoría y concurrencia

La creación inicial valida que el primary sea una membresía activa del mismo tenant con rol owner/accountant y, en una transacción, crea cuenta, primera persona fiscal, asignación primary, ejercicio, 12 períodos y cuatro eventos de auditoría. Devuelve los cuatro identificadores de servidor. Un fallo de auditoría revierte toda la transacción.

El reemplazo de primary bloquea y revoca las asignaciones activas necesarias antes de crear la nueva; la restricción parcial respalda la invariante. Se rechaza revocar el último primary con `LAST_PRIMARY_ASSIGNMENT`. El archivado de personas fiscales bloquea el conjunto activo y rechaza archivar la última. Las actualizaciones usan versión optimista. Las restricciones se traducen a códigos como `LEGAL_ENTITY_RFC_CONFLICT` y `FISCAL_YEAR_CONFLICT`.

La invalidación de las sesiones afectadas ocurre después del commit para no publicar un estado de cache previo a una transacción fallida.

La validación global devuelve `VALIDATION_ERROR` con status 422 y `fieldErrors` por ruta de campo. Los mensajes funcionales del módulo están traducidos a español y los errores 5xx nunca exponen detalles internos.

## Frontend

Se añadió `features/clients` con tipos, cliente de API basado únicamente en `apiClient` y pantallas vivas. La ruta real soporta:

- `/clients`
- `/clients/:accountId`
- `/clients/:accountId/settings`
- `/clients/:accountId/legal-entities/:legalEntityId/fiscal-years`
- `/clients/:accountId/legal-entities/:legalEntityId/fiscal-years/:year`
- `/clients/:accountId/legal-entities/:legalEntityId/fiscal-years/:year/periods/:month/:tab`

Las rutas fiscales legadas se conservan como redirects seguros: con una sola persona fiscal activa se redirige a su URL canónica; con varias se exige selección; nunca se elige un RFC arbitrariamente.

La cartera implementa estados loading/error/empty/success, búsqueda con debounce de 300 ms y `AbortController`, filtros/orden/página en URL, cancelación al cambiar tenant y recarga desde deep link. El modal controlado de alta carga candidatos reales, nombre, RFC, primary y ejercicio; bloquea doble envío, muestra pendiente y traduce conflictos RFC, 403 y requisito MFA.

El detalle separa cuenta, múltiples RFC, asignaciones, ejercicios y períodos. Incluye alta/edición/archivo de entidad fiscal, alta/reemplazo/revocación de asignaciones, creación de ejercicios y listado exacto de períodos. Las acciones se ocultan según los cuatro permisos de gestión. Las áreas CFDI/SAT/e.firma y demás módulos fuera de alcance no aparecen en el contexto real del cliente.

## Pruebas y validaciones

| Comando | Resultado | Cantidad/observación |
| --- | --- | --- |
| `bun run --cwd apps/api jest --runInBand --no-cache --testPathIgnorePatterns=e2e-spec` | PASS | 25 suites, 84 tests. El log controlado `provider down` pertenece a un fixture de `EmailService`; no es fallo. |
| `bun run --cwd apps/api test:e2e` | PASS | 3 suites, 14 tests; 10 cubren clientes, tenant, MFA, CSRF, concurrencia, rollback de auditoría, cache y archivo. |
| `bun run --cwd apps/api build` | PASS | Compilación Nest/TypeScript completa. |
| `bunx eslint "{src,apps,libs,test}/**/*.ts"` | PASS | Cero errores y cero warnings. La migración inicial ya aplicada tiene una exclusión exacta para no reescribirla. |
| Prettier `--check` sobre archivos API nuevos/modificados | PASS | Todos los archivos tocados usan el formato configurado. |
| `bun run --cwd apps/web lint` | PASS | Sin errores. |
| `bun run --cwd apps/web typecheck` | PASS | TypeScript sin errores. |
| `bun run --cwd apps/web test` | PASS | 13 tests, incluidas rutas multi-RFC, secciones de cliente y período activo. |
| `bun run --cwd apps/web build` | PASS | Build de producción Next.js 16. |
| `git diff --check` | PASS | Sin whitespace errors. |
| Migraciones y seed en Vault `dev` | PASS | Tres migraciones aplicadas, 27 permisos y 51 relaciones rol-permiso; sin pendientes. |
| `bun run --cwd apps/api qa:migrations` | PASS | Base temporal: apply desde cero, seed doble, rollback parcial/total, reapply y drift 0; base eliminada. |

Se agregaron pruebas unitarias para la matriz CSRF, correlation ID y auditoría, actividad deslizante e idle/absolute expiry, autorización owner/asignado, invalidación exacta de sesiones, DTOs y mass assignment, permisos default, RFC/rango fiscal, sorting, elegibilidad del primary, último primary y mapeo de constraints.

Las garantías estructurales de cross-tenant y concurrencia se comprobaron contra
PostgreSQL real mediante FKs/uniques compuestas, filtros tenant, revalidación
transaccional, locks y una carrera simultánea de RFC. Redis real participó en
la resolución e invalidación de sesiones de la suite E2E.

## Limitaciones reales

1. La máquina local usa Node 20.15.1, debajo del mínimo de TypeORM 1.0.0. El
   `package.json` ya exige una versión soportada y el CLI se verificó con Node
   22.19.0; desarrollo/CI deben actualizar su runtime.
2. `pg_dump` no está instalado localmente. El rollback destructivo sólo se
   ejecutó en una base efímera eliminada; producción requiere backup real.
3. El navegador interno no comparte la sesión autenticada de Chrome. La UI
   privada fue validada manualmente durante el desarrollo y la lógica de rutas
   está automatizada; el smoke visual automatizado cubrió login y verificación.

## Despliegue y rollback seguro

Antes de desplegar, actualizar Node, hacer backup, verificar variables de
producción y ejecutar en una instancia controlada:

```bash
bun run --cwd apps/api typeorm migration:show
bun run --cwd apps/api migration:run
bun run --cwd apps/api seed:run
bun run --cwd apps/api build
bun run --cwd apps/web build
```

`start:prod` ya ejecuta la preparación de DB existente, pero se recomienda separar y observar migración/seed durante el primer despliegue de este módulo.

El rollback preferido es volver a la versión anterior de la aplicación **sin quitar las migraciones append-only**; las tablas y constraints nuevas pueden permanecer y así no se pierde información. Sólo antes de uso productivo, con backup y confirmación de que no existe información dependiente, puede revertirse dos veces en orden inverso:

```bash
bun run --cwd apps/api migration:revert
bun run --cwd apps/api migration:revert
```

La primera reversión elimina las cinco tablas y es destructiva. No debe ejecutarse una vez que existan datos de clientes. La reversión de seeds debe hacerse desplegando el catálogo anterior y ejecutando su seed explícitamente; no se debe editar permisos manualmente durante tráfico activo.

## Git al cierre

El worktree conserva los cambios del módulo y de QA sin commit. No se hizo push
ni se abrió PR. El inventario final y el veredicto están en el reporte de QA.
