# Estándares de interfaz del frontend

Estado: reglas vigentes y propuestas identificadas por sección. Versión: 0.9. Fecha: 11 de septiembre de 2026.
Alcance: pantallas operativas de `apps/web`.

## 1. Propósito y autoridad

Este documento reúne criterios verificables para construir y revisar interfaces consistentes: componentes, tablas, filtros, páginas, modales y formularios. Es la base documental para una futura skill `frontend-ui-auditor`; no crea esa skill ni certifica que las pantallas actuales cumplan todas las reglas.

Fuentes normativas que se deben leer junto con este documento:

- [Registro Sereno](design/ACCOUNTING_UI_DESIGN_AGENT.md): fuente de verdad visual, tokens, accesibilidad y patrones contables.
- [Arquitectura de información](product/ACCOUNTING_INFORMATION_ARCHITECTURE.md): contextos, navegación y distribución de tareas.
- [Instrucciones del frontend](../apps/web/AGENTS.md): reglas de trabajo y verificaciones.

Las garantías funcionales, de seguridad, privacidad, integridad contable y accesibilidad tienen prioridad. Este documento no sustituye los anteriores ni redefine tokens. Ante una divergencia, se debe registrar el conflicto y comprobar el flujo y los contratos actuales antes de recomendar cambios.

**Vigente** identifica una regla respaldada por las fuentes normativas existentes o aprobada explícitamente por el responsable del proyecto. **Propuesta** identifica una convención inicial que requiere validación del equipo antes de tratarla como incumplimiento. **Pendiente** identifica una decisión todavía abierta. Las referencias a código son ejemplos de implementación, no excepciones automáticas ni modelos certificados.

## 2. Componentes y framework

### Base comprobada

La [configuración de shadcn](../apps/web/components.json) declara estilo `base-nova`, componentes TSX, React Server Components, variables CSS e iconos Lucide. El [manifiesto del frontend](../apps/web/package.json) incluye Next.js, React, Tailwind, shadcn y `@base-ui/react`.

| ID | Estado | Regla y comprobación |
| --- | --- | --- |
| UI-01 | Vigente | Reutilizar componentes compartidos antes de crear variantes locales. Revisar imports y composición, no sólo parecido visual. |
| UI-02 | Vigente | Conservar shadcn/Base UI y Lucide; no introducir otra familia visual ni migrar el framework como parte de una pantalla. |
| UI-03 | Vigente | Consumir tokens de `globals.css`; valores fuera del estándar requieren la justificación prevista en Registro Sereno. |
| UI-04 | Vigente | Usar shadcn/Base UI para controles nuevos cuando exista un equivalente, reutilizando primero los componentes locales de `@/components/ui` y las composiciones compartidas que cumplan esta regla. HTML nativo se permite para estructura semántica o necesidades no cubiertas por los componentes existentes, con justificación funcional en este último caso y conservando estilos y accesibilidad. |
| UI-05 | Propuesta | Crear un componente compartido cuando reutilice una necesidad real o encapsule una frontera real; no crear wrappers sólo para renombrar un componente. |

shadcn aporta código local adaptable. Un nombre, un atributo `data-slot` o una dependencia instalada no prueban por sí solos su uso: la revisión debe seguir el import hasta el componente y verificar su comportamiento. Una composición de producto sobre primitivas compartidas es válida; no necesita llamarse como el componente original de shadcn.

Referencias existentes:

| Necesidad | Implementación |
| --- | --- |
| Encabezado de página | [PageHeader](../apps/web/src/components/page-header.tsx) |
| Superficie y campos | [Surface, SurfaceHeader y Field](../apps/web/src/components/product-patterns.tsx) |
| Barra de filtros | [FilterBar](../apps/web/src/components/filter-bar.tsx) |
| Tabla simple de producto | [DataTable](../apps/web/src/components/data-table.tsx), sobre [Table](../apps/web/src/components/ui/table.tsx) |
| Estados de negocio | [StatusBadge](../apps/web/src/components/status-badge.tsx) |
| Menú de acciones por fila | [DropdownMenu](../apps/web/src/components/ui/dropdown-menu.tsx); composición de Clientes: [ClientRowActions](../apps/web/src/features/clients/client-row-actions.tsx) |
| Diálogo con Base UI | [Dialog](../apps/web/src/components/ui/dialog.tsx) |
| Diálogos y panel lateral nativos | [ControlledDialog, ActionDialog y DetailDrawer](../apps/web/src/components/overlay-dialog.tsx) |

### Aplicación de UI-04

- Un modal nuevo debe usar el `Dialog` compartido basado en Base UI; no crear otro `<dialog>` con estilos propios cuando el componente compartido cubra la necesidad.
- Un select nuevo debe usar el componente local equivalente cuando cubra el caso.
- Una tabla debe usar `DataTable` o las primitivas locales de `Table`, según su complejidad.
- Los elementos estructurales como `form`, `label`, `fieldset` y encabezados se mantienen como HTML semántico; no necesitan un wrapper de shadcn.
- Si los componentes existentes no cubren una necesidad, documentar el motivo funcional y la alternativa elegida. La excepción debe conservar los tokens y la accesibilidad del proyecto.
- Los controles existentes se revisan al modificar su flujo. La coexistencia actual con HTML nativo no exige una migración masiva ni constituye por sí sola un incumplimiento retroactivo; al revisar el flujo, evaluar su alineación con UI-04 y documentar cualquier excepción.

## 3. Estructura de páginas y acciones

| ID | Estado | Regla |
| --- | --- | --- |
| PAGE-01 | Vigente | Comenzar la ruta con `PageHeader`: título único `h1`, descripción concreta y acciones, sin línea cobriza ni contexto sobre el título. Comprobar el árbol completo para no duplicarlo si el contenedor ya lo incluye. |
| PAGE-02 | Vigente | Mantener los controles globales en la topbar y las acciones de la tarea junto al contenido afectado. |
| PAGE-03 | Vigente | Usar breadcrumbs desde tres niveles o cuando sea necesario conservar contexto. Respetar despacho, cliente, ejercicio y período definidos por navegación. |
| PAGE-04 | Vigente | Resaltar una acción principal real; conservar visibles las acciones frecuentes, como Descargar o Exportar. Reservar el menú para secundarias de baja frecuencia. |
| PAGE-05 | Vigente | Usar links para navegación y botones para acciones. Nombrar las destructivas con objeto e impacto. |
| PAGE-06 | Propuesta | Orden de una colección: encabezado de página, contexto o aviso aplicable, superficie con filtros, resultados y paginación. No añadir secciones vacías para completar la estructura. |

