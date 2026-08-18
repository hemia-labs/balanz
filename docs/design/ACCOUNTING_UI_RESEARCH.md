# Investigación y auditoría de interfaz contable

## Fecha, alcance y método

- Fecha de consulta y auditoría: 18 de agosto de 2026.
- Repositorio: F:/HemiaBalanceOs/balanz.
- Frontend: apps/web.
- Alcance funcional observado: shell privado, diez rutas privadas, autenticación, cambio de idioma, cambio de tema, estado 404 y primitivos compartidos.
- Método: lectura completa de la estructura y archivos del frontend, revisión de instrucciones existentes, ejecución local, inspección DOM, capturas con datos vacíos, lint y build de línea base, y consulta web de fuentes oficiales.
- Fuente de verdad funcional: el repositorio. No se asumieron servicios, datos, permisos ni flujos contables que no estén implementados.

## Estado técnico comprobado

El repositorio es un monorepo con workspaces en apps/*. El frontend usa Next.js 16 con App Router, React 19, TypeScript, Tailwind CSS 4, shadcn estilo base-nova sobre @base-ui/react y Lucide. Los tokens actuales viven en apps/web/src/app/globals.css.

La línea base pasó:

- npm --prefix apps/web run lint
- npm --prefix apps/web run build

No existen scripts de pruebas unitarias, componentes o end-to-end en apps/web/package.json. Tampoco existe infraestructura de axe, Storybook, Playwright o Cypress en el paquete.

Había cambios previos ajenos a esta tarea en apps/api/package.json y package-lock.json. Se conservaron sin modificación.

## Auditoría del frontend actual

### Arquitectura y rutas

| Arquetipo | Ruta | Archivo principal | Estado observado |
| --- | --- | --- | --- |
| Dashboard / resumen | /es y /en | apps/web/src/app/[lang]/(private)/page.tsx | Estado vacío genérico |
| Listado potencial | /[lang]/documents | apps/web/src/app/[lang]/(private)/[section]/page.tsx | Estado vacío genérico |
| Consulta | /[lang]/queries | mismo archivo dinámico | Estado vacío genérico |
| Listado potencial | /[lang]/income | mismo archivo dinámico | Estado vacío genérico |
| Reportes | /[lang]/reports | mismo archivo dinámico | Estado vacío genérico |
| Configuración | /[lang]/certificates | mismo archivo dinámico | Estado vacío genérico |
| Configuración | /[lang]/users | mismo archivo dinámico | Estado vacío genérico |
| Configuración | /[lang]/plans | mismo archivo dinámico | Estado vacío genérico |
| Colaboración | /[lang]/collaboration | mismo archivo dinámico | Estado vacío genérico |
| Listado potencial | /[lang]/payroll | mismo archivo dinámico | Estado vacío genérico |
| Autenticación | /[lang]/login | apps/web/src/components/login-form.tsx | Formulario local sin envío |
| Registro | /[lang]/register | apps/web/src/components/register-form.tsx | Formulario local sin envío |
| Estado especial | ruta inexistente | apps/web/src/app/[lang]/not-found.tsx | Tarjeta 404 |

### Componentes y responsabilidades

| Área | Archivo | Hallazgo |
| --- | --- | --- |
| Shell | apps/web/src/app/[lang]/(private)/layout.tsx | Sidebar y topbar fijos; el contenido carece de contenedor máximo y encabezado de página propio |
| Navegación | apps/web/src/components/app-sidebar.tsx | Diez opciones sin agrupación; se oculta por completo debajo de md y no ofrece alternativa móvil |
| Barra superior | apps/web/src/components/app-topbar.tsx | Repite el título de la página; búsqueda y notificaciones no tienen comportamiento; perfil concentra tema e idioma |
| Estado vacío | apps/web/src/components/empty-state.tsx | Una única tarjeta de 320 px de alto para todos los contextos, con el mismo icono y mensaje |
| Autenticación | apps/web/src/components/login-form.tsx y register-form.tsx | Labels correctos, pero controles pequeños, textos genéricos y submit bloqueado con preventDefault |
| Tema | apps/web/src/app/globals.css y theme-initializer.tsx | Existen temas claro y oscuro funcionales; la guía heredada .claude/skills/frontend-design-system/SKILL.md dice light-only, por lo que hay una contradicción documental |
| Tokens | apps/web/src/app/globals.css | Tema shadcn base neutral; faltan tokens de éxito, advertencia, información, layout, motion, z-index y datos numéricos |
| Botones | apps/web/src/components/ui/button.tsx | Alturas de 24 a 36 px; targets de icono de 32 px; transición all y desplazamiento activo innecesarios |
| Inputs | apps/web/src/components/ui/input.tsx | Altura base de 32 px; el buscador fuerza 36 px; focus consistente pero pequeño para uso táctil |
| Badges | apps/web/src/components/ui/badge.tsx | Radio 4xl tipo píldora en todas las variantes y transición all |
| Tabla | apps/web/src/components/ui/table.tsx | Semántica HTML correcta, pero sin reglas de alineación numérica, caption visible, encabezado sticky o totales |
| Dropdown | apps/web/src/components/ui/dropdown-menu.tsx | Targets de menú de aproximadamente 24 px y animación con zoom; no respeta todavía reduced motion |
| Microcopy | apps/web/src/dictionaries/es.json | Usa Dashboard y workspace en operación; estados vacíos no explican contexto ni recuperación |
| Iconografía | apps/web/src/lib/nav.ts | Una sola familia, Lucide, pero FileText y Users se repiten para módulos distintos |

### Problemas principales

1. Jerarquía duplicada. La topbar muestra Dashboard como h1 y la superficie vacía repite Dashboard como h2. El contenido no tiene un encabezado que separe título, contexto y acciones.
2. Navegación móvil ausente. El sidebar usa hidden md:flex; a 390 px no hay mecanismo alterno para acceder a las rutas privadas.
3. Arquitectura indiferenciada. Las diez rutas privadas renderizan exactamente el mismo EmptyState. No existe una lectura por arquetipo ni microcopy específico.
4. Aspecto de plantilla. La combinación shadcn neutral, tarjeta grande centrada, icono genérico y copy repetido no expresa el dominio contable ni una identidad propia.
5. Densidad mal utilizada. Hay gran cantidad de espacio vacío, pero los controles interactivos son pequeños. La interfaz no usa el espacio para información, filtros o contexto.
6. Acciones operativas sin jerarquía. No hay patrón compartido para acciones primarias, filtros, descarga o exportación. La búsqueda aparece prominente aunque no tiene comportamiento.
7. Accesibilidad incompleta. Los icon buttons de 32–36 px son menores al objetivo recomendado; no hay skip link, navegación móvil, reduced motion global ni validación de errores de formulario.
8. Tokens incompletos. Los componentes mezclan valores de altura, radio y transición. Faltan tokens semánticos de estados y layout.
9. Inconsistencia documental. README describe el producto como light-only mientras el código conserva un tema oscuro y un selector funcional.
10. Terminología. Dashboard y workspace quedan en español operativo; Sistema operativo es ambiguo y no identifica el estado de sincronización o servicio.

### Densidad, responsive y accesibilidad por arquetipo

| Arquetipo | Objetivo principal | Acción primaria actual | Densidad | Riesgo principal |
| --- | --- | --- | --- | --- |
| Resumen | Conocer el estado general | Ninguna | Muy baja | Un bloque vacío no orienta ni informa |
| Listado / tabla | Consultar registros | Ninguna | Nula | No existe patrón de tabla, filtro o exportación aplicado |
| Consulta | Encontrar información | Búsqueda global sin lógica | Nula | La affordance promete una capacidad inexistente |
| Configuración | Revisar parámetros | Ninguna | Nula | Todas las secciones parecen iguales |
| Autenticación | Acceder o crear cuenta | Submit local bloqueado | Media | No hay errores, recuperación ni estado de carga |
| 404 | Recuperarse de una ruta inválida | Volver al inicio | Baja | Correcto funcionalmente, pero visualmente aislado |

### Evidencia visual de línea base

Las capturas contienen únicamente el estado vacío y no exponen datos personales, fiscales o empresariales:

- docs/design/screenshots/before/dashboard-light-1440x900.png
- docs/design/screenshots/before/dashboard-1440x900.png

El control de viewport del navegador integrado no aplicó tamaños menores durante la línea base: una solicitud de 390 × 844 mantuvo 1280 × 720. Por ello no se presenta una captura móvil engañosa; la ausencia de navegación móvil se verificó directamente en el código y mediante la regla hidden md:flex.

## Investigación web

Todas las fuentes se consultaron el 18 de agosto de 2026. Se priorizaron documentación oficial, centros de ayuda y guías de producto; no se usaron Dribbble, Behance, Pinterest ni imágenes externas.

### Sistemas de diseño y accesibilidad

| Fuente | Tipo | Hallazgo útil | Adoptar o adaptar | Rechazar |
| --- | --- | --- | --- | --- |
| Google, Material 3 Expressive: https://design.google/library/expressive-material-design-google-research?pubDate=20250521 | Investigación oficial, 2025 | La expresión debe dirigir atención, tener propósito y partir de la tarea; controles grandes y contraste mejoran localización | Adaptar: usar tamaño, color y contención solo para la acción primaria | Rechazar formas exuberantes, color intenso y movimiento emocional en trabajo contable repetitivo |
| IBM Carbon, data table accessibility: https://carbondesignsystem.com/components/data-table/accessibility/ | Sistema empresarial oficial | Orden de teclado, sorting operable y paginación separada son responsabilidades explícitas | Adoptar semántica, estados y anotaciones de accesibilidad | No copiar la estética IBM ni introducir complejidad de grid sin necesidad |
| Microsoft Fluent 2, accessibility: https://fluent2.microsoft.design/accessibility | Sistema empresarial oficial | Jerarquía escaneable, zoom, teclado, reflow y texto simple se diseñan desde el inicio | Adoptar estructura predecible y zoom 200% | Rechazar decoración o profundidad que no agregue jerarquía |
| Apple HIG, lists and tables: https://developer.apple.com/design/human-interface-guidelines/lists-and-tables | Guía oficial | Tablas multicolumna para productividad, encabezados descriptivos, sorting y preservación de legibilidad | Adaptar a web de escritorio y mantener comparación de columnas | No trasladar patrones táctiles o de plataforma que no correspondan |
| W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/ | Norma oficial | AA requiere reflow, focus visible/no oculto, teclado, contraste y target mínimo | Adoptar como criterio mínimo verificable | No usar cumplimiento como sustituto de pruebas con usuarios |
| WAI-ARIA APG, table pattern: https://www.w3.org/WAI/ARIA/apg/patterns/table/ | Patrón oficial | Se prefiere table HTML nativa; grid solo si existe navegación compuesta completa | Adoptar table semántica por defecto | Evitar roles ARIA complejos sin interacción de teclado completa |

### Productos contables y administrativos internacionales

| Producto | Fuente | Hallazgo útil | Adoptar o adaptar | Rechazar |
| --- | --- | --- | --- | --- |
| QuickBooks Online | https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/run-reports-quickbooks-online/L7aILHhbl_US_en_US?uid=lsdfiaac | Los reportes hacen visibles periodo, método contable, personalización y exportación Excel/CSV/PDF | Adoptar exportación visible y contexto del periodo | Evitar menús profundos y terminología propia de Intuit |
| Zoho Books | https://www.zoho.com/us/books/help/reports/manage-reports.html | Permite densidad de tabla, filtros, columnas, permisos, fecha y autor de generación | Adaptar densidad y trazabilidad al contexto Hemia | Evitar exponer demasiadas opciones simultáneamente |
| Xero | https://www.xero.com/us/accounting-software/run-financial-reports/ | Distingue reportes estándar, personalizados, borrador y publicado; búsqueda de reportes | Adoptar estados explícitos y descubrimiento por tarea | Evitar replicar su identidad visual o estructura de marketing |

### Productos de México y Latinoamérica

| Producto | Fuente | Hallazgo útil | Adoptar o adaptar | Rechazar |
| --- | --- | --- | --- | --- |
| Alegra México | https://ayuda.alegra.com/mex/reportes-inteligentes | Agrupa reportes por tarea; descarga se ubica arriba y explicita Excel/PDF; reconoce periodos y SAT | Adoptar acción Descargar visible y microcopy mexicano | Rechazar emojis, tips promocionales y exceso de señales visuales en operación |
| Bind ERP México | https://ayuda.bind.com.mx/pantalla-reportes | Usa filtros específicos, históricos y exportación masiva; organiza reportes por dominio | Adaptar filtros persistentes y exportación por alcance | Evitar dashboards y gráficas automáticas en cada módulo |
| Aspel COI México | https://www.aspel.com.mx/assets/manuales/manual-aspel-sistema-contabilidad-integral.pdf | Expone criterios de reporte antes de emitir y conserva rutas claras para balanza, pólizas y respaldo | Adoptar claridad de criterios y verbos de dominio | Evitar apariencia de software de escritorio legado y toolbars de iconos sin texto |

## Síntesis competitiva

Las referencias coinciden en cinco patrones:

1. El periodo y el método contable son contexto, no filtros secundarios invisibles.
2. Los reportes se consultan, ajustan y exportan desde la misma superficie.
3. Las tablas siguen siendo el medio principal de comparación; las gráficas son complementarias.
4. El usuario necesita trazabilidad de generación, permisos y actualización.
5. La densidad debe poder aumentar sin perder labels, foco o lectura numérica.

Hemia no debe copiar ninguna composición. La oportunidad de diferenciación está en una jerarquía más serena, microcopy mexicano sin promoción, datos numéricos tratados con precisión y una marca visual discreta inspirada en el registro contable.

## Tendencias 2025–2026 evaluadas

| Clasificación | Tendencia | Evaluación para Hemia |
| --- | --- | --- |
| Adoptar | Tokens semánticos y temas derivados | Mejora consistencia, accesibilidad y mantenimiento; evita colores arbitrarios |
| Adoptar | Jerarquía por tamaño, contención y proximidad | Acelera escaneo sin agregar decoración |
| Adoptar | Acciones de exportación visibles junto al contexto | Es central para el trabajo contable y reduce recorridos |
| Adoptar | Densidad operativa moderada | Permite comparar más filas y reduce scroll con targets todavía accesibles |
| Adoptar | Tipografía con números tabulares | Mejora comparación de montos, porcentajes y folios |
| Adaptar | Material 3 Expressive | Solo su principio de destacar la acción clave; no su lenguaje volumétrico o lúdico |
| Adaptar | Personalización de densidad | Documentarla y preparar componentes; posponer el selector hasta existir tablas reales |
| Adaptar | Dashboards configurables | Comenzar con jerarquía accionable; no construir personalización sin datos o requerimiento |
| Adaptar | Dark mode | Conservar el comportamiento existente con tokens pareados; el modo claro será la referencia principal |
| Evitar | Bento grids y card soup | Fragmentan información contable y crean jerarquía artificial |
| Evitar | Glassmorphism, gradientes morado-azul, neón y blobs | Reducen contraste y se asocian con plantillas o IA |
| Evitar | KPI cards uniformes y gráficas decorativas | No responden preguntas ni ofrecen acciones por sí mismas |
| Evitar | Redondeado exagerado y botones píldora universales | Debilitan densidad y precisión visual |
| Evitar | Microanimaciones en cada hover | Aumentan ruido y no aportan al flujo repetitivo |
| Posponer | Grid tipo hoja de cálculo | Requiere edición celular y navegación de teclado completas, ausentes en el MVP |
| Posponer | Predicción y resúmenes generados por IA | No existe funcionalidad ni evidencia de negocio aprobada |
| Posponer | Visualización avanzada | No hay contratos de datos ni preguntas analíticas implementadas |

## Alternativas visuales consideradas

### Banco glacial

Navy, blanco puro, sombras mínimas y alta simetría. Se descartó por sentirse corporativo, frío y similar a productos bancarios; no aporta calidez ni identidad propia.

### Operación expresiva

Formas variables, color abundante, contenedores grandes y motion inspirado en Material 3 Expressive. Se descartó porque compite con tablas, envejece rápido y puede sentirse infantil en un flujo contable.

### Registro Sereno — seleccionada

Una interpretación contemporánea del libro de registro: tinta azul petróleo, canvas cálido, superficies blancas, acento cobrizo muy limitado y densidad de escritorio. La identidad aparece en dos rasgos funcionales:

1. Regla de registro: una línea cobriza corta en encabezados y una doble regla en totales o cierres, nunca como decoración extensa.
2. Riel numérico: montos, porcentajes, fechas y folios usan números tabulares; montos se alinean a la derecha y los folios pueden usar Geist Mono.

La dirección equilibra confianza y humanidad sin recurrir a monedas, calculadoras, billetes, ilustraciones 3D ni gráficas ascendentes.

## Evidencia que respalda la decisión

- El repositorio ya usa Geist y Geist Mono mediante next/font, evitando una nueva dependencia y permitiendo números tabulares y folios distinguibles.
- Tailwind CSS 4 y las variables shadcn permiten centralizar el sistema sin migrar framework ni biblioteca.
- Lucide ya es la única familia de iconos y es suficiente.
- La interfaz actual está casi completamente vacía; fortalecer fundaciones, shell, responsive y estados aporta valor sin inventar datos o reglas.
- WCAG 2.2, Carbon y WAI-ARIA respaldan mantener semántica nativa, foco visible y comportamiento predecible.
- QuickBooks, Zoho, Alegra y Bind muestran que periodo, filtros y exportación deben tener jerarquía operativa, no esconderse por estética.

## Suposiciones conservadoras

- Se conserva el selector de tema porque está implementado y eliminarlo violaría la regla de no retirar funcionalidad. El modo claro será el estado de referencia; ambos temas comparten los mismos tokens semánticos.
- Se conserva el idioma inglés porque existe como funcionalidad. Español de México permanece como idioma por defecto y ningún texto operativo nuevo queda solamente en inglés.
- No se agregan tablas con datos, KPIs, gráficas, filtros ejecutables ni exportaciones simuladas porque no existen fuentes de datos o contratos frontend para sostenerlos.
- Las rutas privadas actuales se migran como estados vacíos específicos y coherentes, sin inventar módulos adicionales.
