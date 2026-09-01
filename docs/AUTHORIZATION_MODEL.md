# Modelo de roles, permisos y alcance del MVP

Este documento es el contrato normativo de autorización para HU-P0-003. Define
el modelo que deben consumir la API, los workers, los procesos de exportación y
el frontend. La implementación se realiza en las subtareas posteriores.

## Separación de conceptos

- **Rol**: conjunto de permisos por defecto. En el MVP se conserva como un
  catálogo en `roles`; `memberships.role_id` referencia uno de los tres roles
  admitidos: `admin`, `accountant` o `collaborator`.
- **Permiso**: acción atómica, estable y auditable. Nunca contiene IDs, RFCs ni
  nombres de cuentas.
- **Alcance**: cuentas cliente sobre las que una membresía puede operar. Se
  obtiene exclusivamente de `account_assignments`.
- **Condición de seguridad**: estado de sesión, tenant, membresía y recurso,
  MFA y reautenticación.
- **Entitlement**: límite comercial del plan. Puede restringir una operación,
  pero nunca concede permiso ni alcance.

El titular no es un rol. Se determina comparando el usuario con
`organizations.owner_user_id`. `admin` tampoco es un bypass: pasa por la misma
política que los demás roles.

## Identificadores de permisos

Toda clave debe cumplir exactamente:

```text
^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$
```

No se admiten wildcards, mayúsculas, guiones, más de un punto ni claves que
combinen acción y cuenta. Por ejemplo, `periods.close` es válido y
`periods.close_cliente_abc` no lo es.

## Catálogo inicial

| Clave | Acción | Sensible | MFA | Reautenticación |
| --- | --- | :---: | :---: | --- |
| `credentials.manage` | Cargar, sustituir o revocar e.firma | sí | sí | siempre |
| `sat.download` | Solicitar una descarga SAT | sí | sí | siempre |
| `payroll.view` | Consultar o exportar CFDI de nómina | sí | sí | según recurso |
| `cfdi.exclude` | Excluir o reincorporar CFDI con motivo | sí | sí | según política |
| `exceptions.accept` | Aceptar una excepción que permite continuar | sí | sí | siempre |
| `periods.close` | Crear una versión cerrada de un período | sí | sí | siempre |
| `periods.reopen` | Reabrir un período con motivo | sí | sí | siempre |
| `exports.generate` | Generar Excel, CSV o ZIP | sí | sí | exportación masiva |
| `support.authorize` | Conceder soporte temporal JIT | sí | sí | siempre |
| `members.manage` | Invitar, suspender, reactivar o revocar miembros | sí | sí | según acción |
| `permissions.manage` | Conceder o denegar permisos de membresías | sí | sí | siempre |

Navegar, consultar, preparar, clasificar, comentar y operar checklists no crea
permisos implícitos adicionales en este catálogo. Esas acciones requieren
sesión, tenant y membresía válidos, además de una asignación activa cuando el
recurso pertenezca a una cuenta cliente.

## Defaults propuestos por rol

Esta matriz es cerrada para el MVP y debe aprobarse antes de implementar la
política. Una celda vacía significa que el rol no tiene ese permiso por defecto;
no significa una denegación explícita.

| Permiso | admin | accountant | collaborator |
| --- | :---: | :---: | :---: |
| `credentials.manage` | sí | sí | — |
| `sat.download` | sí | sí | — |
| `payroll.view` | sí | sí | — |
| `cfdi.exclude` | sí | sí | — |
| `exceptions.accept` | sí | sí | — |
| `periods.close` | sí | sí | — |
| `periods.reopen` | sí | sí | — |
| `exports.generate` | sí | sí | — |
| `support.authorize` | sí | — | — |
| `members.manage` | sí | — | — |
| `permissions.manage` | sí | — | — |

`collaborator` conserva las acciones normales descritas arriba sobre sus cuentas
asignadas. Si producto necesita que ejecute una acción sensible, se usa un
override `grant` explícito.

## Esquema objetivo

Las fechas usan `timestamptz`. Las tablas referenciadas por claves compuestas
deben exponer previamente `UNIQUE (organization_id, id)` para impedir relaciones
cruzadas entre tenants.

### `roles`

