# Perfil sat_efirma_v1 y PKCS8
Estado: implementación offline disponible; habilitación real bloqueada. synthetic_v1 conserva su manifiesto de fixtures. La selección es exclusivamente EFIRMA_CERTIFICATE_PROFILE del servidor. El cierre del 2026-09-15 prepara un modo real_pilot separado de QA, desactivado y sin artefacto de autorización operativo suministrado. No se incluye trust bundle SAT ni se transforma el manifiesto sintético en confianza real.

## Controles implementados
DER máximo 16 KiB, profundidad 16, 512 nodos, consumo completo y consistencia de recodificación mediante asn1js/PKIjs. node:crypto abre PKCS8 protegido y comprueba la llave contra el certificado. Cadena offline con PKIjs, raíces CA autofirmadas, firma del emisor, vigencia de todos los certificados, RSA de 2048/3072/4096 bits para titular, firma del certificado del titular SHA-256/RSA; para CA, SHA-256/RSA o SHA-512/RSA sustentado por la publicación SAT de septiembre; BasicConstraints no CA, KeyUsage digitalSignature y exacto del perfil, extensiones críticas permitidas sin duplicados. No se consulta AIA/OCSP/CRL.

El registro de generaciones exige versión, fingerprint del emisor, política positiva e.firma, KeyUsage, extensiones críticas y evidencia oficial. Certificados CSD/perfiles desconocidos no tienen regla positiva y se rechazan. Bundle limitado a 256 KiB, 8 raíces, 8 intermedios y 16 reglas; cada DER lleva SHA-256 y fuente oficial verificable. Una URL con nombre de emisor no establece confianza: además se requiere hash, cadena, firma y política de generación. La publicación y revisión externa del bundle siguen pendientes.

