# Auditoría de cobertura entre frontend y modelo de datos de Balanz

## 1. Portada y control

| Campo | Valor |
|---|---|
| Sistema | Balanz por Hemia |
| Documento | Análisis de diferencias frontend → persistencia |
| Versión | 1.0 |
| Fecha | 18 de agosto de 2026 |
| Estado | Auditoría técnica terminada; propuesta, no implementación |
| Alcance | Frontend, contratos implícitos, modelo documental y persistencia existente |
| Repositorio | `F:/HemiaBalanceOs/balanz` |
| Rama | `codex/refactor-ux-ui` |
| Raíz Git | `F:/HemiaBalanceOs/balanz` |
| Stack | Monorepo npm/Bun; Next.js 16 + React 19 + TypeScript; NestJS 11 + TypeORM + PostgreSQL |

Se revisaron completos `C:/Users/lofor/Downloads/control_mensual_cfdi.md` (v3.1, 12-08-2026), `README.md`, `apps/web/AGENTS.md`, los README de `apps/web` y `apps/api`, `docs/product/ACCOUNTING_INFORMATION_ARCHITECTURE.md`, `docs/product/ACCOUNTING_NAVIGATION_IMPLEMENTATION_REPORT.md`, los tres documentos vigentes de `docs/design`, las rutas App Router, resolutores de navegación, pantallas, componentes de contexto, permisos, fixtures y pruebas de navegación. Del backend se revisaron configuración TypeORM, entidad/migración de usuarios, DTO, servicio, controlador, JWT y guard de permisos.

El `git status --short` inicial estaba limpio. No se consultó una base local: el **modelo implementado** de esta auditoría significa código TypeORM y migraciones versionadas, no una afirmación sobre el estado de una instancia externa.

## 2. Resumen ejecutivo

El modelo actual **no cubre el frontend**. El documento base propone un núcleo sólido de control mensual —35 tablas conceptuales, original fiscal inmutable, decisiones versionadas, cierre, idempotencia y object storage—, pero la implementación real sólo contiene `users`. La migración existente no crea organizaciones, membresías, sesiones persistidas, clientes, RFC, períodos, CFDI, jobs ni auditoría.

La cobertura documental es alta para CFDI, ingesta, revisión y cierre; es parcial para identidad, titularidad, preferencias, alertas y procesos; es insuficiente para suscripción; y es inexistente para la arquitectura DIOT/IEPS que el frontend ya representa. El mayor riesgo funcional adicional es que las rutas y fixtures usan un único `clientId` con un solo RFC, mientras la decisión aprobada distingue cuenta cliente y entidad fiscal y permite varios RFC por cuenta.

| Prioridad | Hallazgos |
|---|---:|
| P0-BLOQUEANTE | 4 |
| P0-NECESARIO | 8 |
| P1 | 8 |
| P2 | 3 |
| DEUDA TÉCNICA | 3 |
| SIN CAMBIO | 5 |
| **Total** | **31** |

Conclusión: el frontend sirve como contrato de navegación y estados representativos, no como evidencia de datos persistidos. Antes de conectar una pantalla debe implementarse la frontera multi-tenant, después clientes/RFC y períodos, y sólo entonces ingesta/CFDI/cierre. DIOT e IEPS deben construirse sobre un núcleo de obligaciones versionado; no deben agregarse como columnas ad hoc a `periods` ni como una tabla EAV.

## 3. Estado real encontrado

| Capa | Estado comprobado |
|---|---|
| Frontend actual | Esqueleto funcional navegable en español con rutas catch-all, guards visuales, modales/drawers y fixtures tipados. Login, mutaciones, archivos y búsquedas son demostrativos. |
| Backend actual | API NestJS con CRUD global de usuarios, JWT Bearer y permisos tomados del token. No hay login/refresh, tenant activo, membresías, asignaciones ni endpoints contables. |
| Persistencia actual | Una entidad y una migración TypeORM para `users`; no hay otras tablas versionadas. `synchronize` está deshabilitado. |
| Modelo propuesto | `control_mensual_cfdi.md` describe 35 tablas del MVP y reglas de seguridad, pero sus bloques `TABLE (...)` son documentación lógica, no migraciones. Describe `Subscription` sin catalogar tablas comerciales. Excluye DIOT/IEPS del MVP original. |
| Necesidad del frontend | Organización activa, cuenta global multi-organización, clientes, períodos, CFDI, procesos, equipo, facturación, notificaciones y esqueletos DIOT/IEPS. |
| Modelo objetivo | El catálogo autosuficiente de `CORRECTED_POSTGRESQL_DATA_MODEL.md`: identidad global, titularidad única, suscripción de organización, aislamiento compuesto, núcleo fiscal, jobs específicos con proyección común y obligaciones versionadas. |

Conflictos relevantes:

- El README raíz afirma un backend de usuarios “con validación, permisos y persistencia”, pero no existe autenticación emitida ni autorización multi-tenant; el guard sólo confía en `permissions[]` del JWT.
- El documento base denomina el perfil `admin` y deriva al titular por `owner_user_id`; el frontend distingue `titular` y `administrador`. El objetivo conserva roles operativos `admin/accountant/collaborator` y calcula `titular` exclusivamente desde `organizations.owner_user_id`.
- El documento base dice que DIOT/IEPS y declaraciones quedan fuera del roadmap; la decisión posterior e inamovible obliga a preparar estructuralmente DIOT e IEPS sin afirmar presentación.
- `users.locale` acepta valores libres y el frontend todavía conserva infraestructura `en`, pero el alcance actual es exclusivamente `es-MX`.

## 4. Inventario de pantallas y rutas

Los parámetros `:organizationId`, `:clientId`, `:year`, `:period`, `:uuid` y `:instanceId` son segmentos reales resueltos por `resolveProductRoute`. Los tabs por query (`?vista=`) conservan una sola pantalla física. Todos los datos operativos provienen hoy de fixtures.

