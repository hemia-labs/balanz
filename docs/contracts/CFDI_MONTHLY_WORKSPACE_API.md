# Contrato de mesa mensual — Fase 5

Versión: monthly-workspace/1.0.0. Fecha: 2026-09-15. Implementación: MonthlyController/MonthlyService en client-accounts; detalle compartido en cfdi. Esta entrega no inicia SAT ni exporta archivos.

## Contexto y lectura

Todas las rutas requieren sesión vigente, organización activa, membresía y cuenta/entidad autorizadas, cfdi.view y periods.view; el servidor obtiene tenant de la sesión. El titular real se determina por organizations.owner_user_id; los demás requieren asignación activa. Cache-Control: no-store. Las mutaciones conservan CSRF global y revalidan permisos/scope. Las fechas y decimales se transmiten como cadenas; no se suman con float en el navegador.

Prefijo: /periods/:periodId. Cada participación concreta, incluido sourceOrdinal, tiene identidad propia. La paginación de documentos es por sourceDate/id; limit predeterminado 25, máximo 100. El historial se ordena por versión descendente.

| Método y ruta | Resultado / entrada adicional |
| --- | --- |
| GET /monthly | Entidad, RFC, año/mes, estado, versión, editor/vencimiento, permisos, contadores, importes y fuentes |
| GET /monthly/items | page/limit; view=all,pending,incidents,excluded,news; direction=issued,received; documentType=I,E,T,P,N; search UUID/RFC/nombre; currency; dateFrom/dateTo; amountFrom/amountTo |
| GET /monthly/items/:participationId/document | Representación CFDI existente, autorizada a través de la participación |
| GET /monthly/decisions/:participationId/history | Últimas 100 versiones inmutables, actor, fecha, comentario y dimensiones |
| GET /monthly/incidents | page/limit, evidencia original y último seguimiento mensual |
| GET /monthly/incidents/:incidentId/history | page/limit, estados, motivos, comentario, responsable y autoría |
| GET /monthly/assignees | Miembros activos con acceso a la cuenta; la escritura verifica además permisos de gestión/nómina |
| GET /monthly/checklist | Comprobaciones automáticas y confirmaciones humanas, evidencia, versión y autor |
| GET /monthly/news | Altas/cambios/bajas contra último cierre, cambios concretos de fuentes/incidencias; nunca comparación sólo por fecha |
| GET /monthly/closes | Últimas 100 versiones, actor, fecha y excepción de fuentes |
| GET /monthly/closes/:version | Snapshot de lectura; participaciones page/limit, resto de evidencia congelada; no devuelve IDs privados de objeto ni hashes |
| GET /monthly/categories | Catálogo opcional de organización, incluidas archivadas |
| GET /monthly/checklist-template | Versión y claves de plantilla vigente para futuros espacios |

Los importes de la mesa describen lo incorporado, incluidas exclusiones; no son una base fiscal. SQL NUMERIC mantiene precisión. Se agrupan por dirección, I/E y moneda, sin compensarlos. P y T no aumentan esos totales. Documentos distintos y participaciones tienen denominadores separados. Nómina se filtra antes de contar, sumar o paginar. La consulta de un cierre del período completo se deniega si el actor no puede ver alguna parte protegida, sin revelar esa parte.

## Autoridad editorial y escrituras

POST /monthly/lease recibe instanceToken aleatorio (32–128 caracteres). Una instancia de edición por período, incluso entre pestañas de la misma sesión. El servidor guarda SHA-256, sesión, membresía y vencimiento; TTL máximo 120 segundos limitado por sesión. GET no crea workspace ni renueva lease. Renovación cada 30 segundos mientras hay actividad editorial; el heartbeat no genera actividad nueva ni incrementa versión de contenido.

POST /monthly/lease/takeover añade motivo y exige periods.takeover, MFA y reautenticación general vigente de 15 minutos. POST /monthly/lease/renew y /release reciben instanceToken y expectedVersion. Un editor desplazado converge al recibir el conflicto o actualizar su estado. No se usan grants de e.firma.

