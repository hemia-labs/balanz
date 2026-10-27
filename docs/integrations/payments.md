# Pagos desde Balanz

Billing selecciona el único proveedor activo configurado en el precio publicado. La selección queda guardada con la compra y los reintentos la conservan aunque cambie el catálogo; las suscripciones existentes conservan su proveedor. Si no hay una configuración única o el proveedor no tiene adaptador, Billing rechaza la operación antes de cobrar. PayPal conserva su implementación; registrar otro proveedor en el catálogo no implementa su integración. Balanz no envía un proveedor ni necesita credenciales de la pasarela.

Console genera `PAYMENTS_CONNECTION` con producto, destinos, cliente y funciones seleccionadas. Configura únicamente ese JSON y `HEMIA_CLIENT_SECRET` en el API. El JSON incluye `receiver` y `legal` cuando corresponden; no hay variables ni secretos separados para cada servicio. Una conexión solo de catálogo puede omitir ambos bloques y las URLs de retorno.

Para recibir licencias, `PAYMENTS_CONNECTION.receiver` debe incluir `audience` y `billingClientId` (el cliente OAuth emisor de Billing). En desarrollo se usan `balanz-api` y `billing-legal-service`. Billing debe registrar además el producto `balanz_cfdi` con receptor `http://localhost:3021/api/v1/payments/webhooks/license`, resource `http://localhost:3021` y audience `balanz-api`. La configuración valida que Identity autorice `billing.webhooks.deliver` para ese destino. Reinicia la API después de cambiar su configuración local.

Comprueba la conexión con el probe autenticado `GET /payments/webhooks/license?productCode=balanz_cfdi` y una entrega real: la revisión debe coincidir entre `billing_license_deliveries` en Billing y `payments_licenses` en Balanz. Sin token o con timestamp vencido debe responder `401`; reenviar una revisión ya aplicada devuelve `applied: false` y no renueva la confirmación. El trial local conserva sus fechas y puede dar acceso aunque la licencia pagada recibida esté revocada.

Balanz importa `@hemia/payments/nestjs` en `BillingModule`. `PaymentsApplicationService` conserva autorización de sesión, membresía activa, MFA, permiso `billing.manage`, contexto Legal y rutas de retorno por despacho. `PaymentsAccessService` lee la copia local confirmada bajo RLS y la combina con la prueba local; una cuenta sin suscripción no recibe una prueba automáticamente. La autorización fiscal y el trial no dependen de una llamada HTTP a Billing.

Los intentos de compra, su payload inmutable, reintentos y recuperación pertenecen a Billing. El SDK consume esa API central sin tablas de intentos en el producto. Balanz conserva `payments_checkout_attempts` histórica sin escrituras nuevas y mantiene su copia opcional en `payments_licenses`. La migración inicial `PaymentsInitial1792886500000` permanece intacta. La nueva `PaymentsSnapshots1793404800000` agrega `subscription` y `snapshot_version`, y una función SECURITY DEFINER con CAS por revisión para actualizar licencia y contrato atómicamente. Se ejecuta explícitamente solo en Balanz; nunca durante el arranque. Las revisiones duplicadas o anteriores no modifican la copia ni renuevan `confirmed_at`, que proviene de Billing.

Rutas relativas a `/api/v1`:

- `GET /payments/plans`, `POST /payments/checkout-attempts`, `GET /payments/checkout-attempts/:id`, `POST /payments/checkout-attempts/:id/retry`: usuario autorizado; el reintento conserva la misma key y solicitud original. No hay scheduler ni ejecución financiera local.
- `GET /payments/license`: lectura remota de licencia. `GET /payments/access`: acceso desde copia local y trial, sin HTTP a Billing. `POST /payments/sync`: recuperación explícita de la organización autenticada; consulta un snapshot remoto fuera de la transacción y aplica solo una revisión mayor antes de releer la copia. Conserva sesión, tenant y CSRF; no escanea organizaciones ni ejecuta cobros. Un fallo de sincronización no bloquea el acceso local ni un trial vigente.
- `POST /payments/legal/prepare`, `POST /payments/legal/accept`: aceptación del comprador autenticado cuando Legal está configurado.
- `POST /payments/legal/context`: contexto actual de autorización, protegido con OAuth de Legal.
- `GET|POST /payments/webhooks/license`: prueba y recepción de licencia, protegidas con OAuth de Billing y `x-billing-timestamp`.
- `GET /payments/integration-status`: comprobación de Console autenticada, consulta el catálogo con la credencial instalada y devuelve únicamente configuración pública.
- `GET /payments/ready`: confirma la configuración del SDK y su autoridad central, sin migrar ni llamar servicios externos. La copia local necesita su migración explícita; el SDK no administra ese esquema.

