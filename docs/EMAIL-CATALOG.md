# Catálogo de correos de CFDIOS

## Propósito

Este documento define los correos transaccionales recomendados para CFDIOS,
el remitente que debe usarse, el evento que los dispara, sus destinatarios y
su objetivo.

Actualmente están implementados el correo de verificación y la bienvenida
posterior a la confirmación. Los demás correos deben agregarse cuando exista el
evento correspondiente en el backend; no deben dispararse desde pantallas demo
ni desde el frontend.

## Remitentes

El proyecto necesita únicamente tres remitentes:

~~~text
CFDIOS <auth@cfdios.hemia.dev>
CFDIOS <notifications@cfdios.hemia.dev>
CFDIOS <billing@cfdios.hemia.dev>
~~~

| Remitente | Uso |
| --- | --- |
| `auth@cfdios.hemia.dev` | Identidad, acceso y alertas de seguridad |
| `notifications@cfdios.hemia.dev` | Actividad operativa, equipo, CFDI, SAT y obligaciones |
| `billing@cfdios.hemia.dev` | Prueba gratuita, planes, pagos y facturación |

Los tres usan `support@hemia.dev` como `Reply-To` mientras no existan buzones
propios para cada categoría. Estas direcciones son remitentes de SES, no
buzones para recibir correo.

## Correos de identidad y seguridad

| Tipo | Remitente | Evento de origen | Destinatario | Objetivo | Estado |
| --- | --- | --- | --- | --- | --- |
| Verificación de correo | `auth@cfdios.hemia.dev` | Registro o reenvío desde `AuthService` | Correo de la cuenta | Confirmar la propiedad del correo y activar la cuenta | Implementado |
| Recuperación de contraseña | `auth@cfdios.hemia.dev` | Solicitud y token creados por el backend | Correo de la cuenta | Restablecer la contraseña mediante un enlace temporal | Pendiente de backend |
| MFA activado | `auth@cfdios.hemia.dev` | Confirmación exitosa del TOTP | Correo de la cuenta | Informar que se agregó un segundo factor | Recomendado siguiente |
| MFA desactivado | `auth@cfdios.hemia.dev` | Desactivación confirmada del TOTP | Correo de la cuenta | Alertar inmediatamente de un cambio sensible | Recomendado siguiente |
| Correo o contraseña modificados | `auth@cfdios.hemia.dev` | Cambio confirmado por el backend | Correo anterior y/o actual, según el cambio | Alertar sobre modificaciones de credenciales | Futuro |
| Acceso sospechoso | `auth@cfdios.hemia.dev` | Detección de dispositivo o ubicación nueva | Correo de la cuenta | Permitir reconocer o reportar el acceso | Sólo cuando exista detección confiable |

No se debe enviar un correo por cada inicio de sesión normal. Las alertas de
acceso requieren primero un mecanismo real para reconocer dispositivos o
riesgo; comparar únicamente direcciones IP produciría demasiado ruido.

## Correos de activación y facturación

| Tipo | Remitente | Evento de origen | Destinatario | Objetivo | Estado |
| --- | --- | --- | --- | --- | --- |
| Bienvenida y cuenta activada | `notifications@cfdios.hemia.dev` | Confirmación del correo, después de crear la sesión | Titular de la cuenta | Confirmar la activación, informar el trial y llevar al onboarding | Implementado |
| Prueba gratuita iniciada | `billing@cfdios.hemia.dev` | Suscripción `pending → trialing` | `Organization.billingEmail` y titular | Informar plan y fechas de la prueba | Recomendado siguiente |
| Prueba próxima a terminar | `billing@cfdios.hemia.dev` | Scheduler sobre `trialEndsAt` | `Organization.billingEmail` y titular | Avisar 7, 3 y 1 día antes del vencimiento | Requiere scheduler |
| Prueba terminada | `billing@cfdios.hemia.dev` | Vencimiento de `trialEndsAt` | `Organization.billingEmail` y titular | Explicar limitaciones y cómo continuar | Requiere ciclo de suscripción |
| Pago confirmado | `billing@cfdios.hemia.dev` | Webhook confirmado del proveedor de pagos | `Organization.billingEmail` | Confirmar importe, periodo y referencia | Requiere proveedor de pagos |
| Pago rechazado | `billing@cfdios.hemia.dev` | Webhook fallido del proveedor de pagos | `Organization.billingEmail` y titular | Solicitar actualizar el método de pago | Requiere proveedor de pagos |
| Plan modificado o cancelado | `billing@cfdios.hemia.dev` | Cambio persistido de suscripción | `Organization.billingEmail` y titular | Mantener evidencia del plan y fecha efectiva | Requiere ciclo de suscripción |

## Correos de equipo y acceso

