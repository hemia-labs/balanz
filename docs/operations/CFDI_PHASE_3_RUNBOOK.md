# Expiración, cleanup y restore de custodia temporal

Alcance actual: sintético/aislado. No habilitar material real. La custodia expira como máximo a los 600 segundos de crear la intención y puede vencer antes por sesión. Ninguna operación renueva ese instante.

## Operación y recuperación

El worker reconcilia lotes de hasta 100 intenciones cada 30 segundos. Leases exclusivos protegen preparación/consumo y cleanup. Una preparación abandonada pasa a `requires_user_authorization`; un claim previo a unwrap puede recuperarse dentro del plazo. Un estado `unwrapping` abandonado nunca se reintenta: requiere nueva autorización. El callback debe comprobar autoridad antes de cada futura operación; no conservar/exportar KeyObject.

Revocar, expirar, cambiar generación o perder autoridad impide nuevo consumo inmediatamente en API/worker. Se marca cleanup durable. Se espera el lease de una transferencia externa acotada y cinco segundos de margen antes de eliminar; nunca se mantiene lock DB durante storage/Vault.

Cleanup elimina exclusivamente objetos referenciados de tipos `credential_certificate` y `credential_private_key`; no toca CFDI ni originales ZIP. Revoca el accessor cuando procede y borra referencias, ciphertext Transit y accessor de la intención al completar. Delete de storage es idempotente. Si Vault no responde, se conserva cleanup pendiente, sin permitir acceso. Tras consumir exitosamente el wrapping token ya no existe; no se exige revocarlo otra vez. Un resultado incierto puede esperar el TTL antes de completar cleanup si el accessor ya desapareció.

Uploads parciales se reservan antes de escribir; reconciliación elimina esos objetos. Un segundo barrido acotado revisa objetos de credencial ya vencidos, incluidos aquellos previamente marcados eliminados, para retirar escrituras tardías que reaparezcan después de una respuesta incierta. Revisa como máximo 100 por lote y vuelve a considerarlos después de cinco minutos. No incluye objetos XML/ZIP. Si se pierde una respuesta de wrapping antes de registrar su accessor, la DEK huérfana no tiene una segunda copia y queda limitada por su TTL; no se rewrappea. Incidentes sólo conservan evidencia sanitizada, no prolongan secretos.

Metadata de intención se elimina 90 días después de estado terminal y cleanup completado; grants sin intención expiran y se purgan tras 90 días. Auditoría global no se modifica. `stored_objects` conserva sus referencias operativas históricas según política existente, sin bytes privados en PostgreSQL.

## Restore obligatorio

1. Mantener capacidad y consumidores desactivados antes/durante restauración de DB, storage o Vault.
2. **Fuera del snapshot restaurado**, reemplazar `EFIRMA_CUSTODY_GENERATION_FILE` por un UUID v4 nuevo. Archivo sólo legible por API/worker, no editable por runtime. No restaurar su versión anterior ni copiarlo desde el backup.
3. Entregar el mismo valor nuevo a ambos perfiles. Toda intención/grant anterior conserva su generación vieja y queda denegada, incluso con TTL vigente o wrapping token recuperado de snapshot.
4. Ejecutar reconciliación en QA autorizado y verificar que no puede consumirse ninguna custodia antigua; documentar IDs/estados sanitizados y valor público de la nueva generación. La prueba externa automatizada ejerce este rechazo.
5. Sólo después permitir nuevos consumidores y nuevas autorizaciones. No hay comando de restore ni modificación de CI en esta entrega.

Si no se puede acreditar que el archivo quedó fuera de snapshots o que se rotó antes de habilitar consumidores, mantener desactivado. La prueba de código demuestra comparación/denegación; no certifica procedimientos humanos ni backups administrados.

## Límites de eliminación y observabilidad

En bucket versionado, `DeleteObject` puede crear un delete marker: **no demuestra borrado de versiones anteriores**. DB/WAL/snapshots Vault también pueden retener ciphertext o secretos envueltos históricos. Para material real se exige política verificable de versiones/retención, restore y aprobación legal-operativa; no se declara borrado físico total.

Auditoría `efirma.grant.issued`, `efirma.custody.*`; códigos seguros en la intención. Métricas sin labels: `efirma_ready_total`, `efirma_consumed_total`, `efirma_expired_total`, `efirma_cleanup_failures_total`. Son observación de procesos; PostgreSQL/auditoría son autoridad durable, no el contador en memoria. No registrar cuerpos multipart, contraseñas, TOTP, grants, tokens, llaves, object keys ni errores crudos de Vault/OpenSSL.