### Aplicación obligatoria de PAGE-01

- **Dónde usarlo:** `PageHeader` es obligatorio como encabezado principal de las páginas operativas de listado, detalle y formulario. Reutilizar el componente compartido; no reproducir su estructura con un `<header>` local.
- **Dónde colocarlo:** al inicio del contenido principal de la página, después del shell y de los breadcrumbs cuando existan, antes de avisos, filtros y contenido de la tarea.
- **Uno por pantalla:** si un layout o contenedor ya proporciona el `PageHeader` correspondiente a la página activa, las vistas internas no deben añadir otro. El título debe identificar la vista actual, no únicamente el módulo padre.
- **Dónde no usarlo:** dentro de modales, drawers, tarjetas, tablas o subsecciones. Usar sus encabezados específicos y una jerarquía semántica apropiada; para secciones de una página, `h2` y `h3` según corresponda.
- **Contenido:** título descriptivo, descripción concreta que aporte información y acciones de alcance de página cuando existan. No incluir línea cobriza ni contexto sobre el título. No añadir acciones para llenar el espacio disponible.
- **Acciones locales:** filtros, acciones por fila y acciones de una sección permanecen junto al contenido afectado; no trasladarlas al `PageHeader`.
- **Alcance y excepciones:** esta obligación aplica a páginas operativas. Autenticación y otros flujos con composición específica conservan su patrón documentado. Cualquier excepción dentro del alcance operativo debe registrarse conforme a la sección 10.

La obligatoriedad de `PageHeader` es una convención del proyecto. Los estándares web requieren estructura semántica y jerarquía accesibles, no un componente con ese nombre. Las pantallas existentes que reproduzcan el encabezado localmente deben adoptar el componente al modificar su encabezado o flujo; esta regla no exige una migración masiva fuera del alcance de la tarea.

## 4. Tablas

Aplican a colecciones cuya tarea principal sea consultar o comparar filas y columnas. Para fichas de un objeto o contenido narrativo, elegir una estructura semántica adecuada en lugar de forzar una tabla.

| ID | Estado | Regla |
| --- | --- | --- |
| TABLE-01 | Vigente | Usar tabla HTML semántica con caption y encabezados con `scope`. No usar roles de grid sin implementar su interacción completa. |
| TABLE-02 | Vigente | Mantener una superficie continua. Conservar contexto y encabezados en carga, vacío y error; distinguir ausencia de registros de ausencia de resultados filtrados. |
| TABLE-03 | Vigente | Alinear montos y porcentajes al final con números tabulares; aplicar formatos contables y precisión de negocio de Registro Sereno. No comunicar estados sólo mediante color. |
| TABLE-04 | Vigente | Ordenamiento mediante botón en el encabezado y estado accesible. Mostrar controles únicamente para operaciones soportadas. |
| TABLE-05 | Vigente | Paginación con rango visible y total cuando exista. No inventar totales que el servicio no provea. |
| TABLE-06 | Vigente | Selección múltiple con conteo y alcance explícitos; acciones masivas en una barra contextual. Distinguir página actual, selección y conjunto filtrado. |
| TABLE-07 | Vigente | Scroll horizontal contenido en la tabla, sin desbordar la página. Mantener columnas prioritarias; documentar las ocultables. No convertir automáticamente filas en tarjetas. |
| TABLE-08 | Propuesta | Orden inicial de columnas: selección si aplica, identificación principal, datos de comparación, estado y acciones. Ajustarlo cuando la tarea contable necesite otro orden y registrar la razón. |

Usar `DataTable` cuando su API cubra el caso. Para una necesidad que no cubra, componer las primitivas `Table` existentes antes de crear otra infraestructura tabular. No añadir selección, sorting o paginación si la tarea no los necesita. `DataTable` admite carga y error dentro del cuerpo sin retirar encabezados; la pantalla proporciona mensajes de vacío según los filtros aplicados. Usar `wrap` en columnas de nombres o descripciones que puedan ocupar varias líneas, manteniendo montos e identificadores según la tarea.

### 4.1. Composición y responsabilidades

La composición de referencia de un listado es la siguiente. Los elementos opcionales sólo se incluyen cuando la tarea los necesita; la distribución de filtros se rige por la sección 5.

```text
Página de la feature
├── PageHeader
└── Surface — superficie continua del listado
    ├── SurfaceHeader — opcional, si la colección necesita título propio
    ├── FilterBar — opcional, controles de consulta
    ├── DataTable
    │   └── Table — primitivas locales de shadcn
    │       ├── TableCaption — nombre accesible
    │       ├── TableHeader — columnas estables
    │       └── TableBody — carga, error, vacío o filas
    └── CollectionPagination — sólo si el contrato usa páginas y total
        └── Pagination — primitivas locales de shadcn
```

| Pieza | Responsabilidad | No le corresponde |
| --- | --- | --- |
| [Table](../apps/web/src/components/ui/table.tsx) | Estructura HTML, estilos base, espaciado, bordes y contenedor de scroll horizontal. | Consultas, permisos o reglas de negocio. |
| [DataTable](../apps/web/src/components/data-table.tsx) | Componer columnas y filas, aplicar alineación y ajuste de texto, conservar encabezados y presentar estados. | Consultar el API, interpretar errores de transporte, decidir permisos, filtrar, ordenar o paginar datos. |
| [CollectionPagination](../apps/web/src/components/collection-pagination.tsx) | Mostrar rango, total, página actual y controles anterior/siguiente; emitir la página solicitada. | Poseer la URL, hacer peticiones o calcular el total del servidor. |
| [Pagination](../apps/web/src/components/ui/pagination.tsx) | Primitivas de navegación basadas en shadcn, con Button local, iconos Lucide y textos en español. | Conocer clientes, CFDI u otra entidad de negocio. |
| Pantalla o hook de la feature | Consultar datos, validar contexto, controlar filtros/página, resolver permisos y formatear datos y mensajes. | Duplicar la estructura y estilos compartidos de tabla o paginación. |

