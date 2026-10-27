# Validación de desarrollo del módulo de clientes

## Veredicto

**READY FOR MANUAL QA y listo para abrir PR.**

La implementación del módulo de clientes, las migraciones, los seeds, el
aislamiento tenant, la política MFA/CSRF, la concurrencia principal y el
frontend compilan y pasan las validaciones automatizadas ejecutadas el
2026-08-26. Las cuatro migraciones pasaron el lifecycle efímero sin drift; las
tres migraciones base ya están en `dev` y la migración trigram queda para el
flujo normal de despliegue.

Este veredicto habilita revisión de código y merge sujeto a la revisión normal
del equipo. No sustituye el checklist de despliegue productivo: antes de
producción deben usarse una versión de Node soportada, backup real, secretos del
ambiente destino y observación de la migración.

## Identificación

- Repositorio: `balanz`.
- Workspace de integración validado: `codex/refactor-ux-ui`, SHA
  `f2b5ed0b298347c138f6fbdd2bf91710ffd4517d`.
- Publicación preparada en dos ramas desde el `develop` actualizado:
  `codex/modulo-clientes-back` y `codex/modulo-clientes-front`.
- Entorno persistente: Vault `dev`, PostgreSQL con `synchronize: false` y Redis
  disponible.
- Entorno efímero: base PostgreSQL con prefijo
  `balanz_migration_qa_`, creada y eliminada por el runner de QA.
- La publicación se prepara sobre las PR existentes de backend y frontend.

No se registran host, usuario, contraseña, tokens, cookies ni identificadores
de datos reales en este reporte.

## Resumen de resultados

| Área | Resultado | Evidencia |
| --- | --- | --- |
| Estado de migraciones | PASS | Cuatro migraciones validadas en el lifecycle efímero; trigram queda para el flujo de despliegue. |
| DataSource de CLI + Vault | PASS | `migration:show`, `migration:run` y `seed:run` resuelven el mismo secreto PostgreSQL que Nest. |
| Migración desde base vacía | PASS | Se aplicaron las cuatro migraciones en una base temporal. |
| Rollback y reaplicación | PASS | Se revirtieron trigram y clientes, luego todo el esquema, y se reaplicaron cuatro migraciones. |
| Drift TypeORM | PASS | `upQueries = 0`, `downQueries = 0`. |
| Seeds | PASS | Dos ejecuciones consecutivas: 4 roles, 27 permisos únicos y 55 relaciones rol-permiso. |
| Integridad persistente | PASS | Cero huérfanos o cadenas tenant inconsistentes en 17 comprobaciones. |
| Períodos | PASS | Todos los ejercicios persistentes tienen exactamente los meses 1–12. |
| Unitarias API | PASS | 27 suites, 102 pruebas. |
| E2E API | PASS | 3 suites, 18 pruebas; 13 corresponden al dominio de clientes. |
| Lint API | PASS | Cero errores y cero warnings en el alcance completo configurado. |
| Build API | PASS | Compilación Nest/TypeScript completa. |
| Lint frontend | PASS | Sin errores. |
| Typecheck frontend | PASS | Sin errores. |
| Pruebas frontend | PASS | 31 pruebas. |
| Build frontend | PASS | Build productivo Next.js 16.2.12. |
| Smoke HTTP | PASS | Web 200, API 200, ruta privada sin sesión 401, preflight CORS 204 con credenciales. |
| Smoke visual público | PASS | Login y verificación de correo renderizan; la tarjeta de verificación está centrada. |
| Limpieza QA | PASS | Cero fixtures `example.test`; los conteos previos del dominio persistente se conservaron. |

## Migraciones y esquema

### Migraciones aplicadas

1. `Migration1787601284711`
2. `IdentityIntegrity1787690000000`
3. `ClientAccountsDomain1787690100000`
4. `ClientAccountSearchTrigram1787690200000`

El snapshot persistente inicial ya contenía las tres migraciones base. La cuarta
es append-only y se validó desde cero, con rollback y reaplicación, en una base
efímera; su aplicación a cada ambiente corresponde al flujo normal de despliegue.

Comandos verificados con un runtime Node soportado por TypeORM:

