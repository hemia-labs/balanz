# Invitaciones y ciclo de vida de membresías

Este diseño implementa TA-P0-002-01 conforme a `docs/docs2/control_mensual_cfdi.md`.
La identidad (`users`), la pertenencia al despacho (`memberships`), los permisos
efectivos y el alcance fiscal son conceptos independientes.

## Modelo y transiciones

```text
Invitation pending ── accept ──> accepted + Membership pending
                   ├─ expire ──> expired
                   └─ revoke ──> revoked

Membership pending ── activate after verified email ──> active
                   └─ revoke ──> revoked
Membership active ── suspend ──> suspended
                  └─ revoke ──> revoked
Membership suspended ── authorized reactivate ──> active
                     └─ revoke ──> revoked
```

Los estados terminales de una invitación no tienen transiciones de salida. Una
membresía revocada tampoco puede reactivarse; requiere un nuevo flujo de
incorporación. MFA no activa la membresía: es un requisito adicional de sesión
para acciones sensibles según la política central.

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
  debe crear o vincular esa única fila dentro de una transacción.
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
- `GET /organizations/:organizationId/invitations` lista exclusivamente el
  tenant activo y materializa expiraciones pendientes con auditoría.
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
mantiene la membresía `pending` hasta verificar el correo mediante la familia de
tokens independiente. Si la identidad ya tiene el correo verificado, la nueva
membresía puede quedar `active`; esto no crea una sesión ni concede alcance
fiscal por sí solo.