| Ruta/pantalla | Contexto y parámetros | Datos principales | Acciones | Permiso visual | Implementación |
|---|---|---|---|---|---|
| `/es/login` | Usuario | correo, contraseña, recordar | iniciar sesión, recuperar | público | Demo; no valida |
| `/es/register` | Usuario | nombre, correo, contraseña, términos | registrar | público | Demo; no persiste |
| `/es/forgot-password` | Usuario | correo | solicitar recuperación | público | Backend implementado; UI bloqueada |
| `/es/onboarding` | Usuario → organización | nombre, zona, pasos iniciales | abrir demo | público | No persiste |
| `/es/seleccionar-despacho` | Usuario global | membresías, rol, número de asignaciones | elegir organización | membresía | Fixture |
| `/es/{perfil,seguridad,preferencias,ayuda}` | Usuario; ayuda puede usar organización | perfil, MFA, tema/locale/zona, ticket | guardar o solicitar ayuda | sesión demo | Formularios bloqueados |
| `/es/sin-acceso` | Contexto de denegación | recurso/capacidad solicitada | volver | ninguno | Visual 403 |
| `/es` | Sesión demo | organización por defecto | redirigir a inicio | sesión | Redirect fijo al tenant demo |
| ruta `/es/*` inexistente | Ninguno o contexto parcial | mensaje de recurso inexistente | volver | ninguno | Visual 404 |
| `/es/despachos/:organizationId/inicio` | Organización + período global | cartera, progreso, incidencias, corte, responsables, procesos | filtrar, abrir período/cliente | `organization.view` | Fixture agregado |
| `…/clientes` | Organización | cuenta/RFC, responsable, estado, e.firma, SAT | buscar, filtrar, crear | `clients.view/manage` | Fixture; modal bloqueado |
| `…/procesos?vista=` | Organización; SAT/carga/exportación/fiscal/error | tipo, cliente, período, estado, progreso, actor, resultado | detalle, reintento | `organization.view` | Fixture; sin job |
| `…/equipo?vista=` | Organización; miembros/invitaciones/perfiles/asignaciones | identidad, rol, estado, cuentas | invitar, revisar acceso | `team.view/manage` | Fixture |
| `…/auditoria` | Organización | fecha, actor, cliente, acción, módulo, severidad | filtrar | `audit.view` | Fixture |
| `…/configuracion` y `/datos` | Organización | datos operativos, zona, correo, período preferido | guardar | `organization.view/manage` | Bloqueada; hoy cualquier `:section` desconocida cae al resumen |
| `…/configuracion/seguridad` | Organización | política de seguridad | guardar | `organization.view` | Bloqueada |
| `…/configuracion/plan-facturacion` | Organización + titular | propietario, plan, pago, renovación | administrar | `billing.manage`; falta owner check real | Bloqueada |
| `…/configuracion/retencion-datos` | Organización | política de conservación/exportación | guardar | `organization.view` | Bloqueada |
| `…/configuracion/soporte` | Organización | soporte JIT | autorizar | `organization.view`; acción requerirá `support.authorize` | Bloqueada |
| `…/clientes/:clientId/resumen` | Cuenta cliente; RFC implícito | estado, corte, e.firma, SAT, CFDI nuevos, incidencias, año | descargar/cargar, cambiar responsable | `clients.view`; acciones requieren permisos específicos | Fixture |
| `…/clientes/:clientId/ejercicios` | RFC implícito | años, estados, períodos cerrados, novedades | crear/abrir ejercicio | `clients.view` | Fixture |
| `…/clientes/:clientId/ejercicios/:year` | RFC implícito + año | 12 períodos, avance, CFDI, incidencias, corte, versión | abrir período | `clients.view` | Fixture; sólo 2026 resoluble |
| `…/periodos/:period/resumen` | RFC implícito + año/mes | contadores, cierre, checklist, obligaciones | continuar trabajo | `clients.view` | Fixture |
| `…/periodos/:period/cfdi` | Período | CFDI, selección, tipo, contraparte, total, decisión | filtrar, acción masiva, excluir | `clients.view`; mutación necesita `cfdi.review/exclude` | Fixture |
| `…/periodos/:period/pagos` | Período | PPD, importes, complemento, relaciones | abrir CFDI | `clients.view` | Fixture |
| `…/periodos/:period/nomina` | Período | CFDI de nómina | consultar | `payroll.view` | Fixture protegido visualmente |
| `…/periodos/:period/incidencias` | Período | tipo, severidad, contexto, responsable, estado | revisar/resolver | `clients.view` | Fixture |
| `…/periodos/:period/cierre` | Período | checklist, estado, comentario | cerrar, reabrir | ruta `clients.view`; acciones necesitan `period.close/reopen` | Bloqueada |
| `…/periodos/:period/exportaciones` | Período | formato, alcance, solicitud, estado, expiración | configurar/descargar | ruta `clients.view`; acción necesita `exports.create` | Fixture |
| `…/clientes/:clientId/cfdi` | Cuenta/RFC transversal | UUID, fecha, dirección, tipo, contraparte, método, total, estado | buscar, filtrar, exportar, abrir | `clients.view` | Fixture |
| `…/clientes/:clientId/cfdi/:uuid?returnTo=` | Documento | general, XML, conceptos, impuestos, relaciones, historial | excluir/reincorporar, volver | `clients.view`; mutación `cfdi.exclude` | Fixture |
| `…/clientes/:clientId/alertas` | Cuenta/RFC | incidencia, condición de credencial y novedad | revisar | `clients.view` | Unión demo de conceptos distintos |
| `…/configuracion/{datos,responsables,e-firma-sat,obligaciones,accesos}` | Cuenta; RFC implícito | identidad, asignaciones, credencial, obligación, acceso | guardar/cambiar | `clients.manage`, `clients.assign`, `credentials.manage`, `obligations.configure` | Bloqueada |
| `…/obligaciones` | RFC implícito | obligación, periodicidad, período, estado, observaciones, archivo | continuar | `obligations.view` | Fixture |
| `…/obligaciones/diot` | RFC implícito | período, corte, proveedores, operaciones, estado, archivo | abrir | `obligations.view` | Fixture |
| `…/diot/:year/:period/{resumen,operaciones,validaciones,ajustes,vista-previa,archivos}` | RFC + período DIOT | fuentes, importes, clasificación, ajustes, validación, preview, versiones | revisar, generar TXT | lectura `obligations.view`; generar `diot.generate` | Fixture; generación bloqueada |
| `…/obligaciones/ieps` | RFC implícito | anexo, periodicidad, estado, detectados, pendientes | configurar/abrir | `obligations.view/configure` | Fixture |
| `…/ieps/:instanceId/{resumen,cfdi-fuente,impuestos,productos,clasificacion,informacion-adicional,validaciones,vista-previa,archivos}` | RFC + instancia | anexo, fuentes, impuestos, conceptos, clasificación, campos adicionales, preview | revisar, generar batch | lectura `obligations.view`; generar `ieps.generate` | Fixture; generación bloqueada |
| `…/obligaciones/archivos-generados` | RFC | tipo, período, anexo, layout, versión, actor, vigencia | descargar | `obligations.view` | Fixture; descarga bloqueada |
| `/es/{documents,queries,income,payroll,certificates,reports,users,collaboration,plans}` | Heredado | `origen` | redirigir a contexto seguro | según destino | Redirect, no pantalla de datos |
| `/en/*` | Compatibilidad | ninguno | redirigir | ninguno | Redirige a `/es/*` |