### 4.2. Uso obligatorio y contrato de DataTable

**TABLE-09 — Vigente:** los listados operativos deben usar `DataTable` cuando su contrato cubra la necesidad. No crear otra tabla genérica ni copiar sus estilos por pantalla. Si no cubre el caso, aplicar las excepciones de la sección 4.6. Las tablas de consulta insertadas en detalles también pueden reutilizarla; no necesitan su propio `PageHeader`.

| Propiedad | Uso correcto |
| --- | --- |
| `caption` | Obligatoria. Nombre concreto del conjunto; se presenta a lectores de pantalla aunque esté visualmente oculto. |
| `columns` | Al menos una columna, con `id` único y estable, `header` descriptivo y `render(row)` para el contenido. El componente no valida estos requisitos en runtime. |
| `rows` | Filas del resultado actual, en el orden que corresponde a la consulta. No volver a paginar un resultado ya paginado por el servidor. |
| `rowKey` | Identificador único y estable de la fila; no usar índice, posición, valores aleatorios o nombres que puedan repetirse. |
| `numeric` | Alinea al final y activa números tabulares. No convierte ni formatea valores: moneda, precisión y redondeo permanecen en el dominio. |
| `align` | `start` por defecto o `end` para alinear encabezado y celdas al final sin semántica numérica, por ejemplo acciones. `numeric` conserva su alineación final. |
| `wrap` | Permite varias líneas y quiebre de palabras, con ancho máximo de la celda definido por el componente. Usarlo en nombres o descripciones largas; no equivale a ocultar ni truncar contenido. |
| `loading` / `loadingMessage` | Estado de carga y texto contextual, por ejemplo “Cargando clientes…”. Evitar retirar la tabla completa. |
| `error` | Contenido React ya preparado para el usuario; no pasar un objeto `Error`, una excepción cruda ni un componente vacío para representar ausencia de error. Usar `undefined` cuando no exista error. |
| `emptyMessage` | Mensaje según la consulta aplicada: “Todavía no hay clientes registrados” o “No hay clientes que coincidan con los filtros”. No decidirlo a partir de un borrador de filtro aún no aplicado. |

`render(row)` puede componer links, botones compartidos, estados y texto secundario. No debe ejecutar mutaciones durante el render. Los permisos de las acciones se resuelven en la feature y se verifican también en el backend. La fila no se convierte en un contenedor clicable que sustituya links o botones accesibles.

### 4.3. Estados y recuperación

**TABLE-10 — Vigente:** conservar `DataTable` montada para la carga de la colección y proporcionar sus estados. El orden implementado de presentación es **carga → error → vacío → filas**. Carga o error ocultan las filas suministradas; los encabezados permanecen y la celda de estado ocupa todas las columnas.

- La carga marca la tabla con `aria-busy`; carga y vacío usan un mensaje con `role="status"`.
- El contenido de error debe aportar su semántica accesible, mensaje seguro y una acción real de recuperación cuando exista. `DataTable` no agrega automáticamente `role="alert"` ni un botón Reintentar.
- No presentar una respuesta fallida como una colección vacía ni afirmar éxito sin confirmación real.
- Un cambio de tenant, entidad o consulta debe invalidar los datos anteriores en el hook o pantalla. Ocultar filas durante carga no sustituye ese aislamiento.
- Los errores o cargas del contexto completo, antes de conocer la entidad o las columnas, pueden usar un estado de página. No mostrar una tabla ficticia para un contexto inexistente o sin acceso.
- El comportamiento actual no incluye skeleton, actualización silenciosa conservando filas ni gestión de foco posterior a una petición. Si un flujo los necesita, definirlo y verificarlo explícitamente.

#### Responsabilidad del estado vacío

**TABLE-12 — Vigente:** el estado vacío pertenece a `DataTable` en su presentación y a la vista en su significado. La vista pasa `emptyMessage`; no reemplaza la tabla con un estado vacío externo ni crea su propia fila vacía. El mensaje vacío se centra horizontalmente en la celda que abarca todas las columnas; la celda conserva su alineación vertical central. Esta decisión específica para tablas prevalece sobre la preferencia general de alinear estados vacíos al inicio; el mensaje de carga comparte el centrado horizontal y vertical; el contenido de error conserva su presentación contextual.

- `DataTable` detecta que no hay filas una vez descartados carga y error, conserva encabezados y caption y presenta el mensaje en una celda que abarca todas las columnas, con estilos y anuncio accesible compartidos.
- La vista decide el texto usando la consulta aplicada y el alcance real de la respuesta. No afirmar que no existen registros en todo el sistema cuando sólo se consultó un subconjunto o una página.
- `emptyMessage` es texto, no JSX: evita que cada vista defina iconos, espaciados o estructuras diferentes para el mismo estado. El mensaje genérico del componente es un fallback; las vistas operativas deben proporcionar uno específico.
- Un vacío no es error, falta de permisos ni carga. Esos estados conservan su tratamiento independiente.
- Mantener las acciones disponibles en su lugar habitual: crear en `PageHeader` y limpiar en `FilterBar`. No duplicarlas automáticamente dentro del estado vacío. Si una tarea necesita una acción contextual adicional, documentar primero esa necesidad antes de ampliar el contrato compartido.

### 4.4. Paginación compartida

**TABLE-11 — Vigente:** usar `CollectionPagination` en colecciones compatibles con páginas numeradas y total conocido. Colocarla después de la tabla dentro de la misma superficie; no duplicar controles por pantalla ni incorporarla a cada fila.

Su contrato recibe `meta` con `page`, `limit`, `total` y `totalPages`, `itemLabel` y `onPageChange(page)`. Los metadatos deben provenir de la respuesta vigente y cumplir el contrato del API: página y límite positivos, totales no negativos. Con `meta=null` no se muestra paginación.