Los endpoints de usuario conservan CSRF y cookies HttpOnly. Los callbacks llevan metadata pública del SDK y autenticación OAuth propia. No existen aliases `/billing/*` ni páginas de retorno antiguas bajo `/settings/billing/checkout`; se usan las páginas de cada despacho.

Balanz fija una versión exacta de `@hemia/payments` en el manifiesto y ambos lockfiles. El módulo configura `onSnapshot` para la copia local; no configura `dataSource` ni `scopeTransaction` en el SDK. La adopción requiere los endpoints centrales de intentos y snapshots del backend nuevo de Billing. Publicar el SDK por CI no fusiona ni despliega ese backend; hasta desplegarlo, esas operaciones remotas no están disponibles.

El retorno del checkout sólo muestra la contratación activa cuando el intento está activo y `/payments/access` confirma acceso `billing` con el mismo `subscriptionId` y `planCode`. Hasta recibir la licencia sigue consultando durante la ventana de confirmación y permite actualizar manualmente. Al confirmarse, emite `balanz:billing-access-changed`. La pantalla de planes también consulta el acceso cada cinco segundos mientras está visible y al recuperar el foco; no realiza cobros ni modifica suscripciones.

Las rutas `/checkout/success` y `/checkout/cancel` usan el layout privado de Balanz; la pantalla de pago conserva su layout independiente. No es necesario permanecer en el retorno: el intento pendiente se recuerda en `sessionStorage`, aislado por organización y usuario, desde su creación. Mientras la app está visible, el aviso global verifica ese intento cada cinco segundos hasta confirmar la licencia exacta, un estado terminal o un `404`. Al activarse muestra un aviso con acceso a la suscripción. Esto no es una notificación push con el navegador cerrado; el webhook actualiza el backend independientemente del navegador.

El webhook entrega un snapshot con licencia, suscripción, revisión y fecha de confirmación. Balanz expone `renewalAt` desde `subscription.nextBillingTime` únicamente si la licencia corresponde al mismo contrato y plan, la suscripción está activa y no tiene cancelación. Descarta fechas inválidas o pasadas. `validUntil` limita el acceso técnico, nunca representa la próxima renovación. La copia vence al menor valor entre 24 horas desde `confirmedAt` y el `validUntil` contractual. Las filas históricas marcadas `snapshot_version=0` mantienen únicamente su licencia validada hasta ese mismo límite; una fila nueva corrupta o revocada nunca usa ese fallback. Los trials mantienen sus fechas y no se crean ni renuevan al sincronizar.

## Cambio y cancelación de planes

Console debe incluir la función **Cambiar y cancelar suscripciones** en la conexión del producto. Requiere aplicar explícitamente la migración Legal `SubscriptionManagementCapability1793062800000` y regenerar la conexión y permisos desde Console; actualizar el SDK no concede permisos OAuth. La gestión usa `billing.subscriptions.manage` y lecturas de catálogo/checkout. No se deben habilitar scopes con cambios manuales permanentes fuera de Console.