```bash
bun run --cwd apps/api typeorm migration:show
bun run --cwd apps/api migration:run
bun run --cwd apps/api seed:run
```

La máquina local tenía Node 20.15.1, menor al mínimo de TypeORM 1.0.0. Para
validar el CLI sin modificar el sistema se ejecutó también con Node 22.19.0. El
`package.json` de la API ahora declara
`^20.19.0 || ^22.13.0 || >=24.11.0`, de modo que CI y despliegue fallen temprano
si usan un runtime incompatible.

### Corrección del DataSource

El DataSource del CLI leía únicamente `DB_*`; con `SECRETS_ENABLED=true`
ignoraba Vault y caía a PostgreSQL local. Se añadió una fábrica compartida para
resolver `database/postgres` con el mismo scope de secretos que la aplicación.
El runner de seeds usa ese DataSource y la lógica idempotente quedó separada en
`seed-database.ts` para poder probarla contra una base efímera.

### Ciclo limpio y rollback

El comando siguiente crea una base de nombre aleatorio validado, aplica el
esquema, ejecuta el seed dos veces, revierte, reaplica y elimina la base incluso
al finalizar:

```bash
bun run --cwd apps/api qa:migrations
```

Resultados:

- aplicación inicial: 4 migraciones;
- rollback de búsqueda: los dos índices trigram se eliminaron y las tablas de
  clientes se conservaron;
- rollback de clientes: las cinco tablas se eliminaron y la identidad se
  conservó;
- rollback total: `users`, `memberships` y el dominio de clientes quedaron
  eliminados;
- reaplicación: 4 migraciones;
- drift final: 0 operaciones;
- base temporal eliminada: sí.

El runner se niega a operar fuera de `development/test`, exige el scope Vault
`dev` cuando los secretos están activos y sólo elimina nombres que coinciden
con `^balanz_migration_qa_[a-f0-9]{12}$`.

### Constraints, índices e integridad

Se verificó en `pg_constraint`, `pg_indexes` e `information_schema` la presencia
de:

- FKs de identidad y sesión, incluidas las cadenas compuestas
  organización/membresía/usuario;
- FKs compuestas del dominio organización/cuenta/RFC/ejercicio/período;
- checks de nombre, RFC, archivo, revocación, año y mes;
- uniques de RFC activo, primary activo, miembro activo, ejercicio y mes;
- índices de listados, búsqueda, asignaciones, ejercicios y períodos.

Las entidades ahora declaran los mismos nombres, defaults, checks, índices,
uniques y FKs que las migraciones. Antes de la corrección, el schema builder
proponía 62 operaciones destructivas; después propone 0.

Las consultas de preflight e integridad devolvieron cero violaciones para:

- owner de organización;
- membresía–organización y membresía–usuario;
- contexto e identidad de sesiones;
- factores, tokens y suscripciones;
- cuenta–organización;
- RFC–cuenta;
- asignaciones–cuenta/membresías/actores;
- ejercicio–RFC;
- período–ejercicio.

Los datos persistentes existentes conservaron sus conteos después de QA:
1 cuenta, 1 RFC, 1 asignación, 1 ejercicio y 12 períodos.

## Backend y seguridad

### Unitarias

```bash
bunx jest --runInBand --no-cache --testPathIgnorePatterns=e2e-spec
```

Resultado: 27 suites y 102 pruebas aprobadas. El log `provider down` pertenece a
un caso controlado de fallo del adaptador de correo.

### E2E

```bash
bunx jest --config ./test/jest-e2e.json --runInBand --no-cache --silent
```

Resultado: 3 suites y 18 pruebas aprobadas. La suite de clientes cubre 13
escenarios integrales:

- 401 sin sesión;
- CSRF sin origen y con origen hostil;
- `MFA_SETUP_REQUIRED` y `MFA_REQUIRED`;
- validación 400 compatible con v1, errores por campo y rechazo de mass assignment;
- creación atómica de cuenta, RFC, primary, ejercicio, 12 períodos y cuatro
  eventos de auditoría;
