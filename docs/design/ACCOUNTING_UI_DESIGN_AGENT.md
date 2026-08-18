# Registro Sereno — lineamientos normativos de UI contable

## A. Metadatos

| Campo | Valor |
| --- | --- |
| Nombre | Registro Sereno |
| Versión | 1.0.0 |
| Fecha | 18 de agosto de 2026 |
| Estado | Normativo |
| Propietario | Producto y frontend de Hemia |
| Alcance | UI, UX, estilos, layout, responsive, componentes, iconografía, gráficas y microcopy |
| Rutas aplicables | apps/web/src/app, apps/web/src/components, apps/web/src/dictionaries, apps/web/src/lib |
| Implementación de tokens | apps/web/src/app/globals.css |

Este documento es la fuente de verdad visual del frontend. En caso de conflicto, tienen prioridad las reglas funcionales, seguridad, privacidad, reglas contables, contratos existentes y WCAG 2.2 AA. Una preferencia estética NO DEBE romper ninguna de ellas.

## B. Contexto del producto

### Público

Balanz de Hemia sirve principalmente a contadores independientes, despachos contables pequeños, equipos administrativos pequeños y negocios mexicanos que consultan y organizan información contable.

### Trabajos principales

- Consultar rápidamente documentos, movimientos, reportes y estados.
- Encontrar información por periodo, folio, RFC, persona o estado cuando la funcionalidad exista.
- Comparar montos y detectar excepciones.
- Descargar o exportar información sin recorridos innecesarios.
- Mantener trazabilidad de quién hizo qué y cuándo.
- Repetir tareas diarias con poco esfuerzo cognitivo.

### Restricciones

- El repositorio define el alcance funcional.
- NO DEBE inventarse emisión, timbrado, PAC, reglas fiscales, permisos, endpoints ni flujos.
- NO DEBE simularse funcionalidad con datos hardcodeados.
- NO DEBE migrarse Next.js, React, Tailwind, shadcn/Base UI ni Lucide.
- Español de México es el idioma operativo principal.
- El escritorio es prioritario; móvil DEBE permitir consulta y acciones simples.

### Personalidad

El producto DEBE sentirse preciso, confiable, contemporáneo, sereno, ágil y humano. NO DEBE sentirse bancario frío, infantil, futurista, cripto, promocional ni como una plantilla.

## C. Principios rectores

1. Claridad antes que decoración. Cada elemento visual DEBE comunicar jerarquía, estado, relación o acción.
2. Precisión antes que expresividad. Datos, periodos, moneda y estados NO DEBEN ceder espacio a ornamentos.
3. Eficiencia antes que espectacularidad. Las acciones frecuentes DEBEN estar visibles y cerca del contexto que afectan.
4. Accesibilidad antes que moda. WCAG 2.2 AA es el mínimo.
5. Consistencia antes que creatividad aislada. Una pantalla NO DEBE crear una gramática nueva.
6. Reglas de negocio antes que preferencias visuales. La UI DEBE representar el comportamiento real.
7. Comparación antes que fragmentación. Datos tabulares NO DEBEN convertirse automáticamente en tarjetas.
8. Estado antes que sorpresa. Loading, empty, error y success DEBEN explicitarse cuando correspondan.

## D. Dirección visual seleccionada

### Nombre

Registro Sereno.

### Descripción

Una interpretación contemporánea del libro de registro: tinta azul petróleo, canvas cálido, superficies blancas, bordes nítidos y un acento cobrizo escaso. La densidad es operativa, no apretada; la jerarquía proviene de tipografía, reglas, proximidad y alineación.

### Rasgos distintivos

1. Regla de registro. Los encabezados de página PUEDEN usar una línea cobriza de 2 px y 28–40 px de alto en el borde inicial. Totales y cierres DEBEN usar una doble regla neutra o de énfasis. La regla NO DEBE rodear cada bloque.
2. Riel numérico. Montos, porcentajes y fechas DEBEN usar números tabulares. Montos se alinean al final; folios e identificadores PUEDEN usar Geist Mono. La cifra principal nunca depende solo del color.

### Razón

La dirección conserva sobriedad y confianza, agrega calidez controlada y favorece grandes volúmenes. Se diferencia mediante tratamiento de registro y números, no mediante clichés contables.

## E. Patrones que hacen que una interfaz parezca generada por IA

### Prohibiciones y límites

La interfaz:

