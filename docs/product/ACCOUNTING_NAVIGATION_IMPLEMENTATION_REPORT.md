# Reporte de implementación de navegación contable

## Estado

Fecha: 18 de agosto de 2026.

Se reemplazó el shell genérico del commit base `571d6ec` por una arquitectura navegable de despacho, cliente, ejercicio, período y obligaciones. La implementación conserva el sistema visual Registro Sereno y usa datos demostrativos tipados; no afirma que existan servicios fiscales o persistencia.

## Fuentes y límites

- Se leyó completo `CODEX_PROMPT_ARQUITECTURA_NAVEGACION_SISTEMA_CONTABLE_HEMIA.md` y el design system `docs/design/ACCOUNTING_UI_DESIGN_AGENT.md`.
- No se localizaron `Propuesta_funcional_Control_mensual_CFDI_Hemia_v3(1).docx` ni `Proyecto contador.docx` en repositorio, Descargas, Escritorio, Documentos, adjuntos o el árbol de Hemia.
- El backend sólo expone usuarios y guards JWT/permisos globales. No se modificó porque aún no modela despachos, membresías, asignaciones, clientes, períodos ni obligaciones.
- Login, registro, onboarding y todas las mutaciones son demostrativos y lo indican junto a la acción.

## Componentes, rutas y fixtures

- `accounting-types.ts`, `permissions.ts`, `navigation-core.ts` y `product-route.ts` concentran tipos, capacidades, filtrado y resolución canónica.
- `demo-data.ts` es la única fuente de datos demo para dos despachos, cuatro clientes, doce períodos, CFDI, procesos y notificaciones.
- `AccountingContextProvider` reconstruye despacho y cliente desde la URL; la selección local nunca concede acceso.
- Sidebar global y de cliente, topbar con breadcrumbs, búsqueda contextual, procesos, notificaciones, perfil y tema comparten el mismo contexto.
- Se añadieron patrones reutilizables para encabezados, superficies, filtros, campos, tabs, tablas, estados, avisos, diálogos, drawers, permisos y retorno con `returnTo`.
- Una ruta catch-all tipada sirve las pantallas de despacho/cliente sin perder URLs semánticas. Las rutas personales y públicas se mantienen separadas.
- La interfaz operativa queda sólo en español; `/en/*` redirige al equivalente `/es/*`.

## Pantallas terminadas

- Despacho: mesa de control, clientes, procesos, equipo, auditoría y configuración.
- Cliente: resumen, ejercicios, año fiscal, CFDI, detalle, alertas y configuración.
- Período mensual: resumen, CFDI, pagos, nómina, incidencias, cierre y exportaciones.
- Obligaciones: resumen, DIOT, IEPS y archivos generados.
- DIOT: resumen, operaciones, validaciones, ajustes, vista previa y archivos.
- IEPS: resumen, CFDI fuente, impuestos, productos, clasificación, información adicional, validaciones, vista previa y archivos.
- Entrada/soporte: login, registro, recuperación, onboarding, selector de despacho, perfil, seguridad, preferencias, ayuda, loading, error, 403 y 404.

## Redirects y guards

- Despacho, membresía, cliente, asignación, año, período, UUID y capacidad se validan antes de renderizar la pantalla demo.
- Un recurso desconocido devuelve 404; falta de membresía, asignación o capacidad redirige a 403 preservando el despacho solicitado.
- El menú se filtra por contexto y capacidad, pero cada aviso aclara que la autorización definitiva debe vivir en backend.
- `documents`, `queries`, `income`, `payroll`, `certificates`, `reports`, `users`, `collaboration` y `plans` redirigen a destinos seguros con contexto explícito.

## DIOT e IEPS

- Ambos flujos son navegables y muestran datos de preparación, observaciones, versiones y archivos representativos.
- `Generar archivo DIOT` y `Generar archivo batch para MULTI-IEPS` abren confirmaciones accesibles con la acción final deshabilitada.
- No se crea TXT, `.dec`, presentación, acuse, determinación fiscal ni comunicación con el SAT.

## Pruebas técnicas

Resultados finales mediante scripts de `apps/web`:

- `npm run lint --workspace apps/web`: sin errores ni advertencias.
- `npm run typecheck --workspace apps/web`: TypeScript sin errores.
- `npm run test --workspace apps/web`: 5/5 pruebas pasan para contexto/capacidad, active state, resolución de rutas, asignación de cliente y redirects heredados.
- `npm run build --workspace apps/web`: compilación de producción y generación de rutas correctas.

## Validación manual y accesibilidad

Se recorrieron en el navegador local:

1. login demo → selector de despacho;
2. Titular y Colaborador/Auxiliar con menús distintos;
3. despacho → cliente → ejercicio → período;
4. DIOT Validaciones y su diálogo de generación bloqueada;
5. IEPS Clasificación con sus nueve vistas;
6. perfil, temas y selector de despacho;
7. 403 contextual, 404 de año inválido, ruta heredada y `/en` → `/es`.

La inspección semántica confirmó enlace de salto, landmarks, títulos, captions de tabla, labels, status con icono/texto, progreso etiquetado, diálogos nativos y botones finales deshabilitados. Durante la prueba se corrigieron dos advertencias de Base UI: semántica de enlaces renderizados por `Button` y `DropdownMenuLabel` fuera de su grupo. No se registraron errores nuevos después de la corrección.

Se obtuvo una captura visual de la pantalla mensual con navegación compacta y tema oscuro. El controlador disponible no expuso un método para fijar viewports arbitrarios; por eso la revisión exhaustiva de varios anchos queda pendiente de una matriz manual de dispositivos, aunque el código conserva breakpoints, overflow horizontal en tablas/tabs y navegación móvil.

## Integraciones no conectadas

Autenticación, recuperación, MFA, organizaciones, membresías, asignaciones, clientes, SAT, CFDI, procesos, exportaciones, auditoría persistida, DIOT e IEPS no tienen contratos frontend/backend disponibles. Tampoco existe motor fiscal, almacenamiento de archivos ni URL de descarga autorizada.

## Documentación

- Arquitectura normativa: `docs/product/ACCOUNTING_INFORMATION_ARCHITECTURE.md`.
- Reporte de implementación: este archivo.
- Reglas del agente: `apps/web/AGENTS.md` referencia el documento de arquitectura y el design system.

## Resumen del diff

La rama de trabajo es `codex/refactor-ux-ui`, basada en `571d6ec`. Los cambios permanecen sin commit ni push. Se preservaron archivos ajenos y no se modificó el backend.