- rollback total si falla la persistencia de auditoría;
- propagación del mismo correlation ID en respuesta y auditoría;
- owner tenant-wide, contador asignado, colaborador no asignado y acceso
  cross-tenant enmascarado como 404;
- contador con MFA y los cuatro permisos de alta: puede crear y operar su cuenta
  asignada, pero una cuenta no asignada del mismo tenant permanece enmascarada
  como 404;
- aislamiento cross-tenant en cuenta, RFC, asignaciones, ejercicios y períodos;
- permisos de mutación;
- asignación, cache caliente, revocación y pérdida inmediata de acceso;
- protección del último primary;
- protección del último RFC activo;
- versión optimista y conflicto stale;
- ejercicio duplicado y creación con 12 meses ordenados;
- carrera de dos altas con el mismo RFC: un 201, un 409 y un solo agregado
  persistido;
- RFC único por organización, sort allowlisted, límite máximo y búsqueda
  parametrizada;
- archivado, visibilidad de owner y ocultamiento para asignados.

Los fixtures usan usuarios y organizaciones con identificador aleatorio, se
revocan sus sesiones, se eliminan por IDs exactos en orden referencial y se
comprueba que no queden usuarios `example.test`.

La suite de autenticación se actualizó para incluir el `Origin` requerido por
el guard CSRF global y un timeout compatible con la latencia real de Vault y
PostgreSQL. Esto evita falsos deadlocks causados por hooks expirados que seguían
ejecutándose durante el cleanup.

### Lint, formato y build

```bash
bunx eslint "{src,apps,libs,test}/**/*.ts"
bun run --cwd apps/api build
```

Resultado final: sin errores ni warnings. La migración inicial ya aplicada se
excluyó por ruta exacta del formatter/linter para no reescribir un artefacto
append-only; las migraciones nuevas continúan dentro del alcance normal.

## Frontend

```bash
bun run --cwd apps/web lint
bun run --cwd apps/web typecheck
bun run --cwd apps/web test
npm --prefix apps/web run build -- --webpack
```

Resultados:

- lint: PASS;
- TypeScript: PASS;
- tests: 31 PASS;
- build Next.js con Webpack: PASS, 14 páginas generadas y ruta privada dinámica compilada.

Las pruebas cubren clasificación de errores, transporte/cancelación, slugs,
`returnTo`, filtrado por capacidades, ruta activa, rutas multi-RFC, separación
entre resumen y datos del cliente, asignación explícita y resolución tenant.

El navegador interno sin sesión autenticada confirmó:

- redirección de `/es` a `/es/login` cuando no hay sesión;
- formulario de login accesible;
- `/verify-email` con contenido centrado y botón de reenvío en estado seguro;
- título `balanz por Hemia` y respuesta HTTP correcta.

La navegación autenticada de cartera, resumen, datos, ejercicios y períodos fue
validada manualmente durante el desarrollo por el usuario y sus resoluciones de
ruta/estado activo quedaron cubiertas por las pruebas de navegación. El
navegador interno no comparte la sesión de Chrome, por lo que no se simuló una
cookie real ajena.

## Matriz de integración y seguridad

| Invariante | Resultado | Evidencia |
| --- | --- | --- |
| Alta agregada | PASS | E2E real confirma 1 cuenta, 1 RFC, 1 primary, 1 ejercicio, 12 períodos y 4 eventos. |
| Auditoría dentro de transacción | PASS | Se fuerza un error de `AuditService.record`; HTTP devuelve 500 y PostgreSQL conserva 0 cuentas/0 RFC para ese intento. |
| Correlation ID | PASS | El UUID enviado reaparece en `x-correlation-id` y en los 4 eventos del agregado. |
| RFC concurrente | PASS | Dos altas simultáneas producen exactamente 201 + 409 y un agregado completo. |
| Versión optimista | PASS | La segunda escritura con versión obsoleta devuelve `STALE_CLIENT_ACCOUNT`. |
| Último primary | PASS | La revocación devuelve `LAST_PRIMARY_ASSIGNMENT`. |
| Último RFC activo | PASS | El archivado devuelve `LAST_ACTIVE_LEGAL_ENTITY`. |
| Tenant | PASS | Cuenta, RFC, asignaciones, ejercicios y períodos ajenos devuelven 404 sin datos. |
| Assignment scope | PASS | Un colaborador no asignado no ve la cuenta; al asignarlo obtiene acceso y al revocarlo lo pierde inmediatamente. |
| Redis/cache | PASS | Redis estuvo disponible; la prueba calienta la sesión antes de revocar y confirma 404 después. Unitarias cubren fallback PostgreSQL y eliminación de llaves acotadas. |
| Allowlist y entrada hostil | PASS | Sort desconocido devuelve `INVALID_CLIENT_SORT`, `limit=101` se rechaza y una búsqueda con metacaracteres no altera la consulta. |
| Mass assignment | PASS | `organizationId` y campos no permitidos se rechazan con `VALIDATION_ERROR` y errores por campo. |
| MFA/CSRF | PASS | Se verificaron MFA no configurado/pendiente, ausencia de origen, origen hostil y origen exacto permitido. |