- NO DEBE usar gradientes morado-azul por defecto.
- NO DEBE usar brillos neón, glassmorphism innecesario, blobs, fondos abstractos ni orbs.
- NO DEBE usar ilustraciones 3D genéricas, imágenes creadas por IA como relleno ni stock financiero.
- NO DEBE usar emojis como iconografía de producto.
- NO DEBE colocar iconos en cada título o cada línea sin significado.
- NO DEBE mezclar familias de iconos; Lucide es la familia única.
- NO DEBE aplicar sombras grandes a todos los elementos.
- NO DEBE usar radios de 16, 20 o 24 px indiscriminadamente.
- NO DEBE usar botones píldora salvo tags, chips o controles cuya semántica lo requiera.
- NO DEBE convertir cada bloque en tarjeta.
- NO DEBE crear card soup ni bento grids sin relación funcional demostrable.
- NO DEBE generar automáticamente cuatro KPIs idénticos para cualquier dashboard.
- NO DEBE agregar gráficas decorativas, 3D o sin pregunta, periodo y acción.
- NO DEBE mostrar mensajes enormes de “Bienvenido de nuevo”.
- NO DEBE usar frases motivacionales, lenguaje promocional ni títulos de landing en operación.
- NO DEBE usar espacio vacío que fuerce scroll sin mejorar comprensión.
- NO DEBE centrar layouts densos, tablas o formularios operativos.
- NO DEBE dejar microcopy operativo solo en inglés.
- NO DEBE mantener nombres genéricos o datos falsos como si fueran reales.
- NO DEBE incorporar Inter, Poppins o Roboto por popularidad. Geist se conserva por licencia, rendimiento e integración actual.
- NO DEBE animar cada hover ni escalar elementos de forma exagerada.
- NO DEBE usar colores semánticos como decoración.
- NO DEBE clonar Linear, Stripe, Notion, Material Design ni otro producto.
- NO DEBE ocultar Descargar, Exportar u otra acción frecuente en tres puntos solo para “limpiar”.

### Señales positivas de diseño deliberado

- Jerarquía clara y densidad apropiada.
- Espaciado consistente y basado en tokens.
- Microcopy específico del dominio.
- Acciones colocadas según frecuencia, riesgo y contexto.
- Tipografía numérica cuidada.
- Tokens semánticos y estados completos.
- Decisiones justificadas y coherencia entre rutas.
- Detalles de marca sutiles y funcionales.
- Menos decoración y más información útil.

### Hacer / no hacer

| Hacer | No hacer |
| --- | --- |
| Mostrar Exportar junto al periodo cuando sea frecuente | Esconder Exportar en un menú genérico |
| Usar una superficie continua para una tabla | Crear una tarjeta por fila |
| Diferenciar total con doble regla, peso y label | Comunicar total solo en verde |
| Usar un h1 de 28 px y contexto breve | Usar un hero de 48 px con saludo |
| Mostrar cero datos con causa y siguiente paso real | Poner una ilustración 3D y “Todo listo” |
| Resaltar una acción primaria | Dar el mismo color y tamaño a cinco acciones |

## F. Sistema de tokens

Los componentes DEBEN consumir variables semánticas mapeadas en apps/web/src/app/globals.css. Hex, oklch, rgb y colores Tailwind de paleta NO DEBEN aparecer en componentes salvo un caso documentado que no pueda representarse semánticamente.

### Colores — tema claro de referencia

| Token CSS | Valor | Uso |
| --- | --- | --- |
| --background | #f4f6f3 | Canvas |
| --foreground | #17242b | Texto principal |
| --card | #ffffff | Superficie principal |
| --card-foreground | #17242b | Texto en superficie |
| --popover | #ffffff | Menús y popovers |
| --popover-foreground | #17242b | Texto de popover |
| --primary | #0f5f68 | Acción primaria y links |
| --primary-foreground | #ffffff | Texto sobre primary |
| --secondary | #e2efed | Acción secundaria y selección |
| --secondary-foreground | #174247 | Texto sobre secondary |
| --muted | #e9eeea | Fondos discretos |
| --muted-foreground | #59666d | Texto secundario |
| --accent | #f3e7dc | Énfasis cálido limitado |
| --accent-foreground | #6b3d25 | Texto sobre accent |
| --destructive | #b42318 | Error y acción destructiva |
| --destructive-surface | #fbe9e7 | Fondo de error |
| --success | #176b45 | Estado positivo |
| --success-surface | #e3f2e9 | Fondo positivo |
| --warning | #8a5614 | Advertencia |
| --warning-surface | #f8eedb | Fondo advertencia |
| --info | #245f86 | Información |
| --info-surface | #e4eef5 | Fondo información |
| --border | #d2dad5 | Divisores y superficies |
| --input | #7f9087 | Controles |
| --ring | #a44f25 | Focus visible |
| --brand-mark | #b86432 | Regla de registro |
| --numeric-band | #edf3f0 | Totales y riel numérico |
| --sidebar | #142d38 | Navegación |
| --sidebar-foreground | #eef4f2 | Texto de navegación |
| --sidebar-primary | #2b6f73 | Navegación activa |
| --sidebar-primary-foreground | #ffffff | Texto activo |
| --sidebar-accent | #1e3b46 | Hover de navegación |
| --sidebar-accent-foreground | #ffffff | Texto hover |
| --sidebar-border | #31505a | Divisor de navegación |
| --sidebar-ring | #e6a16f | Focus sobre sidebar |

