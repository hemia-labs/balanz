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
cp apps/api/.env.example apps/api/.env
```

Completa las variables de PostgreSQL y autenticación en `apps/api/.env` antes de
iniciar la API o ejecutar migraciones.

Con Bun:

```bash
bun install
cp apps/api/.env.example apps/api/.env
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

```bash
npm run dev
```

Con Bun:

```bash
bun run dev
```

Inicia el frontend y la API en paralelo.

```bash
npm run dev:web
```

Con Bun:

```bash
bun run dev:web
```

Inicia únicamente el frontend en `http://localhost:3000`.

```bash
npm run dev:api
```

Con Bun:

```bash
bun run dev:api
```

Inicia únicamente la API en modo watch, normalmente en `http://localhost:3001`.

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

```bash
npm --prefix apps/api run migration:run
```

Con Bun:

```bash
bun run --cwd apps/api migration:run
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
