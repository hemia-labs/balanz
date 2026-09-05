# ADR-CFDI-003: aislamiento fiscal con RLS fail-closed

- Estado: `ACCEPTED`
- Fecha: 2026-08-28
- Alcance: toda tabla fiscal creada desde Fase 0

## Contexto

La autorización de NestJS es necesaria, pero un defecto en un repositorio,
query manual o worker podría cruzar organizaciones. Las tablas fundacionales
guardan datos fiscales y deben aplicar el tenant en PostgreSQL sin confiar en
valores enviados por el cliente.

## Decisión

Toda tabla fiscal nueva usa `ENABLE ROW LEVEL SECURITY` y
`FORCE ROW LEVEL SECURITY`. Las políticas filtran y validan
`organization_id` contra la GUC transaccional exacta `app.organization_id`; la
membresía, cuando aplique, usa `app.membership_id`. El contexto sólo se
establece con `SET LOCAL` dentro de una transacción después de resolver
server-side la organización, cuenta cliente y entidad legal autorizadas. GUC
ausente, vacía, mal formada o no autorizada falla cerrado.

Los roles de runtime de API y worker:

- no son superusuarios;
- no tienen `BYPASSRLS`;
- no son propietarios de las tablas;
- reciben únicamente grants explícitos;
- nunca usan `SET` persistente o pooling con contexto residual.

El modelo de roles separa privilegio de identidad. `balanz_api` y
`balanz_worker` son roles de grupo `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS` y no
owners. El aprovisionamiento de cada ambiente crea LOGINs dedicados —por
ejemplo `balanz_api_login` y `balanz_worker_login`— y concede exactamente uno de
esos grupos. La API nunca hereda `balanz_worker`; sólo el grupo del worker recibe
`EXECUTE` sobre la función de claim. El migrator y los owners `NOLOGIN` son
identidades separadas y jamás se reutilizan como credenciales de runtime ni se
conceden como membresía a esos LOGINs.

Aplicar cualquier migración de Fase 0 pendiente requiere un migrator superuser
efímero y separado. PostgreSQL 16 no permite que un `CREATEROLE` sin
`ADMIN OPTION` recupere las membresías de los owners ni transfiera una función
a un owner sin `CREATE` sobre el schema. Preflight y el runner bloquean ese caso
antes del DDL; la ejecución autorizada usa una sola transacción, revoca
membresías y `CREATE`, y elimina la credencial antes del arranque de API/worker.

El worker reclama trabajo cross-tenant mediante una única función
`SECURITY DEFINER` de privilegio mínimo. La función:

- tiene owner dedicado sin login y `search_path` fijo;
- revoca `EXECUTE` de `PUBLIC`;
- valida `worker_id`, límites y parámetros;
- hace selección/claim atómico con lease y fairness;
- no acepta una organización elegida por el llamador;
- no permite SQL dinámico ni lectura fiscal arbitraria;
- retorna sólo job ID, scope técnico, `lease_token`, versión observable y
  referencias necesarias;
- registra el claim auditable y obliga a continuar en una transacción normal
  con `SET LOCAL` y RLS.

La mutación de claim y su evento de auditoría forman una sola transacción: no se
acepta un lease sin evidencia ni evidencia de un claim que no ocurrió. Los
heartbeats y transiciones posteriores se auditan por la ruta tenant-scoped
normal y cercan ownership con el `lease_token`, estado y lease vigentes.
`worker_id` conserva procedencia y `version` es una revisión monotónica
observable, no un CAS de ownership.

Las FKs compuestas y checks de scope complementan RLS; no se consideran
sustitutos.

## Alternativas rechazadas

- Filtros únicamente en ORM: dependen de que cada query sea correcta.
- `ENABLE` sin `FORCE`: el owner podría omitir políticas.
- Roles con `BYPASSRLS`: convierten un defecto de aplicación en fuga global.
- GUC de sesión: puede filtrarse entre requests mediante el pool.
- Función definer genérica: amplía la superficie de escalamiento.
- Un worker por tenant: complejidad operativa sin eliminar controles de datos.

## Consecuencias

Cada operación fiscal requiere una transacción explícita y contexto validado.
Migraciones, mantenimiento y soporte necesitan roles separados y runbooks. Las
pruebas deben ejecutarse con roles de runtime reales; usar el superusuario sólo
probaría una ruta distinta.

## Controles y pruebas

- Tenant A no observa ni muta tenant B.
- Sin GUC, GUC inválida y UUID válido no autorizado fallan cerrado.
- `WITH CHECK` impide insertar/mover filas a otro tenant.
- Table owner queda sujeto a `FORCE RLS`.
- API y worker reales no tienen `BYPASSRLS`.
- `balanz_api`/`balanz_worker` son `NOLOGIN`; los LOGINs de despliegue heredan
  sólo su grupo esperado y nunca el rol migrator/owner.
- Contexto no sobrevive commit/rollback ni vuelve al pool.
- La función de claim no permite lectura arbitraria y dos workers no duplican
  claim.
- Inspección de catálogo demuestra policies, owners, grants y atributos de rol.

## Límite de fase

Fase 0 aplica RLS a `stored_objects`, `ingestion_uploads`, `ingestion_jobs` e
`ingestion_items`. Cada migración de una fase posterior debe habilitar y probar
RLS al crear su tabla; no puede posponerlo.