| Tipo | Remitente | Evento de origen | Destinatario | Objetivo | Estado |
| --- | --- | --- | --- | --- | --- |
| Invitación al despacho | `notifications@cfdios.hemia.dev` | Membresía pendiente con invitación persistida | Usuario invitado | Mostrar organización, rol y enlace de aceptación | Requiere flujo de invitaciones |
| Invitación aceptada | `notifications@cfdios.hemia.dev` | Membresía `pending → active` | Titular o administrador | Confirmar la incorporación del miembro | Futuro |
| Rol o permisos modificados | `notifications@cfdios.hemia.dev` | Cambio de membresía persistido | Miembro afectado | Dar trazabilidad a cambios de autorización | Futuro |
| Acceso suspendido o revocado | `notifications@cfdios.hemia.dev` | Membresía suspendida o revocada | Miembro afectado | Informar la pérdida de acceso y su organización | Futuro |

## Correos operativos

Estos correos sólo deben implementarse después de que CFDI, SAT, certificados,
procesos, periodos y obligaciones tengan servicios y eventos persistidos en el
backend. Actualmente esas áreas son principalmente demostrativas.

| Tipo | Remitente | Evento de origen | Destinatario | Objetivo |
| --- | --- | --- | --- | --- |
| Proceso completado | `notifications@cfdios.hemia.dev` | Descarga, carga, exportación o generación terminada | Usuario solicitante | Avisar que el resultado está listo y enlazar a la aplicación |
| Proceso con errores | `notifications@cfdios.hemia.dev` | Proceso en estado de error | Solicitante y responsable del cliente | Mostrar contexto seguro y permitir revisar o reintentar |
| Conexión SAT requiere atención | `notifications@cfdios.hemia.dev` | Estado persistido de conexión inválida | Responsable y administrador | Recuperar la conexión antes de afectar procesos |
| e.firma o CSD próximo a vencer | `notifications@cfdios.hemia.dev` | Scheduler sobre la vigencia persistida | Responsable y titular | Avisar con 30, 15, 7 y 1 día de anticipación |
| Incidencia bloqueante de CFDI | `notifications@cfdios.hemia.dev` | Incidencia que impide cerrar un periodo | Responsable del cliente | Dirigir la atención a un problema que bloquea la operación |
| Periodo cerrado o reabierto | `notifications@cfdios.hemia.dev` | Transición persistida del periodo | Responsable y administradores | Mantener trazabilidad de una operación sensible |
| Archivo DIOT, IEPS o exportación listo | `notifications@cfdios.hemia.dev` | Archivo generado correctamente | Usuario solicitante | Entregar un enlace autenticado y temporal |
| Resumen diario | `notifications@cfdios.hemia.dev` | Agregación programada de eventos no urgentes | Responsable de cada cliente | Agrupar novedades sin enviar un correo por evento |

Los eventos críticos o bloqueantes se envían inmediatamente. Los CFDI nuevos,
procesos exitosos y novedades rutinarias deben agruparse en un resumen para no
saturar a los usuarios.

## Orden recomendado de implementación

1. Mantener la verificación de correo existente.
2. Agregar recuperación de contraseña y alertas de activación/desactivación de
   MFA.
3. Enviar bienvenida e inicio de prueba al confirmar el correo.
4. Agregar recordatorios sobre `trialEndsAt` cuando exista un scheduler.
5. Incorporar invitaciones cuando el backend pueda crear y aceptar membresías.
6. Agregar facturación cuando se integre un proveedor de pagos.
7. Implementar correos CFDI, SAT y fiscales sólo al existir procesos reales.

## Reglas de seguridad y entrega

- El frontend nunca selecciona el remitente, el Configuration Set ni el nombre
  final del template.
- Los templates y categorías se resuelven mediante allowlists del backend.
- Los tokens sólo se incluyen en enlaces HTTPS temporales y nunca se registran
  en logs.
- No se adjuntan XML, e.firma, CSD, llaves privadas ni información fiscal
  sensible. El correo enlaza a una vista autenticada.
- Los enlaces de descarga deben ser temporales, de un solo propósito y estar
  autorizados para el usuario destinatario.
- Los destinatarios se calculan desde usuarios, membresías y responsables
  persistidos; no desde datos arbitrarios enviados por el navegador.
- La entrega actual es directa y tolera el fallo de SES sin revertir la
  operación de negocio. Cuando el volumen lo justifique, migrar a outbox y
  reintentos para no perder correos por una caída temporal de SES.
- Deben registrarse `MessageId`, tipo, destinatario normalizado, estado e
  intentos, pero nunca el token ni `TemplateData` completo.
- Los eventos de SES deben contemplar entrega, rendering failure, bounce,
  complaint y supresión.

## Convención de templates

Los templates siguen la convención:

~~~text
cfdios-<environment>-<event>
~~~

Ejemplos iniciales:

~~~text
cfdios-dev-email-verification
cfdios-dev-welcome
cfdios-dev-password-reset
cfdios-dev-mfa-enabled
cfdios-dev-mfa-disabled
cfdios-dev-account-activated
cfdios-dev-trial-started
cfdios-dev-trial-ending
cfdios-dev-member-invitation
cfdios-dev-process-failed
cfdios-dev-certificate-expiring
cfdios-dev-daily-digest
~~~

El welcome sólo envía a SES estos campos: `assetsBaseUrl`, `first_name`,
`organization_name`, `trial_end_date` y `onboardingUrl`.

No se deben crear templates separados por dirección remitente si el contenido
y el evento son iguales. El template representa el caso de uso; el remitente
representa su categoría.
