# Esquemas CFDI de Fase 1

Este directorio conserva copias byte por byte de los XSD publicados por el SAT
para CFDI 4.0, Timbre Fiscal Digital 1.1, Pagos 2.0 y Nómina 1.2, junto con sus
catálogos transitivos. `manifest.json` fija URL oficial, fecha de recuperación,
tamaño y SHA-256.

El runtime no descarga ni resuelve recursos de red. El parser endurecido hace
primero el control estructural y de recursos en streaming y después valida los
bytes acotados contra este set con libxml2 en un worker WASM aislado, con
`--nonet`, memoria limitada y filesystem sólo en memoria. Los
`schemaLocation` se resuelven únicamente contra la allowlist del manifiesto.

La copia runtime del esquema raíz importa TFD 1.1, Pagos 2.0 y Nómina 1.2. Su
wildcard de `Complemento` usa `processContents=lax`: valida estrictamente esos
namespaces conocidos y permite conservar un complemento desconocido después de
validar el core, para que el dominio emita `COMPLEMENT_UNSUPPORTED`. Los XSD
oficiales fijados por hash no se modifican. Una actualización oficial crea un
nuevo set versionado y actualiza manifiesto, pruebas y versión de parser.