```sql
CREATE TABLE roles (
  id uuid PRIMARY KEY,
  key varchar(50) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description text NOT NULL,
  scope varchar(20) NOT NULL,
  CONSTRAINT roles_key_chk
    CHECK (key IN ('admin', 'accountant', 'collaborator'))
);
```

La tabla existe para mantener identidad referencial y permitir que
`role_permissions` modele los defaults. No implica roles configurables por
tenant en el MVP. Los tres roles son globales, tienen alcance de organización y
las membresías los referencian mediante `role_id`. El titular sigue siendo una
propiedad de la organización, no una fila adicional en `roles`.

### `permissions`

```sql
CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  key varchar(80) NOT NULL UNIQUE,
  description text NOT NULL,
  sensitive boolean NOT NULL DEFAULT false,
  requires_mfa boolean NOT NULL DEFAULT false,
  requires_reauthentication boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT permissions_key_format_chk
    CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT permissions_status_chk
    CHECK (status IN ('active', 'deprecated', 'disabled'))
);
```

Un permiso `disabled` no se puede conceder ni ejecutar. Deshabilitarlo no borra
defaults, overrides ni auditoría histórica.

### `role_permissions`

```sql
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id),
  permission_id uuid NOT NULL REFERENCES permissions(id),
  enabled boolean NOT NULL DEFAULT true,
  valid_from timestamptz NULL,
  valid_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_validity_chk
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);
```

El default existe sólo cuando la fila está habilitada y vigente. Esta tabla no
contiene `organization_id`, `client_account_id` ni otra forma de alcance.

### `membership_permissions`

```sql
CREATE TABLE membership_permissions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  permission_id uuid NOT NULL REFERENCES permissions(id),
  effect varchar(10) NOT NULL,
  granted_by_membership_id uuid NOT NULL,
  granted_at timestamptz NOT NULL,
  revoked_by_membership_id uuid NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT membership_permissions_effect_chk
    CHECK (effect IN ('grant', 'deny')),
  CONSTRAINT membership_permissions_target_fk
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES memberships (organization_id, id),
  CONSTRAINT membership_permissions_actor_fk
    FOREIGN KEY (organization_id, granted_by_membership_id)
    REFERENCES memberships (organization_id, id),
  CONSTRAINT membership_permissions_revoker_fk
    FOREIGN KEY (organization_id, revoked_by_membership_id)
    REFERENCES memberships (organization_id, id)
);

CREATE UNIQUE INDEX uq_membership_permissions_active
  ON membership_permissions (organization_id, membership_id, permission_id)
  WHERE revoked_at IS NULL;
CREATE INDEX membership_permissions_membership_idx
  ON membership_permissions (organization_id, membership_id, revoked_at);
CREATE INDEX membership_permissions_permission_idx
  ON membership_permissions (organization_id, permission_id, revoked_at);
```

Revocar un override asigna `revoked_at` y `revoked_by_membership_id`; nunca
elimina la fila. Después de revocarlo, la evaluación vuelve al default vigente
del rol. Una nueva decisión crea una nueva fila histórica.

### `account_assignments`

```sql
CREATE TABLE account_assignments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  client_account_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  responsibility varchar(30) NULL,
  status varchar(10) NOT NULL,
  assigned_by_membership_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT account_assignments_status_chk
    CHECK (status IN ('active', 'revoked')),
  CONSTRAINT account_assignments_account_fk
    FOREIGN KEY (organization_id, client_account_id)
    REFERENCES client_accounts (organization_id, id),
  CONSTRAINT account_assignments_target_fk
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES memberships (organization_id, id),
  CONSTRAINT account_assignments_actor_fk
    FOREIGN KEY (organization_id, assigned_by_membership_id)
    REFERENCES memberships (organization_id, id)
);

CREATE UNIQUE INDEX uq_account_assignments_active
  ON account_assignments (organization_id, client_account_id, membership_id)
  WHERE status = 'active' AND revoked_at IS NULL;
```

Una asignación sólo aporta alcance. Nunca aporta permiso. Al revocarla se marca
`status = 'revoked'` y `revoked_at`; desde ese momento bloquea nuevas acciones.

## Precedencia y decisión

Para un permiso, sólo se consideran filas vigentes (`revoked_at IS NULL`):

```text
deny vigente > grant vigente > default vigente del rol > sin permiso
```

