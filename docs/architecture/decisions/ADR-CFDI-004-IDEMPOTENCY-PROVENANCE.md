# ADR-CFDI-004: idempotencia específica y procedencia inmutable

- Estado: `ACCEPTED`
- Fecha: 2026-08-28
- Alcance: plataforma de ingesta desde Fase 0
- Implementación XML: Fase 1 `IN_PROGRESS`

## Contexto

Clientes, proxies y workers pueden repetir una solicitud. La misma key puede
llegar concurrentemente, o reutilizarse con contenido/alcance distintos. A la
vez, la plataforma debe explicar qué bytes originaron cada proceso sin
confundir reintento técnico, duplicado fiscal y reemplazo del original.

## Decisión

La idempotencia pertenece a la operación de ingesta, no a un ledger genérico.
La fila durable conserva, como mínimo:

- `organization_id`, `client_account_id` y `legal_entity_id`;
- operación/version contractual;
- `idempotency_key` opaca y acotada;
- `request_fingerprint` canónico y versionado;
- referencia al upload/job resultante;
- estado, timestamps, correlación y versión optimista.

Una constraint única cubre el scope y operación aprobados. La creación ocurre
en una sola transacción: la primera solicitud gana; una repetición con el mismo
fingerprint devuelve el mismo resultado durable; la misma key con fingerprint
distinto devuelve `IDEMPOTENCY_CONFLICT` sin revelar datos de la solicitud
original. La comparación no depende de filename ni de orden JSON accidental.

En el upload XML manual, la recepción larga no conserva una conexión ni un
advisory lock de sesión de PostgreSQL mientras fluye el multipart. La fila de
`ingestion_uploads` cerca al receptor mediante estado, versión y actividad
durable; heartbeats optimistas permiten recuperar un receptor abandonado sin
crear otra intención. Un replay confirmado vuelve a calcular el hash/tamaño de
la solicitud, y la recuperación de una caída posterior al `put` reabre el
objeto privado y verifica sus bytes antes de confirmar. Así, unos bytes nuevos
nunca pueden quedar asociados a la metadata de un objeto anterior.

Cada `stored_object` tiene key opaca, hash y tamaño. Upload, job e item conservan
FKs compuestas y referencias al objeto observado. Un objeto confirmado es
inmutable. Los reintentos apuntan al intento/origen anterior mediante relaciones
explícitas; no sobrescriben procedencia ni reinician `attempt_count`. El dedupe
fiscal por UUID/hash de Fase 1 es una decisión separada y no reemplaza la
idempotencia HTTP/plataforma.

Los fingerprints e idempotency keys se consideran metadatos sensibles: logs y
métricas usan IDs técnicos/correlación, no sus valores completos.

## Alternativas rechazadas

- Tabla genérica global de idempotencia: desacopla scope y lifecycle de la
  operación real.
- Buscar por filename: no es identidad ni es seguro.
- Deduplicar sólo por hash: no representa intención ni respuesta contractual.
- `SELECT` seguido de `INSERT` sin unique: falla bajo concurrencia.
- Reutilizar el mismo job para fingerprint distinto: mezcla procedencia.
- Sobrescribir el objeto original: destruye evidencia.

## Consecuencias

La canonicalización y su versión forman parte del contrato. Cambiar campos del
fingerprint requiere compatibilidad explícita. Las constraints resuelven la
carrera y el servicio debe traducir su resultado establemente. La retención
debe conservar la evidencia necesaria o expirar key y objeto mediante una
política coordinada y auditable.

## Controles y pruebas

- Dos requests concurrentes con misma key/fingerprint producen un solo efecto.
- El replay retorna las mismas referencias y no crea job/objeto extra.
- Misma key/fingerprint diferente produce `IDEMPOTENCY_CONFLICT`.
- Scope de otro tenant no colisiona ni revela existencia.
- Retry, cancelación y reconciliación preservan origen y correlación.
- Hash/tamaño se verifican antes de marcar objeto disponible.
- No aparecen keys, fingerprints completos ni datos fiscales en logs/métricas.

## Evolución por fase

Fase 0 implementó estructura e invariantes con datos sintéticos. Fase 1 activa
la llave del endpoint XML, canonicalización `manual_xml_upload_v1`, admisión
concurrente y dedupe UUID/hash, conservando upload, objeto, job e item como
observaciones inmutables. ZIP y otras operaciones definirán fingerprints
propios en su fase.
