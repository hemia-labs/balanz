# ADR-CFDI-008 — Mesa mensual y cierre interno

Fecha: 2026-09-15. Estado: implementado bajo autorización del solicitante; validación automatizada y PostgreSQL local documentadas en CFDI_PHASE_5_VALIDATION_REPORT. No atribuye revisión independiente ni aprobación de release.

## Autoridad y separación de desarrollo/liberación

La autorización explícita permite desarrollar F5 con XML/ZIP y el núcleo durable F4. F4 permanece PARTIAL, SAT real desactivado y requerido para liberar el MVP. Sus pendientes de perfil real, metadata y aprobación operativa no se eliminan. No se autoriza merge, despliegue, uso real de e.firma ni Fase6.

Base inicial: 4802dbeb72c28b205f5b7d6ff9e096005131b1bf, entonces PR25 abierta. Durante el desarrollo el equipo integró PR25; se incorporó por fast-forward su merge en develop 4b392b7721596cd1be5612b029fe411e40980f2b, sin diferencias de contenido ni pérdida del trabajo F5. La PR F5 se dirige a develop. El código F4 validado es 8f1f58fd8ea39832fb755f64ab82fbd7286abdf5 y su integración local pasó con 61 comprobaciones sobre 51e896ab8e6d305b024f0041c538e0bbf920d4e9. No se repite esa validación ni se reescriben reportes históricos.

## Decisiones recibidas y vinculantes

- Mesa real por entidad/período, búsqueda/filtros, indicadores accionables, panel de detalle reutilizado y navegación anterior/siguiente. Abrir no marca revisado. Avance de revisión y fuentes son dimensiones distintas; no se presenta cumplimiento fiscal.
- Unidad de decisión: participación con ordinal. Conservar cfdi-period-participation/1.0.0, fechas literales y timezone histórico: I/E/T por emisión, P por cada pago, N por fecha de pago. Referencias PPD no duplican participación/importe ni arrastran decisiones entre meses.
- Reconciliar participaciones faltantes al crear ejercicios mediante worker existente, sin nueva cola ni reprocesamiento innecesario del XML. Importes exactos, monedas separadas; P/T no aumentan totales facturados; I/E separados. Permisos de nómina también afectan agregados.
- Decisiones append-only: pendiente/revisado, incluida/excluida y motivo obligatorio de exclusión. Sin decisión significa pendiente/incluida, con interpretación versionada. Categoría, comentario y tratamiento son opcionales.
- Categorías configurables por organización, sin catálogo inicial obligatorio. Crear/renombrar/archivar conserva referencias/etiquetas históricas. cfdi.classify no administra categorías; usar cfdi.categories.manage si no existe equivalente, inicialmente titular. Tratamientos fiscal/IVA: pendiente/no_aplica/documentado con nota; no cálculo ni bloqueo automático del cierre.
- Masivas hasta100 participaciones con preview, IDs/versiones congelados, permisos por acción/elemento, cfdi.bulk_action, idempotencia específica, éxito parcial y auditoría individual. Nunca repetir aplicados ni reconsultar un filtro para ampliar selección.
- Lease por instancia/sesión/membresía:120s, renovación30s sólo con actividad editorial. Lectura no adquiere/renueva. Toda mutación verifica autoridad, token y versión. Heartbeat no cambia versión de contenido. Takeover exige periods.takeover, motivo, MFA y reautenticación general vigente.
- Autosalvado serializado en servidor, estados honestos de guardado. Texto no enviado sólo en memoria; sin promesa de recuperación después de cerrar navegador. Salida voluntaria permite guardar/descartar; logout, revocación o cambio de tenant limpian contexto y descartan respuestas tardías. Borrador tras perder lease no se aplica solo.
- Reutilizar incidents con asociación mensual e historial, sin alterar evidencia original. Seguimiento manual de aclaración con cliente, sin mensajería ni portal. Rechazados pueden darse por revisados conservando el rechazo; no se vuelven válidos por excepción. Advertencias PPD/relaciones no son conclusiones fiscales.
- Checklist de catálogo controlado/versionado: comprobaciones automáticas con evidencia separadas de confirmaciones humanas. Desconocido no es cumplido; las acciones automáticas no se atribuyen al usuario. Plantillas no reescriben períodos/cierres previos. Exportación preparada significa conjunto apto para snapshot del exportador futuro, no archivo ficticio ni dependencia circular con cierre anterior.

## Cierre, fuentes y novedades