- El rango y total se muestran incluso con una sola página; sin registros, el rango es `0–0`.
- Los controles se muestran cuando hay varias páginas o cuando la página actual quedó fuera del rango después de un cambio en los datos.
- Anterior se deshabilita en la primera página. Siguiente se deshabilita en la última o fuera de rango. Anterior permite regresar a una página válida cuando el total se redujo.
- La pantalla actualiza la consulta al recibir el callback. Durante carga o error debe ocultar la paginación del resultado anterior.
- Las primitivas de shadcn están adaptadas a botones porque los consumidores actuales usan callbacks. No usar enlaces `href="#"` para simular navegación; si un flujo dispone de URLs reales, componer links mediante el soporte `render` del botón local.
- La implementación no incluye selector de tamaño, salto a página, números intermedios ni paginación por cursor. No inventar un total para adaptar un API de cursores a este componente.

### 4.5. Presentación y accesibilidad

Aplicar los tokens y medidas de Registro Sereno en `ui/table.tsx`; no redefinir colores, tipografía o padding por cada pantalla. Los estados se comunican con texto y semántica, además del color cuando proceda.

Las columnas con `wrap` permiten lectura de textos largos; las demás conservan el comportamiento sin salto de línea de las primitivas. La tabla mantiene scroll horizontal contenido. Esto no certifica por sí solo accesibilidad móvil: verificar columnas prioritarias, acceso con teclado al contenido desplazado, foco de acciones, zoom y ausencia de desbordamiento de página.

Los encabezados usan `scope="col"`; las columnas con `sortKey` y configuración `sorting` presentan un botón de ordenamiento. No mostrar apariencia de ordenamiento si la tabla no lo implementa. Cada columna ordenable requiere botón accesible; sólo la columna actualmente ordenada declara `aria-sort="ascending"` o `"descending"`. Las demás omiten el atributo. Ordenar el conjunto correcto, no únicamente las filas de una página del servidor.

#### Alineaciones y formatos

- Texto, nombres y badges se alinean al inicio; encabezado y contenido deben compartir alineación. Mantener alineación vertical central cuando los nombres ocupen varias líneas.
- Las acciones se alinean al final mediante `align: "end"`; no usar `numeric` para alinear botones.
- Montos y porcentajes conservan TABLE-03. Años y fechas usan cifras tabulares, pero no necesitan alineación final sólo por contener números.
- En Clientes, Actualización usa `dd/mm/aaaa` con locale `es-MX` y elemento `time`; Ejercicio reciente muestra el año o “Sin ejercicio”. No inventar una zona horaria ni reemplazar la configuración real por una constante.

#### Acciones por fila

| ID | Estado | Regla |
| --- | --- | --- |
| ACTION-01 | Vigente | Mantener la acción frecuente visible con texto corto y específico, seguida de `⋯` cuando existan acciones secundarias disponibles. En Clientes: `Ver ⋯`, con estilo ghost. Una sola acción no necesita menú. |
| ACTION-02 | Vigente | Usar `DropdownMenu` local de shadcn/Base UI. Todos los ítems del menú llevan icono Lucide y etiqueta textual; los iconos que repiten el significado del texto usan `aria-hidden="true"`. Conservar tamaños y espaciado compartidos. |
| ACTION-03 | Vigente | El activador `⋯` tiene nombre accesible contextual, como “Más acciones de [cliente]”, y tooltip “Más acciones”. La acción corta conserva un nombre como “Ver cliente [nombre]”, que incluye el texto visible. No depender sólo del tooltip. |
| ACTION-04 | Vigente | Mostrar opciones según permisos, estado y contratos reales. Navegar mediante enlaces y ejecutar cambios mediante acciones explícitas. No mostrar menús vacíos, opciones inventadas ni deducir una operación por la sola existencia de un estado en el modelo. |
| ACTION-05 | Vigente | Colocar las acciones destructivas al final, separadas del resto y con variante destructiva. Confirmar objeto, impacto y posibilidad real de recuperación en un Dialog compartido; bloquear doble envío, comunicar espera y permitir recuperación de errores sin afirmar éxito anticipado. |
| ACTION-06 | Propuesta | Mantener visible el encabezado “Acciones”, alineado al final. Si una necesidad de densidad justifica ocultar su texto, conservar un `th scope="col"` con nombre accesible mediante `sr-only`; no eliminar la celda de encabezado. Clientes conserva el encabezado visible. |

Verificar apertura por Enter/Espacio, recorrido del menú con flechas, cierre con Escape y retorno del foco. Al abrir una confirmación, transferir el foco al diálogo; al cancelar, devolverlo al activador. Si una operación elimina la fila, definir un destino de foco estable en la colección. El menú debe quedar dentro del viewport y ser accesible aunque la tabla tenga scroll horizontal. Mantener los targets táctiles de Registro Sereno.

La cantidad no es el único criterio: dos acciones frecuentes pueden permanecer visibles si caben. Una variante sólo con icono exige una necesidad de densidad demostrada, significado claro y nombre accesible; no sustituye automáticamente el patrón de texto corto. No migrar otras tablas ni agregar operaciones de dominio fuera del alcance solicitado.

Iconos acordados para Clientes: Pencil para editar, Users para responsables, Pause para suspender, Play para reactivar, RotateCcw para restaurar, Archive para archivar y Trash2 para eliminar definitivamente. Esta correspondencia visual no autoriza esas operaciones en producción.

#### Badges y contexto del estado

**TABLE-13 — Vigente:** las columnas de estado usan `StatusBadge` de forma consistente, incluidos valores de ausencia como “Sin período”. Los estados neutrales conservan fondo suave `bg-muted`, borde, icono y texto; no convertirlos en éxito o advertencia para darles visibilidad. Mantener texto, icono y color semántico sin apariencia de botón. No es necesario igualar el ancho de todos los badges ni asignar una región viva a cada celda.

En Clientes se distinguen “Estado de cuenta” y “Estado del período”. El RFC mostrado bajo el nombre se identifica como principal; no implica que la cuenta tenga un solo RFC. “Sin responsable” y “Sin ejercicio” son ausencias de datos en otras columnas, no estados que deban convertirse automáticamente en badges.

