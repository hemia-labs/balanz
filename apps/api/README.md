# API (NestJS)

Backend del monorepo `nextjs-nestjs`. Plantilla NestJS + TypeORM + PostgreSQL.
La base de datos viene **desactivada** hasta que la configures (ver abajo).

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
AUTH_SESSION_ACTIVITY_PERSIST_INTERVAL_SECONDS=300
```

Cuando `SECRETS_ENABLED=true`, la conexión Redis se obtiene desde Vault en
`cache/redis` con `redis_host`, `redis_port`, `redis_password` y `redis_db`.
Si ese secret no existe o es inválido, se intenta la configuración `REDIS_*` del
`.env`. Si tampoco existe un host Redis utilizable, las sesiones usan PostgreSQL.
No se utiliza `REDIS_URL`. Si Redis no está disponible, las sesiones hacen
fallback a PostgreSQL sin utilizar valores locales obsoletos.

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

```bash
bun install
bun run --cwd apps/api start:dev   # watch mode
```

Sin DB el servidor levanta igual (responde en `/`). El módulo de datos está apagado.

## Activar la base de datos

1. Completa `.env`.
2. En `src/app.module.ts` verifica los imports de `DatabaseModule` y `UsersModule`.
3. Genera y corre la migración:

```bash
bun run --cwd apps/api migration:generate
bun run --cwd apps/api migration:run
```

El primer comando genera la migración con el nombre base `Migration` dentro de
`src/database/migrations`.

## Migraciones

```bash
bun run --cwd apps/api typeorm migration:generate src/database/migrations/<Nombre>
bun run --cwd apps/api migration:run
bun run --cwd apps/api migration:revert
```

`synchronize` está en `false`: todo cambio de schema requiere migración.

## Tests y build

```bash
bun run --cwd apps/api test
bun run --cwd apps/api build
```

## Autenticación y tenant

La API expone el flujo de alta bajo `/api/v1/auth`:

- `POST /auth/register`
- `POST /auth/email/verification/resend`
- `POST /auth/email/verification/confirm`
- `GET /auth/onboarding`
- `POST /auth/mfa/setup`
- `POST /auth/mfa/verify`
- `GET|DELETE /auth/session`
- `PATCH /auth/session/organization`
- `GET /me/organizations`
- `GET /me/authorization`

La sesión usa una cookie `HttpOnly` con token opaco persistido como hash en
`auth_sessions`. Redis cachea la sesión y el contexto de autorización usando el
hash como llave; el TTL nunca extiende `expires_at`. `last_activity_at` se
persiste en PostgreSQL como máximo una vez cada cinco minutos por sesión.
El proveedor MFA disponible en esta fase es un stub exclusivo
para desarrollo y pruebas (`MFA_PROVIDER=stub`); producción debe conectar un
proveedor real antes de arrancar.

`GET /api/v1/users` acepta `search`, `status`, `page` y `limit` (1–100) y
devuelve `{ items, meta: { page, limit, total, totalPages } }`.