La prueba de rollback inyecta el fallo en auditoría, que es el último tramo del
alta agregada y por tanto demuestra que también se revierten las escrituras
anteriores. No se inyectó un fallo independiente en cada uno de los doce inserts
de períodos; esa granularidad queda como endurecimiento futuro, no como bloqueo
para QA manual.

## Matriz de endpoints

Todos los endpoints usan sesión, tenant activo y permisos persistidos. “Scope”
significa owner real de la organización o asignación activa, nunca nombre de rol.

| Endpoint | Permiso | MFA | Scope | Éxito | Evidencia |
| --- | --- | --- | --- | --- | --- |
| `GET /client-accounts` | `clients.view` | No | cartera filtrada | 200 | E2E positivo, asignado, no asignado, archivado, filtros y cross-tenant |
| `GET /client-accounts/available-primary-members` | `clients.assign` | Sí | tenant | 200 | contrato inspeccionado y consumo real del formulario |
| `POST /client-accounts` | cuatro permisos de alta | Sí | tenant | 201 | E2E positivo, validación, rollback y carrera |
| `GET /client-accounts/:id` | `clients.view` | No | cuenta | 200 | E2E positivo, revocación, archivado y cross-tenant |
| `PATCH /client-accounts/:id` | `clients.manage` | No | cuenta | 200 | E2E positivo, 403 y stale 409 |
| `DELETE /client-accounts/:id` | `clients.manage` | No | cuenta | 204 | E2E archivo y visibilidad posterior |
| `GET /client-accounts/:id/legal-entities` | `fiscal_entities.view` | No | cuenta | 200 | flujo autenticado y E2E cross-tenant |
| `POST /client-accounts/:id/legal-entities` | `fiscal_entities.manage` | Sí | cuenta | 201 | E2E segundo RFC y conflicto |
| `PATCH /legal-entities/:id` | `fiscal_entities.manage` | Sí | RFC/cuenta | 200 | contrato, DTO, transacción y constraints inspeccionados |
| `DELETE /legal-entities/:id` | `fiscal_entities.manage` | Sí | RFC/cuenta | 204 | E2E archivo y protección del último activo |
| `GET /client-accounts/:id/assignments` | `clients.assign` | Sí | cuenta | 200 | E2E listado/primary y cross-tenant |
| `GET /client-accounts/:id/available-members` | `clients.assign` | Sí | cuenta | 200 | contrato inspeccionado y consumo real del formulario |
| `POST /client-accounts/:id/assignments` | `clients.assign` | Sí | cuenta | 201 | E2E asignación y acceso posterior |
| `DELETE /client-accounts/:id/assignments/:assignmentId` | `clients.assign` | Sí | cuenta | 204 | E2E último primary y revocación con cache caliente |
| `GET /legal-entities/:id/fiscal-years` | `fiscal_years.view` | No | RFC/cuenta | 200 | flujo autenticado y E2E cross-tenant |
| `POST /legal-entities/:id/fiscal-years` | `fiscal_years.manage` | No | RFC/cuenta | 201 | E2E alta, duplicado y 12 períodos |
| `GET /fiscal-years/:id/periods` | `fiscal_years.view` | No | ejercicio/cuenta | 200 | E2E meses 1–12 y cross-tenant |

