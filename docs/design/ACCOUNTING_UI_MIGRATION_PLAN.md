# Plan de migración visual — Registro Sereno

## Estado

- Fecha de inicio: 18 de agosto de 2026.
- Frontend: apps/web.
- Dirección objetivo: Registro Sereno.
- Estrategia: migración incremental sobre Next.js, Tailwind CSS 4, shadcn/Base UI y Lucide existentes.
- Restricción: no cambiar backend, contratos, autenticación, permisos ni reglas contables.

## Línea base auditada

El frontend tiene un shell privado, diez rutas privadas basadas en un único estado vacío, login, registro y 404. La navegación desktop funciona y puede colapsarse; en móvil desaparece. Existen temas claro y oscuro, selector de idioma, buscador visual y botones de notificaciones/perfil. No hay datos contables conectados, tablas pobladas, gráficas, descargas ni exportaciones implementadas en el frontend.

Problemas prioritarios:

- Tokens shadcn neutrales y sin estados completos.
- Ausencia de navegación móvil.
- Título duplicado entre topbar y contenido.
- Estados vacíos idénticos y sin contexto.
- Controles de 24–36 px.
- Microcopy con Dashboard y workspace.
- Sin skip link ni reduced motion global.
- Falta un patrón explícito para encabezado, superficies, datos y exportación.

## Arquitectura visual objetivo

1. Fundaciones semánticas en globals.css.
2. Shell con sidebar agrupado, topbar global, navegación móvil accesible y contenido con ancho operativo.
3. PageHeader como única jerarquía principal de ruta.
4. Surface y EmptyState como patrones compartidos, sin card soup.
5. Primitivos shadcn/Base UI ajustados a tokens, targets y focus.
6. Autenticación y 404 alineados con la misma marca y reglas.
7. Rutas privadas con microcopy específico, sin datos o acciones simuladas.

## Fases, dependencias y estado

| Orden | Fase | Dependencia | Estado |
| --- | --- | --- | --- |
| 1 | Auditoría del repositorio y línea base | Ninguna | Completada |
| 2 | Investigación y dirección | Auditoría | Completada |
| 3 | Documentación normativa y AGENTS.md | Dirección | Completada |
| 4 | Tokens, tipografía, focus y motion | Documento normativo | Completada |
| 5 | Shell desktop y móvil | Fundaciones | Completada |
| 6 | Componentes compartidos | Fundaciones | Completada |
| 7 | Rutas privadas | Shell y componentes | Completada |
| 8 | Login, registro y 404 | Fundaciones y componentes | Completada |
| 9 | Validación visual, accesibilidad y técnica | Implementación | Completada con limitaciones registradas |

## Fundaciones a modificar

- apps/web/src/app/globals.css
  - Colores semánticos claro/oscuro.
  - Estados success, warning, info y destructive-surface.
  - Tokens de marca, layout, sombras, motion y z-index.
  - Tipografía numérica y focus global.
  - Skip link, reduced motion y estilos de selección.
- apps/web/src/app/[lang]/layout.tsx
  - Mantener Geist/Geist Mono.
  - Garantizar estructura base y clase numérica disponible.
- apps/web/src/components/theme-initializer.tsx
  - Conservar tema existente y modo claro de referencia sin romper preferencia guardada.

## Componentes compartidos

| Componente | Acción |
| --- | --- |
| Button | Refactorizar alturas, radios, transiciones, focus y variantes |
| Input | Refactorizar altura, background, error y placeholder |
| Badge | Refactorizar radio y estados semánticos |
| DropdownMenu | Aumentar targets, reducir zoom y respetar reduced motion |
| Tooltip | Alinear radio, motion y contraste |
| Table | Alinear padding, headers, números y totales |
| BrandMark | Crear marca tipográfica reutilizable |
| PageHeader | Crear jerarquía de ruta y área de acciones |
| EmptyState | Refactorizar a variantes contextuales y alineación operativa |
| AppSidebar | Agrupar navegación, mejorar estado activo y conservar collapse |
| MobileNavigation | Crear diálogo nativo con foco, Escape y cierre al navegar |
| AppTopbar | Convertir en controles globales sin repetir h1 |