### Colores — tema oscuro conservado

| Token CSS | Valor |
| --- | --- |
| --background | #0d171c |
| --foreground | #edf3f1 |
| --card | #142229 |
| --card-foreground | #edf3f1 |
| --popover | #192a31 |
| --popover-foreground | #edf3f1 |
| --primary | #6fc8c2 |
| --primary-foreground | #082f33 |
| --secondary | #24464a |
| --secondary-foreground | #e4f5f2 |
| --muted | #1d2c32 |
| --muted-foreground | #a9b6b3 |
| --accent | #3e3028 |
| --accent-foreground | #f2d5c2 |
| --destructive | #ff8a80 |
| --destructive-surface | #3a2222 |
| --success | #75d5a6 |
| --success-surface | #173528 |
| --warning | #efc171 |
| --warning-surface | #372d1d |
| --info | #8cc6ee |
| --info-surface | #183247 |
| --border | #34464b |
| --input | #607277 |
| --ring | #f0a66f |
| --brand-mark | #df8b58 |
| --numeric-band | #1b3032 |
| --sidebar | #0b2029 |
| --sidebar-foreground | #eaf2f0 |
| --sidebar-primary | #326f73 |
| --sidebar-primary-foreground | #ffffff |
| --sidebar-accent | #173641 |
| --sidebar-accent-foreground | #ffffff |
| --sidebar-border | #2c4b56 |
| --sidebar-ring | #f0a66f |

Estados NO DEBEN comunicarse solo por estos colores. DEBEN incluir texto, icono, forma o estado programático.

### Tipografía

| Token | Tamaño / línea | Peso |
| --- | --- | --- |
| --text-caption | 0.75rem / 1.125rem | 500 |
| --text-body-sm | 0.8125rem / 1.25rem | 400 o 500 |
| --text-body | 0.875rem / 1.375rem | 400 |
| --text-body-lg | 1rem / 1.5rem | 400 |
| --text-heading-sm | 1.125rem / 1.5rem | 650 |
| --text-heading-md | 1.375rem / 1.75rem | 650 |
| --text-heading-lg | 1.75rem / 2.25rem | 700 |
| --text-display | 2.25rem / 2.75rem | 700; solo autenticación o estado excepcional |

### Espaciado

Escala permitida: 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48 y 64 px. Un valor distinto DEBE responder a una restricción externa y quedar comentado.

- Gap interno de control: 8 px.
- Gap entre label y control: 8 px.
- Gap entre campos: 20 px.
- Padding de tabla: 10 px vertical y 16 px horizontal en densidad estándar.
- Padding de panel: 20 px compacto, 24 px estándar.
- Separación entre secciones: 32 px; 40 px cuando cambia la tarea.

### Grid, anchos y breakpoints

- Grid de contenido: 12 columnas en desktop, gap 24 px; 4 columnas en móvil, gap 16 px.
- Ancho máximo del shell: sin límite artificial; el contenido operativo DEBE usar max-width 1600 px.
- Ancho máximo de tabla o dashboard: 1440 px antes de expandirse al disponible.
- Formulario largo: 720 px.
- Lectura y mensajes: 680 px.
- Breakpoints: sm 640, md 768, lg 1024, xl 1280, 2xl 1536 px.
- Viewports de referencia: 390 × 844, 768 × 1024, 1024 × 768, 1280 × 800 y 1440 × 900.
- Sidebar: 272 px expandido; 72 px colapsado; oculto bajo 768 px con diálogo de navegación equivalente.
- Topbar: 60 px.

### Radios, bordes y sombras

