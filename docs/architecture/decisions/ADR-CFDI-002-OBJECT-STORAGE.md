# ADR-CFDI-002: almacenamiento privado de objetos originales

- Estado: `ACCEPTED`
- Fecha: 2026-08-28
- Alcance: Fase 0, reutilizable por Fases 1–8

## Contexto

Los originales fiscales y artefactos derivados no deben almacenarse en
`public`, en la base de datos ni en paths construidos con RFC, razón social,
nombre de cliente o filename. La plataforma necesita streaming, integridad,
retención, operación local reproducible y un adapter productivo real.

## Decisión

El dominio depende de `ObjectStoragePort`, no de un SDK específico. Fase 0
implementa dos adapters:

1. `LocalFilesystemObjectStorageAdapter`, permitido sólo fuera de producción,
   en una raíz privada fuera de `public`, con permisos mínimos, keys opacas,
   defensa contra traversal, escritura/lectura por stream, hash SHA-256 y
   tamaño calculados durante el flujo.
2. `S3ObjectStorageAdapter`, compatible con S3/MinIO, bucket privado, sin ACL
   pública, acceso por credenciales de mínimo privilegio, SSE-KMS configurable
   y URLs firmadas de duración corta sólo cuando una capacidad autorizada las
   requiera. Cada `PutObject` y `CompleteMultipartUpload` usa la precondición
   atómica `If-None-Match: *`; una colisión devuelve
   `OBJECT_STORAGE_CONFLICT` y nunca reemplaza bytes existentes. La policy del
   bucket productivo debe exigir esa cabecera para las escrituras de objetos.

El Compose de desarrollo usa la cuenta root de MinIO sólo durante bootstrap y
entrega al adapter una identidad distinta con policy limitada al bucket de QA;
no reutiliza credenciales administrativas en las pruebas S3.

En POSIX el adapter fija y verifica `0700` en directorios y `0600` en archivos;
cualquier fallo aborta. En Windows, donde [Node.js no implementa la distinción
owner/group/other de `chmod`](https://nodejs.org/api/fs.html#file-modes), falla
cerrado salvo que desarrollo/test declare explícitamente una
raíz NTFS ya existente y preasegurada cuyos hijos heredan la DACL. Esa
atestación exige el marcador creado por el preflight versionado, usa una ruta
absoluta estable desde la raíz del repositorio y está prohibida en producción;
sin el control externo se usa S3/MinIO.

La base conserva metadatos, scope, estado, hash, tamaño, media type declarado y
detectado, versión del adapter y la key opaca. Los bytes son inmutables una vez
confirmados. Un reemplazo crea un objeto nuevo; nunca muta el original. La
operación DB+storage no se finge atómica: estados intermedios y reconciliadores
idempotentes corrigen objetos huérfanos, filas sin objeto y expiraciones.

Producción falla al iniciar si selecciona filesystem, si faltan bucket/region
o si una política obligatoria de cifrado no está configurada. La identidad se
entrega mediante credenciales explícitas o la cadena estándar de workload del
SDK; su inaccesibilidad deja readiness en `down`. El bucket no se crea
implícitamente en producción. El probe S3 usa una key opaca efímera y comprueba
`PutObject`, metadata/cifrado, `GetObject` y `DeleteObject`; intenta cleanup aun
si una respuesta de escritura queda ambigua.

## Alternativas rechazadas

- `bytea` en PostgreSQL: aumenta backups, WAL y contención sin aportar valor.
- Filesystem compartido en producción: carece de durabilidad y controles
  portables suficientes.
- Paths semánticos: filtran datos y favorecen traversal/colisiones.
- Bucket u objetos públicos: contradicen el carácter fiscal de los archivos.
- Guardar primero en DB y asumir transacción distribuida: oculta split-brain.

## Consecuencias

Los consumidores deben usar streams y verificar hash/tamaño. El ciclo de vida
requiere estados explícitos, limpieza segura, métricas y runbook. Las URLs
firmadas son credenciales temporales y nunca se registran en logs. MinIO es la
prueba de compatibilidad de desarrollo; no convierte extensiones particulares
de MinIO en contrato del port.

## Controles y pruebas

- Round-trip por stream y archivos mayores al buffer habitual.
- Hash y tamaño independientes coinciden.
- Keys opacas no contienen filename, RFC ni datos de tenant.
- Traversal y escape de raíz fallan cerrado.
- MinIO real prueba put/get/head/delete y URL firmada breve.
- Dos escrituras concurrentes —incluido multipart— a la misma key dejan
  exactamente un ganador y preservan sus bytes.
- Bucket privado, sin ACL pública y configuración SSE-KMS validada.
- Falla inyectada entre storage y DB converge por reconciliación.
- Objetos de prueba se eliminan al terminar.

## Límite de fase

Fase 0 entrega la plataforma y sus pruebas con bytes sintéticos no fiscales. No
expone endpoint de carga XML, listado, detalle ni descarga de CFDI.
