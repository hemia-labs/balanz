# ADR-CFDI-001: trabajos durables sobre PostgreSQL

- Estado: `ACCEPTED`
- Fecha: 2026-08-28
- Alcance: Fase 0, reutilizable por Fases 1–8

## Contexto

Las futuras cargas XML/ZIP, descargas SAT, exportaciones y purgas no pueden
depender del proceso HTTP, de memoria local ni de Redis. Deben sobrevivir
reinicios, permitir reintentos acotados, cancelación, recuperación y reparto
justo entre organizaciones sin perder el aislamiento multi-tenant.

## Decisión

PostgreSQL es la única autoridad durable de los trabajos. El worker se ejecuta
como proceso separado dentro del mismo monorepo y release que la API. Reclama
trabajo mediante una operación atómica basada en `FOR UPDATE SKIP LOCKED`,
encapsulada en la función `SECURITY DEFINER` mínima definida por
ADR-CFDI-003. El retorno contiene únicamente identificadores, scope y datos de
control necesarios para continuar bajo RLS.

Parámetros bloqueados:

- lease de 90 segundos;
- heartbeat cada 20 segundos;
- `WORKER_MAX_ATTEMPTS=3` como límite de tres ejecuciones totales, incluida la
  inicial;
- backoff de 10 y 30 segundos más jitter antes de las ejecuciones 2 y 3; 120
  segundos queda reservado por compatibilidad y no habilita una ejecución 4;
- concurrencia configurada y acotada;
- selección con fairness entre organizaciones;
- polling de PostgreSQL siempre activo;
- Redis pub/sub sólo como señal best-effort posterior al commit;
- shutdown: dejar de reclamar, terminar o abandonar en un límite seguro,
  detener heartbeat y cerrar dependencias sin publicar resultados con lease
  perdido.

Esta semántica resuelve por precedencia una ambigüedad del material de entrada
entre “tres intentos” y “tres intentos automáticos”: la instrucción directa de
la ejecución limita el job a tres ejecuciones totales. Diez segundos preceden
al primer reintento (ejecución 2) y 30 al segundo (ejecución 3), ambos con
jitter. El tercer valor configurado, 120, se conserva como reserva compatible,
pero no se usa para programar ni justificar una cuarta ejecución. Si la tercera
ejecución falla, el job queda `failed_final`.

El job conserva un estado canónico grueso y `current_stage`; el item conserva
estado técnico y resultado separados. Perder el lease invalida cualquier
escritura terminal del handler. La recuperación de leases vencidos y los
reconciliadores son idempotentes. Sólo los tests pueden registrar un handler de
prueba; Fase 0 no inventa un tipo de job de producción.

Cada claim se audita dentro de la misma operación durable que asigna el lease.
El heartbeat distingue `renewed`, `cancel_requested` y `lease_lost`: al observar
cancelación, el runner aborta cooperativamente el handler y sólo confirma
`cancelled` en un boundary seguro con lease y versión vigentes. El evento de
auditoría contiene IDs técnicos/estado, nunca payload fiscal.

## Alternativas rechazadas

- Redis, Bull/BullMQ u otra cola como autoridad: crea doble verdad y debilita
  RLS, auditoría y recuperación.
- Trabajo dentro del request HTTP: no sobrevive reinicios ni permite operación
  durable.
- Cron que procesa lotes sin lease: permite doble ejecución y mala latencia.
- Microservicio independiente: añade despliegue y contratos distribuidos sin
  necesidad demostrada.
- Locks de sesión o memoria: no sobreviven caída del proceso.

## Consecuencias

La cola comparte disponibilidad y capacidad con PostgreSQL, por lo que sus
índices, transacciones, `queue_age`, contención y bloat son señales operativas
obligatorias. Los handlers deben ser idempotentes y validar la propiedad del
lease en cada transición. Redis puede degradarse sin afectar la corrección,
aunque aumenta la latencia hasta el siguiente poll.

## Controles y pruebas

- Dos workers no reclaman el mismo job.
- Heartbeat extiende sólo el lease del dueño vigente.
- Heartbeat devuelve `cancel_requested` sin ocultarlo como una renovación normal
  y provoca aborto cooperativo/confirmación segura.
- Lease vencido se recupera; lease perdido no puede completar.
- Intentos/backoff/jitter y transición final se verifican con reloj controlado.
- Reinicio y shutdown seguro no pierden autoridad.
- Fairness evita monopolio por un tenant.
- Redis disponible reduce latencia; Redis apagado conserva progreso.
- Los reconciliadores convergen al ejecutarse repetidamente.

## Límite de fase

Fase 0 implementa la maquinaria, probes y un registro de handlers vacío en
producción. Los handlers XML, ZIP, SAT y exportación permanecen
`NOT_STARTED` hasta su fase correspondiente.