- --radius-sm: 4 px para celdas y controles compactos.
- --radius-md: 6 px para botones e inputs.
- --radius-lg: 8 px para paneles, modales y popovers.
- --radius-full: 9999 px solo para avatar, status dot, chip o badge.
- Bordes: 1 px solid var(--border).
- Totales: 3 px double var(--border-strong) o equivalente semántico.
- Sombra de superficie: ninguna por defecto.
- --shadow-float: 0 8px 24px rgb(23 36 43 / 0.10).
- --shadow-overlay: 0 16px 40px rgb(23 36 43 / 0.18).
- Solo popovers, drawers y modales PUEDEN usar sombra.

### Opacidad, movimiento y z-index

- Disabled: 0.48; además DEBE existir disabled o aria-disabled.
- Scrim: 0.52.
- Hover tint: 0.06–0.10; NO DEBE reducir contraste.
- Duraciones: instant 100 ms, standard 160 ms, overlay 240 ms.
- Curva estándar: cubic-bezier(0.2, 0, 0, 1).
- Curva de salida: cubic-bezier(0.4, 0, 1, 1).
- NO DEBE usarse transition-all.
- z-base 0, z-sticky 10, z-dropdown 30, z-drawer 40, z-modal 50, z-toast 60.
- prefers-reduced-motion: reduce DEBE eliminar desplazamiento, escala y animación no esencial.

## G. Tipografía

- Familia principal: Geist, cargada con next/font y fallback ui-sans-serif, system-ui, sans-serif.
- Familia de identificadores: Geist Mono, cargada con next/font y fallback ui-monospace, SFMono-Regular, Consolas, monospace.
- Se conserva porque ya está integrada, es variable, se sirve localmente por Next.js y evita una nueva dependencia.
- Cuerpo operativo: 14 px. NO DEBE bajarse de 12 px.
- H1: 28 px/36, peso 700; uno por pantalla.
- H2: 22 px/28, peso 650.
- H3: 18 px/24, peso 650.
- Labels: 13–14 px, peso 600.
- Longitud de línea: 45–75 caracteres; mensajes y ayuda máximo 680 px.
- Capitalización: sentence case. NO DEBEN usarse mayúsculas completas salvo siglas como RFC, CFDI, XML, IVA o SAT.
- Columnas numéricas DEBEN usar font-variant-numeric: tabular-nums lining-nums.
- Montos DEBEN usar Geist Sans tabular; folios y hashes PUEDEN usar Geist Mono.
- Porcentajes DEBEN mantener el símbolo junto al número y la misma precisión dentro de la columna.

## H. Layout y densidad

### Shell

- Desktop: sidebar persistente, topbar global y main fluido.
- La topbar DEBE contener controles globales; NO DEBE repetir el h1 de la página.
- Cada ruta DEBE comenzar con PageHeader: eyebrow opcional, h1, descripción concreta y acciones.
- Breadcrumbs DEBEN aparecer a partir de tres niveles o cuando el usuario pueda perder contexto; NO DEBEN repetir una sola ruta.
- El canvas DEBE ser background y las superficies de trabajo card.
- Una tabla grande DEBE ocupar una superficie continua, no varias tarjetas.

### Densidad predeterminada

- Botón e input estándar: 40 px en desktop; 44 px mínimo en layouts táctiles.
- Fila de tabla estándar: 44 px; compacta 36 px solo cuando exista selector o necesidad comprobada.
- Target absoluto mínimo: 24 × 24 px con separación suficiente, conforme WCAG 2.2; Hemia DEBERÍA apuntar a 40 × 40 px.
- Desktop ancho: el contenido usa el espacio para columnas y comparación, no para agrandar tarjetas.
- Laptop: acciones secundarias PUEDEN compactarse, pero Descargar/Exportar frecuente permanece visible.
- Tablet: sidebar se reemplaza por diálogo; filtros secundarios PUEDEN pasar a drawer.
- Móvil: consulta y acciones simples; las tablas conservan scroll horizontal contenido, columnas prioritarias y encabezado accesible.

## I. Componentes

### Matriz normativa