- `GET /payments/subscription`: suscripción contractual actual, con cancelación y cambio pendientes; incluye una cancelada si conserva período pagado. El fin contractual proviene de `currentPeriodEnd`/`cancellation.effectiveAt`, nunca del TTL técnico del SDK.
- `POST /payments/subscription/change-plan`: crea el intento durable para el cambio en el proveedor del contrato. Conserva las entradas de checkout y agrega `expectedSubscriptionId` para detectar una pantalla obsoleta. Reutiliza documentos, seguimiento y reintentos; no crea otro contrato del proveedor.
- `POST /payments/subscription/cancel`: `{idempotencyKey, expectedSubscriptionId, reason?}`; el servidor deriva organización y actor, compara la suscripción esperada y devuelve `409` si cambió. La confirmación de la UI es explícita. Billing conserva la intención y reintenta resultados ambiguos.

Política elegida por el usuario: el upgrade se activa al confirmar la autorización de las próximas renovaciones y el pago único del prorrateo. El downgrade aplica en la próxima renovación, conservando los días pagados. No hay regreso automático al plan anterior después de un upgrade.

Antes de aceptar los documentos, Balanz consulta `GET /payments/subscription/plan-change-quote?targetPlanCode=…&targetPlanPriceCode=…` y muestra el importe a pagar ahora, moneda, importe recurrente y fecha del próximo cobro. Billing calcula la cotización; Balanz no calcula dinero ni clasifica el cambio localmente. El cambio envía `expectedAmountDueNow` como máximo aceptado: el importe puede disminuir por el tiempo transcurrido, pero nunca aumentar sin revisar otra cotización.

El retorno consulta el estado mediante GET sin ejecutar cobros. El comprador pulsa confirmar para llamar `POST /payments/checkout-attempts/:id/confirm`, que verifica la autorización y continúa el flujo. `planChange.action=approve_subscription|approve_payment|none` identifica la acción vigente; su `checkoutUrl` sustituye el enlace anterior, incluso cuando es nulo. Balanz acepta únicamente URLs HTTPS sin credenciales ni puertos no estándar recibidas del backend autenticado. Billing valida los dominios de autorización dentro del adaptador del proveedor. El pago proporcional necesita una aprobación separada del acuerdo de renovación. La recuperación conserva el mismo intento durable y muestra una acción explícita para retomarlo.

`planChange.state=scheduled` confirma el downgrade autorizado sin adelantar beneficios; `effective` permite confirmar el acceso del plan objetivo únicamente cuando Balanz recibió su licencia exacta. Un contrato activo o una licencia antigua no confirman el upgrade mientras falte el prorrateo. El retorno y el aviso global distinguen cambio programado, acción pendiente y licencia activa. El enlace de autorización pendiente se recupera únicamente para el mismo comprador autorizado.

Una cancelación deja de renovar y conserva el acceso pagado hasta su vencimiento. La UI distingue confirmación pendiente y cancelación programada. También permite cancelar cuando existe un cambio pendiente; esa confirmación explica que se descarta dicho cambio. Todas las rutas mantienen sesión, tenant, `billing.manage`, MFA y CSRF.

Validación local: pruebas de API/SDK con transporte y proveedor simulados; no ejecutar recorridos financieros reales para verificar esta mejora. La preparación del catálogo y regeneración de la conexión son pasos explícitos; no se ejecutan al arrancar Balanz. En el ambiente local ya se aplicaron los catálogos Legal/Identity y Console mostró «Conexión comprobada». Las consultas OAuth/SDK reales de suscripción/licencia fueron correctas y conservaron el contrato existente.


Validación de la adopción: pruebas unitarias del API, build con el paquete candidato y fixture PostgreSQL desechable `bash apps/api/test/payments-snapshots.docker.sh`. El fixture verifica migración aditiva, historial, CAS y confirmación de origen, revocación, TTL, roles/RLS y trial durante una caída de Billing. No se ejecutan migraciones ni recorridos financieros en servicios residentes.

## Compatibilidad del SDK 0.9.0

Balanz fija `@hemia/payments` en `0.9.0`. Requiere Billing >=1.0.1 y <2.0.0 con el contrato `billing.integrations.v1`. Antes de desplegar Balanz, despliega Billing y aplica sus migraciones explícitamente. Ejecuta `bun run --cwd apps/api billing:identity:check` contra la configuración del entorno: verifica compatibilidad y lectura del catálogo con la credencial instalada, sin crear ni cancelar pagos. Un fallo bloquea la comprobación.

