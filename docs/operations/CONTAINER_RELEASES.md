# Releases de imágenes de Balanz

El flujo construye y prueba imágenes, las publica en `registry.hemia.cloud` y permite descargarlas por digest y arrancarlas mediante Docker Compose. El entorno público de `vps-dev` ya corre API, worker y web en el proyecto `hemia-balanz-live`. Nginx y los dominios se conservan: `contable.hemia.dev` → `127.0.0.1:5181`, `api-contable.hemia.dev` → `127.0.0.1:3021`; worker → `127.0.0.1:3002`.

Los tres procesos de Balanz se retiraron de PM2 y se guardó su lista vacía. El workflow antiguo `deploy-dev.yml` está deshabilitado en GitHub y `BALANZ_PM2_ENABLED=false` impide reactivarlo al integrar el guard local. La publicación automática a live sigue pendiente de autorización y de integrar los cambios de Balanz en `main`; no confundirla con el deploy manual ya probado.

## Versiones y tags

1. Agregar una nota con `bun run changeset`, seleccionando API, web o ambos.
2. Integrar el PR funcional en `main`. **Balanz release** ejecuta CI y abre/actualiza `changeset-release/balanz` mediante Changesets.
3. Revisar e integrar el PR de versión. API y web se versionan juntas; el primer changeset alinea las versiones existentes en `0.1.1`.
4. El workflow reconoce un cambio exclusivamente de versiones, changelogs, lockfile y notas consumidas. Vuelve a validar el commit, construye/prueba imágenes y publica `balanz-vX.Y.Z` junto con la GitHub Release **Balanz X.Y.Z**.

No ejecutar `version:balanz` en un PR funcional; ese comando pertenece al PR de versión. Los paquetes siguen privados y no se publican a npm. El worker comparte versión e imagen con API.

Imágenes:

- `registry.hemia.cloud/balanz/api:balanz-vX.Y.Z`
- `registry.hemia.cloud/balanz/web:balanz-vX.Y.Z`

La Release adjunta `release.json` (commit, imágenes por digest, dominios, hashes de migraciones y assets), `compose.json`, `balanz-deploy.py` y `SHA256SUMS`. Para desplegar se usan los digests del manifiesto, no una etiqueta mutable. No se publica `latest`.

El publicador reutiliza una imagen existente sólo si sus etiquetas OCI identifican el mismo commit y versión. Rechaza tags de otro commit, assets distintos y dominios inesperados. Un reintento de **Balanz release** permite únicamente el tag correspondiente a las versiones ya comprometidas en `main`; puede completar un borrador interrumpido sin sobrescribir lo ya publicado. Una release completa se reconoce y reutiliza.

## GitHub

Ya se prepararon las variables de repositorio `REGISTRY_HOST=registry.hemia.cloud`, `REGISTRY_USERNAME` y el secret `REGISTRY_PASSWORD` al configurar el registry. El job de publicación recibe las credenciales sólo después de pasar la validación y usa un `DOCKER_CONFIG` temporal. El runner usa HTTPS público; no requiere Tailscale ni acceso SSH a los VPS.

El PR de versión usa obligatoriamente la GitHub App organizacional `hemia-ci`. Hereda la variable `RELEASE_APP_CLIENT_ID` y el secret `RELEASE_APP_PRIVATE_KEY` de `hemia-labs`; no se copian claves al repositorio. La instalación selecciona los repositorios autorizados, incluido Balanz. El job solicita un token limitado a `balanz` con Contents y Pull requests de escritura; su `GITHUB_TOKEN` conserva sólo Contents de lectura. Si falta configuración de la App, el workflow falla explícitamente y no usa fallback. Los commits y PRs creados con el token de la App disparan CI normalmente, sin `actions: write` ni dispatch adicional. `main` debe exigir los checks de CI. La ejecución manual de **ci** continúa disponible para diagnóstico.

Las releases inmutables quedaron habilitadas en los ajustes de GitHub de Balanz para proteger los assets y tags después de publicar. Publicar siempre como borrador, adjuntar los assets y finalmente publicar evita intentar agregar assets a una release ya bloqueada.