El prompt completo fue recibido. El cierre es una revisión interna de lo incorporado, no acredita cobertura SAT ni una declaración. Fuentes pendientes o inciertas bloquean por defecto; únicamente exceptions.accept, MFA, reautenticación y motivo permiten una excepción explícita con evidencia congelada. El envío SAT incierto nunca se modifica por esa excepción. Un período vacío requiere confirmación de alcance y se expresa como “Sin CFDI incorporados”.

El snapshot versionado conserva participaciones, versiones de decisiones (incluida la interpretación pendiente/incluida), checklist, incidencias, fuentes, excepciones, actores y referencias/hash de originales. Las novedades comparan conjuntos y versiones, no timestamps. Los cierres históricos sin snapshot se identifican como heredados. Reabrir exige autoridad, lease, versión, MFA y motivo; no modifica cierres publicados.

La exportación de Fase 6 queda fuera de alcance; sólo se define el contrato interno consumible del snapshot.

## Límites técnicos

Monolito NestJS/Next existente, PostgreSQL durable, RLS y FKs compuestas, originales inmutables. No migraciones históricas modificadas, dependencias nuevas ni cambios CI/deploy como parte de esta entrega. Se amplía el formato de permisos sólo para cfdi.categories.manage mediante la única migración nueva 1787691200000-PhaseFiveMonthlyWorkspace; no se edita el historial.

## Implementación y consecuencias

- MonthlyService usa TypeORM directamente en ClientAccountsModule, contexto RLS y REPEATABLE READ. La fila de período coordina las escrituras breves; no se mantienen transacciones durante llamadas externas. No hay segunda representación CFDI ni repositorio genérico.
- monthly_decisions, monthly_incident_events, monthly_checklist_events y monthly_closes son append-only con ACL sin UPDATE/DELETE runtime. El apuntador del workspace y su versión se actualizan en la misma transacción. Categorías son configurables; la etiqueta de una decisión/cierre queda congelada. La plantilla queda instanciada al comenzar la primera edición, no al consultar.
- La preparación compara el fingerprint del snapshot con el contenido al confirmar. INSERT de participación posterior cambia closed a changes_detected mediante trigger; cambios en relaciones, observaciones SAT, fuentes o incidencias se detectan comparando los valores durables al consultar. No dependen del timestamp de llegada ni del orden UUID. El estado visible puede reflejar cambios adicionales al estado materializado de periods.
- Relaciones de pago se consultan en ambas direcciones usando cfdi_payment_documents y sus índices existentes. Son referencias observadas; no trasladan la factura al mes del pago ni propagan decisiones. “No incorporado” no significa inexistente.
- El worker existente ejecuta reconciliación periódica por lote máximo 25, claim de 60 segundos, fencing y próximos intentos durables. cfdi_period_intents guarda política, ordinal, fecha literal, instante y zona antes de buscar un período. Una caída o creación tardía del ejercicio no pierde la pertenencia.
- Documentos anteriores sin intención se localizan por FISCAL_PERIOD_NOT_CONFIGURED. Sólo en esa recuperación se lee de nuevo el original limpio, con hash/tamaño, límite XML existente y parser compartido. El instante normalizado ya persistido no se recalcula con el timezone actual; si la zona histórica no fue conservada se identifica historical-unrecorded. Un original perdido/inconsistente deja incidencia/reconciliación pendiente, no inventa fechas ni incorpora material inválido. Una vez guardada la intención, los retries no releen XML.
- La resolución de participación queda en cfdi_period_reconciliations y audit_events; no se sobreescribe evidencia original de incidents. Los dos roles runtime mantienen privilegios restringidos; la función de claim utiliza el propietario NOLOGIN ya existente y permisos mínimos de columnas.
- El lease es sólo autoridad de edición. MFA rota el token de cookie conservando sessionId; no debe fabricar otra instancia editorial ni extender el lease. Consultar, navegar y heartbeats sin actividad no lo prolongan.
- Se conserva el checklist mínimo normativo mediante el mapeo explícito del contrato API; categorías y tratamientos opcionales no generan cálculos. El contrato interno monthly-close/1.0.0 sirve a F6, pero no crea archivos de salida ni retención nueva.

Documentos complementarios: [API](../../contracts/CFDI_MONTHLY_WORKSPACE_API.md), [operación](../../operations/CFDI_PHASE_5_RUNBOOK.md) y [validación](../../qa/CFDI_PHASE_5_VALIDATION_REPORT.md). El browser smoke no se sustituye por afirmaciones de accesibilidad visual comprobada; su disponibilidad se registra aparte.
