# API de reautenticación y custodia temporal — Fase 3

Prefijo normal `/api/v1`. Sólo QA sintético explícito; por defecto `EFIRMA_DISABLED` (503). No habilita e.firmas reales ni SAT. Todas las rutas requieren sesión, tenant, `credentials.manage` y scope. Mutaciones protegidas por CSRF existente (origen/referer permitido). Respuestas `Cache-Control: no-store`.

| Método/ruta | Entrada | Salida |
|---|---|---|
| POST `/legal-entities/:id/reauth-grants` | JSON `{code: "123456"}`; TOTP fresco | 201 `{grant, expiresAt, purpose: "efirma.prepare"}`; cookie rotada. El grant vive sólo en memoria del navegador. |
| POST `/legal-entities/:id/efirma-sessions` | `Idempotency-Key` de 8–128 caracteres `[A-Za-z0-9._:-]`; multipart `certificate` (.cer), `key` (.key), `password`, `grant`, `replacesId` opcional | 202 DTO durable después de preparación. Replay contextual retorna la misma intención, sin consumir otro grant. |
| GET `/legal-entities/:id/efirma-sessions/:sessionId` | IDs UUID | 200 estado autorizado; aplica expiración/generación/sesión. |
| POST `/legal-entities/:id/efirma-sessions/:sessionId/revoke` | Sin secreto/cuerpo requerido | 200 estado terminal, idempotente. Revocación durable inmediata; cleanup puede estar pendiente. |

Cada archivo: 1–16,384 bytes; certificado DER y llave PKCS8 DER protegida. Password: 1–1,024 bytes UTF-8. Recepción multipart total hasta 40,000 bytes, dos archivos y tres campos; duplicados, partes adicionales, extensión incorrecta y truncamiento rechazados. Procesamiento acotado en memoria; no disco temporal, URLs de cliente ni upload firmado para credenciales.

DTO: `id`, `legalEntityId`, `status`, `createdAt`, `expiresAt`, `localValidation` (`local_validation_passed`/`not_passed`), `revocationStatus: unknown`, `synthetic: true`, `errorCode`, `cleanup` (`pending`/`completed`). No contraseña, llave, wrapping token, ciphertext Transit ni object key. Recuperación del navegador por `entityId`/`custodyId` en URL, nunca por secretos almacenados.

Vencimiento: grant y custodia tienen cada uno máximo 600 segundos; ambos limitados por la sesión. Crear custodia no extiende la sesión. Polling, errores, verificaciones y retry no cambian la fecha. Otra entrega requiere TOTP/grant nuevos, clave idempotente nueva y opcional `replacesId` terminal. No hay retry automático que recupere una contraseña.

| Error seguro | HTTP | Acción |
|---|---|---|
| `EFIRMA_DISABLED`, `EFIRMA_DEPENDENCY_UNAVAILABLE` | 503 | Habilitar sólo configuración QA autorizada/reparar dependencia. Sin fallback. |
| `EFIRMA_INPUT_INVALID`, `EFIRMA_IDEMPOTENCY_KEY_REQUIRED` | 400 | Corregir entrada acotada. |
| `EFIRMA_SCOPE_DENIED`, `EFIRMA_GRANT_INVALID`, `EFIRMA_FRESH_TOTP_REQUIRED` | 403 | Revisar autoridad y solicitar TOTP/grant nuevo. |
| `EFIRMA_NOT_FOUND` | 404 | Recurso ausente o fuera de contexto. |
| `EFIRMA_IDEMPOTENCY_CONFLICT`, `EFIRMA_REPLACEMENT_INVALID`, `EFIRMA_AUTHORIZATION_LOST` | 409 | No reutilizar intención con otro contexto/contenido. |
| `EFIRMA_CERTIFICATE_PROFILE_REJECTED`, `EFIRMA_RFC_MISMATCH`, `EFIRMA_CERTIFICATE_EXPIRED`, `EFIRMA_KEY_PASSWORD_INVALID`, `EFIRMA_KEY_MISMATCH` | 422 | Validación local falló; nueva entrega autorizada. |

Fallos tras reservar intención convergen a `requires_user_authorization` y cleanup durable; el error incluye únicamente `details.efirmaSessionId` y `details.legalEntityId` para recuperar ese estado y relacionar una nueva autorización. Si se pierde la respuesta antes de conocer el ID, el cliente no conserva material ni intenta reconstruirlo: solicita otra autorización; la intención huérfana converge por lease/TTL. El puerto interno distingue `EFIRMA_NOT_CONSUMABLE` y `EFIRMA_REQUIRES_USER_AUTHORIZATION`; no se expone como endpoint público.

Auditoría: emisión de grant, admisión, preparación, fallo, consumo, revocación, expiración y cleanup. Metadata de eventos vacía/sanitizada; códigos operativos tipados en intención. Grants XML de descarga permanecen separados.
