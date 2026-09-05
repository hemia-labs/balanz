# ADR-CFDI-005: frontera segura del parser XML CFDI

- Estado: `ACCEPTED` (decisión de diseño)
- Fecha: 2026-08-28
- Implementación: Fase 1 `IN_PROGRESS`

## Contexto

XML y ZIP son entradas hostiles. Entidades externas, DTD, expansión, esquemas
remotos, profundidad, tamaño, complementos inesperados y errores del parser
pueden producir SSRF, lectura local, DoS o aceptación fiscal incorrecta. Aunque
Fase 0 no parsea CFDI, el límite debe quedar decidido antes de construir la
plataforma que lo ejecutará.

## Decisión

El parser es un adapter aislado detrás de un port explícito. Recibe
un stream/objeto ya almacenado y escaneado; nunca una URL proporcionada por el
usuario. Se configurará con:

- red, DTD, entidades externas y resolución de recursos externos deshabilitadas;
- sin XInclude ni transformaciones que ejecuten código;
- límites duros de bytes, nodos, profundidad, atributos, texto, tiempo y memoria;
- decodificación y encoding permitidos explícitamente;
- XSD/catálogos locales, versionados y con SHA-256 fijado;
- allowlist exacta de CFDI 4.0, tipos `I/E/T/N/P` y complementos aprobados;
- namespaces validados por URI, nunca sólo por prefijo;
- normalización/canonicalización definida para hashes derivados sin alterar el
  hash de los bytes originales;
- resultado tipado, códigos estables y ninguna excepción cruda hacia API;
- ejecución sin shell, con permisos mínimos, sin filesystem arbitrario ni
  secretos.

El flujo será: objeto confirmado → scanner limpio → parser endurecido →
validación semántica → persistencia transaccional. Scanner limpio no implica
XML seguro; ambos controles son obligatorios. Un rechazo conserva evidencia y
procedencia según retención, pero no persiste un dominio CFDI parcial como si
fuera válido.

## Alternativas rechazadas

- Parser DOM con defaults: límites y resolución pueden ser inseguros.
- Validar contra XSD descargado en runtime: introduce red y supply chain.
- Regex sobre XML: no implementa correctamente namespaces ni estructura.
- Aceptar cualquier complemento y guardar JSON opaco: oculta semántica y
  controles de producto.
- Confiar sólo en ClamAV: no cubre ataques propios de XML.
- Parsear dentro del request HTTP: no es durable ni aislable.

## Consecuencias

Los esquemas/catálogos son dependencias versionadas con manifest y revisión de
procedencia. La allowlist obliga a tratar una versión raíz o una versión
desconocida de un complemento soportado como `CFDI_VERSION_UNSUPPORTED` o
`COMPLEMENT_UNSUPPORTED`, no como éxito silencioso. Un namespace de complemento
desconocido conserva el core CFDI 4.0 y produce un incidente
`COMPLEMENT_UNSUPPORTED`, sin inventar campos. Las métricas sólo usan
versión/tipo/código acotados; nunca RFC, UUID fiscal, nombre o contenido XML.

## Criterios de entrada de Fase 1

- Desarrollo de Fase 0 `ACCEPTED`, autorización explícita de Fase 1 y gates de
  release todavía obligatorios antes de merge/despliegue.
- Librería elegida demuestra controles de red/DTD/entities/limits.
- Corpus oficial y sintético, XSD/catálogos y hashes registrados.
- Threat model revisado y presupuesto de recursos medido.

## Pruebas obligatorias de Fase 1

XML válido; malformed; DTD/XXE; external schema; entity expansion; profundidad,
tamaño y atributos extremos; encoding inválido; namespace engañoso; versión y
complemento no soportados; timeout/memoria; reinicio y replay; logs redactados.

## Límite histórico de Fase 0

Este ADR fue el único entregable del parser en Fase 0. La autorización expresa
de Fase 1 habilita ahora dependencia, handler, endpoints, dominio y fixtures
sintéticos exclusivamente para XML individual; ZIP y fases posteriores
permanecen fuera de alcance.