| Componente | Usar cuando | No usar cuando | Variantes y tamaños | Estados y accesibilidad | Responsive y ejemplo |
| --- | --- | --- | --- | --- | --- |
| Button | Ejecuta una acción | Navega a otra URL; usar link | primary, secondary, outline, ghost, destructive, link; 40 px normal, 36 compacto, 40 icon | default, hover, active, focus, disabled, loading; icon-only con aria-label y tooltip | Texto completo en desktop; icono solo si es universal. Ej.: Exportar |
| Link | Cambia de ruta o abre recurso | Ejecuta mutación | default, quiet, inverse | Focus visible; propósito comprensible fuera de contexto | NO DEBE perderse al envolver |
| Input | Texto corto o búsqueda real | Elección de lista conocida | 40 px; error y disabled | Label visible; aria-describedby para ayuda/error | Ancho completo en móvil |
| Textarea | Texto libre de varias líneas | Datos estructurados | min 96 px; redimensionable vertical | Label y límite cuando exista | Página o sección, no modal pequeño |
| Select | 5–20 opciones estables | Búsqueda larga; usar autocomplete | 40 px | Teclado completo, valor y label | Full width móvil |
| Autocomplete | Catálogo grande o búsqueda remota | Menos de 5 opciones | Combobox con loading/empty/error | Implementar patrón APG completo | Resultados no deben cubrir el label |
| Campo monetario | Captura monto y moneda | Número sin unidad | Alineado al final, prefix/suffix no editable | Error anuncia formato; conserva valor sin redondeo sorpresivo | Código de moneda visible si hay ambigüedad |
| Campo porcentaje | Captura tasa | Captura monto | Suffix %, límites visibles | No depender de placeholder | Precisión acorde a regla de negocio |
| Date picker | Fecha con beneficio de calendario | Fecha contable rápida que se escribe mejor | Input editable + trigger | Locale es-MX, teclado y fecha anunciada | Popover dentro del viewport |
| Checkbox | Varias opciones independientes | Elección exclusiva | 20 px visual, target 40 px | Label clicable, indeterminate programático | No envolver párrafos extensos |
| Radio | Una opción de conjunto corto | Booleano; usar checkbox/switch según semántica | Target 40 px | fieldset y legend | Apilar en móvil |
| Switch | Cambio inmediato de estado persistente | Consentimiento o submit diferido | 40 × 24 visual, target mayor | Estado checked y label | Efecto inmediato explicado |
| Badge | Categoría corta o etiqueta | Frase o acción | neutral, info; radio full | Contraste y texto | Truncar solo con tooltip |
| Status | Estado de proceso | Decoración | neutral, success, warning, danger, info | Texto + icono/punto; aria-label si hace falta | Mantener texto en móvil |
| Alert | Mensaje persistente en contexto | Confirmación efímera | info, success, warning, danger | role alert solo para urgente/dinámico | Acciones bajo texto en móvil |
| Toast | Confirmación breve no bloqueante | Error que requiere corrección | success, info, warning | aria-live polite; no auto-dismiss crítico | Máximo 420 px, no cubrir acciones |
| Tooltip | Aclarar icono o término | Alojar contenido esencial | 240 px máximo | Hover y focus; Escape; no único label | Evitar en touch como única ayuda |
| Menu / dropdown | Acciones secundarias relacionadas | Acción primaria frecuente | ancho por contenido, items 36–40 px | Flechas, Escape y retorno de focus | No salir del viewport |
| Tabs | Alternar vistas pares del mismo objeto | Navegar módulos | 2–6 tabs | patrón APG completo; active no solo color | Scroll de tabs contenido si es necesario |
| Breadcrumb | Jerarquía de 3+ niveles | Una sola pantalla | compacto | nav con aria-label y aria-current | Colapsar niveles intermedios |
| Modal | Decisión breve y enfocada | Formulario largo o tabla compleja | 480, 640 px | focus trap, título, Escape, retorno de focus | Casi full-screen en móvil |
| Drawer | Filtros o detalle complementario | Tarea principal compleja | 400–520 px | Misma disciplina de focus que modal | Full width hasta 390 px |
| Empty state | No hay resultados o configuración | Error o loading | inline, surface, first-use | Explica qué falta y acción real si existe | Alineado al inicio en contextos densos |
| Skeleton | Estructura conocida cargando | Operación instantánea o indeterminada sin forma | Imita layout | aria-hidden; región anuncia carga | reduced motion sin shimmer |
| Loader | Espera breve o acción localizada | Carga estructural larga | inline, button | Nombre accesible | No bloquear toda la UI sin motivo |
| Error | Fallo recuperable o de campo | Ausencia de datos | inline, surface, page | Qué ocurrió, impacto y recuperación | Mantener acción visible |
| Pagination | Total grande y navegación por páginas | Lista corta o infinite scroll no requerido | 40 px targets | aria-current, labels prev/next | Mostrar rango; compactar páginas móviles |
| Table | Comparación por filas y columnas | Contenido no tabular | standard, compact; HTML table | caption, th/scope, sorting accesible | Scroll horizontal dentro del contenedor |
| Filters | Reducir conjunto de datos | Navegación principal | barra, chips activos, drawer | Labels, botón limpiar y conteo | Primarios visibles; secundarios en drawer |
| Action bar | Acciones sobre pantalla o selección | Contenido pasivo | page, bulk | Describe alcance; disabled explicado | Sticky solo sin ocultar focus |
| Export / download | Obtener archivo o reporte | No existe archivo o permiso | botón visible con Download icon opcional | Nombre, formato, alcance; progreso y error | Permanece visible si es frecuente |
| Chart | Comparación o tendencia válida | Un valor o tabla responde mejor | línea, barra, área limitada | Resumen textual, labels, tabla alternativa | Simplificar series, no ocultar datos |