Estados transversales: `loading.tsx`, `error.tsx`, 403 y 404 existen; las tablas tienen estado vacío reusable. No hay éxito persistente porque las mutaciones están bloqueadas. Filtros son locales o query params; no hay paginación ni contratos API.

La resolución demo no valida todos los identificadores: DIOT acepta meses arbitrarios si el año es 2026, IEPS renderiza cualquier `instanceId` válido sintácticamente y configuración acepta una subsección desconocida. Además, `ContextSearch` en nivel organización recorre todos los CFDI demo sin filtrar primero por organización/asignación, y `NotificationsDrawer` recorre todas las notificaciones demo. Aunque los links posteriores suelen caer en 404/403 y los datos son ficticios, estos patrones no pueden trasladarse al adaptador real.

## 5. Matriz pantalla → datos

| Pantalla/componente | Dato requerido | Clasificación | Fuente actual | Tabla/campo actual | Cobertura | Propuesta objetivo |
|---|---|---|---|---|---|---|
| Login/registro | identidad, email, credencial, sesión | PERSISTIDO | formulario demo | `users` parcial; sin sesión emitida | PARCIAL | `users`, `auth_factors`, `auth_sessions` |
| Selector de despacho | organizaciones y rol por cuenta | PERSISTIDO | `demoData.memberships` | ninguna | NO CUBIERTO | `memberships` + `organizations`; rol efectivo/owner derivado |
| Perfil | nombre, correo, locale, zona | PERSISTIDO / CONFIGURACIÓN | fixture | `users` | PARCIAL | `users`, `user_preferences` |
| Inicio | clientes visibles | DERIVADO POR CONSULTA | `clientsFor()` | ninguna | DERIVADO | `v_portfolio_monthly` filtrada por asignación |
| Inicio | requieren atención/procesos/errores | AGREGADO / READ MODEL | conteos en memoria | ninguna | DERIVADO | read models y vistas de jobs/condiciones |
| Continuar trabajando | últimos contextos | CONFIGURACIÓN | `lastActivity` demo | ninguna | DEMO | preferencia de membresía o telemetría opt-in; no fiscal |
| Clientes | nombre operativo de cuenta y RFC | PERSISTIDO | un objeto `DemoClient` | ninguna | CONFLICTO | `client_accounts` 1:N `legal_entities`; no duplicar RFC |
| Clientes | estado mensual/progreso/incidencias/corte | AGREGADO / READ MODEL | fixture | propuesto parcialmente | PARCIAL | `v_portfolio_monthly` desde períodos, checklist, incidencias, jobs |
| Clientes | e.firma vigente | DERIVADO POR CONSULTA | string demo | `credential_records` propuesto | DERIVADO | derivar de `valid_to/status`; condición de alerta |
| Equipo | identidad, membresía, rol, estado | PERSISTIDO | arreglo local | propuesto, no implementado | NO CUBIERTO | `users`, `memberships`, `invitations` |
| Equipo | número de clientes | AGREGADO / READ MODEL | texto demo | ninguna | DERIVADO | conteo de `account_assignments` activas |
| Procesos | progreso unificado | ESTADO DE TRABAJO ASÍNCRONO | fixture | tablas específicas propuestas | PARCIAL | vista `v_process_center` sobre jobs específicos |
| Auditoría | evento, actor, objeto, decisión | AUDITORÍA | arreglo local | `audit_events` propuesto | NO CUBIERTO | `audit_events` append-only |
| Plan/facturación | plan, renovación, estado | PERSISTIDO | placeholder | no existe tabla base | NO CUBIERTO | `plans`, `plan_entitlements`, `subscriptions`, `subscription_events` |
| Resumen cliente | “CFDI nuevos”, avance anual | AGREGADO / READ MODEL | constantes | ninguna | DEMO | consulta/mat. view con corte explícito |
| Ejercicios | cerrados, pendientes, novedades | AGREGADO / READ MODEL | arreglo local | `fiscal_years/periods` propuestos | PARCIAL | `v_fiscal_year_summary` |
| Período header | estado, corte, versión, responsable | PERSISTIDO + DERIVADO | fixture global | `periods`, cierre y asignación propuestos | PARCIAL | `periods`, cierre vigente y responsable principal |
| Resumen período | nuevos/revisados/excluidos/tipos | AGREGADO / READ MODEL | constantes | `period_cfdis/work_decisions` propuestos | DERIVADO | `v_period_workspace_summary` |
| Mesa CFDI | XML y metadatos fiscales | PERSISTIDO / DATO EXTERNO | fixture | tablas CFDI propuestas | PARCIAL | `cfdis`, conceptos, impuestos, pagos y objetos |
| Mesa CFDI | selección y filtro actual | TEMPORAL DE UI | React/URL | ninguna | DEMO | cliente/URL; sólo vistas guardadas futuras |
| Mesa CFDI | inclusión, categoría, comentario | PERSISTIDO | no persiste | `work_decisions` propuesto | NO CUBIERTO | decisiones append-only con puntero vigente |
| Pagos | pagos/documentos relacionados | PERSISTIDO / DATO EXTERNO | inferido por `method` demo | propuesto | PARCIAL | `cfdi_payments`, `cfdi_payment_documents` |
| Incidencias | tipo, severidad, resolución, asignado | PERSISTIDO | arreglo local | `incidents` propuesto | NO CUBIERTO | `incidents`; no confundir con alerta/notificación |
| Checklist | definición y resultado | PERSISTIDO | checkboxes locales | tablas propuestas | NO CUBIERTO | plantilla + instancia + snapshot de cierre |
| Cierre | versión y reapertura | PERSISTIDO / AUDITORÍA | diálogo bloqueado | propuesto | NO CUBIERTO | `period_closes/items/reopenings` |
| Exportaciones | formato, job, objeto, expiración | ESTADO DE TRABAJO ASÍNCRONO | arreglo local | `export_jobs` propuesto | NO CUBIERTO | `export_jobs` + `stored_objects` |
| Alertas | PPD sin complemento | DERIVADO / INCIDENCIA | arreglo local | incidencia potencial | CONFLICTO | condición derivada; persistir incidencia al confirmarse |
| Alertas | e.firma próxima a vencer | DERIVADO POR CONSULTA | fixture | credencial propuesta | DERIVADO | vista de condiciones desde `valid_to` |
| Drawer notificaciones | entrega/leída por usuario | PERSISTIDO | fixture global | ninguna | NO CUBIERTO | `notifications`, filtrada por usuario/tenant |
| Búsqueda | cliente, RFC, UUID, folio, job | DERIVADO POR CONSULTA | filtro local | índices parciales propuestos | PARCIAL | vista segura + B-tree/trigram; RLS/asignación |
| Configuración | tema | CONFIGURACIÓN | localStorage/CSS | ninguna | PARCIAL | `user_preferences.theme`; cache local permitida |
| Configuración | locale/zona | CONFIGURACIÓN | fixture/`users` | `users.locale/timezone` | PARCIAL | `users` + override opcional de membresía |
| DIOT | instancia, corte, estado | PERSISTIDO | fixture | ninguna | NO CUBIERTO | configuración, instancia y papel de trabajo |
| DIOT | proveedores/operaciones/importes | PERSISTIDO + DERIVADO | arreglos demo | ninguna | NO CUBIERTO | `diot_operations` versionadas con fuentes |
| DIOT | ajuste manual | PERSISTIDO / AUDITORÍA | arreglo demo | ninguna | NO CUBIERTO | `obligation_adjustments` append-only |
| DIOT | preview/layout/TXT | DATO EXTERNO + SNAPSHOT | `<pre>` demo | ninguna | DEMO | layout versionado, preview reproducible, generación durable |
| IEPS | obligación/anexo/periodicidad | CONFIGURACIÓN | fixture | ninguna | NO CUBIERTO | catálogo, variante y configuración por vigencia |
| IEPS | impuestos/productos/clasificación | PERSISTIDO + DERIVADO | arreglo demo repetido | ninguna | NO CUBIERTO | `ieps_workpaper_items` + fuentes y ajustes |
| Archivos fiscales | versión, hash, vigencia | ESTADO ASÍNCRONO / AUDITORÍA | fixture | ninguna | NO CUBIERTO | generaciones, resultados y objeto privado |