`GET /payments/integration-status` autenticado verifica la compatibilidad remota antes de devolver `ready: true`; `/payments/ready` sólo comprueba inicialización local.


## Abandono local de una contratación pendiente

«Conservar mi plan actual» requiere confirmar el descarte y llama `POST /payments/checkout-attempts/:id/cancel`. Para una alta aún sin aprobar ni pagar, Billing registra un abandono durable del contrato exacto y devuelve `{cancelled: true, abandoned: true}`. Esto libera la selección de planes sin esperar a que PayPal permita cancelar su recurso. No cancela ni extiende el plan o trial vigente. La X sólo vuelve a planes y conserva el intento para retomarlo.

El retorno histórico expone `abandoned: true`, retira el enlace de aprobación y nunca concede acceso. Los webhooks y la conciliación mantienen el contrato abandonado como cancelado aunque PayPal envíe una aprobación, activación, pago o reverso posterior. La recuperación durable reintenta cancelar exclusivamente ese contrato antiguo cuando el proveedor lo permite; no afecta una contratación posterior.

Un enlace antiguo puede seguir siendo aprobable en PayPal mientras permanezca `APPROVAL_PENDING`. El bloqueo local impide que esa aprobación cambie el plan, pero no garantiza que PayPal no llegue a cobrar antes de la cancelación. Los pagos tardíos se conservan para auditoría y revisión de devolución; esta integración no realiza reembolsos automáticos. No se deben marcar como reembolsados sin la confirmación del proveedor.

## Volver a activar una renovación cancelada

`POST /payments/subscription/resume-renewal` recibe únicamente `idempotencyKey` y `expectedSubscriptionId`. El SDK deriva el contexto y el contrato; Billing fija plan, precio, impuestos y fecha desde el período pagado de la suscripción cancelada. La operación central `resume_renewal` crea una autorización nueva con inicio futuro, sin cargo inicial. No modifica la licencia ni la cancelación del contrato anterior.

El intento expone `renewalResume` y la suscripción anterior incluye `pendingRenewal` para recuperar el recorrido sin depender del almacenamiento del navegador. La aprobación en PayPal marca la renovación como programada; no constituye un pago ni otorga una licencia nueva. El acceso actual conserva su vigencia. El nuevo período requiere un pago confirmado desde la fecha prevista.

La UI muestra el importe cero de hoy y el total de la próxima renovación antes de abrir PayPal. La X sólo navega. Descartar o cancelar esa autorización futura afecta únicamente al nuevo acuerdo; el período pagado anterior se conserva. Una nueva solicitud usa otra clave sólo después de confirmar el descarte del intento anterior; las respuestas ambiguas conservan la misma clave.

## Cambiar el plan de la próxima renovación

Si existe una renovación futura autorizada, la selección de planes permite cambiar esa renovación mediante `POST /payments/subscription/change-renewal-plan`. El navegador envía la clave idempotente, los identificadores esperados del contrato pagado y del acuerdo futuro, y los códigos del plan y precio objetivo. Billing conserva la fecha del período pagado, valida el total del plan del proveedor y fija el importe de hoy en cero.

La operación `change_renewal_plan` revisa el mismo acuerdo futuro, sin crear otro contrato ni cobrar un prorrateo. `renewalPlanChange` describe el intento y `pendingRenewalPlanChange` permite recuperarlo desde Mi suscripción. La autorización anterior se conserva hasta confirmar el nuevo plan en PayPal; entonces `pendingRenewal` refleja el plan y precio futuros. El plan y la licencia del período actual no cambian.

Cerrar sólo vuelve a planes. Cancelar este cambio restaura la renovación anterior y puede requerir consentimiento de PayPal; no cancela el acuerdo futuro completo. Las aprobaciones atrasadas de enlaces descartados requieren conciliación durable de la autorización anterior.
