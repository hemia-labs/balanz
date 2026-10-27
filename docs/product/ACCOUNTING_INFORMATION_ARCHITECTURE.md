# Arquitectura de información del sistema contable Hemia

## 1. Objetivo y alcance

Este documento define la arquitectura navegable del frontend `apps/web` para un SaaS contable de despachos. La implementación es un esqueleto funcional con datos demostrativos tipados: establece contextos, rutas, jerarquías, componentes y restricciones visuales sin afirmar que existe autenticación, autorización multi-tenant, persistencia, descarga SAT, exportación o generación fiscal real.

La dirección visual normativa sigue siendo **Registro Sereno**, definida en `docs/design/ACCOUNTING_UI_DESIGN_AGENT.md`.

## 2. Fuentes consultadas y limitaciones

Fuentes disponibles:

- `CODEX_PROMPT_ARQUITECTURA_NAVEGACION_SISTEMA_CONTABLE_HEMIA.md`, leído completo el 18 de agosto de 2026.
- `docs/design/ACCOUNTING_UI_DESIGN_AGENT.md`, `ACCOUNTING_UI_RESEARCH.md` y `ACCOUNTING_UI_MIGRATION_PLAN.md`.
- Código real de `apps/web` y configuración Next.js 16, React 19, Tailwind CSS 4, shadcn/Base UI y Lucide.
- Guards JWT y permisos del backend en `apps/api/src/common`.

No se localizaron `Propuesta_funcional_Control_mensual_CFDI_Hemia_v3(1).docx` ni `Proyecto contador.docx` en el repositorio, Descargas, Escritorio, Documentos, adjuntos o el árbol de Hemia. Las decisiones no cubiertas por el prompt quedan pendientes de contrastarse cuando esos documentos estén disponibles.

El backend actual sólo modela usuarios y permisos globales en un JWT. No contiene despachos, membresías, clientes, asignaciones, ejercicios, períodos, CFDI, procesos u obligaciones. Por tanto, los guards de esta implementación son únicamente de presentación y navegación demo; nunca sustituyen autorización del servidor.

## 3. Decisiones posteriores a la propuesta v3

- La cuenta es una identidad global y puede pertenecer a varios despachos con el mismo correo.
- La licencia pertenece al despacho.
- Perfil y capacidades pertenecen a la membresía.
- El acceso a clientes requiere asignación explícita además de membresía.
- Titular y Administrador son perfiles diferentes.
- El superadministrador de Hemia queda fuera de este producto.
- La aplicación operativa se presenta sólo en español de México; `/en` redirige a `/es` por compatibilidad.
- DIOT e IEPS existen como estructura navegable, no como generadores fiscales reales.

## 4. Glosario

| Término | Definición |
| --- | --- |
| Cuenta | Identidad global de una persona. |
| Despacho | Organización o tenant que contrata una licencia. |
| Membresía | Relación entre cuenta y despacho; contiene perfil y capacidades. |
| Miembro | Cuenta vinculada a un despacho mediante una membresía activa. |
| Cliente | Contribuyente administrado por un despacho. |
| Asignación | Relación explícita entre una membresía y un cliente. |
| Ejercicio | Año fiscal dentro de un cliente. |
| Período | Espacio mensual de trabajo dentro de un ejercicio. |
| Documento | CFDI u otro archivo asociado al cliente y período. |
| Obligación | Preparación documental DIOT o IEPS; no implica presentación al SAT. |

## 5. Modelo de contexto

```text
Cuenta
└── Membresía → Despacho
    └── Asignación → Cliente
        └── Ejercicio
            └── Período
                └── Documento u obligación
```

La URL contiene los identificadores necesarios para reconstruir contexto. `localStorage` puede recordar el último despacho como conveniencia, pero NO concede acceso. La fuente demo reside en `src/lib/demo-data.ts` y deberá sustituirse por servicios y claims del backend.

## 6. Happy paths

### Sin despacho

Login → `/es/onboarding` → Crear despacho. El formulario explica que la integración y contratación están pendientes y no crea un plan falso.

### Configuración incompleta

Login → onboarding con pasos visibles: datos del despacho, primer cliente, responsable, ejercicio y e.firma opcional. Los pasos no persisten mientras no exista backend.

### Un despacho con clientes

Login → `/es/despachos/:organizationId/inicio`. El inicio muestra la cartera antes de forzar selección de cliente.

### Varios despachos

Se restaura el último despacho válido cuando la URL o sesión lo identifica. Si no existe, se usa `/es/seleccionar-despacho`; no se abre un despacho perdido o desconocido.

### Abrir cliente y período

Inicio → Clientes → Resumen del cliente → Ejercicios → 2026 → Agosto → CFDI → detalle → volver conservando `returnTo` y filtros en query parameters.

## 7. Navegación