## 6. Matriz de entidades y tablas

| Entidad/tabla base o real | Necesidad del frontend | Decisión | Gap principal | Impacto | Tabla objetivo |
|---|---|---|---|---|---|
| `users` | cuenta global/perfil | MODIFICAR | implementación mezcla autenticación local y perfil; locale libre | Alto | `users` + `auth_factors` + preferencias |
| `organizations` | despacho/owner/configuración | MODIFICAR | no implementada; falta consistencia owner-membership | Crítico | `organizations` |
| `memberships` | multi-organización/rol | MODIFICAR | no implementada; `organization_owner` duplica verdad | Crítico | `memberships` sin flag owner |
| `invitations` | equipo | MODIFICAR | propuesta usa permisos en payload; falta idempotencia explícita | Alto | `invitations` |
| `auth_sessions` | tenant activo/revocación | MODIFICAR | JWT real no lo representa | Crítico | `auth_sessions` con contexto nullable preselección |
| `permissions` | capacidades | MODIFICAR | claves base y frontend usan vocabularios distintos | Alto | `permissions` con keys canónicas `dominio.acción` |
| `role_permissions` | defaults | CONSERVAR | no implementada | Alto | igual, con vigencia |
| `membership_permissions` | override | MODIFICAR | necesita PK/historial consistente | Alto | igual, append-only/revocación |
| `client_accounts` | cuenta agrupadora | MODIFICAR | frontend la colapsa con RFC | Crítico | `client_accounts` |
| `account_assignments` | alcance y responsable | MODIFICAR | falta distinguir responsabilidad principal | Crítico | `account_assignments` con unicidad parcial de principal |
| `legal_entities` | RFC/credencial/períodos | MODIFICAR | ruta no tiene `legalEntityId`; regímenes pueden ser múltiples/vigentes | Crítico | `legal_entities`; configuración fiscal separada cuando aplique |
| `fiscal_years` | ejercicios | CONSERVAR | no implementada | Alto | `fiscal_years` |
| `periods` | meses, estado, corte | MODIFICAR | lease actual embebido no conserva historial | Alto | `periods` + `period_leases` |
| `stored_objects` | XML/ZIP/credenciales/salidas | MODIFICAR | falta clasificación de cifrado/retención y FK de tenant robusta | Crítico | `stored_objects` |
| `credential_records` | e.firma/SAT | MODIFICAR | falta RFC/cert hash de validación e historial explícito | Crítico | `credential_records` (cada fila es una versión) |
| `sat_download_jobs` | descargas/procesos | MODIFICAR | faltan timestamps/state checks/credential usado | Crítico | igual |
| `sat_download_packages` | paquetes | MODIFICAR | object nullable durante espera; falta hash oficial si existe | Alto | igual |
| `ingestion_jobs` | SAT/carga manual | MODIFICAR | fuente sólo SAT/manual es insuficiente para paquete | Alto | igual |
| `ingestion_items` | resultado parcial | MODIFICAR | falta nombre seguro/ordinal/idempotencia por item | Alto | igual |
| `cfdis` | consulta/detalle | MODIFICAR | falta `client_account_id`, dirección respecto al RFC y estado fuente versionable | Crítico | `cfdis` |
| `cfdi_concepts` | detalle/IEPS | MODIFICAR | faltan importes/constraints físicos precisos | Alto | igual |
| `cfdi_taxes` | detalle/DIOT/IEPS | MODIFICAR | unicidad e integridad concepto-CFDI incompletas | Alto | igual |
| `cfdi_relations` | relaciones | MODIFICAR | relación por UUID puede resolverse después | Medio | igual |
| `cfdi_payments` | pagos | CONSERVAR | no implementada | Alto | igual |
| `cfdi_payment_documents` | parcialidades | MODIFICAR | falta moneda/equivalencia cuando fuente la provee | Alto | igual |
| `period_cfdis` | participación mensual | MODIFICAR | puntero circular `current_decision_id` complica inserción | Alto | igual; puntero validado por trigger diferible |
| `work_decisions` | revisión/exclusión | MODIFICAR | catálogos configurables no modelados | Alto | igual + códigos controlados |
| `incidents` | incidencias | MODIFICAR | falta origen, descripción y aceptación de excepción explícita | Alto | `incidents` |
| `organization_checklist_items` | plantilla | MODIFICAR | PK lógica no permite versionar label/regla | Medio | igual con `id` y vigencia |
| `period_checklist_items` | checklist | MODIFICAR | falta snapshot de required/sort y lock version | Alto | igual |
| `period_closes` | cierre versionado | MODIFICAR | snapshot sólo referencia decisiones; falta manifiesto/hash | Alto | igual |
| `period_close_items` | detalle cierre | CONSERVAR | no implementada | Alto | igual |
| `period_reopenings` | reapertura | MODIFICAR | debe señalar nueva versión de trabajo/razón | Alto | igual |
| `export_jobs` | exportar/centro procesos | MODIFICAR | falta parameters snapshot/hash/invalidación de autorización | Alto | igual |
| `audit_events` | auditoría | MODIFICAR | `metadata` sin esquema/lista permitida; falta actor de servicio | Crítico | igual append-only |
| Suscripción conceptual | plan/facturación | AGREGAR | descrita pero sin tabla base | Crítico | `plans`, `plan_entitlements`, `subscriptions`, `subscription_events` |
| Preferencias | perfil/tema/zona | AGREGAR | no modeladas salvo locale/zona en user | Medio | `user_preferences`, `membership_preferences` |
| Notificaciones | drawer/avisos | AGREGAR | no existe persistencia de entrega/lectura | Medio | `notifications`, `notification_preferences` |
| Soporte JIT | ayuda/soporte | AGREGAR | sólo aparece como regla | Alto | `support_access_grants` |
| Obligaciones | DIOT/IEPS | AGREGAR | inexistentes | Crítico | familia `obligation_*`, layouts y tablas específicas |
| Centro de procesos | pantalla unificada | REEMPLAZAR | no conviene duplicar jobs en tabla genérica | Medio | vista `v_process_center` sobre jobs específicos |
| Alertas | pantalla unificada | REEMPLAZAR | mezcla condiciones, incidencias y notificaciones | Alto | vista `v_alert_conditions` + tablas específicas |

