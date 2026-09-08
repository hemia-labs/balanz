# Matriz automatizada de autorización — TA-P0-003-04

## Alcance

Esta matriz valida que el backend siga siendo la autoridad para sesión, MFA,
tenant, membresía, permisos efectivos, alcance, reautenticación y estado del
recurso. La tabla `roles` es catálogo controlado del MVP; sólo aporta defaults:
el titular real se determina mediante
`user_id == organizations.owner_user_id` y tiene alcance fiscal `tenant-wide`;
`admin` no titular, `accountant` y `collaborator` requieren una
`account_assignment` activa.

## Casos automatizados

| Canal | Caso | Resultado comprobado |
| --- | --- | --- |
| Política | Titular real (`user_id == organizations.owner_user_id`) | Alcance fiscal `tenant-wide`, sujeto a sesión, tenant, membresía, permiso, recurso y MFA o reautenticación cuando aplique |
| Política | `admin` no titular sin asignación | `404/OUT_OF_SCOPE`; el nombre de rol no concede alcance global |
| Política | `accountant` + default + asignación | `ALLOW` |
| Política | `accountant` + `deny` + asignación | `DENY` y auditoría |
| Política | `collaborator` + `grant` + asignación | `ALLOW` |
| Política | `collaborator` + default | Según `role_permissions` |
| Política | Permiso existente + cuenta no asignada | `404/OUT_OF_SCOPE`, sin IDs en auditoría |
| Política | Permiso sensible + MFA antiguo | `REAUTHENTICATION_REQUIRED` |
| Política | Permiso sensible sin MFA | `MFA_REQUIRED` |
| Política | Tenant inactivo | `DENY` |
| Sesión/worker | Sesión revocada o expirada | `401` semántico |
| Override | `revoked_at` vigente | Se ignora el override y vuelve al default |
| Administración | `grant`, `deny` y `revoke` | Persistencia y `audit_event` con actor, tenant, permiso, recurso y correlación |
| Reautenticación futura | Evidencia con antigüedad máxima de 10 minutos | Sólo es válida para el mismo `session_id`, `organization_id` y `purpose` |
| Capacidad futura | `POST /sat-download-jobs` | `FUTURE / NOT_STARTED`; no se presenta como endpoint productivo activo |
| Capacidad futura | `POST /exports` | `FUTURE / NOT_STARTED`; no se presenta como endpoint productivo activo |
| Worker | Job vigente | Revalida antes de reclamarlo |
| Worker | Job expirado | Marca `expired` y no ejecuta |
| Objeto privado | Objeto de otro tenant | `404`, sin enumeración ni mutación |
| URL privada | Objeto autorizado | Token aleatorio, hash persistido, vigencia máxima de cinco minutos y token ausente de auditoría |
| HTTP | MFA, permiso, alcance y estado | Respuestas `401`, `403`, `404` y `409` |
| HTTP | Operación autorizada | `201` sólo después de completar el servicio |
| Frontend | Permiso efectivo + asignación | Navegación y acceso visibles |
| Frontend | Permiso ausente o cuenta fuera de alcance | Navegación/acción bloqueadas |
| Frontend | Cambio de tenant | No reutiliza permisos ni asignaciones anteriores |
| Convención | `close_period`, `periods.*`, `*.*` | Identificadores rechazados |

## Suites

- `apps/api/test/authorization-matrix.spec.ts`
- `apps/api/test/authorization-channels.spec.ts`
- `apps/api/test/authorization-http.spec.ts`
- `apps/api/test/permission-administration-audit.spec.ts`
- `apps/api/test/permission-catalog.spec.ts`
- `apps/web/src/lib/authorization-matrix.test.ts`

## Ejecución verificada

```bash
npm --prefix apps/api test -- --runInBand
npm --prefix apps/api run build
npm --prefix apps/web test
npm --prefix apps/web run lint
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
```

Resultado del 31 de agosto de 2026:

- API: 32 suites, 131 pruebas aprobadas.
- Frontend: 51 pruebas aprobadas.
- Lint, TypeScript y builds de API y frontend aprobados.

El build web requiere acceso a `fonts.googleapis.com` porque `next/font`
descarga Geist durante la compilación.
