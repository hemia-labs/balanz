# Balanz: token de servicio de Identity para Billing

En `apps/api/.env.api.local`, completa `BILLING_CLIENT_SECRET` con el secreto del cliente
`balanz-billing-service`, audiencia `billing-api`, grant `client_credentials` y scopes:

- `billing.integration.catalog.read`
- `billing.integration.checkout.create`
- `billing.integration.checkout.read`

La URL local es `BILLING_IDENTITY_TOKEN_URL=http://localhost:4000/oauth/token`.
En producción usa HTTPS y un secreto inyectado por el entorno de despliegue; no
versiones archivos locales ni expongas credenciales al frontend.
`BILLING_IDENTITY_TIMEOUT_MS` está en milisegundos: default 5000, rango 100–30000.

Desde la raíz ejecuta `bun run --cwd apps/api billing:identity:check`. Sin secreto,
comprueba discovery y client_credentials. Con secreto, también solicita un token;
no imprime credenciales ni tokens. Esta última comprobación emite un token real.
No conecta a PostgreSQL ni ejecuta migraciones o seeds.

`BillingModule` exporta `BillingIdentityService.getAccessToken()` para llamadas
server-to-server. Reutiliza el token en memoria, lo renueva 30 segundos antes de
vencer y comparte una única petición entre llamadas simultáneas. No agrega login
SSO ni endpoints para entregar tokens al navegador. El worker rechaza estas variables.
La integración no llama a Identity al arrancar; sin secreto falla al solicitar token.

Pendiente para checkout: registrar la política del cliente en Billing y conectar
los endpoints de catálogo/checkout. Balanz mantiene su autenticación propia; sus
UUID de usuario y organización son locales. Debe definirse su correspondencia con
Hemia Legal antes de enviar identificadores en una compra.