Si una tabla base ya tuviera datos, las decisiones MODIFICAR se migran de forma aditiva: crear columnas/constraints inicialmente diferibles, rellenar tenant y relaciones por joins autorizados, verificar cruces, activar `NOT NULL`, y sólo después retirar campos sustituidos. Ninguna eliminación física se propone sin exportación y auditoría. `memberships.organization_owner` se recalcularía desde `organizations.owner_user_id` y luego se eliminaría; no se promovería su valor a segunda fuente.

## 7. Hallazgos por dominio

### Identidad, sesión y multi-organización

La entidad real `users` sí permite un correo global único, pero no existe `memberships`; por tanto hoy no puede pertenecer a varias organizaciones. `AuthenticatedUser` sólo contiene `sub`, `email` y `permissions`; el JWT no transporta ni revalida sesión, organización o membresía activa. El contexto frontend recuerda `last-demo-organization` sin usarlo para autorizar, lo cual es correcto como demo, pero no cancela solicitudes ni cachés reales porque aún no existen.

Los guards de página son incompletos a nivel de acción: una ruta de período exige en general `clients.view`, pero los diálogos de cierre, reapertura, exportación, descarga SAT y exclusión pueden renderizarse sin volver a aplicar sus capacidades específicas. Los endpoints futuros no pueden inferir permiso de que el usuario haya alcanzado esa pantalla.

Objetivo: sesiones persistidas y revocables con `organization_id`/`membership_id` activos, ambos nulos durante pre-MFA/selección; cambio transaccional de tenant; cachés con tenant; y revalidación de jobs. El mismo `users.id` tendrá N membresías.

### Titularidad, roles y permisos

