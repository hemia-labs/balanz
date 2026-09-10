# Perfil sat_efirma_v1 y PKCS8
Estado: implementación offline disponible; habilitación real bloqueada. synthetic_v1 conserva su manifiesto de fixtures. La selección es exclusivamente EFIRMA_CERTIFICATE_PROFILE del servidor y sólo dentro de QA aislado. No se incluye trust bundle SAT ni se transforma el manifiesto sintético en confianza real.

## Controles implementados
DER máximo 16 KiB, profundidad 16, 512 nodos, consumo completo y consistencia de recodificación mediante asn1js/PKIjs. node:crypto abre PKCS8 protegido y comprueba la llave contra el certificado. Cadena offline con PKIjs, raíces CA autofirmadas, firma del emisor, vigencia de todos los certificados, RSA de 2048/3072/4096 bits para titular, firma de certificado SHA-256/RSA, BasicConstraints no CA, KeyUsage digitalSignature y exacto del perfil, extensiones críticas permitidas sin duplicados. No se consulta AIA/OCSP/CRL.

El registro de generaciones exige versión, fingerprint del emisor, política positiva e.firma, KeyUsage, extensiones críticas y evidencia oficial. Certificados CSD/perfiles desconocidos no tienen regla positiva y se rechazan. Bundle limitado a 256 KiB, 8 raíces, 8 intermedios y 16 reglas; cada DER lleva SHA-256 y fuente oficial verificable. Una URL con nombre de emisor no establece confianza: además se requiere hash, cadena, firma y política de generación. La publicación y revisión externa del bundle siguen pendientes.

RFC: se exige un uniqueIdentifier X.500 2.5.4.45 exactamente igual a la entidad. El [perfil DOF](https://dof.gob.mx/nota_detalle_popup.php?codigo=5457756) documenta ese atributo y SHA-256/RSA; esto no prueba que todas las generaciones SAT usen esa representación. Representantes/formatos compuestos se rechazan hasta contar con sustento. No hay OID e.firma/CSD inventado ni política real precargada. Faltan fuentes primarias por generación, raíces/intermedios verificables, reglas positivas e.firma frente a CSD y muestras públicas legítimas de cada variante.

## Preflight de llave protegida
Sólo PBES2/PBKDF2/AES-256-CBC, HMAC-SHA1 por defecto o HMAC-SHA256, sal primitiva 8–64 bytes, IV primitivo 16 bytes, longitud derivada ausente o 32, ciphertext no vacío múltiplo de 16. Iteraciones 1–200,000; máximo dos aperturas admitidas concurrentemente por proceso. Se valida antes del trabajo OpenSSL. Se rechazan PBES1/3DES, scrypt, otros PRF/cifrados, ASN.1 truncado/trailing y presupuestos mayores; no se habilita proveedor legacy global.

Medición sintética focalizada: Node v24.19.0, tres muestras por PRF, 200,000 iteraciones y 32 bytes derivados: máximo observado SHA1 48 ms, SHA256 32 ms. Es presupuesto Hemia, no límite SAT ni garantía universal de latencia. Requiere verificar capacidad del host antes de habilitar; la concurrencia se limita, sin cola infinita. No se cambió runtime.

Resultado local_validation_passed y revocation_status unknown. Ninguna prueba sintética demuestra no revocación ni aceptación SAT real. Firmas XMLDSig SAT RSA-SHA1 son compatibilidad de ese adaptador, no confianza de certificados ni algoritmo de custodia.

Dependencias autorizadas exactas: pkijs 3.4.0 (BSD-3-Clause), asn1js 3.0.10 (BSD-3-Clause), xml-crypto 6.1.2 (MIT), sax 1.6.1 (BlueOak-1.0.0). Versiones en bun.lock, runtime existente compatible. xml-crypto 6.1.2 supera los parches 6.0.1 de [GHSA-x3m8-899r-f7c3](https://github.com/node-saml/xml-crypto/security/advisories/GHSA-x3m8-899r-f7c3) y [GHSA-9p8x-f768-wp2g](https://github.com/node-saml/xml-crypto/security/advisories/GHSA-9p8x-f768-wp2g), consultados 2026-09-10. No es una auditoría general de dependencias.