Los dos endpoints de candidatos y el `PATCH` de entidad fiscal no tienen todavía
un caso E2E aislado por endpoint; sí comparten guards, scope, DTOs, transacciones
y consultas verificadas por el resto de la suite. Se mantienen explícitos en el
recorrido manual de abajo.

## Comandos finales y duración

| Comando | Código | Duración aprox. | Resultado |
| --- | ---: | ---: | --- |
| TypeORM `migration:show` con Node 22.19 | 0 | 18.6 s | 3 base aplicadas |
| TypeORM `migration:run --transaction all` con Node 22.19 | 0 | 8.4 s | 3 base sin pendientes |
| `bun run --cwd apps/api seed:run` (primera repetición final) | 0 | 2.7 s | idempotente |
| `bun run --cwd apps/api seed:run` (segunda repetición final) | 0 | 2.6 s | idempotente |
| `bunx eslint "{src,apps,libs,test}/**/*.ts"` | 0 | 9.2 s | PASS |
| Unitarias API, `--runInBand --no-cache` | 0 | 9.6 s | 27 suites / 102 pruebas |
| E2E API completo, `--runInBand --no-cache` | 0 | 60.2 s | 3 suites / 18 pruebas |
| `bun run --cwd apps/api build` | 0 | 8.6 s | PASS |
| `bun run --cwd apps/web lint` | 0 | ejecución previa de esta validación | PASS |
| `bun run --cwd apps/web typecheck` | 0 | ejecución previa de esta validación | PASS |
| `bun run --cwd apps/web test` | 0 | validación final frontend | 31 pruebas |
| `npm --prefix apps/web run build -- --webpack` | 0 | validación final frontend | 14 páginas; PASS |
| `git diff --check` | 0 | < 1 s | sin errores de whitespace |

Los logs `provider down` y `forced audit persistence failure` corresponden a
casos negativos intencionales que terminaron PASS.

## Preparación para prueba manual

Con Node soportado, desde la raíz:

```bash
bun run --cwd apps/api migration:run
bun run --cwd apps/api seed:run
bun run --cwd apps/api start:dev
bun run --cwd apps/web dev
```

- Web: `http://localhost:3000/es/login`.
- API: `http://localhost:3001/api/v1`.
- Usar una cuenta de desarrollo existente mediante el login normal; este
  documento no almacena contraseña, cookie ni secreto.
- API y web quedaron escuchando en 3001 y 3000 al cerrar esta validación.

### Checklist manual copiable

| Paso | Resultado esperado | Evidencia sugerida |
| --- | --- | --- |
| [ ] Iniciar sesión | acceso sin exponer la cookie | captura de Inicio |
| [ ] Confirmar tenant activo | organización correcta en el selector | nombre visible |
| [ ] Abrir Clientes | cartera real, sin fallback demo | captura/listado |
| [ ] Crear cliente | botón y modal disponibles según permiso | captura del modal |
| [ ] Verificar mensaje de éxito | alta confirmada una sola vez | toast/captura |
| [ ] Abrir detalle | URL contiene `clientAccountId` real | URL/captura |
| [ ] Verificar RFC inicial | razón social y RFC normalizados | captura |
| [ ] Verificar responsable primary | responsable elegido activo | captura |
| [ ] Abrir ejercicio | breadcrumb y sidebar coherentes | URL/captura |
| [ ] Verificar 12 períodos | enero–diciembre, sin duplicados | captura/lista |
| [ ] Regresar a clientes | vuelve a la cartera conservando contexto | captura |
| [ ] Buscar por nombre | sólo coincidencias del tenant | captura |
| [ ] Buscar por RFC | encuentra el cliente correcto | captura |
| [ ] Editar nombre | persiste y aumenta versión | antes/después |
| [ ] Agregar segundo RFC | ambos RFC aparecen, sin elección arbitraria | captura |
| [ ] Editar segundo RFC | cambio válido o conflicto amigable | captura |
| [ ] Crear segundo ejercicio | aparece con 12 períodos | captura |
| [ ] Consultar candidatos | listas reales de integrantes elegibles | captura |
| [ ] Agregar colaborador | asignación activa visible | captura |
| [ ] Iniciar sesión como colaborador | sólo cartera asignada | captura |
| [ ] Confirmar acceso asignado | abre únicamente ese cliente | URL/captura |
| [ ] Revocar asignación | operación confirmada | captura owner |
| [ ] Confirmar pérdida inmediata | detalle devuelve 404 seguro | captura colaborador |
| [ ] Probar ID de otro tenant | 404 sin nombre, RFC ni estado ajenos | red/body seguro |
| [ ] Probar RFC duplicado | 409 con mensaje usable | captura del formulario |
| [ ] Probar datos inválidos | 400 con errores por campo en español | captura |
| [ ] Recargar URL profunda | restaura cliente/RFC/ejercicio/período | URL/captura |
| [ ] Cambiar de tenant | se limpia el contexto anterior | captura antes/después |