**Decisión específica de Clientes, aprobada por el responsable del proyecto el 11 de septiembre de 2026:** la celda “Estado del período” muestra sólo el badge, sin fecha, por preferencia de presentación compacta. No generalizar esta decisión a comparaciones entre períodos: si la tarea exige comparar el mismo mes, el contexto temporal debe quedar explícito. Los mocks contienen meses distintos; quitar la fecha no implica que representen un período común.

### Ordenamiento de tablas

`DataTable` recibe `sorting` con `key`, `direction` (`asc` o `desc`) y `onChange(key, direction)`. Sólo las columnas con `sortKey` muestran botón e indicador. El encabezado activo declara `aria-sort`; un clic alterna dirección, y una columna diferente comienza ascendente. Sin configuración, los encabezados permanecen como texto. La tabla no reordena filas localmente.

La vista actualiza criterio, dirección y página 1 en una sola navegación, preservando búsqueda y filtros. Clientes usa Cliente, Estado de cuenta y Actualización, y omite el menú Ordenar de FilterBar para no duplicar controles. La propiedad `sort` de FilterBar permanece disponible para vistas sin encabezados ordenables.

### 4.6. Excepciones y evolución

Una excepción justificada puede componer directamente las primitivas locales de `Table`. Debe registrar necesidad, regla afectada, archivos, alternativa y responsable conforme a la sección 10, conservando tokens y accesibilidad.

| Necesidad no cubierta hoy | Tratamiento |
| --- | --- |
| Totales semánticos o encabezados agrupados | Evaluar composición con `TableFooter`, `th` y relaciones de encabezados adecuadas. No simular un total como fila de datos sin semántica. |
| Selección múltiple, expansión o edición de celdas | Definir primero la tarea, alcance y comportamiento de teclado. Ampliar el componente sólo con necesidad real; no agregar flags preventivos. |
| Ordenamiento por encabezado | Diseñar el contrato con la consulta real y los requisitos de TABLE-04; `header` conserva la etiqueta textual y `sortKey` identifica el criterio del servidor. |
| Paginación por cursor o total desconocido | Respetar el contrato del API; reutilizar primitivas de Pagination en una composición específica, sin fabricar números de página o total. |
| Interacción comparable a una hoja de cálculo | Tratarla como necesidad distinta, con patrón completo de teclado y foco. No añadir `role="grid"` a la tabla actual para aparentar soporte. |
| Información no tabular | Usar listas, definiciones o secciones semánticas según la tarea. No forzar DataTable por uniformidad visual. |

Antes de una ampliación, comprobar si la composición existente resuelve el caso. Una corrección común debe hacerse en el componente compartido más cercano; las diferencias fiscales, permisos, formatos y consultas permanecen en las features. No agregar dependencias o una nueva infraestructura de tablas sin necesidad demostrada y autorización según las reglas del repositorio.

### 4.7. Verificación

- [Pruebas de tabla y paginación](../apps/web/src/components/data-table.test.tsx): verifican encabezados y ocultamiento de filas durante carga/error, mensaje vacío, ajuste de texto y límites de paginación. Se ejecutan mediante `bun run --cwd apps/web test`.
- Para cambios en estos componentes, ejecutar lint, typecheck, tests y build del frontend, además de revisar visualmente los viewports definidos en Registro Sereno y la navegación con teclado.

## 5. Búsqueda y filtros

### 5.1. Alcance y fundamento

Los filtros reducen un conjunto de resultados; la búsqueda local encuentra coincidencias dentro de ese conjunto y el ordenamiento cambia su secuencia. No confundirlos con selectores de contexto (despacho, cliente o ejercicio) ni con campos de captura de un formulario.

La distribución de filtros es una convención del proyecto: prioriza proximidad a los resultados, alcance comprensible y adaptación al espacio disponible.

### 5.2. Reglas de distribución

| ID | Estado | Regla |
| --- | --- | --- |
| FILTER-01 | Vigente | Indicar el conjunto afectado y permitir consultar y restablecer los filtros activos. En FilterBar, mostrar el conteo en el badge y los valores seleccionados dentro del menú, sin chips. Cada control tiene nombre accesible persistente. |
| FILTER-02 | Vigente | Los filtros secundarios pueden pasar a un drawer en tablet; conservar acceso y comprensión del estado aplicado. |
| FILTER-03 | Vigente | Usar `FilterBar` inmediatamente sobre la colección afectada. La barra ocupa el ancho disponible de esa colección; sus controles se agrupan a la derecha, sin centrarse ni repartirse entre extremos. |
| FILTER-04 | Vigente | Elegir por colección aplicación automática o envío con Aplicar filtros según la complejidad y costo de consulta. Distinguir valores aplicados de borradores. |
| FILTER-05 | Vigente | Cambiar filtros aplicados devuelve a página 1. Limpiar filtros restaura búsqueda y filtros iniciales, conserva el orden elegido y el contexto de navegación, y vuelve a página 1. |
| FILTER-06 | Vigente | Conservar en URL búsqueda, filtros, orden y página necesarios para recuperar o compartir la vista cuando el contrato de ruta lo soporte. Excluir secretos y datos sensibles. |
| FILTER-07 | Vigente | Agrupar búsqueda, Filtros con limpieza integrada y Ordenar opcional, en ese orden, juntos a la derecha. En tablas ordenables, usar los encabezados de DataTable y omitir Ordenar en la barra. Mantener el orden de lectura al apilar. |
| FILTER-08 | Vigente | Usar Input, Select, DropdownMenu y Button compartidos conforme a UI-04. FilterBar compone la presentación; la feature controla consulta, valores iniciales y cambios de estado. |

**Ancho de barra no significa ancho completo de cada control.** En escritorio, FilterBar ocupa el ancho de la colección y agrupa los controles a la derecha con separación de 8 px. La búsqueda mide 256 px y los botones se ajustan a su contenido. Mantener alturas consistentes; no estirar ni separar los controles para llenar la fila.

La búsqueda precede al menú Filtros; organizar sus grupos por frecuencia de uso. La limpieza queda integrada visualmente al botón Filtros y el menú Ordenar opcional va al final. No agregar controles que no tengan soporte real ni duplicar período, cliente o despacho ya establecidos por navegación.

