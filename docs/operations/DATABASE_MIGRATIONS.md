# Migraciones incrementales

La ruta normal contiene las 19 migraciones originales en
`apps/api/src/database/migrations/`. Se retiró la consolidación local:
no existe una migración `InitialSchema` ni un paso de adopción del historial.
Los archivos aplicados se conservan sin modificar; los cambios futuros requieren
una migración nueva y actualizar el manifiesto y sus validaciones.

## Base existente

Con un respaldo verificado y la configuración del migrador dirigida al ambiente
correcto, ejecutar desde `apps/api`:

```bash
bun run migration:show
bun run release:prepare
```

`release:prepare` ejecuta preflight, migraciones pendientes y seeds. El preflight
actual está restringido a development/test y, con Vault, al scope dev.
No borrar ni falsificar el historial. Los identificadores `id` no necesitan ser
consecutivos; se validan nombres y timestamps. Si el historial contiene las 15
migraciones hasta `CfdiUsageCodeLength1787690710000`, quedan pendientes las cuatro
de invitaciones 080, 081, 082 y 083. Su SQL modifica el esquema y puede actualizar
datos; comprobar primero sobre una copia de la base.

La restauración del código anterior no revierte migraciones ya confirmadas.
Si algún ambiente llegó a aplicar la inicial consolidada, detener el despliegue:
ese historial necesita una revisión separada antes de usar la cadena original.

## Base nueva e infraestructura

Infraestructura prepara PostgreSQL 16+, la base, `uuid-ossp`, usuarios y secretos.
Las migraciones crean el esquema incrementalmente. El bootstrap fiscal histórico
requiere superusuario y conserva la creación condicional de grupos NOLOGIN;
los usuarios LOGIN y contraseñas siguen siendo responsabilidad de infraestructura.
No ejecutar con las credenciales runtime de API o worker.

## CI y deploy DEV

Ambos usan PostgreSQL temporal en el runner, con `SECRETS_ENABLED=false` y
credenciales ficticias. Preparan `uuid-ossp`, ejecutan `qa:migrations` sobre la base
vacía, aplican la cadena original y repiten QA sobre la base migrada para comprobar
el esquema y seeds idempotentes. El QA revierte sus cambios transaccionales.
No se consulta Vault ni se usan bases reales en estas pruebas.

El deploy conecta al VPS solamente después de estas validaciones. Allí ejecuta
`release:prepare` con la configuración real del migrador.