`organizations.owner_user_id` debe ser la única fuente de titularidad. Se elimina el flag `memberships.organization_owner` propuesto. El rol operativo del titular será normalmente `admin`; “Titular” se calcula comparando `owner_user_id`. Administrador no podrá transferir propiedad, cancelar ni controlar cobro. Las capacidades visuales de puntos (`period.close`) se convierten en claves canónicas; los nombres underscore del documento base requieren una tabla de mapeo de migración, no dos catálogos.

### Suscripción

Es el gap documental más claro: `Subscription` se describe, pero no figura en el catálogo de tablas. El objetivo añade plan versionable, entitlements, una suscripción vigente por organización y eventos idempotentes del proveedor. No se guardan PAN/CVC; sólo referencias externas y descripción enmascarada opcional del método.

### Clientes, RFC, ejercicios y períodos

El frontend modela cada `DemoClient` con `name` y `rfc` y sus rutas no contienen `legalEntityId`. Esto sólo funciona para una cuenta con un RFC. El modelo objetivo preserva `client_accounts` 1:N `legal_entities`; una transición futura de navegación deberá insertar el RFC activo de forma explícita o resolverlo únicamente cuando haya uno. La base de datos nunca inferirá que `clientId == legalEntityId`.

La asignación permanece a nivel de cuenta y se hereda. `account_assignments.responsibility = primary` representa al responsable, con múltiples colaboradores. Se deja una evolución compatible a una tabla de scope por RFC en P2, sin conceder acceso granular ahora.

### CFDI, pagos, impuestos y decisiones

El modelo base cubre correctamente original inmutable, conceptos, impuestos, relaciones y complementos. Requiere constraints compuestas por tenant, importes precisos, dirección respecto de la entidad y `client_account_id` para políticas seguras. Los estados de revisión/exclusión viven en `work_decisions`, no en `cfdis`; el fixture `status` mezcla hoy SAT y trabajo y no debe copiarse tal cual.

### Procesos y exportaciones

Se elige una **proyección unificada** y no una tabla base genérica: SAT, ingesta, exportación y generación fiscal tienen state machines, idempotencia y payloads distintos. `v_process_center` normaliza identificador, tipo, estado UI, progreso, cliente, RFC, período, actor y error sin duplicar la fuente de verdad. Los workers revalidan autorización al comenzar y antes de publicar objetos; la revocación impide nuevas descargas aunque el procesamiento técnico pueda terminar en cuarentena.

### Alertas, notificaciones, búsqueda y auditoría

La pantalla Alertas combina tres naturalezas: PPD sin complemento (condición/posible incidencia), e.firma por vencer (condición derivada) y novedad posterior (estado del período). Se resuelve con una vista de condiciones, `incidents` para trabajo persistente, `notifications` para entrega a una persona y `audit_events` para trazabilidad. No se crea `alerts` genérica. La búsqueda real debe partir de tenant y asignaciones antes de aplicar texto; esto corrige el barrido global de `demoData.cfdi` que hoy realiza el buscador en contexto de despacho.

### Preferencias

Locale y zona global permanecen en `users`; el alcance limita locale a `es-MX`. Tema vive en `user_preferences`. Preferencias de período, densidad o notificación dentro de un despacho viven en membresía. “Último cliente visitado” puede quedar local o como preferencia opcional; no es dato fiscal ni columna del cliente.

### DIOT

No existe cobertura en el modelo base. El objetivo añade configuración vigente por RFC, instancia mensual, papel de trabajo versionado, fuentes CFDI/pagos/impuestos, operaciones DIOT explícitas, ajustes, validaciones, layout versionado y generación durable. Un cambio de fuentes aumenta `source_revision`; archivos con una revisión anterior quedan `stale` sin borrarse.

### IEPS

No existe cobertura. Se comparte el núcleo de obligaciones, pero IEPS conserva variante/anexo y una tabla explícita por concepto/producto con impuesto detectado y clasificación; no se modela como un archivo universal. El batch preparado por Balanz y cualquier resultado de MULTI-IEPS son objetos con `artifact_role` diferente. Ningún estado significa “presentado al SAT”.

### Object storage, seguridad y RLS

La propuesta base ya evita XML/llaves en PostgreSQL. El objetivo fortalece el patrón con clase de cifrado, retención, cuarentena, hash y objetos derivados. Todas las tablas de tenant tienen `organization_id` y FKs compuestas o triggers equivalentes; RLS filtra tenant y, para recursos fiscales, una política o vista autorizada aplica asignación. RLS es defensa adicional, nunca reemplazo de permisos, owner, MFA o reautenticación.

## 8. Hallazgos de integridad

- **PK:** las tablas asociativas base sin `id` dificultan auditoría/historial; se agregan UUID salvo catálogos realmente estáticos.
- **FK compuestas:** casi todas las fichas base dicen “mismo tenant” sin mostrar constraints ejecutables. El objetivo exige `UNIQUE (organization_id,id)` en padres y FK `(organization_id,parent_id)`.
- **Unicidad:** RFC activo por tenant debe ser índice parcial; correo usa `lower(email)`/`citext`; owner requiere membresía activa mediante trigger diferible, no una FK simple.
- **Checks:** estados, meses, importes no negativos, rangos de vigencia y coherencia de timestamps deben ser constraints. Los estados oficiales SAT permanecen separados del job interno.
- **Nulabilidad:** sesión puede no tener tenant antes de selección; `xml_object_id` es nulo para metadata; `object_id` de un job es nulo hasta completarse.
- **Borrado:** identidad y datos fiscales no se borran por cascada de UI. Se archivan/revocan y un proceso de retención elimina objetos. Auditoría, decisiones, cierres, ajustes y eventos comerciales son append-only.
- **Concurrencia:** `periods.lock_version` más `period_leases`; índices parciales garantizan un lease activo. Cierres y generaciones bloquean por clave de idempotencia.
- **Referencias circulares:** `period_cfdis.current_decision_id` requiere trigger diferible o puede omitirse y obtener la última versión. El objetivo lo conserva como acelerador validado, nunca autoridad independiente.
- **Índices:** búsqueda de RFC/UUID usa B-tree; nombres/folios usan `pg_trgm`; jobs usan `(organization_id,status,created_at)`; períodos y obligaciones usan claves de año/mes/configuración.
- **Cruces de tenant:** el esquema base no presenta cada FK física; una FK sólo por UUID permitiría relacionar un hijo con otro tenant si la aplicación falla. Es P0.
- **Fuentes duplicadas:** `memberships.organization_owner`, `DemoClient.status/progress`, `cfdis.status` demo y tarjetas agregadas no pueden ser fuentes de verdad.
- **Migración real:** el `UNIQUE(email)` de `users` depende de normalización de servicio; debe transformarse a unicidad independiente de mayúsculas en DB. Sus `created_at/updated_at/deleted_at` son `timestamp` sin zona en la migración, contrario a la convención `timestamptz`.

