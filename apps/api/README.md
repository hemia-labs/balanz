# API (NestJS)

Backend del monorepo `nextjs-nestjs`. Plantilla NestJS + TypeORM + PostgreSQL.
La base de datos está activa y es obligatoria para los módulos de identidad y clientes.

## Stack

- **NestJS 11** — framework HTTP (módulos, controllers, services).
- **TypeORM** — ORM + migraciones contra PostgreSQL.
- **PostgreSQL** — base de datos (timezone `America/Mexico_City`).
- **Redis 6+** — cache de sesiones y autorización; PostgreSQL sigue siendo la fuente durable.
- **@nestjs/config** — configuración tipada por namespace (`registerAs`).
- **class-validator / class-transformer** — validación de DTOs vía `ValidationPipe` global.
- **TypeScript**, **Jest** (tests), **ESLint + Prettier**.
- Gestor de paquetes: **bun**.

## Estructura

```
apps/api/
  src/
    main.ts                      # bootstrap: ValidationPipe global + CORS, escucha PORT (3001)
    app.module.ts                # módulo raíz
    config/
      database.config.ts         # config namespaced 'database' (registerAs)
      redis.config.ts            # config namespaced 'redis' (host, port, DB y password)
    database/
      data-source.ts              # DataSource para el CLI de migraciones
      database.module.ts         # TypeOrmModule.forRootAsync, synchronize: false
      migrations/                # migraciones TypeORM
    modules/
      users/                     # módulo de usuarios (controller, service, entity, dtos)
      client-accounts/           # cuentas, RFC, asignaciones, ejercicios y períodos
```

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores:

```
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=
DB_PASSWORD=
DB_DATABASE=
DB_LOGGING=false

# Session cache
# Opcional: false desactiva Redis; si se omite, intenta Vault o REDIS_* y si no hay config usa PostgreSQL.
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=balanz:
REDIS_CONNECT_TIMEOUT_MS=1000
AUTH_SESSION_IDLE_TTL_SECONDS=1800
AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS=300
TRUST_PROXY_HOPS=0
APP_CORS_ORIGINS=http://localhost:5181
```

Cuando `SECRETS_ENABLED=true`, la conexión Redis se obtiene desde Vault en
`cache/redis` con `redis_host`, `redis_port`, `redis_password` y `redis_db`.
Si ese secret no existe o es inválido, se intenta la configuración `REDIS_*` del
`.env`. Si tampoco existe un host Redis utilizable, las sesiones usan PostgreSQL.
No se utiliza `REDIS_URL`. Si Redis no está disponible, las sesiones hacen
fallback a PostgreSQL sin utilizar valores locales obsoletos.

`AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS` debe ser estrictamente menor
que `AUTH_SESSION_IDLE_TTL_SECONDS`. La API falla al arrancar si la combinación
puede cerrar sesiones activas durante una recuperación de cache.

## Cookies

La API registra `cookie-parser` y expone la configuración en el namespace
`cookies`. Las cookies se configuran como `HttpOnly`:

```env
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
COOKIE_DOMAIN=
```

En producción `COOKIE_SECURE=true` es obligatorio. Usa `COOKIE_SAME_SITE=none`
solo para cookies cross-site y siempre junto con `COOKIE_SECURE=true`. CORS usa
`credentials: true`; el frontend debe enviar las peticiones con
`credentials: 'include'`.

`PORT` opcional (default `3001`). `.env` y `.env.local` están en `.gitignore`.

## Arranque

Requiere Node.js `^20.19.0`, `^22.13.0` o `>=24.11.0`, además de Bun.

```bash
bun install
bun run --cwd apps/api start:dev   # watch mode
```

El arranque falla si PostgreSQL o la configuración obligatoria no están disponibles.

En producción, `start:prod` ejecuta primero las migraciones pendientes y el seed
idempotente, y solo inicia la API si ambos pasos terminan correctamente:

```bash
bun run --cwd apps/api start:prod
```

## Preparar la base de datos

1. Completa `.env`.
2. Ejecuta las migraciones append-only y el seed idempotente:

```bash
bun run --cwd apps/api migration:run
bun run --cwd apps/api seed:run
```

## Migraciones

```bash
bun run --cwd apps/api typeorm migration:generate src/database/migrations/<Nombre>
bun run --cwd apps/api migration:run
bun run --cwd apps/api migration:revert
```

`synchronize` está en `false`: todo cambio de schema requiere migración.
El DataSource del CLI resuelve Vault cuando `SECRETS_ENABLED=true`; no usa un
fallback silencioso a PostgreSQL local.

La migración de búsqueda ejecuta `CREATE EXTENSION IF NOT EXISTS pg_trgm`. Antes
del despliegue, el rol que corre migraciones debe tener permiso para instalar
esa extensión en la base objetivo, o un DBA/proveedor administrado debe dejarla
preinstalada. Conviene verificarlo en el preflight; no se deben ampliar los
privilegios permanentes del usuario de ejecución de la API sólo para desplegar
este índice.