RFC: se exige un uniqueIdentifier X.500 2.5.4.45 exactamente igual a la entidad. El [perfil DOF](https://dof.gob.mx/nota_detalle_popup.php?codigo=5457756) documenta ese atributo y SHA-256/RSA; esto no prueba que todas las generaciones SAT usen esa representación. Representantes/formatos compuestos se rechazan hasta contar con sustento. No hay OID e.firma/CSD inventado ni política real precargada. Faltan fuentes primarias y reglas positivas e.firma frente a CSD por generación, un bundle runtime reducido revisado y muestras públicas legítimas de cada variante. Las CA públicas recuperadas en el cierre se documentan abajo y no completan por sí solas ese perfil.

## Preflight de llave protegida
Sólo PBES2/PBKDF2/AES-256-CBC, HMAC-SHA1 por defecto o HMAC-SHA256, sal primitiva 8–64 bytes, IV primitivo 16 bytes, longitud derivada ausente o 32, ciphertext no vacío múltiplo de 16. Iteraciones 1–200,000; máximo dos aperturas admitidas concurrentemente por proceso. Se valida antes del trabajo OpenSSL. Se rechazan PBES1/3DES, scrypt, otros PRF/cifrados, ASN.1 truncado/trailing y presupuestos mayores; no se habilita proveedor legacy global.

Medición sintética focalizada: Node v24.19.0, tres muestras por PRF, 200,000 iteraciones y 32 bytes derivados: máximo observado SHA1 48 ms, SHA256 32 ms. Es presupuesto Hemia, no límite SAT ni garantía universal de latencia. Requiere verificar capacidad del host antes de habilitar; la concurrencia se limita, sin cola infinita. No se cambió runtime.

Resultado local_validation_passed y revocation_status unknown. Ninguna prueba sintética demuestra no revocación ni aceptación SAT real. Firmas XMLDSig SAT RSA-SHA1 son compatibilidad de ese adaptador, no confianza de certificados ni algoritmo de custodia.

Dependencias autorizadas exactas: pkijs 3.4.0 (BSD-3-Clause), asn1js 3.0.10 (BSD-3-Clause), xml-crypto 6.1.2 (MIT), sax 1.6.1 (BlueOak-1.0.0). Versiones en bun.lock, runtime existente compatible. xml-crypto 6.1.2 supera los parches 6.0.1 de [GHSA-x3m8-899r-f7c3](https://github.com/node-saml/xml-crypto/security/advisories/GHSA-x3m8-899r-f7c3) y [GHSA-9p8x-f768-wp2g](https://github.com/node-saml/xml-crypto/security/advisories/GHSA-9p8x-f768-wp2g), consultados 2026-09-10. No es una auditoría general de dependencias.

## Cierre técnico y matriz de evidencia — 2026-09-15

No hay todavía un perfil de titular e.firma real acreditado integralmente. No basta activar una variable. El código exige una regla positiva por generación y CertificatePolicies.policyOid; no se ha acreditado ese discriminador como regla e.firma/CSD SAT. Si el documento oficial define otro discriminador, habrá que implementar esa regla concreta en GenerationRule/SatCertificateValidator antes del piloto, sin eliminar el rechazo por defecto.

| Componente/variante | Evidencia | Estado |
|---|---|---|
| AC5 SAT → ARC5 IES | Archivo oficial, hashes DER y firma del emisor verificada localmente | Cadena CA documentada; no clasifica al titular como e.firma |
| AC6 SAT / AC7 SAT → ARC6 IES | Archivo oficial, firma y hash de raíz/intermedio | Soportados por el lector CA RSA4096/SHA512; no son un bundle runtime habilitado |
| Certificado del titular RSA2048/3072/4096 y SHA256/RSA, DER completo | Controles implementados; perfil DOF general y ejemplos documentales | Falta acreditación para una generación fiscal concreta |
| RFC único exacto en 2.5.4.45 | DOF general; el ejemplo SAT de descarga contiene también una variante compuesta | Código acepta exacto; ninguna generalización fiscal acreditada. Compuestos/representante rechazados |
| Diferenciación positiva e.firma/CSD | Trámites SAT distinguen credenciales, pero no aportan regla X.509 suficiente | PENDING; no se inventa un OID ni se acepta cualquier llave que abra |
| PKCS8 PBES2/PBKDF2/AES256CBC, SHA1/SHA256 PRF | Bibliotecas estándar y medición Hemia ya registrada | Implementado y acotado; falta muestra pública legítima/especificación de salida Certifica de la generación elegida |
| CA históricas SHA1/MD5, RSA2784, expiradas | Presentes en publicación oficial | Rechazadas; publicación no implica vigencia ni habilitación |
| CSD, OCSP, pruebas SAT y perfiles desconocidos | No tienen regla positiva de titular e.firma | Rechazados para custodia real |

Fuente primaria recuperada sin autenticación: [Servicios especializados SAT](https://wwwmat.sat.gob.mx/consultas/20585/conoce-los-servicios-especializados-de-validacion), enlace «Certificados raíz», [ZIP oficial](https://wwwmat.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1461175745719&ssbinary=true), consulta 2026-09-15. HTTP200, 37,863 bytes; SHA256 c58f3fe92e23d1c82cee46e8b2356b69b0e216b23bbec86eefdc280822ad6af7. Copia e inventario reproducible: sat-v1.5/sat-public-ca-20260915.zip y .json. Sólo contienen evidencia pública, no se instalan como confianza.

| DER | SHA256 | Vigencia publicada en certificado |
|---|---|---|
| AC5_SAT | 1ac6325143920fc047b6506e42540944fa6590b44560807b564c5603d15add8e | 2019-05-03 a 2027-05-03 |
| ARC5_IES | cbf3e084a86cac5ef1060b9242196eec15e8786931ffff05466ba7becd43b15e | 2018-12-07 a 2034-12-03 |
| AC6_SAT | 054e8f213ff2228254d8f87ec43d2e7c2eda628d927c270b9a77d1d09eef9418 | 2023-03-24 a 2031-03-24 |
| AC7 | 6d1d1f871f0d69233fc94526fecf826bee67181782d6b7e5320b279c97e8dac7 | 2023-05-23 a 2031-05-23 |
| ARC6_IES | a86baf49b2e91d0141722c4e7026ab246183a8072926e9983edbd4e5ba72515d | 2023-03-17 a 2039-03-17 |

En este ZIP los archivos ARC6_IES y ARC7_IES contienen el mismo DER. Se verificó criptográficamente la firma de AC6/AC7 con esa raíz; no se infirió del nombre. Las fechas son atributos locales, no prueba de no revocación. La ampliación SHA512 se limita a CA porque esas CA públicas la usan; no cambia el algoritmo del titular, PBKDF2, XMLDSig ni custodia.

Búsqueda adicional concluida, sin investigación indefinida: portal de validación/raíces SAT; consulta/recuperación CFDI; manual enlazado (timeout); trámites e.firma/CSD; DOF 5457756 y PDFs SAT v1.5 locales. No se recuperó una política oficial por generación que defina clasificación positiva, RFC y variantes de llave. No se consultaron llaves/contraseñas reales, AIA, OCSP ni CRL.

Artefacto exacto pendiente: especificación/circular/CP-CPS oficial SAT para una generación concreta de titular (por ejemplo bajo AC6), con atributos RFC y discriminador positivo e.firma/CSD; certificado público representativo autorizado y procedencia verificable; especificación PKCS8/Certifica de esa generación. Arquitectura/seguridad deben contrastarla y registrar una regla. Operaciones debe producir el bundle reducido versionado/hash aprobado, sin copiar todo el ZIP histórico.