Las escrituras siguientes reciben instanceToken y expectedVersion. La autorización se valida otra vez en servidor. Cambios de contenido incrementan la versión; una versión obsoleta produce 409 y nunca se sobreescribe automáticamente. Closed/changes_detected no permiten decisiones hasta reabrir.

| POST | Contrato y permisos adicionales |
| --- | --- |
| /monthly/decisions/:participationId | decisionVersion; reviewStatus=pending/reviewed; inclusion=included/excluded, exclusionReason; categoryId opcional; taxStatus/vatStatus=pendiente/no_aplica/documentado y notas; comment. cfdi.review; cfdi.exclude al cambiar inclusión/motivo; cfdi.classify al cambiar categoría/tratamiento |
| /monthly/bulk/preview | selection de 1–100 IDs/versiones únicos; action review/unreview/include/exclude/category; reason/categoryId; cfdi.bulk_action y permisos de cada elemento |
| /monthly/bulk/execute | La misma selección/acción + previewId. El servidor compara su hash con la vista previa durable del actor; no reevalúa filtros |
| /monthly/checklist | key humana, itemVersion, confirmed, reason; checklist.complete |
| /monthly/incidents/:incidentId | incidentVersion; state=open/client_clarification/resolved/reviewed_rejection; reason, comment, responsibleMembershipId opcional; incidents.manage |
| /monthly/sources | kind=ingestion/sat, sourceId y motivo; vincula intención al período, no mueve CFDI |
| /monthly/prepare-close | Vista previa consistente; periods.ready; sourceExceptionReason opcional bajo exceptions.accept + MFA/reauth |
| /close | periods.close + MFA/reauth; mismo conjunto preparado, versión y excepción explícita |
| /reopen | periods.reopen + MFA/reauth, motivo obligatorio; conserva todos los cierres |

Idempotency-Key obligatorio (máximo 128) en decisiones, preview/execute, checklist, incidencias, fuentes, cierre y reapertura. Clave contextual a actor/período/operación; fingerprint de contenido estable, excluyendo el estado transitorio del lease. Un replay devuelve el resultado persistido sin aplicar otra vez; sigue exigiendo sesión, scope y permisos. Otro contenido bajo la misma clave se rechaza. Bulk usa savepoint por participación, confirma válidos y devuelve applied/failed + resultados individuales. Se auditan aplicados y denegados; un fallo de infraestructura revierte la transacción completa y puede recuperarse con la misma clave.

POST /monthly/categories y /categories/:categoryId reciben label (1–80), archived y expectedVersion. cfdi.categories.manage se ofrece por defecto sólo al titular real; una concesión explícita sigue las reglas de overrides. cfdi.classify no administra el catálogo. El catálogo comienza vacío. El cambio de nombre no reescribe la etiqueta guardada en decisiones/cierres. Archivar impide asignaciones nuevas, conservando referencias previas.

POST /monthly/checklist-template recibe expectedVersion y keys del catálogo controlado; exige checklist.configure + MFA/reauth. Las siete claves mínimas no pueden retirarse. client_clarifications/professional_review son opcionales. Catálogo y plantilla son configuración de organización con versión propia; no utilizan el lease editorial de un período. Cada workspace instancia la versión al comenzar a editar; cambios futuros no alteran instancias previas.

## Checklist y evidencia

| Clave | Origen | Correspondencia con CONTROL_MENSUAL_CFDI_V3_3 |
| --- | --- | --- |
| documents_reviewed | Sistema | Decisiones de todas las participaciones revisadas, sin inferencias al abrir |
| exclusions_reasoned | Sistema | Exclusiones con motivo |
| sources_settled | Sistema | Cargas/solicitudes relacionadas terminadas; excepción expresa de alcance permitida |
| integrity_resolved | Sistema | Archivos rechazados e incidencias revisados/resueltos; no valida material rechazado |
| relationships_reviewed | Persona, motivo | Cancelaciones, relaciones y advertencias PPD revisadas o justificadas |
| scope_confirmed | Persona, motivo | Fuente/fecha de corte y límites de la revisión, incluido un período vacío |
| snapshot_ready | Sistema | Referencias/hash/políticas presentes y autoridad para formar el conjunto del cierre; no afirma que exista una exportación |

