# ADR-CFDI-006: reautenticación fiscal y custodia temporal

Fecha: 2026-09-09. Diseño técnico autorizado por el solicitante para desarrollo y pruebas sintéticas aisladas. **No constituye revisión independiente de seguridad ni aprobación legal/operativa para credenciales reales.** Esa aprobación permanece pendiente. Capacidad desactivada por defecto; esta entrega sólo permite el perfil `synthetic_v1` en QA local aislado. No implementa Fase 4.

## Reautenticación

El endpoint fiscal siempre llama a `AuthService.reauthenticate`: TOTP fresco, contador antirreutilización, límites de intentos y rotación existentes. El grant se liga al contexto resultante y la cookie rotada se entrega antes de emitirlo. La ventana general de reautenticación de 15 minutos conserva su comportamiento y no permite emitir grants fiscales sin otro TOTP válido.

Cada grant aleatorio de 256 bits se guarda sólo como SHA-256, dura como máximo 600 segundos y nunca sobrevive a la expiración de la sesión. Vincula usuario, sesión, organización, membresía, cuenta, entidad, generación y propósito cerrado `efirma.prepare`. Consumirlo y reservar la intención ocurre en una transacción RLS. Un lock asesor contextual serializa la misma clave de idempotencia; un UPDATE condicional da un único ganador para el grant. No se usa la contraseña ni su hash en fingerprints. El fingerprint incluye hashes del certificado y del archivo de llave ya protegido, identidad, entidad y eventual intención anterior.

La autorización se reconsulta en PostgreSQL: usuario verificado/activo, sesión activa/MFA/TTL/idle, membresía/organización activas, cuenta/entidad activas, permiso efectivo `credentials.manage`, overrides y asignación activa salvo titular real. Un trigger invalida grants y custodias al rotar token, cambiar tenant/membresía o revocar la sesión. La eliminación de una sesión elimina su referencia y deniega nuevos usos.

## Material y persistencia

| Material | Ubicación y protección | Vida y eliminación |
|---|---|---|
| Contraseña de la llave | Memoria de recepción/validación; distinta de la contraseña de Hemia y del TOTP | No DB, Redis, Vault, archivos ni fingerprint. Buffers se sobrescriben best-effort; strings y KeyObject dependen de GC. No se promete borrado físico perfecto. |
| Llave abierta | KeyObject/buffer en memoria | Sólo validación o callback interno; referencias descartadas y buffers sobrescritos. |
| Llave en custodia | `stored_objects`, tipo `credential_private_key`, cifrada AES-256-GCM con DEK aleatoria por intención, nonce nuevo y SSE del storage | Plazo absoluto máximo 10 minutos; cleanup tras consumo/revocación/expiración/fallo. |
| DEK | Memoria y respuesta envuelta de Vault | Un unwrap, sin rewrap/renovación ni segunda copia cifrada con una clave permanente. TTL restante con margen del timeout de llamada. |
| Wrapping token | Memoria; persistencia sólo cifrada por Transit en `wrapped_token_ciphertext` | Nunca navegador/Redis. Se retira de metadata al completar cleanup. Accessor mínimo para revocación. |
| Certificado | Storage privado `credential_certificate`, SSE | Misma ventana y cleanup; no endpoint genérico de descarga. |
| Metadata | Columnas tipadas PostgreSQL | 90 días desde estado terminal; sin blobs/tokens/DEK tras cleanup. Auditoría sigue su política existente. |

El envelope binario es versión 1, nonce de 12 bytes, tag de 16 bytes y ciphertext. AAD canónica liga versión, organización, entidad, intención, propósito, vencimiento y generación. Descifrar con otro contexto o bytes alterados falla. La capa extra GCM no sustituye SSE ni el bucket privado.

**Existe persistencia temporal cifrada.** DB/WAL, backups, versiones del bucket o snapshots de Vault pueden conservar material histórico cifrado y respuestas envueltas. Expirar el acceso no significa borrar físicamente todas esas copias. No se afirma “cero material privado en backups”. Se acepta esta limitación únicamente para desarrollo sintético; credenciales reales requieren decisión legal/operativa y prueba de retención/eliminación, incluidas versiones de objetos.

## Validación de certificados: límite explícito

