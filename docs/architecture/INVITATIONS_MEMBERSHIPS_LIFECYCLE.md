# Invitaciones y ciclo de vida de membresías

Este diseño implementa TA-P0-002-01 conforme a
`docs/architecture/CONTROL_MENSUAL_CFDI_V3_3.md` y a la actualización de la HU
del 19 de agosto de 2026 sobre membresía titular pendiente.
La identidad (`users`), la pertenencia al despacho (`memberships`), los permisos
efectivos y el alcance fiscal son conceptos independientes.

## Modelo y transiciones

```text
Invitation pending ── accept ──> accepted + Membership pending
                   ├─ expire ──> expired
                   └─ revoke ──> revoked

Membership pending ── verified email + confirmed MFA ──> active
                   └─ revoke ──> revoked
Membership active ── suspend ──> suspended
                  └─ revoke ──> revoked
Membership suspended ── authorized reactivate ──> active
                     └─ revoke ──> revoked
```

Los estados terminales de una invitación no tienen transiciones de salida. Una
membresía revocada no puede reactivarse directamente: una invitación nueva debe
reutilizar bajo lock la misma fila, devolverla a `pending` y limpiar sus fechas
de activación, suspensión y revocación. Sus permisos personalizados y
asignaciones anteriores quedan revocados y no se recuperan automáticamente.

## Integridad y aislamiento

- `invitations` conserva organización, correo original y normalizado, rol,
  creador, hash de token, expiración y trazabilidad de envío/transición.
- Sólo puede existir una invitación `pending` por organización y correo
  normalizado. El índice parcial permite conservar el historial terminal.
- `token_hash` es único, no seleccionable por defecto desde TypeORM y nunca debe
  aparecer en logs, auditoría ni respuestas. El token original sólo vive en el
  proceso que construye y envía el enlace.
- Las claves foráneas compuestas garantizan que quien invita y la membresía
  vinculada al aceptar pertenecen a la misma organización de la invitación.
- `memberships` mantiene `UNIQUE (organization_id, user_id)`; una aceptación
  crea la fila o reutiliza exclusivamente una fila `revoked` dentro de la misma
  transacción. Cualquier otro estado existente produce conflicto.
- `proposed_permissions` es sólo una propuesta serializada. Aceptarla no crea
  concesiones en `membership_permissions` ni asignaciones en
  `account_assignments`.
- La titularidad se deriva exclusivamente de `organizations.owner_user_id`.

## Nota para Backend

La aceptación operativa debe bloquear la invitación `pending`, comparar el hash
del token, comprobar `expires_at`, validar que la organización esté `active`,
crear o vincular `users` y hacer un upsert idempotente de `memberships` en una
sola transacción. La misma transacción cambia la invitación a `accepted`, fija
`accepted_membership_id` y escribe `audit_events`, sin incluir token ni hash.

Expirar y revocar deben usar actualizaciones condicionales desde `pending`, de
modo que repetir la operación no produzca transiciones ni auditorías duplicadas.
Suspender o revocar una membresía debe revocar sus `auth_sessions` activas e
invalidar su caché de autorización. Activar requiere usuario y organización
activos, correo verificado y no crea contexto de tenant, capacidades ni cuentas.

## API implementada

- `POST /organizations/:organizationId/invitations` crea y envía una invitación.
- `POST /invitations/:invitationId/resend` rota el token y reintenta una
  invitación pendiente. La entrega se registra como `pending`, `sent` o
  `failed`; la API sólo confirma el envío después de que el proveedor responde.
- `GET /organizations/:organizationId/invitations` lista exclusivamente el
  tenant activo con paginación (`page`, `limit`, máximo 100). Es estrictamente
  de lectura y proyecta como `expired` las invitaciones pendientes cuya fecha
  límite ya pasó; no atribuye una transición automática al usuario que consulta.
- `POST /invitations/:invitationId/accept` consume el token mediante SHA-256 y
  crea o vincula identidad y membresía dentro de una transacción.
- `POST /invitations/:invitationId/revoke` revoca idempotentemente una
  invitación pendiente.
- `PATCH /memberships/:membershipId/suspend`, `PATCH
/memberships/:membershipId/reactivate` y `POST
/memberships/:membershipId/revoke` aplican el ciclo autorizado y protegen la
  membresía titular.

Las operaciones administrativas requieren tenant activo, `members.manage`, MFA
y reautenticación reciente. Suspender o revocar invalida las sesiones activas de
la membresía después de confirmar la transición. El enlace enviado por correo
transporta `invitationId` y token en el fragmento URL; el backend nunca devuelve
ni registra el token o su hash.

Para una identidad nueva, la aceptación exige nombre, apellido y contraseña y
mantiene la membresía `pending`. Verificar el correo habilita la configuración
de MFA, pero no activa por sí solo la membresía. `completeMfa` realiza la
transición `pending → active` al confirmar el enrolamiento TOTP y vuelve a
comprobar que el correo esté verificado. Una identidad existente sólo puede
quedar `active` al aceptar si ya tiene correo verificado y un factor MFA activo;
esto no crea una sesión ni concede alcance fiscal por sí solo.