### Reglas adicionales

- Un botón primario por región de decisión. Una página PUEDE tener más de uno solo si pertenecen a tareas independientes.
- Destructive DEBE requerir confirmación cuando el impacto no sea reversible.
- Los iconos son de 16 o 18 px en controles y 20 px en navegación. NO DEBEN cambiar de familia.
- Loading de botón conserva el ancho y anuncia el progreso.
- Un control disabled DEBERÍA explicar por qué si el usuario podría esperar usarlo.

## J. Patrones contables

### Montos y moneda

- Montos DEBEN alinearse al final de la columna.
- Se DEBE usar Intl.NumberFormat con locale es-MX y la moneda configurada.
- MXN sin ambigüedad: $1,234.56. Con varias monedas: MXN 1,234.56 o USD 1,234.56.
- La precisión DEBE seguir la regla de negocio; la UI NO DEBE truncar ni redondear silenciosamente.
- Negativos DEBEN conservar signo menos tipográfico: −$1,234.56. La representación con paréntesis PUEDE usarse en reportes impresos si es consistente.
- Un negativo NO DEBE comunicarse solo en rojo.
- Ceros DEBEN mostrarse como $0.00 cuando la precisión sea relevante; guion solo si significa “no aplica” y se explica.

### Débitos, créditos y balances

- Débito y crédito DEBEN permanecer en columnas separadas cuando la comparación lo requiera.
- Subtotales DEBEN usar peso 600 y borde superior simple.
- Totales DEBEN usar peso 700, números tabulares y doble regla superior.
- Un balance DEBE mostrar su periodo, moneda, método y fecha de actualización cuando existan.
- Diferencias DEBEN indicar signo, unidad y criterio de comparación.

### Porcentajes

- Alinear al final.
- Mantener precisión consistente por columna.
- Indicar la base o periodo de comparación.
- NO DEBE mostrarse tendencia cuando no existe comparación temporal válida.

### Fechas y periodos

- UI narrativa: 18 ago 2026.
- Tabla densa: 18/08/2026 solo si el encabezado y locale eliminan ambigüedad.
- Periodo: Ago 2026 o 1–31 ago 2026.
- NO hardcodear zona horaria. Usar la configuración del producto, usuario o empresa.

### Identificadores y trazabilidad

- Folios, UUID y hashes PUEDEN usar Geist Mono y truncado medio que preserve inicio y fin.
- RFC se presenta en mayúsculas; NO se corrige ni valida visualmente con una regla inventada.
- Documentos asociados DEBEN mostrar tipo, folio y estado cuando existan.
- Detalles DEBERÍAN mostrar usuario y fecha de última modificación si el backend los provee.
- Filtros activos DEBEN permanecer visibles y ser removibles.
- Información sensible DEBE enmascararse según permisos y nunca aparecer en capturas de documentación.

### Descarga y exportación

- Descargar obtiene un archivo existente; Exportar genera una representación. Los verbos NO DEBEN intercambiarse sin razón.
- El botón DEBE indicar formato o abrir una elección breve: Exportar XLSX, Descargar XML.
- Debe quedar claro el alcance: filas filtradas, selección o todo el periodo.
- Procesos largos DEBEN mostrar progreso o estado y permitir continuar trabajando cuando el backend lo soporte.

## K. Tablas y grandes volúmenes