## 9. Datos que NO deben convertirse en tablas o columnas

| Dato visual | Por qué no persistirlo así | Fuente correcta |
|---|---|---|
| Clientes visibles/requieren atención | conteo dependiente de usuario, tenant, mes y asignación | consulta/read model |
| Progreso de cliente o ejercicio | cambia con checklist/decisiones/período | cálculo o vista materializada con estrategia de refresh |
| “CFDI nuevos”, emitidos, recibidos, revisados | agregados por corte/participación/decisión | `period_cfdis`, `cfdis`, decisión vigente |
| Estado de e.firma “próxima a vencer” | condición temporal | `credential_records.valid_to` + política de umbral |
| “Conexión SAT” | proyección de credencial, último job y configuración | read model, no booleano duplicado |
| Última actividad / continuar trabajando | preferencia o telemetría contextual | cliente local o preferencia de membresía |
| Nombre del editor actual | identidad del lease activo | join `period_leases → memberships → users` |
| Porcentaje de job | estado operativo mutable | job específico; en algunos estados puede derivarse |
| Etiquetas de tabs y breadcrumbs | configuración de interfaz | código de navegación |
| Búsqueda/filtros/selección actual | estado temporal o URL | cliente; vista guardada sólo si Producto la aprueba |
| Nombres, montos, UUID y RFC `DEMO-*` | fixtures demostrativos | nunca catálogo/productivo |
| “Layout demostrativo 2026” y líneas preview | placeholder no normativo | `fiscal_layout_versions` aprobada + snapshot |
| Proveedores/operaciones/IVA demo DIOT | ejemplos sin regla fiscal aprobada | papel de trabajo producido por versión de reglas |
| Producto A/B y anexos demo IEPS | placeholder | configuración y conceptos reales versionados |
| Conteo de notificaciones en campana | agregado por destinatario/lectura | `notifications` |
| Severity de auditoría visual | presentación derivada de acción/resultado | mapping de UI; el evento conserva acción/decisión |

## 10. Priorización de hallazgos

| ID | Prioridad | Hallazgo y evidencia | Riesgo / impacto | Recomendación | Dependencias |
|---|---|---|---|---|---|
| GAP-001 | P0-BLOQUEANTE | Sólo `users` existe en una migración | Ningún flujo contable puede persistir | Implementar fundaciones por etapas | proveedor auth |
| GAP-002 | P0-BLOQUEANTE | No hay tenant/membresía/asignación/FK compuesta/RLS | fuga cross-tenant crítica | establecer contexto y constraints antes de datos fiscales | GAP-001 |
| GAP-003 | P0-BLOQUEANTE | JWT confía en permisos globales sin sesión/tenant | escalación, revocación inefectiva | sesión persistida y política central | GAP-001/002 |
| GAP-004 | P0-BLOQUEANTE | DIOT/IEPS navegables no tienen modelo | no se puede estimar ni generar reproduciblemente | núcleo de obligaciones versionado | núcleo CFDI |
| GAP-005 | P0-NECESARIO | Frontend colapsa cuenta y RFC | mezcla de cierres/credenciales en cuentas multi-RFC | mantener 1:N y exigir entidad fiscal explícita en contratos | clientes |
| GAP-006 | P0-NECESARIO | owner y admin no están implementados; flag base duplica owner | cancelación/propiedad incorrecta | `owner_user_id` único; rol admin separado | membresías |
| GAP-007 | P0-NECESARIO | suscripción descrita sin tablas | facturación y entitlement no trazables | cuatro tablas comerciales | organizaciones |
| GAP-008 | P0-NECESARIO | no hay custodia/referencia e.firma real | exposición de clave/flujo SAT imposible | objetos privados, KMS, credencial versionada | storage/security review |
| GAP-009 | P0-NECESARIO | no hay CFDI/ingesta/pagos implementados | pantallas principales sin fuente | implementar original inmutable e idempotencia | clientes/storage |
| GAP-010 | P0-NECESARIO | jobs sólo son fixtures | procesos se pierden al cerrar/reiniciar | tablas específicas durables + vista común | workers/colas |
| GAP-011 | P0-NECESARIO | cierre/checklist/lease no implementados | sobrescritura y cierres no reproducibles | lock, lease histórico, snapshots | períodos/decisiones |
| GAP-012 | P0-NECESARIO | permisos de ruta no protegen acciones internas | botón oculto puede ejecutar acción | permiso por endpoint/worker/objeto | política central |
| GAP-013 | P1 | alertas mezclan 4 conceptos | duplicación y estados incoherentes | condición derivada + incidencia + notificación + auditoría | read models |
| GAP-014 | P1 | drawer de notificaciones usa fixtures globales | enlace de otro tenant | destinatario y `organization_id`; filtro estricto | identidad |
| GAP-015 | P1 | dashboard persiste implícitamente agregados demo | totales obsoletos | vistas/read models con corte y refresh | dominio base |
| GAP-016 | P1 | búsqueda local no cubre jobs y no pagina | fuga/ineficiencia | vista segura e índices B-tree/trigram | RLS/asignación |
| GAP-017 | P1 | soporte JIT sólo está documentado | acceso interno sin evidencia | grants con TTL, scope, ticket y revocación | auth/audit |
| GAP-018 | P1 | preferencias mezcladas con usuario/tenant | cambio de organización contamina UI | separar user y membership preferences | identidad |
| GAP-019 | P1 | `stored_objects` base carece de clase de cifrado/retención | borrado o acceso incorrecto | políticas por kind, encryption y retention | storage |
| GAP-020 | P1 | archivo fiscal desactualizado sólo es etiqueta demo | uso de versión vieja | revisiones de fuente y stale automático | obligaciones |
| GAP-021 | P2 | asignación por RFC no está en MVP | cuentas complejas futuras | extensión de scope compatible, pospuesta | evidencia piloto |
| GAP-022 | P2 | densidad de tablas es preferencia potencial | tabla innecesaria hoy | campo opcional de preferencia, activar cuando exista UX | decisión Producto |
| GAP-023 | P2 | resultado externo MULTI-IEPS no tiene flujo | confusión batch vs archivo externo | `artifact_role` y carga opcional futura | integración externa |
| GAP-024 | DEUDA TÉCNICA | infraestructura/diccionario inglés persiste | contradice alcance | mantener redirect; retirar sólo en tarea frontend separada | ninguna DB |
| GAP-025 | DEUDA TÉCNICA | CRUD global de usuarios permite soft-delete sin tenant | endpoint administrativo riesgoso | limitar a identidad propia/internal app | auth nueva |
| GAP-026 | DEUDA TÉCNICA | README sobredescribe autenticación y permisos | falsas expectativas | actualizar en tarea documental posterior | implementación real |
| GAP-027 | SIN CAMBIO | usuario global con correo único | soporta múltiples organizaciones | conservar identidad global | — |
| GAP-028 | SIN CAMBIO | original CFDI/XML inmutable | garantiza evidencia | conservar | — |
| GAP-029 | SIN CAMBIO | asignación por cuenta heredada a RFC | regla MVP aprobada | conservar | — |
| GAP-030 | SIN CAMBIO | jobs específicos y object storage privado | buen límite de dominio | conservar/reforzar | — |
| GAP-031 | SIN CAMBIO | decisiones/cierres/auditoría append-only | trazabilidad correcta | conservar/reforzar | — |