Se reutiliza `node:crypto` para verificación de firma/cadena, vigencia, RSA 2048–4096, apertura PKCS8 protegida, correspondencia de llave y cifrado. La dependencia `@peculiar/x509` 2.1.0 fue autorizada explícitamente por el usuario: lee atributos/extensiones/algoritmos estructurados y genera fixtures en memoria con WebCrypto. Es compatible con Node >=20, sin cambiar runtime. Parsing limitado a profundidad 16, 512 nodos y 16 KiB; extensiones críticas desconocidas o duplicadas se rechazan. No se implementa ASN.1 ni criptografía propia, no se necesita OpenSSL externo y no se crean archivos temporales con material privado.

`synthetic_v1` es un perfil **de QA, no un perfil SAT**. La raíz y hashes de archivos PKCS8 sintéticos se registran en un manifiesto del servidor. Esto limita también el costo KDF antes de abrir PKCS8 arbitrario. Los certificados deben verificar su cadena contra esa raíz, RSA/SHA-256, basicConstraints, digitalSignature y EKU clientAuth. El RFC ocupa `serialNumber` estructurado y la OU identifica el fixture sintético; estas reglas **no se atribuyen al SAT**. Sólo se admiten fixtures registrados fuera de las peticiones, en entorno test con DB y Vault locales. El cliente no puede seleccionar perfil o raíces. Para aceptar llaves arbitrarias reales será necesario un perfil acotado de PKCS8/KDF además del perfil SAT y las aprobaciones indicadas abajo.

Resultado: `local_validation_passed`, `revocation_status: unknown`. Nunca se consultan CRL, OCSP ni URLs de certificados. Quedan bloqueados para credenciales reales: perfil SAT versionado y sustentado de atributos/RFC, algoritmos/extensiones, cadena/raíces confiables y distinción e.firma/CSD. Los documentos SAT consultados distinguen los trámites, pero no sustentan por sí solos todos esos criterios criptográficos; no se inventan OID.

Fuentes: [Node 20 crypto/X509Certificate](https://nodejs.org/docs/latest-v20.x/api/crypto.html#class-x509certificate), [RFC 5280](https://www.rfc-editor.org/rfc/rfc5280), [trámite SAT e.firma](https://www.sat.gob.mx/gobmx/Paginas/ficha_105_cff.html), [trámite SAT CSD](https://www.sat.gob.mx/gobmx/Paginas/ficha_108_cff.html), [Vault wrapping](https://developer.hashicorp.com/vault/api-docs/system/wrapping-wrap), [unwrap](https://developer.hashicorp.com/vault/api-docs/system/wrapping-unwrap), [Transit](https://developer.hashicorp.com/vault/api-docs/secret/transit).

## Consumo, recuperación y restore

`EfirmaConsumerService.withCredential` es un puerto interno del worker con callback que no devuelve material. No hay endpoint de unwrap/firma/llave y no se conecta a `POST /sat-download-jobs`. `efirma.prepare` no autoriza operaciones SAT futuras.

Estados: `preparing → ready → claimed → unwrapping → consumed`; terminales alternativos `revoked`, `expired`, `failed`, `requires_user_authorization`. Antes de unwrap un claim vencido se puede reclamar conservando autoridad/plazo. `unwrapping` se persiste antes de llamar a Vault; caída o resultado incierto pasa a nueva autorización, nunca repite unwrap a ciegas. Perder recepción/preparación también requiere nueva entrega porque la contraseña no se conserva. La nueva intención usa nuevo grant y puede referenciar la anterior. Ningún retry renueva el vencimiento.

Se comprueban autoridad, generación, claim, lease y expiración antes de operaciones criptográficas y publicación final. Revocación impide nuevos usos; no deshace operaciones ya realizadas. PostgreSQL/Vault/storage no son una transacción distribuida: reservas, leases de 30 segundos, compensación y reconciliación sustituyen locks largos. Una creación envuelta cuya respuesta se pierde queda limitada por TTL absoluto, aunque no se conozca su accessor.

La generación se lee en cada operación desde un archivo externo al conjunto de snapshots de custodia. Restore exige detener consumidores, rotar ese UUID fuera del backup, reconciliar y sólo entonces habilitar. API/worker deniegan generaciones distintas o archivo inaccesible. El procedimiento y evidencia operativa están en el [runbook](../../operations/CFDI_PHASE_3_RUNBOOK.md).
