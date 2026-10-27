El flujo implementado en el código local es: **Balanz administra al comprador, Legal verifica y guarda la aceptación, y Billing crea el checkout con el proveedor configurado.**

1. **Balanz crea la organización y sus miembros.**  
   Balanz guarda estos datos y determina quién tiene permiso para contratar.

2. **Balanz solicita a Legal preparar la aceptación.**  
   Su backend obtiene un token de Identity para `legal-api`, con el scope `legal.integration.acceptances.prepare`, y envía usuario, organización y sesión.

3. **Legal consulta el contexto en Balanz.**  
   Comprueba que el cliente esté autorizado como `collector` y consulta a Balanz para verificar la membresía y el permiso para contratar. Después devuelve los documentos vigentes.

4. **El usuario acepta los documentos en Balanz.**  
   Balanz envía las confirmaciones a Legal con el scope `legal.integration.acceptances.create`. Legal verifica nuevamente el contexto, guarda la evidencia y devuelve el `legalAcceptanceId`.

5. **Balanz solicita el checkout a Billing.**  
   Usa un token de servicio para Billing y envía el producto `balanz_cfdi`, precio seleccionado, organización, usuario, `legalAcceptanceId` y URLs de retorno.

6. **Billing autoriza a Balanz y valida la aceptación con Legal.**  
   Primero comprueba los productos, organizaciones y retornos permitidos para ese cliente. Después llama a Legal con su propio cliente, autorizado como `validator`, y el scope `legal.integration.acceptances.validate`.

7. **Legal vuelve a consultar a Balanz.**  
   Confirma que el comprador todavía puede contratar y que la aceptación corresponde al usuario, organización, producto y documentos vigentes. Devuelve la evidencia que Billing verifica.

8. **Billing crea el checkout con el proveedor configurado.**  
   Devuelve la URL a Balanz, que redirige al usuario para aprobar la suscripción.

9. **El proveedor notifica a Billing.**  
   Billing verifica el evento, actualiza la suscripción y recalcula la licencia. Encola una entrega durable y envía a Balanz un webhook autenticado con un snapshot de licencia y suscripción. Balanz actualiza atómicamente su copia PostgreSQL. La pantalla de retorno consulta el intento central de Billing; el acceso fiscal se comprueba con la copia local y el trial. Regresar a la URL de éxito por sí solo no confirma la activación.

**Identity autentica a los servicios; cada aplicación autoriza lo que pueden hacer.** Registrar una integración en Legal no autoriza automáticamente a Balanz para consumir Billing.

10. **Balanz aplica su política local de acceso.**
    Las nuevas operaciones fiscales requieren licencia active/grace vigente y
    confirmada en las últimas 24 horas, o una prueba local vigente. El estado
    del checkout no sustituye esa decisión; el worker ya no concilia licencias.

Esta descripción no acredita despliegue ni configuración del ambiente.
