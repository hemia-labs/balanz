# Matriz de permisos de la plataforma CFDI

- Versión: 1.0
- Fecha: 2026-08-28
- Fase 0: `BLOCKED`
- Fases 1–8: `NOT_STARTED`

## 1. Principios

Un permiso nunca basta por sí solo. Toda decisión combina:

1. sesión válida y usuario activo;
2. organización activa resuelta server-side;
3. membresía/rol vigente;
4. permiso ejecutable;
5. asignación a cuenta/entidad cuando la matriz diga `Asignadas`;
6. ownership del proceso cuando diga `Propios`;
7. MFA/reauth cuando corresponda;
8. RLS y FKs compuestas en PostgreSQL.

Un ID de organización, cuenta, entidad, job u objeto recibido del cliente no
otorga scope. Un recurso ajeno o no asignado responde de modo no enumerante.
Platform admin opera la plataforma, pero no obtiene acceso fiscal por su rol.
El soporte futuro necesitará un grant JIT, temporal, auditado y de alcance
explícito; no se implementa en Fase 0.

## 2. Permisos registrados

Los seeds de Fase 0 registran idempotentemente estas keys para que las fases
posteriores no reconstruyan autorización. Registrar una key no crea endpoint,
UI ni capacidad de producto.

| Permiso            | Intención                                 | Capacidad que lo consume | Estado funcional en F0   |
| ------------------ | ----------------------------------------- | ------------------------ | ------------------------ |
| `ingestion.view`   | ver una ingesta y sus resultados técnicos | XML/ZIP/SAT              | Sin endpoint de producto |
| `ingestion.create` | iniciar una ingesta autorizada            | XML/ZIP/SAT              | Sin endpoint de producto |
| `ingestion.retry`  | solicitar retry durable                   | procesos de ingesta      | Sin endpoint de producto |
| `ingestion.cancel` | solicitar cancelación durable             | procesos de ingesta      | Sin endpoint de producto |
| `processes.view`   | ver jobs/procesos fiscales                | centro de procesos       | Sin endpoint de producto |
| `processes.retry`  | reintentar un proceso elegible            | centro de procesos       | Sin endpoint de producto |
| `processes.cancel` | cancelar un proceso elegible              | centro de procesos       | Sin endpoint de producto |
| `cfdi.view`        | consultar dominio CFDI                    | lista/detalle F1         | `NOT_STARTED`            |
| `cfdi.download`    | obtener acceso temporal al original       | descarga F1              | `NOT_STARTED`; exige MFA |
| `incidents.view`   | consultar incidencias fiscales            | incidentes F1+           | `NOT_STARTED`            |
| `incidents.manage` | resolver/clasificar incidencias           | incidentes F1+           | `NOT_STARTED`            |

## 3. Defaults por rol

Leyenda: `Tenant` = todas las cuentas/entidades del tenant dentro del producto;
`Asignadas` = sólo asignaciones activas; `Propios ∩ asignados` = actor creador y
scope actualmente asignado; `No` = denegado por defecto.

| Acción             | owner        | accountant      | collaborator        | platform admin |
| ------------------ | ------------ | --------------- | ------------------- | -------------- |
| `ingestion.view`   | Tenant       | Asignadas       | Asignadas           | No             |
| `ingestion.create` | Tenant       | Asignadas       | Asignadas           | No             |
| `ingestion.retry`  | Tenant       | Asignadas       | Propios ∩ asignados | No             |
| `ingestion.cancel` | Tenant       | Asignadas       | Propios ∩ asignados | No             |
| `processes.view`   | Tenant       | Asignadas       | Asignadas           | No             |
| `processes.retry`  | Tenant       | Asignadas       | No                  | No             |
| `processes.cancel` | Tenant       | Asignadas       | No                  | No             |
| `cfdi.view`        | Tenant       | Asignadas       | Asignadas           | No             |
| `cfdi.download`    | Tenant + MFA | Asignadas + MFA | Asignadas + MFA     | No             |
| `incidents.view`   | Tenant       | Asignadas       | Asignadas           | No             |
| `incidents.manage` | Tenant       | Asignadas       | Asignadas           | No             |

