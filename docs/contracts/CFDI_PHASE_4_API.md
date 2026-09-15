# Contrato API — Fase 4 SAT on-demand
Base real: /api/v1/sat-download-jobs. SessionGuard, TenantAccessGuard, PermissionsGuard y CSRF global para mutaciones. Requiere sat.download y credentials.manage, membresía/entidad vigentes y asignación según regla existente; titular real tenant-wide. Nómina no se ofrece.

| Método/ruta relativa | Contrato |
|---|---|
| POST / | Idempotency-Key obligatorio. legalEntityId, direction issued/received/folio, contentType xml/metadata, documentType I/E/T/P, documentStatus active/cancelled/all, dateFrom/dateTo o folio. 202 con ID durable y enlaces. Recibidos XML requiere active; por folio sólo XML. |
| GET /?legalEntityId=&page=&limit= | Procesos recuperables; orden created_at DESC, id DESC; máximo 100. |
| GET /:id | Estado interno separado de estado/códigos/folio SAT; counters derivados de paquetes/ingestas/observaciones. No entrega tokens, certificados, keys ni URLs firmadas. |
| GET /:id/packages?after=0&limit=50 | Cursor ordinal estable; máximo 100; intentos, incertidumbres, estado, generación/expiración oficial si se conoce. |
| GET /:id/packages/:packageId/items?after=0&limit=50 | Resultados por entrada y enlaces al CFDI existente sólo con cfdi.view; máximo 100. |
| POST /:id/reauth-grants | code TOTP fresco. Rotación de sesión existente; grant contextual máximo 600 segundos, sólo hash durable. no-store. |
| POST /:id/authorizations | Multipart certificate .cer, key .key, password, grant; límites F3 de 16 KiB por archivo/contraseña 1024 bytes y límite total del receptor existente. Idempotency-Key. 202, metadata de custodia y processId. Replay valida fingerprint sin consumir otro grant. |
| POST /:id/retry | Reintento técnico acotado; no resuelve un envío incierto ni crea otra solicitud fiscal. |
| POST /:id/packages/:packageId/retry | Acción explícita. Si existe raíz íntegra, nueva ingesta local; si descarga incierta, respeta presupuesto restante y solicita autorización. No toca CFDI originales. |
| POST /:id/cancel | Cancelación local idempotente. Conserva folios y resultados; no promete cancelación SAT remota. |

Estados: authorization_pending, submitting, waiting_sat, requires_user_authorization, recovering, processing_local, completed, completed_with_issues, cancelled, failed, external_submission_unknown. El frontend consulta automáticamente sólo ejecución activa; espera SAT requiere acción explícita. Recupera por IDs en URL y listado; no persiste archivos, grants, contraseñas, tokens ni object keys.

Errores sanitizados: SAT_DISABLED / SAT_ACTIVATION_NOT_AUTHORIZED (503), SAT_SCOPE_DENIED (403), SAT_NOT_FOUND (404), SAT_FILTER_INVALID / SAT_PAGE_INVALID (400), SAT_IDEMPOTENCY_CONFLICT, SAT_AUTHORIZATION_NOT_ALLOWED, SAT_SUBMISSION_UNRESOLVED, SAT_RETRY_BACKOFF, SAT_RETRY_BUDGET_EXHAUSTED, SAT_PACKAGE_RETRY_NOT_ALLOWED. Incidencias externas: SAT_SUBMISSION_UNCERTAIN, SAT_RESPONSE_CONTRADICTORY, SAT_DOWNLOAD_UNCERTAIN, SAT_DOWNLOAD_BUDGET, SAT_PACKAGE_EXPIRED. Se conserva el código SAT por separado; 5004 no equivale a conjunto vacío.

No existe endpoint público de unwrap, llave, firma o token SAT. Se retiró exclusivamente la ruta preliminar SAT de fiscal-operations; sus otros flujos conservan sus rutas.


## Ajustes del cierre PR25 — 2026-09-15
GET/list/creación incluyen technicalRetry: eligible, allowed, availableAt (ISO8601 o null), remainingAttempts. eligible requiere requires_user_authorization + SAT_TECHNICAL_FAILURE, ausencia de cancelación y presupuesto menor a tres; allowed exige también backoff cumplido. El botón sólo aparece elegible y se habilita con allowed; consultar estado actualiza la elegibilidad. No hay cargo doble del retry.

Modo real_pilot: creación/autorización sólo contentType=xml; metadata retorna SAT_PILOT_XML_ONLY. No se cambia el parser metadata ni se acredita su contrato real. Cancelación y consulta conservan autoridad de aplicación; vencimiento/retiro del permiso operativo del piloto bloquea nuevas custodias/llamadas, sin borrar folios ni resultados. Ningún cliente selecciona modo, confianza, endpoints o autorización operativa.

Paquetes/folio que contienen N producen entrada unsupported/SAT_PAYROLL_UNSUPPORTED sin crear CFDI de nómina. Para resultados heredados N, cfdiId sólo se expone con cfdi.view y payroll.view. Ningún endpoint nuevo entrega el XML o paquete. Errores de validación local no exponen datos del certificado ni del XML.

### Contrato de descarga XML frente a metadata
Documento oficial download.pdf v1.5 (mayo2025), SHA256 8e9de4220d90f91ded80a84d891f9088ec64262e722891b1ef50190c5ccc81f1: cubre SOAP1.1, SOAPAction IDescargaMasivaTercerosService/Descargar, namespace DescargaMasivaTerceros.sat.gob.mx, peticionDescarga con IdPaquete/RfcSolicitante, firma enveloped RSA-SHA1/SHA1 con Reference URI vacío, token WRAP en Authorization y respuesta con CodEstatus en Header y Paquete base64 en Body. La implementación corresponde a esas estructuras. Añade un Transform C14N inclusivo explícito para el digest (el ejemplo sólo muestra enveloped y la canonicalización implícita del node-set); usa canonicalización estándar, validada localmente, todavía sin aceptación SAT real. WSDL vivo de descarga no recuperado: no se volvió a insistir sobre HTTP400 ni se inventó contrato. El PDF basta para preparar este adaptador; no sustituye una prueba interoperable autorizada.

[Consulta y recuperación SAT](https://wwwmatnp.sat.gob.mx/consultas/42968/consulta-y-recuperacion-de-comprobantes-(nuevo)), consultada 2026-09-15, confirma TXT delimitado por tilde y los campos semánticos de metadata. No confirma literalmente los nombres/capitalización/orden del encabezado que exige METADATA_HEADER, incluido FechaCertificacionSat. El manual enlazado no se recuperó por timeout. Se conserva el parser estricto y metadata queda fuera del primer piloto XML, sin eliminar este pendiente global.