### 5.3. Ubicación según el conjunto afectado

| Vista | Dónde colocar los filtros | Alcance |
| --- | --- | --- |
| Tabla de listado | Debajo de PageHeader y del título de colección si existe, dentro de la misma Surface, antes de DataTable. | Toda la consulta de la colección, no sólo la página visible. |
| Lista o colección de tarjetas | Sobre la colección, alineada con sus bordes. | Los elementos de esa colección; no obliga a convertirlos en tabla. |
| Sección dentro de un detalle | Después del encabezado de sección y antes de sus resultados. | Sólo esa sección; identificarla si hay varias colecciones. |
| Pestañas | Encima de las pestañas si filtra todas; dentro de la pestaña si sólo afecta esa vista. | Declarar alcance y conservación de valores al cambiar pestaña; no duplicar controles equivalentes. |
| Reporte o resumen con varias visualizaciones | Bajo el encabezado y antes de los bloques afectados. | Período u otros criterios compartidos, sólo cuando todas las visualizaciones los respeten. |
| Catálogo con muchas categorías | Puede usar panel izquierdo junto a resultados como excepción justificada. | Exploración por múltiples categorías. |
| Modal o drawer con una colección breve | Sobre esa colección, dentro del cuerpo. | Búsqueda o filtros locales; si la tarea se vuelve compleja, usar página conforme a la sección 6. |

No poner filtros locales en la topbar global, después de la paginación, dentro de cada fila ni en el área de acciones principales de PageHeader. El centrado del estado vacío de la tabla no se extiende a su barra de filtros.

### 5.4. Comportamiento, limpieza y estados

- **Aplicación automática:** para listados con pocos criterios independientes. La búsqueda espera brevemente tras escribir; selectores se aplican al elegir. Reutilizar el debounce existente y no establecer una duración global sin medición.
- **Aplicación conjunta:** para varios criterios dependientes o consultas costosas. Mostrar Aplicar filtros y dejar claro que las ediciones no modifican resultados hasta confirmar. No mezclar ambos modelos de forma sorpresiva.
- **Limpiar filtros:** acción secundaria integrada al botón Filtros. Mostrarla sólo cuando haya búsqueda o filtros que limpiar (`canClear`), sin reservar espacio para un control deshabilitado. Su disponibilidad no depende de haber cambiado únicamente el ordenamiento.
- **Valores iniciales:** documentarlos por colección. Restablecer no significa necesariamente mostrar todos los registros: respetar alcance, permisos y criterios iniciales del producto. Si hace falta restablecer también orden u otras preferencias, usar una acción explícita distinta, no cambiar silenciosamente el significado de Limpiar filtros.
- **Ordenar por:** no modifica el conjunto ni cuenta como filtro activo. Un cambio de orden vuelve a página 1 y actúa sobre el conjunto completo del servidor cuando hay paginación remota.
- **Carga:** conservar controles y foco en el elemento usado; indicar actualización en los resultados y descartar respuestas anteriores. No bloquear toda la barra por cada pulsación.
- **Sin resultados o error:** mantener la barra para que el usuario pueda corregir criterios; usar los estados de DataTable. No confundir fallo de consulta con vacío.
- **Filtros activos:** en FilterBar, mostrar un badge con el número de criterios distintos de su valor inicial y marcar la selección dentro del menú. No mostrar chips ni una fila adicional. Permitir limpiar desde la barra y restablecer un criterio desde su menú.
- **Accesibilidad:** labels visibles en formularios; en la búsqueda compacta de FilterBar se permite un label visualmente oculto. Mantener nombres claros, teclado y foco completos. El placeholder describe la búsqueda pero no sustituye su etiqueta. Al actualizar resultados no mover el foco automáticamente a la tabla.

### 5.5. Responsive y presentación

En escritorio, la barra ocupa el ancho de la superficie con búsqueda y botones juntos a la derecha. En anchos intermedios permite varias filas conservando el orden y sin comprimir los controles ni provocar desbordamiento.

En móvil, búsqueda a ancho disponible y controles restantes debajo alineados a la derecha; pueden compartir fila sólo si caben sin recortar etiquetas, opciones o targets. Apilar cuando sea necesario y conservar el mismo orden DOM y visual. La barra no debe requerir scroll horizontal, aunque la tabla sí pueda tenerlo.

Usar fondo discreto, bordes y espaciado de los componentes compartidos. La limpieza no debe competir con la acción principal de página. Con pocos controles no introducir un drawer; reservarlo para filtros secundarios que realmente necesiten espacio, manteniendo visibles búsqueda y criterios frecuentes. Evitar una barra sticky salvo necesidad demostrada y verificación de que no oculta foco ni contenido.

### 5.6. Barra compacta estándar

Para búsquedas textuales y filtros de selección exclusiva simples, usar `FilterBar`: fondo de superficie, búsqueda compacta con icono, botón Filtros y botón Ordenar opcional juntos y alineados a la derecha, separados por 8 px. Clientes es un consumidor; sus opciones no se imponen a otras colecciones.

```text
           [Buscar…] [Filtros ① ×] [Ordenar (opcional)]
───────────────────────────────────────────────────────────────
DataTable
CollectionPagination
```

- El menú Filtros contiene los grupos de selección exclusiva configurados por la colección. Las opciones seleccionadas deben anunciarse y marcarse. En DataTable, ordenar desde los encabezados; reservar el menú Ordenar para colecciones sin encabezados ordenables.
- Los filtros ocultos aplicados se indican con conteo en el botón y selección marcada dentro del menú. Limpiar filtros aparece cuando hay búsqueda o filtros modificados, conserva el orden y vuelve a página 1. Esta variante no reserva espacio para una limpieza deshabilitada.
- La búsqueda tiene nombre accesible persistente mediante label visualmente oculto y placeholder descriptivo; es una excepción explícita al label visible para esta barra compacta. No mostrar un atajo de teclado que no esté implementado.
- En móvil, búsqueda a ancho completo y botones en la siguiente fila, conservando orden de lectura y sin desbordamiento horizontal.
- Aplicación automática y debounce existente, sin cambiar consultas, permisos ni contexto. La acción principal de la página permanece en PageHeader.
- Esta variante no convierte un menú en formulario de filtros complejos: para varios campos dependientes, rangos o contenido extenso, aplicar el patrón de panel apropiado.