La carga manual futura no exige reautenticación adicional; sí exige sesión,
permiso, asignación y límites. MFA para `cfdi.download` no puede satisfacerse
por una bandera del cliente. Las operaciones e.firma/SAT/cierre de fases
posteriores definirán MFA+reauth purpose-bound en su propio gate.

## 4. Reglas por recurso

### Uploads, jobs e items

- El scope proviene del recurso y se valida contra la organización activa.
- Accountant/collaborator requieren asignación vigente a la cuenta/entidad.
- Retry/cancel de **ingesta** por collaborator exige además que `created_by`
  corresponda al actor; no se concede por conocer el ID. Retry/cancel del
  centro general de procesos no se concede a collaborator por defecto.
- Retry requiere estado retryable, presupuesto/política y versión vigente.
- Cancel es una solicitud durable; no promete interrupción instantánea.
- Worker no usa permisos humanos: usa rol técnico mínimo, RLS y claim definer.

### Objetos y descargas

- `ObjectStoragePort` no es una superficie de autorización; el servicio de
  aplicación decide scope antes de llamar al adapter.
- Fase 0 no expone descarga fiscal.
- La futura descarga exige `cfdi.view` + `cfdi.download`, asignación y MFA; URL
  breve, de un solo recurso y nunca registrada.

### Incidentes

- `incidents.view` respeta asignación y sensibilidad del recurso.
- `incidents.manage` no permite reescribir bytes, procedencia o auditoría.
- Incidentes de plataforma cross-tenant se investigan operacionalmente sin
  conceder acceso fiscal al platform admin.

## 5. Revocación y cambios de contexto

- Cambio de organización invalida el contexto anterior; cada transacción hace
  un nuevo `SET LOCAL`.
- Revocar membresía, permiso o asignación bloquea la siguiente operación y el
  siguiente poll; no depende de reiniciar el proceso.
- Un job ya reclamado vuelve a validar scope/autorización técnica antes de
  publicar resultados, y RLS sigue aplicando.
- URLs/grants futuros deben ser breves y revocables; una sesión cerrada no
  convierte una URL larga en aceptable.

## 6. Tests obligatorios

| Caso                                                                                 | Resultado esperado                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| owner tenant A consulta A                                                            | permitido por permiso y RLS                                         |
| owner tenant A usa ID de B                                                           | no enumerante; RLS cero filas                                       |
| accountant no asignado                                                               | denegado aunque tenga key de permiso                                |
| collaborator asignado ve proceso                                                     | permitido sólo en scope asignado                                    |
| collaborator reintenta proceso ajeno                                                 | denegado                                                            |
| collaborator reintenta propio desasignado                                            | denegado                                                            |
| platform admin intenta leer objeto/job fiscal                                        | denegado                                                            |
| `app.organization_id` ausente/inválida o `app.membership_id` inválida cuando aplique | cero acceso/falla cerrado                                           |
| grupos `balanz_api`/`balanz_worker` inspeccionados                                   | `NOLOGIN`, sin owner/superuser/BYPASSRLS                            |
| LOGINs dedicados API/worker inspeccionados                                           | miembro sólo del grupo esperado; nunca migrator/owner/grupo opuesto |
| `cfdi.download` sin MFA en F1                                                        | `MFA_REQUIRED`                                                      |
| seed ejecutado dos veces                                                             | mismas keys/defaults, sin duplicados                                |

## 7. Gobierno y separación por fase

Modificar defaults requiere migración/seed append-only, revisión de seguridad y
test de regresión. Fase 0 entrega catálogo y grants base, pero no debe simular
consumo de permisos mediante rutas ficticias. Fase 1 permanece `NOT_STARTED` y
es el primer consumidor público previsto de permisos `ingestion.*`,
`cfdi.*` e `incidents.*`.