No se requieren fixtures persistentes adicionales: el alta E2E usa datos
aleatorios y los elimina; la cuenta creada manualmente durante el desarrollo se
conservó.

## Defectos encontrados y corregidos en esta validación

1. El CLI TypeORM no resolvía Vault.
2. No se declaraba el mínimo de Node requerido por TypeORM 1.0.0.
3. Entidades y migraciones tenían un drift de 62 operaciones.
4. No existía E2E del módulo de clientes.
5. El E2E de autenticación no enviaba `Origin` después de activar CSRF global.
6. Los timeouts de autenticación eran menores a la latencia del entorno.
7. El lint global fallaba por intentar reformatear una migración legacy
   append-only y por una aserción insegura en un test.

Todos quedaron corregidos y se repitieron las validaciones relacionadas.

## Observaciones no bloqueantes

- La máquina local debe actualizar Node 20.15.1. El código ya declara el mínimo
  soportado y el CLI fue validado con Node 22.19.0.
- TypeORM/`pg` emite una advertencia de deprecación durante introspección y E2E
  sobre consultas concurrentes del cliente; no afecta el resultado actual,
  pero debe revisarse antes de migrar a `pg` 9.
- `pg_dump` no está instalado en la máquina. No se ejecutó una reversión
  destructiva sobre la base persistente; el ciclo destructivo ocurrió sólo en
  una base efímera eliminada al terminar. Producción sí requiere backup.
- Health/readiness, headers explícitos equivalentes a Helmet y OpenAPI siguen
  siendo brechas generales de plataforma, fuera del módulo de clientes.
- En producción debe conservarse `DB_LOGGING=false` para evitar registrar
  parámetros sensibles de consultas.

## Estado Git final

Se ejecutaron los cuatro comandos requeridos:

```bash
git status --short
git diff --stat
git diff --name-status
git ls-files --others --exclude-standard
```

La validación se ejecutó antes de dividir el cambio para revisión. El árbol ya
estaba sucio con la implementación no confirmada del módulo de clientes y los
refinamientos de navegación/errores; se conservaron sin reset ni sobrescritura.
La publicación separa API, migraciones y documentación en la rama backend, y la
integración Next.js en la rama frontend. `apps/api/.env` permanece ignorado y no
aparece en archivos tracked o untracked. `git diff --check` termina con código
0; los avisos LF/CRLF de Git no representan errores de whitespace.

No se creó commit, no se hizo push y no se abrió PR.

## Checklist previo a abrir la PR

- [x] Migraciones append-only aplican desde cero.
- [x] Migraciones revierten y reaplican en entorno efímero.
- [x] No hay migraciones pendientes en `dev`.
- [x] No hay drift TypeORM.
- [x] Seeds son idempotentes.
- [x] FKs, checks, uniques e índices están presentes.
- [x] No hay huérfanos ni fixtures filtrados.
- [x] Unitarias, E2E, lint y builds pasan.
- [x] Aislamiento tenant, MFA, CSRF, permisos y concurrencia están probados.
- [x] Frontend compila y su navegación crítica tiene cobertura.
- [x] Documentación técnica actualizada.
- [ ] Commit, push y apertura de PR: deliberadamente no realizados.
