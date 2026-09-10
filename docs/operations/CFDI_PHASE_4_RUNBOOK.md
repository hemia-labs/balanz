# Runbook Fase 4
## Continuidad
waiting_sat no programa llamadas firmadas ilimitadas. Solicitar nueva autorización del mismo ID para consultar; no cambia filtros ni folio. requires_user_authorization conserva paquetes. Revocación de sesión/membresía/permiso/asignación o generación impide nuevas llamadas. Procesamiento local de paquetes completos no requiere clave por XML.

external_submission_unknown congela envío automático. Investigar evidencia sanitizada; si no existe folio acreditado no inferirlo de un código de duplicidad ni reenviar. Nueva solicitud fiscal requiere acción explícita con nueva identidad. No hay endpoint que acepte un folio arbitrario como reconciliación.

Descarga incierta consume un intento. Máximo dos; retry de paquete requiere acción explícita y autorización si aún hay bytes por recuperar. Si ya está íntegro, reprocesar localmente sin descargar. Lo completado no se repite automáticamente. Caducidad oficial 72 horas desde generación publicada; cuando esa hora es desconocida, generated_at y official_expires_at permanecen NULL. first_observed_at es observación, no hora de generación.

## Cleanup
Custodia: mismas reglas ADR006, máximo diez minutos, cleanup al consumir/revocar/expirar/fallar. Se eliminan referencias secretas y objetos mediante reconciliación; metadata mínima F3 90 días. No se prolonga por incidente ni retry. Contraseña y token SAT sólo memoria, limpieza best effort, no promesa de borrado físico de heap.

Raíz SAT: ventana técnica 30 días; se conserva mientras proceso/ingesta esté activo, haya incidente abierto, malware o hold. Objetos pending_upload huérfanos son candidatos después de una hora; se aborta multipart y elimina mediante cleanup durable, idempotente. Sólo se marca deleted después de borrar en storage. claim_sat_cleanup y claim_zip_cleanup reclaman objetos elegibles; el worker existente procesa los candidatos. Antes de retry local se bloquea objeto y se comprueba que no esté en cleanup/infectado. XML extraído incorporado como original CFDI queda protegido por su referencia; otros extraídos siguen la retención y cleanup ZIP compartidos. Objetos de credenciales nunca entran al cleanup SAT.

Cancelación solicita convergencia local, impide llamadas nuevas y cancela ingestas activas, preservando CFDI ya incorporados. Raíces completas conservan ventana de retención; parciales se reconcilian. Si storage versionado deja copias históricas, registrar el requisito operativo y no declarar borrado de todas las versiones.

## Restore y operación
Antes de reiniciar consumidores tras restore: desactivar capacidad, rotar generación externa fuera del snapshot, comprobar que custodias con generación previa son rechazadas, reconciliar secretos/objetos, sólo después habilitar QA autorizado. La autorización para credenciales reales sigue pendiente. No restaurar una contraseña ni renovar wrapping para rescatar un retry.

Auditoría guarda admisión/acción de usuario y transiciones durables, IDs técnicos y códigos sanitizados; no cuerpos SOAP/XML, certificados completos, tokens ni keys. Métrica sat_external_calls_total tiene operación cerrada; métricas ZIP registran escaneo/extracción/bytes/resultados compartidos. Consultar errores y counters durables antes de autorizar retry, nunca editar filas para simular éxito.

El retry técnico no vuelve a descontar el intento que ya falló: exige presupuesto restante y backoff cumplido, y luego nueva autorización. El reprocesamiento local tiene máximo 10 intentos explícitos por paquete y conserva las ingestas terminales anteriores. Un objeto pendiente de escritura abandonado por más de una hora puede limpiarse cuando no conserva un lease activo; no se elimina un paquete íntegro necesario por un proceso pendiente.