## Imágenes y configuración

Se construyen desde la raíz del monorepo con Node 24, Bun 1.3.2 y lockfile congelado. La base Node está fijada por digest. Ambas imágenes ejecutan como usuario `node`; API sólo lleva dependencias de producción y el `dist` compilado, incluidos los XSD. La imagen final no incluye Bun, código fuente ni `.env`. El contexto excluye credenciales, llaves, builds y dependencias locales.

La web usa Next standalone exclusivamente durante el build Docker (`BALANZ_CONTAINER_BUILD=true`). El build de PM2 conserva `next start`. La URL pública de API se fija al compilar en `https://api-contable.hemia.dev/api/v1`; no puede cambiarse mediante una variable al arrancar la imagen ya construida.

La API mantiene `APP_HOST=127.0.0.1` por defecto para PM2. Dentro de Docker, pasar `APP_HOST=0.0.0.0`. El worker usa `node dist/worker.js` con `WORKER_HEALTH_HOST=0.0.0.0` y su propio perfil/env; no compartir JWT, MFA, email ni credenciales API/migrador con el worker.

## Deploy por SSH y Compose

`balanz-deploy.yml` valida una release estable e inmutable, comprueba que el tag corresponde al commit del manifiesto y que pertenece a `main`. Transfiere únicamente los cuatro assets, verifica sus hashes, descarga imágenes por digest, comprueba sus etiquetas OCI y ejecuta `docker compose up -d --no-build --wait`. Antes de arrancar consulta las migraciones pendientes mediante una conexión de sólo lectura; nunca migra ni ejecuta seeds automáticamente.

Configuración de GitHub en el environment `docker-validation`, restringido a `main`:

- Variables `VPS_HOST`, `VPS_SSH_KNOWN_HOSTS`, `BALANZ_DOCKER_DEPLOY_USER`.
- Secret `BALANZ_DOCKER_SSH_PRIVATE_KEY`: clave exclusiva con acceso Docker/sudo en el servidor. La clave antigua de PM2 no tiene esos permisos.
- `ENABLE_BALANZ_DOCKER_VALIDATION=true` habilita el deploy automático posterior a publicar una release. Sin la variable, se publica y se omite el deploy automático.

La provisión del host vive en `hemia-infra/ansible/playbooks/balanz-docker-validation.yml`. El root es `/srv/apps/balanz-docker-validation`; `shared/host.json` fija registro, base, red, storage y puertos. Los envs privados de API, worker y migrador están separados. Cada release conserva copias privadas de API/worker para recuperar también su configuración anterior. Una rotación de configuración requiere una nueva release.

Validación: API `127.0.0.1:53021`, worker `127.0.0.1:53002`, web `127.0.0.1:55181`. Usa PostgreSQL dedicado `balanz_docker_validation_test`, credenciales sintéticas y storage independiente. No usar los envs actuales de PM2: un segundo worker podría reclamar trabajo real. La configuración de prueba usa desarrollo explícito; no sustituye la revisión de S3/KMS, scanner y Payments del entorno real.

La operación manual `migrate` exige `backup_confirmation=I_HAVE_A_BACKUP`, ejecuta exclusivamente el migrador y no promueve la release. Debe realizarse después de comprobar el backup. Los roles mínimos API/worker se provisionan por una operación administrativa explícita; nunca al arrancar los servicios.

Sólo después de readiness de API/worker y respuesta de web se actualizan `current` y `previous`. Si falla el arranque y los hashes de migraciones coinciden, se recuperan las imágenes y configuración anteriores; no se revierten migraciones. `rollback` permite elegir una release anterior y exige reconocer la compatibilidad del esquema cuando cambia. El historial queda en `history.jsonl`. Si el esquema no permite recuperación automática, se detienen únicamente los servicios Docker de ese proyecto y se reporta el fallo.