## Pantallas a migrar

| Ruta | Arquetipo | Objetivo | Estado |
| --- | --- | --- | --- |
| /es, /en | Resumen | Mostrar estado honesto sin KPIs simulados | Migrada |
| /[lang]/documents | Listado vacío | Preparar superficie para CFDI/XML sin inventar datos | Migrada |
| /[lang]/queries | Consulta vacía | Explicar ausencia sin simular búsqueda | Migrada |
| /[lang]/income | Listado vacío | Preparar jerarquía de ingresos y pagos | Migrada |
| /[lang]/reports | Reportes vacíos | Reservar patrón para periodo y exportación real futura | Migrada |
| /[lang]/certificates | Configuración vacía | Contexto claro y seguro | Migrada |
| /[lang]/users | Configuración vacía | Contexto de usuarios/roles sin inventar permisos | Migrada |
| /[lang]/plans | Configuración vacía | Contexto de plan sin inventar compra | Migrada |
| /[lang]/collaboration | Colaboración vacía | Estado específico sin contactos ficticios | Migrada |
| /[lang]/payroll | Listado vacío | Preparar superficie para XML de nómina | Migrada |
| /[lang]/login | Autenticación | Acceso claro, labels y targets | Migrada |
| /[lang]/register | Formulario | Registro claro y usable | Migrada |
| 404 | Estado especial | Recuperación coherente | Migrada |

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| El frontend no tiene datos ni contratos contables | No pueden validarse tablas, KPIs o exportación real | No simular; documentar patrones y migrar estados reales |
| Tema existente contradice guía heredada light-only | Mezcla de reglas | Documento nuevo define light como referencia y preserva dark por funcionalidad |
| Navegación móvil nueva puede afectar focus | Bloqueo para teclado/lector | Usar dialog nativo, botón con aria-label, Escape y cierre por navegación |
| Cambios de tokens afectan todos los primitivos | Regresiones globales | Migrar primitivos inmediatamente después de tokens y revisar todas las rutas |
| No hay suite frontend | Regresiones no automatizadas | Ejecutar lint/build y pruebas manuales de teclado, DOM y viewports disponibles |
| In-app browser puede no aplicar viewport solicitado | Evidencia responsive limitada | Verificar CSS/DOM, registrar tamaño real y no afirmar capturas inexistentes |

## Validaciones

### Visual

- Rutas privadas, login, registro y 404.
- Temas claro y oscuro.
- 1440 × 900, 1280 × 800, 1024 × 768, 768 × 1024 y 390 × 844 cuando la herramienta aplique realmente el viewport.
- Sin scroll horizontal de página.
- Texto largo, estado vacío y navegación colapsada.

### Accesibilidad

- Tab y Shift+Tab.
- Skip link y focus visible.
- Navegación móvil: apertura, focus, Escape, retorno.
- Labels de login/registro.
- Menú de perfil.
- Contraste de tokens.
- 200% zoom y reflow cuando la herramienta lo permita.
- prefers-reduced-motion por CSS y ausencia de transition-all.

### Técnica

- npm --prefix apps/web run lint
- npx tsc --noEmit -p apps/web/tsconfig.json
- npm --prefix apps/web run build

No se inventarán comandos de pruebas inexistentes.

## Criterios de aceptación

- Tokens centralizados y usados por los componentes.
- Shell coherente en desktop y móvil.
- Un h1 por ruta.
- Navegación móvil accesible.
- Todas las rutas existentes revisadas.
- Estados vacíos específicos y honestos.
- Login, registro y 404 alineados.
- Sin cambios de backend o datos simulados.
- Sin dependencias de producción nuevas.
- Exportación documentada como patrón de primer nivel, pero no simulada sin implementación.
- Lint, typecheck y build sin regresiones.
- Limitaciones visuales y de pruebas documentadas.

## Checklist por ruta

Cada ruta se considera migrada cuando cumple:

- [x] PageHeader y h1 único.
- [x] Microcopy específico.
- [x] Tokens y componentes compartidos.
- [x] Estado vacío aplicable; loading, error y success quedan normados para cuando exista flujo real.
- [ ] Recorrido secuencial completo con Tab y Shift+Tab en navegador externo.
- [x] Sin overflow de página en el viewport efectivo de 1280 × 720; reglas responsive inspeccionadas en código.
- [x] Tema claro y oscuro.
- [x] Sin acción o dato simulado.
- [x] Lint, typecheck y build.

## Registro de avance

### Resultado de implementación — 18 de agosto de 2026

- Se implementaron tokens semánticos claro/oscuro, focus visible, `prefers-reduced-motion`, skip link, numerales tabulares y jerarquía tipográfica.
- El shell ahora separa navegación agrupada, controles globales y contenido; conserva collapse y añade navegación móvil mediante `dialog` nativo.
- Todas las rutas actuales usan encabezado y estado vacío específicos. No se añadieron KPIs, datos, permisos, exportaciones o reglas de negocio simuladas.
- Login, registro y 404 comparten marca, lenguaje y fundaciones. Los campos de acceso tienen label programático y altura de 40 px.
- Se ajustaron Button, Input, Badge, DropdownMenu, Tooltip y Table sin cambiar shadcn/Base UI, Next.js ni React.
- No se añadieron dependencias de producción ni se modificó el backend.

### Evidencia visual

Antes:

- `docs/design/screenshots/before/dashboard-light-1440x900.png`
- `docs/design/screenshots/before/dashboard-1440x900.png`

Después:

- `docs/design/screenshots/after/dashboard-light-1280x720-final.png`
- `docs/design/screenshots/after/reports-light-1280x720-final.png`
- `docs/design/screenshots/after/login-light-1280x720-final.png`
- `docs/design/screenshots/after/dashboard-collapsed-light-1440x900.png`
- `docs/design/screenshots/after/dashboard-dark-1440x900.png`
- `docs/design/screenshots/after/dashboard-dark-1280x720-actual.png`

### Validación ejecutada

- Las rutas raíz, las diez secciones privadas, login y registro respondieron 200 tanto en `/es` como en `/en`; una ruta inexistente respondió 404.
- Panel, reportes y login se inspeccionaron en DOM y visualmente sin scroll horizontal a 1280 × 720.
- Panel y reportes tienen un único h1. Login tiene un único h1 y todos sus inputs están etiquetados.
- Sidebar collapse, selector de tema y menús se ejercitaron con interacción real. El foco del skip link fue visible con outline de 2 px.
- Contraste calculado: texto principal claro 14.60:1, texto secundario claro 5.45:1, acción primaria clara 7.35:1, focus claro 5.19:1, texto de sidebar 12.90:1 y borde de input contra blanco 3.36:1. Los tokens oscuros medidos superan 8.67:1 para texto secundario, acción primaria y focus contra el fondo.
- No existen scripts de unit, E2E o axe en `apps/web`; no se inventaron comandos.

### Limitaciones de la herramienta

- El controlador de viewport aceptó solicitudes para 1440 × 900, 1280 × 800, 1024 × 768, 768 × 1024 y 390 × 844, pero después devolvió siempre 1280 × 720. Las capturas finales se nombran con el tamaño realmente observado. Las reglas responsive y el `dialog` móvil se revisaron en código, pero el drawer no pudo validarse visualmente a 390 px.
- El navegador integrado permitió verificar focus visible y activar controles concretos, pero no avanzó de forma fiable el foco global al enviar Tab/Shift+Tab. Sigue pendiente un recorrido secuencial manual en un navegador externo, incluido Escape y retorno de foco del drawer.
- Las capturas de 1440 × 900 conservadas corresponden a evidencias tomadas antes de que el controlador quedara fijado en 1280 × 720; no se atribuyen a la ronda final.

Un estado Completada significa que existe evidencia real; no significa que se haya construido funcionalidad ausente del repositorio.