### Sidebar de despacho

- Despacho activo: nombre, perfil y selector si existen varias membresías.
- Operación: Inicio, Clientes, Procesos.
- Administración: Equipo, Auditoría, Configuración.
- Soporte: Ayuda y soporte.

### Sidebar de cliente

- Volver al despacho.
- Cliente activo: razón social, RFC y selector de cliente.
- Cliente: Resumen, Ejercicios, CFDI, Obligaciones fiscales, Alertas.
- Configuración: Datos del cliente, Responsables, e.firma y SAT, Obligaciones, Accesos.

DIOT e IEPS no son opciones raíz; viven dentro de Obligaciones fiscales. Nómina y pagos son pestañas del período.

### Topbar

- Breadcrumb/contexto visible.
- Buscador contextual con resultados demo locales y alcance explícito.
- Acceso a procesos con conteo de activos/errores.
- Drawer de notificaciones.
- Menú de perfil con identidad, perfil de membresía, navegación personal, apariencia y cierre de sesión confirmado.
- No muestra selector de idioma.

## 8. Mapa de rutas implementado

El prefijo `/es` se conserva.

### Entrada y personales

| Ruta | Propósito |
| --- | --- |
| `/es/login` | Acceso demostrativo; no crea sesión real. |
| `/es/register` | Registro visual existente; backend pendiente. |
| `/es/forgot-password` | Recuperación visual; backend disponible, integración frontend pendiente. |
| `/es/onboarding` | Alta base del primer despacho. |
| `/es/seleccionar-despacho` | Selección cuando existen varias membresías. |
| `/es/perfil`, `/es/seguridad`, `/es/preferencias`, `/es/ayuda` | Rutas personales. |
| `/es/sin-acceso` | 403 visual. |

### Despacho

Base: `/es/despachos/:organizationId`

- `/inicio`
- `/clientes`
- `/procesos`
- `/equipo`
- `/auditoria`
- `/configuracion`
- `/configuracion/datos`
- `/configuracion/seguridad`
- `/configuracion/plan-facturacion`
- `/configuracion/retencion-datos`
- `/configuracion/soporte`

### Cliente

Base: `/es/despachos/:organizationId/clientes/:clientId`

- `/resumen`
- `/ejercicios`
- `/ejercicios/:year`
- `/ejercicios/:year/periodos/:period/:tab`
- `/cfdi`
- `/cfdi/:uuid`
- `/obligaciones`
- `/obligaciones/diot`
- `/obligaciones/diot/:year/:period/:tab`
- `/obligaciones/ieps`
- `/obligaciones/ieps/:instanceId/:tab`
- `/obligaciones/archivos-generados`
- `/alertas`
- `/configuracion/{datos,responsables,e-firma-sat,obligaciones,accesos}`

Pestañas de período: `resumen`, `cfdi`, `pagos`, `nomina`, `incidencias`, `cierre`, `exportaciones`.

## 9. Matriz de pantallas

| Contexto | Pantalla | Estructura principal | Fuente actual |
| --- | --- | --- | --- |
| Despacho | Inicio | Período global, filtros, tabla de cartera, alertas y procesos | Fixtures demo |
| Despacho | Clientes | Búsqueda, filtros, tabla y modal Crear cliente | Fixtures demo |
| Despacho | Procesos | Pestañas, tabla y drawer de detalle | Fixtures demo |
| Despacho | Equipo | Miembros, invitaciones, perfiles, capacidades y asignaciones | Fixtures demo |
| Despacho | Auditoría | Filtros y eventos sin secretos/XML | Fixtures demo |
| Despacho | Configuración | Subsecciones filtradas por capacidad | Fixtures demo |
| Cliente | Resumen | Estado, ejercicio, e.firma, alertas y acciones rápidas | Fixtures demo |
| Cliente | Ejercicios | Lista y comparativo de doce períodos | Fixtures demo |
| Cliente | CFDI | Filtros compartibles, tabla y detalle | Fixtures demo |
| Cliente | Alertas | Severidad, contexto, responsable y acción | Fixtures demo |
| Período | Siete pestañas | Context header, filtros, tablas, checklist y acciones | Fixtures demo |
| Obligaciones | Resumen | DIOT, IEPS y archivos por período | Fixtures demo |
| DIOT | Seis pestañas | Resumen, operaciones, validaciones, ajustes, vista previa, archivos | Fixtures demo |
| IEPS | Configuración/instancia | Nueve pestañas y ayuda MULTI-IEPS | Fixtures demo |

Todas las pantallas comparten loading de ruta, error recuperable, empty state de tabla y 403 cuando el contexto demo niega capacidad/asignación.

## 10. Modales y drawers