Las condiciones automáticas muestran su evidencia y no inventan actor humano. Tratamiento fiscal/IVA es opcional: documentado requiere nota; no calcula deducibilidad, impuestos o acreditamiento ni bloquea por sí solo el cierre. Pendiente/incluida sin decisión tiene interpretación monthly-decision/1.0.0. Las incidencias mantienen el registro original; el seguimiento mensual es append-only. Integridad no resuelta de un CFDI incorporado no puede levantarse por excepción editorial. Un archivo ajeno/rechazado puede darse por revisado, permaneciendo fuera del dominio CFDI.

## Corte y contrato interno de cierre

monthly-close/1.0.0 congela participaciones completas, ordinal/política/fecha literal/zona, datos mínimos CFDI, decisión y versión (incluido default), categorías y etiquetas, comentarios/tratamientos/motivos, relaciones ordinarias y de pagos observadas, última observación SAT con fuente/fecha, checklist/configuración, incidencias/responsables, fuentes y alcance. La fila de cierre agrega actor, membresía, versión, fecha, fingerprint SHA-256 y motivo de excepción. La evidencia de fuentes pendientes permanece en el snapshot; cerrar no modifica su estado SAT.

Internamente conserva sourceObjectId y SHA-256 del original privado, nunca una copia XML. Éste es el contrato consumible por Fase 6, bajo autorización de alcance completo y payroll.view cuando corresponda; no es un endpoint de exportación ni un grant de descarga. La lista pública elimina las referencias privadas; descargar XML mantiene el contrato MFA de Fase 1.

Las transacciones de mesa usan REPEATABLE READ. Mutaciones/cierre bloquean brevemente la fila de período, y snapshot/preparación se comparan por contenido. INSERT de participación se coordina mediante FK/trigger de período: una llegada queda dentro del corte o invalida listo/marca novedades después. Relaciones, observaciones, fuentes y seguimiento se comparan contra valores congelados, también cuando no existe nuevo CFDI. El estado visible incorpora esas diferencias al consultar y es reconstruible desde PostgreSQL; el snapshot nunca se actualiza. Una transacción iniciada antes del cierre que confirma después también produce novedad.

La preparación no equivale a cierre. Si el conjunto cambia, se rechaza la confirmación y debe prepararse otra vez. Un cierre vacío conserva scope_confirmed explícito y dice “Sin CFDI incorporados”; no acredita ausencia de operaciones. Fuentes activas de la entidad sin alcance aclarado y SAT pendiente/incierto bloquean por defecto. Excepción exige motivo, exceptions.accept, MFA/reauth, y conserva IDs/estados al corte. Un error de integridad o permiso no admite esa excepción.

## Errores y navegador

409: MONTHLY_LEASE_LOST, MONTHLY_VERSION_CONFLICT, MONTHLY_CLOSED, MONTHLY_CLOSE_BLOCKED, MONTHLY_SOURCES_PENDING y conflictos de idempotencia/preview. 400: entrada/selección/página/motivo inválidos. 403: MONTHLY_SCOPE_DENIED; 404: recurso fuera del contexto o inexistente. MFA_REQUIRED/REAUTHENTICATION_REQUIRED reutilizan reautenticación general. Los mensajes públicos son acotados y no muestran SQL ni material fiscal privado.

El navegador recupera por URL/IDs y datos confirmados del servidor; no persiste texto fiscal, archivos ni tokens editoriales en localStorage/IndexedDB. Autosalvado serializa escrituras; salida del panel ofrece guardar/descartar y la salida de navegador advierte sobre pendientes. Revocación, logout y cambio de tenant invalidan la instancia y respuestas tardías. Tras pérdida de lease, un borrador requiere autoridad y versión vigentes, nunca se reaplica automáticamente.