### Presentación de filtros activos

El botón Filtros muestra la cantidad de criterios activos en un Badge compartido. Un control de cierre adyacente, visualmente integrado sin divisor ni bordes interiores, pero como botón independiente, ejecuta `onClear` sin abrir el menú ni anidar botones. Su nombre accesible indica que limpia búsqueda y filtros; conserva el orden según el contrato. Con búsqueda sola, la limpieza permanece disponible sin mostrar un conteo de filtros inexistentes.

Reglas del badge y del control de limpieza:

- El badge aparece sólo si hay filtros distintos de su valor inicial; cuenta criterios, no opciones disponibles. Búsqueda y ordenamiento no incrementan ese conteo. El nombre accesible del botón anuncia el número y el badge visual no lo duplica.
- La “×” integrada aparece cuando `canClear` es verdadero. Mantenerla compacta: área de interacción de 24 px de ancho y altura del botón, sin padding horizontal adicional ni divisor. Reducir el padding final del activador para minimizar el crecimiento del conjunto. No reducir el área interactiva al tamaño del icono.
- Menú y limpieza son controles hermanos con foco y nombres accesibles propios. No anidar botones ni abrir el menú al limpiar; conservar foco visible aunque no exista separación visual.
- Si no hay filtros configurados pero sí búsqueda que limpiar, presentar un control independiente de limpieza de búsqueda. No mostrar un menú Filtros vacío.
- La limpieza global conserva orden y contexto; restablecer un criterio desde el menú comunica su `defaultValue`. La feature aplica los cambios de consulta y el reinicio de página.

No mostrar chips ni una fila adicional de filtros seleccionados. El badge resume la cantidad y el menú permite consultar o restablecer cada criterio. Activar filtros no aumenta la altura de la barra; el ajuste a varias filas sólo responde al espacio disponible.

### Contrato del componente FilterBar

`FilterBar` es la composición estándar parametrizable; no acepta `children` ni cambios de orden o estilo por pantalla. Presenta búsqueda, menú Filtros y menú Ordenar juntos, en ese orden y alineados a la derecha con limpieza integrada junto al botón Filtros. Las capacidades no configuradas se omiten.

| Propiedad | Contrato |
| --- | --- |
| `search` | Opcional: label accesible, placeholder, valor controlado, longitud máxima opcional y callback `onChange`. La feature conserva el debounce. |
| `filters` | Lista opcional de filtros de selección exclusiva: `id` único, `label`, `value`, `defaultValue`, `options` y `onChange`. Cada opción tiene valor único y etiqueta. |
| `sort` | Opcional: valor, opciones y callback de ordenamiento. No cuenta como filtro activo. |
| `canClear` / `onClear` | La feature indica si hay búsqueda o filtros que limpiar y ejecuta la limpieza, conservando orden y contexto. No se infiere sólo desde el texto visible porque puede haber una búsqueda aplicada y un borrador diferente. |

La barra calcula el conteo de filtros comparando valor actual con `defaultValue` y muestra sus opciones seleccionadas dentro del menú. Al elegir la opción inicial de un criterio, comunica ese valor mediante su callback. La feature debe suministrar valores válidos presentes en sus opciones, y un `canClear` coherente con el estado de consulta. La barra no realiza consultas, no administra URL, no conoce permisos ni impone opciones de dominio.

El contrato cubre búsqueda textual y selecciones exclusivas simples. No agregar JSX libre para alterar el patrón. Filtros de fechas, rangos, multiselección o campos dependientes requieren evaluar una composición específica y documentar la excepción.

**Compatibilidad de pantallas existentes:** `LegacyFilterBar` conserva temporalmente los consumidores anteriores con contenido libre. No se usa para nuevas barras ni es la referencia visual. Al modificar esos flujos, migrar los filtros compatibles a `FilterBar`; documentar las necesidades especiales de los restantes antes de adaptarlos. Clientes ya usa el contrato estándar.

### 5.7. Excepciones y verificación

Documentar un panel lateral, filtros locales de pestaña u otra variante por necesidad y alcance según la sección 10. No crear otra infraestructura de filtros para cambiar sólo alineación. La estructura de FilterBar debe permitir composición sin incorporar nombres de entidades, endpoints ni reglas fiscales.

Antes de aprobar una implementación, verificar: badge con cero, uno y varios criterios, limpieza sin abrir el menú, restablecer un criterio sin alterar los demás, ausencia de chips y adaptación a pantallas estrechas, capacidades opcionales ausentes, aplicación y limpieza, primera página, conservación de orden y contexto, navegación Atrás/Adelante, respuesta obsoleta, vacío/error, labels y teclado, y los viewports de Registro Sereno. Los filtros específicos y valores iniciales de otras colecciones se acuerdan según sus contratos; este patrón no autoriza copiar Estado o Nombre en todos los listados.

## 6. Página, modal o panel lateral

Las reglas vigentes de Registro Sereno y los flujos explícitos de arquitectura de información prevalecen sobre estos ejemplos generales.

| Contenedor | Cuándo usarlo | Cuándo evitarlo | Estado |
| --- | --- | --- | --- |
| Página | Formulario largo, tarea principal compleja o revisión extensa. | Decisión breve que sólo interrumpe el contexto actual. | Vigente |
| Modal | Una decisión enfocada o formulario corto de aproximadamente cinco campos simples como máximo. | Tablas complejas, tareas con varias secciones o formularios largos. | Vigente |
| Drawer | Filtros o detalle complementario conservando la vista de origen. | Tarea principal compleja. | Vigente |
| Página con URL propia | Objeto o tarea que deba abrirse directamente, compartirse o recuperarse con navegación. | Estado efímero sin identidad propia. | Propuesta |

No decidir sólo por número de campos: dependencias, consecuencias y necesidad de revisar información pueden justificar una página incluso con pocos controles.