| Tipo | Shell conectado |
| --- | --- |
| Modal | Crear cliente, Invitar miembro, Iniciar descarga SAT, Cargar XML/ZIP, Configurar exportación, Excluir CFDI, Acción masiva, Cerrar/reabrir período, Generar DIOT, Generar batch IEPS, Cerrar sesión |
| Drawer | Notificaciones, Detalle de proceso, Vista rápida de cliente, Detalle de incidencia, Cambiar responsable |

Los shells contienen focus mediante `dialog`, cierran con Escape y no producen éxitos falsos. La acción final queda deshabilitada o vuelve al contexto sin afirmar persistencia.

## 11. Roles y capacidades

Perfiles: `titular`, `administrador`, `responsable`, `colaborador`.

Capacidades visuales tipadas:

`organization.view`, `organization.manage`, `ownership.manage`, `billing.manage`, `team.view`, `team.manage`, `clients.view`, `clients.manage`, `clients.assign`, `credentials.manage`, `sat.download`, `payroll.view`, `cfdi.review`, `cfdi.exclude`, `period.close`, `period.reopen`, `exports.create`, `obligations.view`, `obligations.configure`, `diot.generate`, `ieps.generate`, `audit.view`, `support.authorize`.

- Titular: todas las capacidades demo.
- Administrador: operación, equipo, clientes, asignaciones y auditoría; no propiedad/cancelación.
- Responsable: sólo clientes asignados y capacidades operativas explícitas.
- Colaborador: sólo clientes asignados; sin cierre, reapertura, e.firma, exportación masiva o generación fiscal por defecto.

`PermissionGate` y el filtrado del menú explican visibilidad. No son autorización: cada endpoint futuro DEBE validar JWT, tenant, membresía, asignación y capacidad en backend.

## 12. Reglas de acceso

1. Despacho inexistente → 404.
2. Despacho existente sin membresía → 403.
3. Cliente inexistente → 404.
4. Cliente no asignado a Responsable/Colaborador → 403.
5. Ruta con capacidad faltante → 403 o control oculto/explicado según riesgo.
6. `billing` y propiedad → sólo Titular/capacidad explícita.
7. Nómina → `payroll.view`.
8. Ocultar un control nunca sustituye validación del backend.

## 13. Estados

- Loading: skeleton que conserva shell y contexto.
- Error: mensaje accionable, Reintentar y regreso seguro.
- Vacío: distingue sin datos, sin resultados, sin asignaciones, sin permisos y configuración incompleta.
- Bloqueado: status textual + explicación.
- Integración pendiente: `FeaturePendingNotice` sólo junto a la acción afectada.
- Éxito: no se muestra para mutaciones demo no persistidas.

## 14. Compatibilidad con rutas anteriores

| Ruta anterior | Manejo |
| --- | --- |
| `/es/documents`, `/es/queries`, `/es/income`, `/es/payroll`, `/es/certificates` | Redirigen a Clientes para elegir contexto; nunca eligen cliente arbitrariamente. |
| `/es/reports` | Redirige a Procesos/Exportaciones del despacho con mensaje de origen. |
| `/es/users` | Redirige a Equipo. |
| `/es/collaboration` | Redirige a Inicio; colaboración vive en responsables, actividad e incidencias. |
| `/es/plans` | Redirige a Plan y facturación del despacho demo; el guard visual exige `billing.manage`. |
| `/en/*` | Redirige al equivalente `/es/*`. |

## 15. DIOT e IEPS

- DIOT tiene resumen, operaciones, validaciones, ajustes, vista previa y archivos.
- `Generar archivo DIOT` abre confirmación, pero NO crea TXT ni declara al SAT.
- IEPS comienza en configuración y después muestra instancias por anexo/período.
- `Generar archivo batch para MULTI-IEPS` abre confirmación, pero NO genera `.dec`, acuse ni presentación.
- Los datos y columnas son representativos y no codifican reglas fiscales definitivas.
- Archivos generados sólo permite descarga cuando un servicio real entregue una URL autorizada; en demo queda deshabilitada con explicación.

## 16. Sustitución de fixtures

`src/lib/demo-data.ts` exporta un objeto marcado como `demo`. Las pantallas consumen selectores y tipos, no objetos duplicados. La sustitución debe implementar un adaptador con la misma forma desde servicios autenticados. Ningún fixture se importa desde backend, middleware de seguridad o lógica fiscal.

## 17. Suposiciones y límites

- El despacho, cliente y período demo no representan información real.
- No existe login/refresh en el backend actual.
- No existe API de organizaciones, membresías, asignaciones, clientes, SAT, CFDI, procesos, exportaciones, DIOT o IEPS.
- La persistencia de filtros se limita a query parameters y navegación local.
- MFA, contratación, invitaciones y todas las mutaciones quedan como interfaz preparada.
- Las rutas y capacidades deberán alinearse con contratos reales antes de producción.
