# Fuentes contractuales SAT
Descarga pública sin autenticación, 2026-09-10. sources.json conserva URL, fecha de consulta, hash SHA-256 y tamaño por snapshot. PDF v1.5 recuperados; WSDL de autenticación, solicitud y verificación recuperados de endpoints públicos. WSDL vivo de descarga respondió HTTP 400; se implementó con el documento oficial download.pdf. No se atribuye versión interna 1.5 a WSDL si no la declara.

| Operación | Snapshot | Contrato utilizado |
|---|---|---|
| Autenticación | authentication.wsdl y ejemplos PDF | WS-Security X.509, Timestamp firmado con referencia ID, token temporal de respuesta |
| Emitidos/recibidos/folio | request.wsdl, request.pdf | SOAPAction específico, solicitud firmada, IdSolicitud/CodEstatus |
| Verificación | verification.wsdl, verification.pdf | IdSolicitud/RfcSolicitante firmados, EstadoSolicitud/CodigoEstadoSolicitud/NumeroCFDIs/IdsPaquetes |
| Paquete | download.pdf | peticionDescarga firmada, Header respuesta, Paquete base64; 5007 no disponible/vencido y 5008 presupuesto agotado |

XMLDSig usa canonicalización estándar xml-crypto, RSA-SHA1/SHA1 limitada al adaptador. Se explicita la transformación C14N inclusiva que el ejemplo documental implica tras enveloped-signature; la autenticación usa canonicalización exclusiva. Las pruebas verifican referencia y contenido firmado, no sólo existencia de Signature. Aceptación por SAT real: NOT_RUN.

Límites oficiales confirmados: dos descargas por paquete y 72 horas de disponibilidad desde generación. No se presupone TTL de token ni hora exacta de generación a partir del envío. Respuestas 5004 y cero CFDI sólo son vacías cuando existe estado terminal coherente; el ejemplo de verificación con cero y paquetes se trata como contradicción.

Lagunas: WSDL vivo de descarga, generaciones y políticas positivas de certificados reales, confianza operativa y compatibilidad exhaustiva de metadata. Documento, ejemplo, servidor controlado y servicio SAT real son evidencias distintas. Los TXT adyacentes son extracciones auxiliares del PDF, no otro contrato ni evidencia de credenciales reales.

Cierre2026-09-15: sat-public-ca-20260915.zip es publicación oficial de CA, con URL/hash/fechas/firmas en el inventario .json. No es un bundle runtime ni acredita un certificado de titular e.firma. Véase matriz de CFDI_SAT_CERTIFICATE_PROFILE.md. Las consultas adicionales de metadata acreditan tilde/campos semánticos, no encabezado literal. No se reintentó indefinidamente el WSDL de descarga.
