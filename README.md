# Balanz

Balanz es un monorepo para una plataforma de gestión contable y administrativa.
Incluye un frontend web con Next.js y una API con NestJS, TypeORM y PostgreSQL.

Actualmente el proyecto contiene:

- Interfaz web con App Router, Tailwind CSS, componentes shadcn y soporte para español e inglés.
- API REST con NestJS.
- Módulo de usuarios con validación, permisos y persistencia en PostgreSQL.
- Configuración de JWT, guards de autenticación y servicio de contraseñas.
- Migraciones TypeORM y un runner preparado para seeds.

El contrato normativo de roles, permisos, alcance y decisiones de autorización
del MVP está en [`docs/AUTHORIZATION_MODEL.md`](docs/AUTHORIZATION_MODEL.md).

## Requisitos

- [Bun](https://bun.sh)
- PostgreSQL
- Node.js `^20.19.0`, `^22.13.0` o `>=24.11.0` (mínimo exigido por TypeORM 1.0.0).

## Instalación

```bash
npm install
cp apps/api/.env.api.example apps/api/.env.api.local
cp apps/api/.env.worker.example apps/api/.env.worker.local
```

Completa ambos archivos locales con valores propios del entorno. En particular,
`DB_API_PASSWORD` y `DB_WORKER_PASSWORD` deben ser contraseñas distintas de al
menos 16 caracteres. Estos archivos coinciden con `.env*.local`, están ignorados
por Git y nunca deben versionarse.

Con Bun:

```bash
bun install
cp apps/api/.env.api.example apps/api/.env.api.local
cp apps/api/.env.worker.example apps/api/.env.worker.local
```

### Preparar PostgreSQL local por primera vez

La API ya no usa la cuenta administradora de PostgreSQL. El migrador, la API y
el worker tienen identidades separadas:

- `DB_USERNAME`/`DB_PASSWORD`: sólo migraciones, seeds y aprovisionamiento.
- `DB_API_USERNAME`/`DB_API_PASSWORD`: sólo el proceso HTTP de NestJS.
- `DB_WORKER_USERNAME`/`DB_WORKER_PASSWORD`: sólo el worker.

Por este motivo, las variables administrativas que antes se utilizaban para
levantar todo el proyecto:

```dotenv
DB_USERNAME=balanz
DB_PASSWORD=balanz_local
```

ya no deben estar en `apps/api/.env`, `apps/api/.env.local` ni en el entorno del
proceso que ejecuta `npm run dev`. La API rechaza deliberadamente esas variables
durante el arranque. `DB_USERNAME` suele corresponder al owner o superusuario
local necesario para modificar el esquema; permitir que el servidor HTTP use
esa identidad ampliaría innecesariamente el impacto de una vulnerabilidad y
permitiría evadir las restricciones y los permisos destinados al runtime.

La API se conecta al mismo motor y a la misma base, pero utiliza
`DB_API_USERNAME`/`DB_API_PASSWORD`. El LOGIN técnico pertenece únicamente al
grupo PostgreSQL `balanz_api`, no es owner ni superusuario y recibe sólo los
permisos requeridos por el proceso HTTP. El worker aplica el mismo principio con
el grupo `balanz_worker`.

`DB_USERNAME` y `DB_PASSWORD` no fueron eliminadas del proyecto: siguen siendo
válidas para comandos administrativos como migraciones, seeds y
aprovisionamiento. La diferencia es que deben cargarse únicamente durante esos
comandos, desde `.env.migrator.local`, y no durante la ejecución normal de la
aplicación.

Crea `apps/api/.env.migrator.local` con la cuenta administradora de tu base
local. El patrón `.env*.local` también mantiene este archivo fuera de Git:

```dotenv
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5434
DB_DATABASE=balanz_sandbox
DB_USERNAME=<usuario-administrador-local>
DB_PASSWORD=<contraseña-administrador-local>
SECRETS_ENABLED=false
```

Asegúrate de que `.env.api.local` y `.env.worker.local` apunten al mismo host,
puerto y base, y define en ellos los LOGIN técnicos que deseas aprovisionar:

```dotenv
# .env.api.local
DB_API_USERNAME=balanz_api_login
DB_API_PASSWORD=<contraseña-api-local-de-16-o-más-caracteres>

# .env.worker.local
DB_WORKER_USERNAME=balanz_worker_login
DB_WORKER_PASSWORD=<contraseña-worker-local-de-16-o-más-caracteres>
```

Aplica migraciones y crea o actualiza los LOGIN técnicos desde un subshell. Al
terminar, las credenciales administrativas no permanecen exportadas en la
terminal que después ejecutará la aplicación:

```bash
(
  cd apps/api
  set -a
  source .env.migrator.local
  source .env.api.local
  source .env.worker.local
  set +a
  npm run migration:run
  CFDI_PROVISION_RUNTIME_LOGINS=true npm run db:runtime:provision
  npm run seed:run
)
```

Con Bun, sustituye los tres comandos `npm run` por `bun run`.

No copies `.env.example` a `.env` para levantar la aplicación: ese archivo es
un catálogo para tooling e incluye credenciales que los runtimes rechazan. Del
mismo modo, elimina `DB_USERNAME`, `DB_PASSWORD` y `DB_WORKER_*` de cualquier
archivo legado `.env` o `.env.local`; la API carga esos archivos como respaldo
y rechazará credenciales de otro perfil. Tampoco dejes esas variables exportadas
en la terminal antes de iniciar la API. Si antes ejecutaste
`source .env.local`, abre una terminal nueva o ejecuta:

```bash
unset DB_USERNAME DB_PASSWORD DB_WORKER_USERNAME DB_WORKER_PASSWORD
```

Los comandos siguientes muestran primero la variante con `npm` y después la
variante equivalente con `bun`.

## Estructura del proyecto

```text
balanz/
├── apps/
│   ├── web/                         # Frontend Next.js
│   │   ├── src/app/                 # Rutas, layouts y páginas
│   │   ├── src/components/           # Componentes de la aplicación y UI
│   │   ├── src/dictionaries/         # Traducciones es/en
│   │   └── public/                  # Recursos estáticos
│   │
│   └── api/                         # Backend NestJS
│       ├── src/
│       │   ├── common/              # Auth, guards, filtros y utilidades
│       │   ├── config/              # Configuración y validación de entorno
│       │   ├── database/
│       │   │   ├── data-source.ts   # DataSource usado por TypeORM CLI
│       │   │   ├── migrations/      # Cambios versionados del esquema
│       │   │   └── seeds/           # Datos iniciales/reutilizables
│       │   └── modules/users/        # Controller, service, DTOs y entidad
│       └── test/                    # Tests unitarios y e2e
│
├── package.json                     # Workspaces y scripts globales
└── bun.lock                         # Versiones bloqueadas
```

## Desarrollo

Después de completar la preparación local anterior, desde la raíz ejecuta:

```bash
npm run dev
```

Con Bun:

```bash
bun run dev
```

Inicia el frontend y la API en paralelo. Si PostgreSQL responde
`password authentication failed for user "balanz_api_login"`, la contraseña de
`DB_API_PASSWORD` no coincide con la usada durante `db:runtime:provision`;
vuelve a ejecutar el aprovisionamiento con los mismos archivos locales.

```bash
npm run dev:web
```

Con Bun:

```bash
bun run dev:web
```

Inicia únicamente el frontend en `http://localhost:5181`.

```bash
npm run dev:api
```

Con Bun:

```bash
bun run dev:api
```

Inicia únicamente la API en modo watch, normalmente en `http://localhost:3021`.

También puedes ejecutar los comandos directamente dentro de una app:

```bash
npm --prefix apps/web run dev
npm --prefix apps/api run start:dev
```

Con Bun:

```bash
bun run --cwd apps/web dev
bun run --cwd apps/api start:dev
```

## Migraciones de base de datos

La API usa `synchronize: false`; TypeORM no modifica automáticamente el esquema.
Cada cambio en una entidad debe reflejarse en una migración.

### Generar una migración

Después de modificar una entidad, genera la migración desde la raíz del proyecto:

```bash
npm --prefix apps/api run migration:generate
```

Con Bun:

```bash
bun run --cwd apps/api migration:generate
```

Genera una migración con el nombre base `Migration` dentro de
`apps/api/src/database/migrations`.

Para usar un nombre personalizado, ejecuta TypeORM directamente:

```bash
npm --prefix apps/api run typeorm -- migration:generate src/database/migrations/AddUserPhone
```

Con Bun:

```bash
bun run --cwd apps/api typeorm migration:generate src/database/migrations/AddUserPhone
```

La ruta personalizada debe permanecer dentro de `src/database/migrations`.

Compara las entidades con el esquema actual de PostgreSQL y crea un archivo con
las instrucciones `up` y `down`. Revisa el archivo generado antes de aplicarlo.

### Ejecutar las migraciones pendientes

Las migraciones requieren la identidad administrativa de
`.env.migrator.local`; no uses `DB_API_USERNAME` para aplicarlas:

```bash
(
  cd apps/api
  set -a
  source .env.migrator.local
  set +a
  npm run migration:run
)
```

Con Bun:

```bash
(
  cd apps/api
  set -a
  source .env.migrator.local
  set +a
  bun run migration:run
)
```

Aplica en PostgreSQL todas las migraciones que todavía no estén registradas como
ejecutadas.

### Revertir la última migración

```bash
npm --prefix apps/api run migration:revert
```

Con Bun:

```bash
bun run --cwd apps/api migration:revert
```

Ejecuta el método `down` de la última migración aplicada. Úsalo únicamente cuando
quieras deshacer el cambio más reciente.

### Verificar el estado de las migraciones

```bash
npm --prefix apps/api run typeorm -- migration:show
```

Con Bun:

```bash
bun run --cwd apps/api typeorm migration:show
```

Muestra qué migraciones ya fueron ejecutadas y cuáles están pendientes.

El DataSource del CLI usa `DB_*` cuando los secretos están deshabilitados y
resuelve `database/postgres` desde Vault cuando `SECRETS_ENABLED=true`, igual
que la aplicación Nest.

### Validar el ciclo completo en una base temporal

Sólo en `development/test` y con el scope Vault `dev`:

```bash
bun run --cwd apps/api qa:migrations
```

El comando crea una base `balanz_migration_qa_*`, aplica migraciones, ejecuta
el seed dos veces, valida rollback/reaplicación y drift, y elimina la base al
terminar. Requiere que el rol PostgreSQL pueda crear y eliminar bases.

## Seeds

El runner de seeds está preparado en `apps/api/src/database/seeds/run-seeds.ts`.
Cuando existan datos iniciales idempotentes, se agregan allí y se ejecutan con:

```bash
npm --prefix apps/api run seed:run
```

Con Bun:

```bash
bun run --cwd apps/api seed:run
```

## Build, pruebas y formato

```bash
npm run build
```

Con Bun:

```bash
bun run build
```

Compila todas las aplicaciones del monorepo.

```bash
npm --prefix apps/api run test
```

Con Bun:

```bash
bun run --cwd apps/api test
```

Ejecuta las pruebas unitarias de la API.

```bash
npm --prefix apps/api run test:e2e
```

Con Bun:

```bash
bun run --cwd apps/api test:e2e
```

Ejecuta las pruebas end-to-end de la API.

```bash
npm --prefix apps/api run format
```

Con Bun:

```bash
bun run --cwd apps/api format
```

Formatea los archivos TypeScript de la API con Prettier.

Para más detalles específicos de cada aplicación, consulta:

- [Documentación de la API](apps/api/README.md)
- [Documentación del frontend](apps/web/README.md)