## 11. Decisiones, supuestos y alternativas

Decisiones tomadas:

- PostgreSQL 16+ y UUID de aplicación; todas las fechas de dominio son `timestamptz`.
- Owner en `organizations.owner_user_id`; no se persiste otro booleano de titularidad.
- Roles base no configurables en el MVP; permisos atómicos sí admiten overrides.
- Jobs específicos + vista común, descartando una tabla `jobs` que duplicaría estado/payload.
- Sin tabla `alerts`; se usa proyección de condiciones y entidades de propósito único.
- Obligaciones comparten configuración/instancia/papel/layout/generación, con tablas explícitas DIOT e IEPS.
- `jsonb` sólo para snapshots/parameters/definiciones versionadas; no para CFDI, permisos o importes nucleares.
- Una cuenta multi-RFC obliga a resolver entidad fiscal; el modelo no adopta el atajo actual de ruta.

Supuestos conservadores:

- Las categorías y tratamientos de trabajo se guardan inicialmente como códigos controlados por aplicación; si Producto aprueba catálogos configurables, se migran sin cambiar el original CFDI.
- La generación DIOT/IEPS prepara archivos; no presenta obligaciones ni registra acuse SAT como resultado propio.
- El mismo RFC puede existir en tenants diferentes, pero no en dos cuentas activas del mismo tenant.
- La vista de cartera se calcula bajo demanda al inicio; materialización se decide con medición de volumen.

Alternativas descartadas:

- Flag `organization_owner` en membresía: segunda fuente de verdad.
- Suscripción en `organizations`: pierde historial, proveedor y eventos.
- Un `status` global de proceso: mezcla state machines.
- EAV de obligaciones: elimina tipos, constraints y validación fiscal.
- Columnas permanentes por layout DIOT/IEPS: bloquean cambios normativos.
- Copiar cada tarjeta del dashboard a `client_accounts`: produce inconsistencias.

Decisiones realmente pendientes:

- [DECISIÓN REQUERIDA] Proveedor y estrategia final de autenticación/MFA/sesión; determina si `password_hash` se conserva o se migra a referencia externa.
- [DECISIÓN REQUERIDA] Política contractual/legal de retención, exportación y purgado por clase de objeto.
- [DECISIÓN REQUERIDA] Planes, precio, duración/límites de trial, gracia, moneda, impuestos, prorrateo y definición de RFC activo.
- [DECISIÓN REQUERIDA] Catálogo aprobado de categorías/tratamientos e incidencias bloqueantes.
- [DECISIÓN REQUERIDA] Layouts y reglas fiscales oficiales por vigencia para DIOT e IEPS; el modelo sólo prepara su versionado.
- [DECISIÓN REQUERIDA] Campos/formato final de exportación validados por pilotos.

## 12. Conclusión y siguiente paso

Cuando se autoricen migraciones, el primer incremento debe implementar `users`, factores/sesiones, `organizations`, `memberships`, permisos y auditoría mínima con pruebas negativas entre dos tenants. El segundo debe agregar clientes, RFC, asignaciones y constraints compuestas. No debe conectarse CFDI, SAT, archivos o una pantalla fiscal antes de comprobar que cambiar IDs, tenant, membresía y asignación no cruza datos.

Después siguen períodos/lease, object storage/credenciales, ingesta/CFDI, revisión/cierre, jobs/exportaciones y, sobre ese núcleo estable, obligaciones DIOT/IEPS. El modelo objetivo completo se especifica en `docs/architecture/CORRECTED_POSTGRESQL_DATA_MODEL.md`.