El índice único impide que existan simultáneamente dos overrides vigentes para
la misma membresía y permiso. La administración debe ejecutarse en transacción y
bajo bloqueo de la fila objetivo.

Orden obligatorio de evaluación:

1. Validar sesión activa, no expirada y no revocada.
2. Validar tenant seleccionado y organización activa.
3. Validar membresía activa y MFA verificado.
4. Resolver un override `deny` vigente; si existe, terminar con `DENY`.
5. Resolver un override `grant` vigente.
6. Sin override, resolver el default habilitado y vigente del rol.
7. Validar que el permiso esté `active`.
8. Para recursos fiscales, validar `account_assignments` activa.
9. Validar estado del recurso, entitlement y reautenticación.
10. Emitir la decisión y auditar cuando corresponda.

Las decisiones canónicas son `ALLOW`, `DENY`, `MFA_REQUIRED`,
`REAUTHENTICATION_REQUIRED` y `OUT_OF_SCOPE`. Una denegación de tenant o alcance
no debe confirmar si el recurso existe.

`email_verified_at` y una suscripción `trialing` no sustituyen ningún paso de
seguridad ni habilitan datos fiscales o beneficios costosos.

## Administración segura

Para crear, cambiar o revocar overrides:

- el actor debe tener membresía activa, tenant coincidente y
  `permissions.manage` efectivo;
- actor, membresía objetivo y relaciones compuestas deben pertenecer a la misma
  organización;
- el actor no puede modificar sus propios overrides, concederse
  `permissions.manage`, retirar un `deny` propio ni cambiar su rol;
- cambiar un rol nunca cambia `account_assignments`;
- las acciones exclusivas del titular comparan `actor_user_id` con
  `organizations.owner_user_id`;
- toda mutación genera un `audit_event` dentro de la misma unidad de trabajo.

## Contratos HTTP

### Contexto efectivo

`GET /me/authorization` es de sólo lectura:

```json
{
  "organizationId": "org-001",
  "membershipId": "membership-001",
  "role": "accountant",
  "permissions": ["exports.generate", "sat.download"],
  "assignedAccountIds": ["account-001"],
  "reauthenticationRequiredActions": ["periods.close"]
}
```

Las listas salen ordenadas y sin duplicados. Esta respuesta sólo guía navegación
y experiencia; cada endpoint vuelve a evaluar autorización en backend.

`GET /auth/session` expone tenant, membresía, rol y permisos efectivos, pero
tampoco concede acceso por sí mismo.

El frontend carga ambos contratos al iniciar y después de cambiar de tenant.
También refresca `/me/authorization` cuando la ventana recupera foco o
visibilidad y cada 30 segundos mientras la sesión esté activa. Esto actualiza
navegación y acciones cuando cambia un rol u override, sin convertir esa copia
en autoridad: cada mutación continúa validándose en backend. El cambio de
tenant cancela solicitudes pendientes, descarta sesión, autorización e
identidad de cuenta anteriores y navega al inicio del nuevo tenant.

La ruta personal `/es/authorization` permite consultar organización,
membresía, rol, permisos efectivos y `assignedAccountIds`. La ruta
`/es/security` permite ejecutar la reautenticación TOTP real mediante
`POST /auth/session/reauthenticate`; los controles sensibles enlazan a ese
flujo cuando el contrato los marca como sujetos a reautenticación.

La evidencia automatizada transversal de política, HTTP, workers, objetos,
URLs privadas, auditoría, navegación y cambio de tenant se mantiene en
`docs/AUTHORIZATION_TEST_MATRIX.md`.

### Administración de overrides

```text
GET    /organizations/{organizationId}/memberships/{membershipId}/permissions
POST   /organizations/{organizationId}/memberships/{membershipId}/permissions
DELETE /organizations/{organizationId}/memberships/{membershipId}/permissions/{permission}
```

El `POST` recibe exactamente:

```json
{ "permission": "sat.download", "effect": "deny" }
```

El `GET` distingue catálogo, defaults vigentes, overrides históricos y permisos
efectivos. El `DELETE` revoca el override vigente; no elimina historial. Una
clave desconocida, `deprecated` o `disabled` no se puede conceder.

## Auditoría

Se reutiliza `audit_events`. Para este contrato, los nombres se mapean al
esquema existente como `permission_key` y `occurred_at`. Los campos mínimos son:

```text
organization_id, actor_user_id, actor_membership_id, action,
permission_key, decision, object_type, object_id, reason,
correlation_id, metadata, occurred_at
```

Se auditan cambios y usos de permisos sensibles, además de decisiones `DENY`,
`MFA_REQUIRED`, `REAUTHENTICATION_REQUIRED` y `OUT_OF_SCOPE`. `metadata` nunca
guarda secretos, códigos MFA, tokens, llaves privadas, XML completo ni URLs
firmadas permanentes.

## Frontera de implementación

La existencia de `roles` no habilita CRUD ni roles personalizados en el MVP.
TA-P0-003-02 implementa la evaluación efectiva en backend, la revalidación de
workers, las transiciones de períodos, los trabajos SAT/exportación y los
grants efímeros para objetos privados. La navegación basada en este contexto
corresponde a TA-P0-003-03 y la matriz automatizada completa a TA-P0-003-04.

### Administración del catálogo y membresías

Los roles permanecen cerrados y sólo se consultan con `GET /roles`. El catálogo
de permisos se consulta con `GET /permissions`; no se crean claves arbitrarias
desde la API. La administración opera sobre membresías:

- `GET /organizations/{organizationId}/memberships`
- `PATCH /organizations/{organizationId}/memberships/{membershipId}/role`
- `GET /organizations/{organizationId}/memberships/{membershipId}/permissions`
- `POST /organizations/{organizationId}/memberships/{membershipId}/permissions`
- `DELETE /organizations/{organizationId}/memberships/{membershipId}/permissions/{permission}`

Los cambios exigen los permisos administrativos correspondientes, rechazan
mutaciones sobre la propia membresía y protegen la membresía del titular. Todo
cambio queda auditado. Revocar un override conserva su historial mediante
`revoked_at` y devuelve la evaluación al default del rol.

### Implementación de runtime

- Cada petición puede reutilizar la sesión de Redis, pero vuelve a resolver en
  PostgreSQL tenant, membresía, rol, defaults y overrides; los permisos
  efectivos no quedan confiados a una copia cacheada.
- El titular no recibe alcance fiscal global: también requiere una fila activa
  en `account_assignments`.
- `POST /auth/session/reauthenticate` verifica TOTP, actualiza
  `mfa_verified_at` y rota el token de sesión. La ventana sensible es de 15
  minutos.
- `POST /periods/{periodId}/close` y `reopen` bloquean la fila, validan estado y
  auditan la transición dentro de la misma transacción.
- `POST /sat-download-jobs` y `POST /exports` crean una operación durable con
  expiración corta. El consumidor llama `authorizeWorker` antes de reclamarla;
  la reclamación es condicional para impedir doble ejecución.
- `POST /objects/{objectId}/access-url` crea un grant de un solo uso con cinco
  minutos de vigencia. `GET /objects/{objectId}/content` vuelve a evaluar la
  política y entrega la ruta únicamente mediante `X-Accel-Redirect`; ni la URL
  pública ni la auditoría contienen el `storage_key`.

## Migración desde el modelo anterior

La migración `1787690050000-AuthorizationModel` conserva la tabla `roles` y sus
relaciones sin perder membresías:

1. convierte el rol histórico `owner` en `admin`, conservando su UUID y las
   referencias existentes desde `memberships.role_id`;
2. normaliza el catálogo a `admin`, `accountant` y `collaborator`, todos con
   alcance de organización;
3. conserva la titularidad exclusivamente en `organizations.owner_user_id`;
4. mantiene `role_permissions.role_id` y agrega vigencia y estado al default;
5. renombra las claves históricas `period.close`, `period.reopen`,
   `exports.create` y `team.manage` a sus claves normativas;
6. marca como `deprecated` las claves anteriores que quedan fuera del catálogo;
7. crea `membership_permissions`; `account_assignments` se reutiliza del módulo
   de cuentas cliente incorporado previamente en `develop`;
8. impide roles fuera del catálogo cerrado mediante una restricción en `roles`.

La migración `1787690100000-ClientAccountsDomain` crea `client_accounts` y
`account_assignments` inmediatamente después del cambio de roles. Sus FKs
compuestas garantizan que cuenta, membresía, actor y revocador pertenezcan al
mismo tenant.