Para validar aplicación desde cero, seed idempotente, rollback, reaplicación y
drift en una base temporal de desarrollo:

```bash
bun run --cwd apps/api qa:migrations
```

El rol PostgreSQL necesita permiso `CREATEDB`. El runner sólo acepta
`development/test`, scope Vault `dev` y nombres temporales generados con el
prefijo `balanz_migration_qa_`.

La limpieza periódica de tokens de recuperación y límites anónimos se ejecuta
fuera del proceso HTTP, mediante una tarea programada del entorno:

```bash
bun run --cwd apps/api maintenance:auth-cleanup
```

La tarea elimina por lotes tokens usados o expirados con más de 24 horas y
límites con más de una hora. Imprime métricas JSON y termina con código distinto
de cero si falla, para que el scheduler active una alerta.

## Tests y build

```bash
bun run --cwd apps/api test
bun run --cwd apps/api test:e2e
bun run --cwd apps/api build
```

## Autenticación y tenant

La API expone el flujo de alta bajo `/api/v1/auth`:

- `POST /auth/register`
- `POST /auth/email/verification/resend`
- `POST /auth/email/verification/confirm`
- `GET /auth/onboarding`
- `POST /auth/login`
- `POST /auth/login/mfa`
- `POST /auth/mfa/totp/setup`
- `POST /auth/mfa/totp/verify`
- `POST /auth/mfa/totp/disable`
- `GET|DELETE /auth/session`
- `PATCH /auth/session/organization`
- `GET /me/organizations`
- `GET /me/authorization`

La sesión usa una cookie `HttpOnly` con token opaco persistido como hash en
`auth_sessions`. Redis cachea la sesión y el contexto de autorización usando el
hash como llave; el TTL nunca extiende `expires_at`. `last_activity_at` se
persiste en PostgreSQL como máximo una vez cada cinco minutos por sesión.
La sesión y Redis no almacenan la cartera completa de cuentas; el scope sólo
conserva `accountAccessMode` y cada acceso se valida nuevamente en PostgreSQL.
MFA es opcional y se implementa localmente con TOTP RFC 6238 (issuer `Balanz`,
SHA-1, seis dígitos, período de 30 segundos y tolerancia de ±30 segundos).
El secreto se cifra con AES-256-GCM y la llave del mecanismo de secretos;
`MFA_ENCRYPTION_KEY` sólo es fallback local. No hay proveedor externo,
recovery codes ni recuperación autoservicio. Las acciones P0 críticas y de
extracción aplican la política centralizada `MFA_SETUP_REQUIRED` /
`MFA_REQUIRED`.

`GET /api/v1/users` acepta `search`, `status`, `page` y `limit` (1–100) y
devuelve `{ items, meta: { page, limit, total, totalPages } }`.

## Módulo de clientes

Las rutas privadas usan el tenant de la sesión, permisos declarativos, MFA para
operaciones sensibles y scope real por titular o asignación activa:

- `GET|POST /api/v1/client-accounts`
- `GET|PATCH|DELETE /api/v1/client-accounts/:clientAccountId`
- `GET|POST /api/v1/client-accounts/:clientAccountId/legal-entities`
- `PATCH|DELETE /api/v1/legal-entities/:legalEntityId`
- `GET|POST /api/v1/client-accounts/:clientAccountId/assignments`
- `GET /api/v1/client-accounts/:clientAccountId/available-members`
- `DELETE /api/v1/client-accounts/:clientAccountId/assignments/:assignmentId`
- `GET|POST /api/v1/legal-entities/:legalEntityId/fiscal-years`
- `GET /api/v1/fiscal-years/:fiscalYearId/periods`

Las colecciones de asignaciones, candidatos, responsables y entidades fiscales
aceptan `page` (máximo 10 000), `limit` (máximo 100) y `search`, y devuelven
`{ items, meta }`.
El detalle usa `legalEntityPage`, `legalEntityLimit` y `legalEntitySearch` para
su página anidada. Un deep link fiscal puede enviar `legalEntityId`; en ese modo
el backend devuelve sólo esa entidad, siempre bajo el mismo scope de cuenta y
tenant. Los períodos permanecen como una lista fija de 12 y los ejercicios como
una lista temporalmente acotada por entidad.

Las mutaciones por cookie exigen un `Origin` exacto autorizado o, si falta,
un `Referer` cuyo origin sea exacto. Cada respuesta expone
`x-correlation-id`; el mismo UUID se reutiliza en errores y auditoría.
`APP_CORS_ORIGINS` es CSV de origins HTTP(S) sin credenciales, paths, query ni
fragment; las variantes equivalentes se canonicalizan antes de CORS y CSRF.

La búsqueda `contains` de cuentas requiere la extensión PostgreSQL `pg_trgm`;
la migración append-only crea índices GIN para nombre y código.