El corte manual ya se completó. Antes de detener PM2 se probaron API y web con los envs reales en puertos alternos y se respaldó `accounting_dev` en el VPS 217. El preflight verificó las 26 migraciones con una sesión de sólo lectura. No se ejecutaron migraciones ni seeds reales.

El estado de PM2 previo al corte está en `/srv/apps/balanz-docker-live/shared/backups/pm2-before-docker-20261027T054038Z.json`; las instrucciones están en `PM2-ROLLBACK.txt`, dentro del mismo directorio privado. Para volver a PM2 hay que detener primero el proyecto Docker live y después restaurar el dump como `deploy`; nunca dejar dos workers reales en paralelo.

El deploy actual usa el bundle local sintético `balanz-v0.0.0` con imágenes fijadas por digest, previamente publicadas y probadas. No representa una GitHub Release estable de Balanz. El flujo de releases reales requiere integrar los Dockerfiles, workflows, controlador y Changesets en `main`.

Payments quedó conectado a producción mediante Console, producto `balanz_cfdi`, cliente `balanz-billing-service` y receptor `https://api-contable.hemia.dev/api/v1/payments/webhooks/license`. Console verificó sus cinco pasos: sistema, política Billing, receptor, contrato de recepción y configuración del backend. `PAYMENTS_CONNECTION` y `HEMIA_CLIENT_SECRET` están sólo en el env privado de API, fuera de Git; el secreto se validó contra Identity de producción. El backend conserva su entorno DEV, Vault, base `accounting_dev`, S3 y Redis existentes.

Para desbloquear Console se publicó y desplegó Legal `legal-v0.2.1` ([PR de corrección](https://github.com/hemia-labs/legal/pull/3), [PR de versión](https://github.com/hemia-labs/legal/pull/4)). Identity tenía `balanz-api` deshabilitada: se habilitó con el recurso público aprobado y se conservaron sus tres scopes existentes. Su endpoint PUT devolvió un error de persistencia (`api_id` nulo); el cambio acotado se aplicó administrativamente, sin cambiar relaciones ni esquema. Ese fallo de Identity queda pendiente de corrección separada.

## Verificación

```sh
bun install --frozen-lockfile --ignore-scripts
bun run test:release
bash infra/deploy/check-images.sh
```

`check-images.sh` construye `linux/amd64` con etiquetas de commit/versión y ejecuta `image-smoke.py`. En una máquina ARM se requiere emulación compatible; Turbopack puede fallar bajo QEMU. Preferir un motor amd64 nativo, como los runners de Actions. `DOCKER_HOST` permite seleccionar otro motor sin cambiar scripts.

El smoke test crea una red, PostgreSQL y almacenamiento únicos, sin publicar puertos. Usa sólo credenciales aleatorias: migra esa base desechable, provisiona roles API/worker distintos y mínimos, y prueba los entrypoints, bcrypt nativo, XSD, readiness a través de la red de contenedores, web/URL compilada y SIGTERM del worker. Ejecuta API/worker con `NODE_ENV=development` explícito, storage local y bypass explícito del scanner; la imagen mantiene `NODE_ENV=production` por defecto y sus reglas de producción no se debilitan. No ejecuta seeds. El entorno de prueba se elimina al terminar. `python3 infra/deploy/image-smoke.py --api-only` permite comprobar backend/worker por separado.

El comando completo de CI es `bash infra/deploy/checks.sh`; requiere además las variables `CI_DB_HOST`, `CI_DB_PORT`, `CI_DB_USERNAME`, `CI_DB_PASSWORD` y `CI_DB_DATABASE` del servicio PostgreSQL desechable de Actions (se traducen a `DB_*` únicamente dentro de la fase de migraciones), para conservar las pruebas existentes del ciclo de migraciones.

Se verificaron las tres imágenes en `vps-dev`, readiness de API/worker con PostgreSQL, S3 y Redis, respuesta HTTPS de API y web, página de login y conexión Payments `verified` en Console. No se ejecutaron cobros ni un checkout financiero real. La prueba aislada de recuperación también restauró la versión anterior ante una configuración inválida.