## 7. Orden y comportamiento de modales

**Propuesta MODAL-01:** usar el siguiente orden para nuevas composiciones:

1. Encabezado: título que nombra la tarea, descripción de alcance cuando aporte contexto y control de cierre con nombre accesible.
2. Cuerpo: contexto indispensable, campos o información de revisión en orden de tarea. Ayuda junto al campo y errores vinculados al control afectado; errores generales cerca del contenido relevante.
3. Pie: Cancelar como secundaria y acción principal con verbo específico, por ejemplo Guardar cambios. En escritorio, secundaria antes de primaria, alineadas al final.

Reglas vigentes:

- **MODAL-02:** contener el foco, permitir Escape y devolver el foco al activador. No ocultar foco ni acciones por scroll; comprobar título y descripción accesibles.
- **MODAL-03:** advertir antes de perder cambios reales sin guardar. Permitir revisar información antes de confirmaciones financieras o legales cuando corresponda.
- **MODAL-04:** respetar los tamaños y adaptación móvil de Registro Sereno. En móvil, acciones apiladas con primaria primero visualmente y orden DOM lógico; verificar el recorrido real con teclado.
- **MODAL-05:** comunicar carga, errores y resultado real. No cerrar con un éxito ficticio ni afirmar persistencia de una acción demo.

**Propuesta MODAL-06:** impedir envíos duplicados mientras una operación esté pendiente y conservar los datos tras errores recuperables. Definir el efecto de cerrar durante procesos largos según el contrato real; cerrar la UI no debe presentarse como cancelación del servidor si no lo es.

**Pendiente:** seleccionar un modal y un drawer como referencias visuales aprobadas, incluidos scroll, pérdida de cambios y estado pendiente. Los componentes existentes son puntos de inspección, no garantía de cumplimiento.

## 8. Formularios

| ID | Estado | Regla |
| --- | --- | --- |
| FORM-01 | Vigente | Label visible y persistente; placeholder sólo como ejemplo. Explicar campos requeridos y vincular ayuda/error con `aria-describedby`. |
| FORM-02 | Vigente | Agrupar campos relacionados con `fieldset` y `legend` cuando corresponda. Ordenar según la tarea. |
| FORM-03 | Vigente | Validación predecible: formato al salir del campo e integridad al enviar, salvo regla existente. Mensajes concretos sin detalles internos del backend. |
| FORM-04 | Vigente | Elegir controles según la matriz de Registro Sereno: radio para conjunto corto exclusivo, select para opciones estables y autocomplete para catálogo grande o remoto. |
| FORM-05 | Vigente | Primaria al final de la lectura y Cancelar secundaria. Formularios largos en página con secciones. |

El orden de campos depende del dominio; no imponer RFC, nombre o período primero en todos los formularios. No inventar validaciones fiscales, catálogos ni obligatoriedad que contradigan el contrato funcional.

## 9. Estados, accesibilidad y responsive

- **STATE-01 — Vigente:** distinguir carga, sin datos, sin resultados, error, restricción de acceso y configuración incompleta. Ofrecer acciones sólo si existen.
- **STATE-02 — Vigente:** conservar el contexto y permitir recuperación de errores cuando sea posible. Éxito sólo después de un resultado real.
- **A11Y-01 — Vigente:** revisar teclado, foco visible, nombres accesibles, contraste, mensajes dinámicos y significado independiente del color conforme a Registro Sereno.
- **RESP-01 — Vigente:** comprobar 390 × 844, 768 × 1024, 1024 × 768, 1280 × 800 y 1440 × 900; además zoom y reflow definidos por la fuente normativa. No certificar estos puntos únicamente por lectura de clases CSS.

### 9.1. Datos de Clientes

La simulación local de Clientes fue retirada el 15 de septiembre de 2026. El listado y el detalle consultan el API del espacio activo; no sustituyen sus respuestas con fixtures. Las acciones disponibles son las soportadas por los contratos reales: editar datos, gestionar responsables y archivar, según permisos y estado. Los datos utilizados exclusivamente por pruebas no se cargan en la aplicación.

## 10. Cómo revisar y registrar excepciones

Para cada pantalla, identificar tarea, contexto, acciones, componentes usados y estados reales. Comparar con las reglas aplicables y recorrer la interacción cuando se evalúe comportamiento visual o accesibilidad.

Cada hallazgo debe contener: ID de regla, estado de la regla, archivo y ubicación, evidencia, impacto, corrección mínima y verificación realizada. Separar:

- Incumplimiento de una regla vigente.
- Diferencia respecto de una propuesta, que requiere decisión y no se trata como defecto obligatorio.
- Punto no verificado o decisión pendiente.

Una excepción debe indicar regla, pantalla, motivo funcional, alternativa adoptada y decisión del responsable. El código existente no constituye por sí mismo aprobación. No exceptuar garantías de accesibilidad, seguridad o integridad para lograr uniformidad visual.

## 11. Decisiones pendientes y mantenimiento

| Decisión | Estado actual |
| --- | --- |
| Tabla, formulario y modal de referencia visual | Seleccionar ejemplos tras verificar sus estados y accesibilidad. |
| Diálogos nuevos | Aprobado: `Dialog` compartido con Base UI cuando cubra la necesidad; UI-04. Existentes se revisan al modificar su flujo. |
| Selects nuevos | Aprobado: componente local shadcn/Base UI equivalente cuando cubra la necesidad; UI-04. Excepciones con justificación funcional. |
| Filtros principales, avanzados y aplicación por arquetipo | Aplicar las reglas de la sección 5 y definir criterios concretos según la tarea. |
| Orden de columnas y campos por dominio | Definir por colección o formulario, sin imponer un esquema universal. |

Al aprobar una propuesta, actualizar su estado en la regla correspondiente. Si cambia una regla visual o navegable ya normativa, actualizar primero su fuente y después este documento. No duplicar catálogos de tokens ni mantener valores divergentes.

Los resultados de auditorías, incidencias de ejecución y pendientes de migración se registran fuera de este estándar. Una regla vigente define el comportamiento exigido; no certifica que todas las pantallas ya lo cumplan.
