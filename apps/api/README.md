# API (NestJS)

Backend del monorepo Balanz. Es un monolito modular NestJS con API HTTP y un
worker durable como procesos separados del mismo release. PostgreSQL es
obligatorio y constituye la única autoridad durable, incluida la plataforma
fiscal compartida de Fase 0.

## Stack

- **NestJS 11** — framework HTTP (módulos, controllers, services).
- **TypeORM** — ORM + migraciones contra PostgreSQL.
- **PostgreSQL** — base de datos (timezone `America/Mexico_City`).
- **Redis 6+** — cache de sesiones/autorización y wakeup best-effort; nunca cola durable.
- **S3/MinIO o filesystem privado** — adapters de object storage detrás de un port.
- **ClamAV** — scanner de malware por protocolo `INSTREAM`.
- **@nestjs/config** — configuración tipada por namespace (`registerAs`).
- **class-validator / class-transformer** — validación de DTOs vía `ValidationPipe` global.
- **TypeScript**, **Jest** (tests), **ESLint + Prettier**.
- Gestor de paquetes: **bun**.

## Estructura

```
apps/api/
  src/
    main.ts                      # bootstrap de la API HTTP
    worker.ts                    # bootstrap separado del worker durable
    app.module.ts                # módulo raíz de API
    worker.module.ts             # módulo raíz del worker
    config/
      database.config.ts         # config namespaced 'database' (registerAs)
      redis.config.ts            # config namespaced 'redis' (host, port, DB y password)
      fiscal-platform.config.ts  # storage, scanner, worker, límites, health y métricas
    database/
      data-source.ts              # DataSource para el CLI de migraciones
      database.module.ts         # TypeOrmModule.forRootAsync, synchronize: false
      migrations/                # migraciones TypeORM
    modules/
      users/                     # módulo de usuarios
      client-accounts/           # cuentas, RFC, asignaciones, ejercicios y períodos
      object-storage/            # port + adapters local y S3/MinIO
      malware-scanner/           # port + ClamAV/bypass dev explícito
      ingestion/                 # foundation durable, RLS y worker
      health/                    # liveness/readiness de API y worker
```

## Variables de entorno

No uses un único `.env` para los dos procesos. Copia `.env.api.example` a
`.env.api.local` para la API y `.env.worker.example` a `.env.worker.local` para
el worker. `.env.example` es el catálogo completo para scripts explícitos; no es
una configuración runtime. La lista normativa, rangos y reglas por ambiente
vive en `../../docs/operations/CFDI_INGESTION_CONFIGURATION_MATRIX.md`; no
copies defaults locales a producción.

```
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=
DB_LOGGING=false

# Sólo en .env.api.local
DB_API_USERNAME=balanz_api_login
DB_API_PASSWORD=

# Sólo en .env.worker.local
DB_WORKER_USERNAME=balanz_worker_login
DB_WORKER_PASSWORD=

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
APP_CORS_ORIGINS=http://localhost:3000
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

`APP_PORT` es opcional (default `3001`). Los archivos `.env*.local` están en
`.gitignore`. API y worker rechazan la credencial migrator y la del otro
runtime. El worker también rechaza/no registra configuración JWT, MFA, email,
cookies o auth. Sólo el provisioner efímero con doble gate puede resolver ambas
credenciales runtime.

Con Vault, usa AppRoles/policies separados aunque ambos conserven el
`SECRETS_SYSTEM` existente. Producción exige `SECRETS_ENVIRONMENT=prod` y
`SECRETS_SYSTEM` explícito. El worker sólo puede leer
`database/postgres-worker` y `cache/redis` si aplica; no `postgres-api`,
`auth/jwt`, `auth/mfa` ni `email/ses`.

## Arranque

Requiere Node.js `^20.19.0`, `^22.13.0` o `>=24.11.0`, además de Bun.

```bash
bun install
bun run --cwd apps/api start:api:dev   # API watch mode
```

El arranque falla si PostgreSQL o la configuración obligatoria no están
disponibles. Los procesos se inician por separado:

```bash
bun run --cwd apps/api start:api:dev      # API
bun run --cwd apps/api start:worker:dev   # worker con watch
bun run --cwd apps/api start:worker       # worker Nest en modo normal
```

Los scripts productivos arrancan únicamente el JavaScript ya compilado; no
ejecutan migraciones ni seeds de forma implícita:

```bash
bun run --cwd apps/api start:api:prod      # node dist/main
bun run --cwd apps/api start:worker:prod   # node dist/worker
```

El despliegue debe ejecutar `release:prepare` como paso explícito y exitoso
antes de iniciar ambos procesos.

## Preparar la base de datos

1. Registra rama, SHA y `git status`; confirma que la base es de desarrollo.
2. Crea un `pg_dump --schema-only` o documenta por qué no está disponible.
3. Ejecuta show/preflight, migraciones append-only y el seed idempotente:

```bash
bun run --cwd apps/api migration:show
bun run --cwd apps/api migration:preflight
bun run --cwd apps/api migration:run
bun run --cwd apps/api seed:run
bun run --cwd apps/api seed:run
```

La segunda ejecución de seeds debe ser idempotente. No uses `synchronize=true`,
`DROP DATABASE`, `TRUNCATE` general ni `migration:revert` sobre datos que deban
conservarse. Las pruebas destructivas sólo pueden usar una base `test_*` o
`*_test` inequívocamente aislada.

## Migraciones

```bash
bun run --cwd apps/api typeorm migration:generate src/database/migrations/<Nombre>
bun run --cwd apps/api migration:show
bun run --cwd apps/api migration:preflight
bun run --cwd apps/api migration:run
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

## Tests y build

```bash
bun run --cwd apps/api test
bun run --cwd apps/api test:e2e
bun run --cwd apps/api build
bun run --cwd apps/api qa:cfdi:postgres
bun run --cwd apps/api test:external:fiscal
```

`qa:cfdi:postgres` requiere PostgreSQL real y banderas QA protegidas; valida
migraciones, seeds, FKs, RLS, claim concurrente, leases, recovery,
idempotencia, reconciliación y shutdown. `test:external:fiscal` es opt-in y usa
Redis, MinIO, ClamAV y storage local reales. La infraestructura reproducible y
sus variables están documentadas en `../../infra/cfdi-phase0/README.md`.

## Plataforma fiscal compartida — Fase 0

Las migraciones `1787690600000-FiscalIngestionFoundation.ts` y
`1787690610000-FiscalRlsWorkerClaims.ts` crean exclusivamente
`stored_objects`, `ingestion_uploads`, `ingestion_jobs` e `ingestion_items`, sus
constraints/índices, RLS `ENABLE` + `FORCE`, roles mínimos y funciones de
claim/cancelación/reconciliación. API y worker deben conectarse con LOGINs
dedicados sin owner, superuser ni `BYPASSRLS`; el contexto fiscal se establece
sólo mediante `SET LOCAL` dentro de una transacción.

Redis publica una señal sin payload después del commit y el worker mantiene
polling PostgreSQL activo. El adapter local sólo es válido en desarrollo y en
Windows exige una raíz NTFS preasegurada; producción exige S3 privado con
SSE-KMS y ClamAV fail-closed. `/liveness`, `/readiness` y `/metrics` son los
únicos endpoints nuevos de plataforma.

Fase 1 permanece `NOT_STARTED`: no existe endpoint de carga XML, parser CFDI,
persistencia del dominio CFDI, lista/detalle ni UI de carga.

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