1. Usar table HTML semántica cuando la estructura sea principalmente tabular.
2. Usar grid interactivo solo para comportamiento comparable a hoja de cálculo y únicamente con navegación por flechas, Home/End, selección y focus administrado.
3. NO agregar roles grid, row o gridcell a una tabla nativa sin implementar el patrón completo.
4. Header: 12–13 px, peso 600, background muted, th con scope.
5. Sorting: botón dentro de th, nombre accesible con estado ascendente/descendente.
6. Búsqueda y filtros DEBEN indicar el conjunto afectado.
7. Paginación DEBE mostrar rango visible y total cuando exista.
8. Selección múltiple DEBE activar una action bar con conteo y alcance.
9. Acciones frecuentes por fila PUEDEN ser visibles; tres puntos solo para acciones de baja frecuencia.
10. Sticky header PUEDE usarse dentro del contenedor; NO DEBE ocultar focus.
11. Columnas prioritarias permanecen visibles. Columnas no críticas PUEDEN ocultarse de forma documentada.
12. Expansión de fila solo para detalle complementario; no para sustituir una pantalla compleja.
13. Totales usan tfoot cuando aplique.
14. Empty, loading y error se renderizan dentro de la superficie de tabla y conservan encabezado/contexto.
15. Scroll horizontal solo dentro del contenedor tabular. La página completa NO DEBE desbordar.
16. En móvil NO se convierte automáticamente cada fila en tarjeta.
17. Celdas numéricas usan class numeric, alineación final y números tabulares.
18. Lectores de pantalla DEBEN recibir caption, headers y estado de sort.

## L. Formularios

- Todo control DEBE tener label persistente y visible.
- Placeholder solo ofrece ejemplo; NO sustituye label.
- Ayuda aparece antes del error y se vincula con aria-describedby.
- Requerido se comunica con texto o símbolo explicado, no solo color.
- Validación DEBE ocurrir en momento predecible: blur para formato y submit para integridad, salvo regla existente.
- Error DEBE explicar qué ocurrió y cómo corregirlo sin exponer backend.
- Agrupar con fieldset/legend cuando exista relación semántica.
- Acciones: primaria al final de la lectura; Cancelar como secundaria. En desktop pueden alinearse al final; en móvil se apilan con primaria primero visualmente y orden DOM lógico.
- Cambios sin guardar DEBEN advertirse antes de abandonar cuando exista estado real.
- Destructivas DEBEN nombrar el objeto e impacto.
- Formularios largos usan página completa y secciones. NO se colocan en modales pequeños.
- Un modal se limita a una decisión o formulario corto de hasta aproximadamente cinco campos simples.
- Confirmaciones financieras o legales DEBEN permitir revisar la información antes de enviar cuando aplique.

## M. Dashboard y KPIs

- El dashboard DEBE responder preguntas reales del usuario y conducir a una acción.
- Cada KPI, cuando corresponda, DEBE indicar medida, periodo, unidad, comparación válida, fuente, actualización y acción relacionada.
- NO mostrar tendencia sin serie temporal válida.
- NO agregar gráfica cuando un valor, tabla o alerta comunica mejor.
- NO usar gráficas 3D.
- NO usar una fila uniforme de cuatro tarjetas por defecto.
- Priorizar excepciones, pendientes y tareas; después contexto y tendencia.
- Estado vacío DEBE ser honesto. NO hardcodear KPIs en cero para aparentar funcionalidad.
- Si no hay contratos de datos, usar un estado vacío específico y no un dashboard simulado.

## N. Iconografía e imágenes

- Lucide es la única familia permitida.
- Se conservan peso, tamaño y estilo consistentes.
- Iconos DEBEN mejorar identificación o comprensión.
- Icon-only requiere aria-label y tooltip si el significado no es universal.
- NO usar emojis, imágenes de stock, ilustraciones generadas por IA ni ilustraciones 3D financieras.
- NO usar monedas, calculadoras, billetes o flechas ascendentes como marca.
- El wordmark de Hemia/balanz PUEDE ser tipográfico hasta existir un asset oficial.

## O. Motion

- Movimiento solo comunica aparición, relación espacial, progreso o confirmación.
- Hover/focus: 100–160 ms, color u opacidad.
- Overlay: 160–240 ms, translate máximo 8 px.
- NO escalar botones, tarjetas o filas en hover.
- prefers-reduced-motion reduce duración a casi cero y elimina translate, zoom, shimmer y parallax.
- Skeleton para carga estructural; spinner para acción localizada.
- La UI NO DEBE bloquearse sin explicar proceso y alcance.

## P. Accesibilidad

Objetivo mínimo: WCAG 2.2 AA.

