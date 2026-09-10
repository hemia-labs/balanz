# ADR-CFDI-007 — Proceso SAT durable y autorización acotada
Fecha: 2026-09-10. Implementación y pruebas sintéticas autorizadas por el solicitante. Sin aprobación legal/operativa para e.firmas reales ni aceptación SAT real.

## Decisión
PostgreSQL conserva proceso, solicitud, folio, intentos y paquetes. La vida del proceso no depende del TTL de una custodia. Redis no es autoridad. Un worker del release existente reclama un proceso con token, vencimiento y fence; publica resultados sólo mientras conserva autoridad. Ninguna transacción SQL permanece abierta durante red.

Una custodia v2 vincula organización, entidad, intención, propósito, vencimiento, generación externa, usuario, membresía, sesión, proceso y versión de filtros. Propósitos cerrados: sat.submit (autenticación y envío) y sat.recover (verificación y recuperación). efirma.prepare y envelopes v1 conservan su semántica. TOTP fresco rota la sesión antes de emitir el grant. Contraseña sólo en memoria; AES-GCM + DEK one-time en Vault wrapping, token de wrapping cifrado con Transit. No se almacena token SAT. Una autorización puede efectuar varias llamadas acotadas; cada llamada vuelve a comprobar sesión, permiso, asignación, cancelación, plazo y fence.

El envío se registra como sending antes de la llamada. Pérdida de respuesta o caída con sending convergen a external_submission_unknown; no se reenvía. No hay reconciliación oficial por clave idempotente propia ni resolución automática inventada. Se conserva evidencia sanitizada y requiere resolución explícita fuera del envío automático. Otra solicitud fiscal requiere nueva identidad y acción del usuario.

La espera normal termina la operación de custodia; waiting_sat explica que otra consulta requiere autorización. La nueva autorización continúa el mismo proceso. Errores técnicos tienen presupuesto de tres y backoff; la espera y la entrega de una nueva autorización no consumen ese presupuesto. Pérdida de la DEK después de unwrap requiere nueva autorización, sin prolongar secretos. La revocación impide nuevas llamadas; no deshace una llamada ya realizada.

Cada intento de descarga se registra antes de red. Máximo dos por paquete; una respuesta incierta cuenta y no se repite automáticamente. Un objeto completo e íntegro permite continuar localmente sin e.firma. Los paquetes tienen ingestas sat_package, upload_id NULL y objetos raíz reales. Éxito parcial por paquete y por archivo, parser y dominio CFDI compartidos. Metadata son observaciones tipadas; no produce CFDI sin XML.

## Consecuencias y límites
SOAP/base64 se decodifica incrementalmente hacia storage con backpressure; la marca de integridad se publica sólo después de validar el SOAP completo. RSA-SHA1/SHA1 se limita a XMLDSig SAT; SHA-256 de objetos y AES-GCM no cambian. El perfil manual ZIP no se amplía.

Los endpoints reales están implementados con allowlist exacta HTTPS. La composición runtime permite únicamente SAT controlado en QA aislado en esta entrega. La capacidad permanece desactivada por defecto y en ambientes administrados. No se ha utilizado ninguna e.firma real.

La extensión sat_efirma_v1 implementa comprobación offline y preflight PKCS8, pero no incluye una generación SAT real aprobada ni trust bundle operativo. Véase CFDI_SAT_CERTIFICATE_PROFILE.md. No se declara compatibilidad con credenciales SAT arbitrarias.

Persistencia cifrada temporal, WAL, backups, versiones de storage y snapshots Vault conservan las limitaciones del ADR-CFDI-006. Expirar acceso no equivale a borrar físicamente copias. Restore exige rotar generación externa antes de habilitar consumidores. Las aprobaciones sobre custodia, retención/versionado, backups y restore siguen pendientes.