- Texto normal: contraste mínimo 4.5:1; texto grande 3:1.
- Controles, iconos informativos, bordes necesarios y focus: mínimo 3:1 contra adyacentes.
- Todo interactivo es operable con teclado y mantiene orden DOM lógico.
- Focus visible: outline sólido de 2 px, offset 2 px, contraste mínimo 3:1.
- Focus NO DEBE quedar oculto por topbar, drawer, sticky header o action bar.
- Debe existir un skip link al contenido principal.
- Labels y nombres accesibles DEBEN coincidir con el texto visible.
- Errores DEBEN identificarse, describirse y vincularse al campo.
- Targets: mínimo WCAG 24 × 24 px; objetivo Hemia 40 × 40 y 44 × 44 en touch.
- Zoom 200%: sin clipping; reflow equivalente a 320 CSS px sin scroll bidimensional salvo tablas justificadas.
- Lectores de pantalla: landmarks, headings ordenados, live regions moderadas y tablas semánticas.
- prefers-reduced-motion DEBE respetarse.
- El color NO es único indicador.
- Modal y drawer DEBEN contener focus, cerrar con Escape y devolver focus al trigger.
- Tooltip DEBE abrir con hover y focus y cerrar con Escape.
- Mensajes dinámicos de éxito usan aria-live polite; errores críticos pueden usar assertive con moderación.
- Autenticación DEBE permitir pegar contraseñas y usar gestores; NO introducir pruebas cognitivas.

## Q. Microcopy

- Español de México, sentence case y verbos concretos.
- Usar Panel o Resumen, no Dashboard, en español.
- Usar espacio de trabajo solo si el concepto existe; evitar workspace.
- Acciones: Descargar XML, Exportar XLSX, Aplicar filtros, Limpiar filtros, Guardar cambios.
- Estados: Pendiente, En proceso, Completado, Con errores, Cancelado.
- NO usar marketing en operación: “Lleva tus finanzas al siguiente nivel”.
- NO usar mensajes genéricos: “Algo salió mal”. Preferir: “No pudimos cargar los CFDI. Revisa tu conexión e intenta de nuevo.”
- NO culpar: “El RFC no tiene el formato esperado”, no “Ingresaste mal el RFC”.
- NO exponer stack traces, HTTP 500, DTO o nombres internos.
- Confirmaciones DEBEN indicar objeto e impacto.
- Empty state DEBE nombrar la información ausente y, solo si existe, la acción siguiente.

## R. Flujo obligatorio para diseñar una pantalla

Antes de modificar una pantalla:

1. Identificar la tarea principal.
2. Identificar la información indispensable.
3. Definir la acción primaria real.
4. Definir acciones secundarias por frecuencia y riesgo.
5. Elegir el arquetipo correcto.
6. Aplicar tokens existentes.
7. Usar componentes compartidos.
8. Diseñar loading, empty, error y success aplicables.
9. Revisar responsive en los cinco viewports.
10. Revisar teclado, focus, labels y contraste.
11. Comparar con pantallas del mismo arquetipo.
12. Ejecutar lint, typecheck, pruebas disponibles y build.

Si una acción, dato o estado no existe en el repositorio, el agente DEBE documentar la limitación y NO simularlo.

## S. Definition of Done visual

Una pantalla no está terminada hasta que:

- Usa tokens semánticos.
- No contiene colores arbitrarios.
- No contiene tamaños arbitrarios sin justificación.
- Usa componentes compartidos recuperables.
- Incluye estados necesarios.
- Es usable con teclado.
- Tiene focus visible y no oculto.
- Cumple contraste AA.
- Funciona en 1440 × 900, 1280 × 800, 1024 × 768, 768 × 1024 y 390 × 844.
- No produce scroll horizontal de página; una tabla puede tenerlo dentro de su contenedor.
- Conserva funcionalidad, rutas, eventos, permisos y contratos.
- No introduce texto operativo solo en inglés.
- Es coherente con rutas similares.
- No contiene decoración genérica o de IA.
- Pasó lint, TypeScript, pruebas y build aplicables.
- Las limitaciones no verificadas quedan escritas.

## T. Mantenimiento

### Versionado

- Cambios de tokens, componentes o reglas: incrementar versión menor.
- Cambio de dirección visual o principio rector: requiere investigación, revisión de producto y versión mayor.
- Corrección editorial sin cambio de comportamiento: incrementar parche.

### Criterios para modificar

- Debe existir evidencia de usuario, accesibilidad, negocio o implementación.
- El cambio DEBE evaluar impacto en pantallas existentes y ambos temas.
- NO se crea una dirección visual nueva por pantalla, equipo o módulo.
- Una excepción DEBE documentar alcance, motivo, duración y responsable.

### Registro de decisiones

| Fecha | Versión | Decisión |
| --- | --- | --- |
| 2026-08-18 | 1.0.0 | Se adopta Registro Sereno; Geist y Lucide se conservan; se centralizan tokens; modo claro es referencia y tema oscuro se mantiene por funcionalidad existente |
