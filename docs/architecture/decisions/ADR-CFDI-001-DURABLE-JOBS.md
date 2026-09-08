# ADR-CFDI-001: trabajos durables sobre PostgreSQL

- Estado: `ACCEPTED`
- Fecha: 2026-08-28
- Alcance: Fase 0, reutilizable por Fases 1–8

## Contexto

Las cargas XML y las futuras cargas ZIP, descargas SAT, exportaciones y purgas
no pueden depender del proceso HTTP, de memoria local ni de Redis. Deben
sobrevivir reinicios, permitir reintentos acotados, cancelación, recuperación y reparto
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
- `WORKER_MAX_ATTEMPTS=4` como número de ejecuciones presupuestadas del ciclo
  normal y `WORKER_MAX_RETRIES=3` como presupuesto durable de reintentos;
- backoff de 10, 30 y 120 segundos más jitter antes de los tres reintentos;
- concurrencia configurada y acotada;
- selección con fairness entre organizaciones;
- polling de PostgreSQL siempre activo;
- Redis pub/sub sólo como señal best-effort posterior al commit;
- shutdown: dejar de reclamar, terminar o abandonar en un límite seguro,
  detener heartbeat y cerrar dependencias sin publicar resultados con lease
  perdido; una liberación graciosa vuelve a `queued` sin consumir retry.

Tres reintentos automáticos significan una ejecución inicial y hasta tres
reejecuciones. Diez, 30 y 120 segundos preceden respectivamente a esos
reintentos, con jitter. Si la cuarta ejecución falla, el job queda
`failed_final`. `automatic_retry_count` es el contador durable que gobierna
esta decisión y sólo avanza después de un fallo retryable o un lease vencido.
`attempt_count` conserva evidencia monotónica de claims y puede superar 4 por
shutdown/reclaim; una liberación graciosa nunca agota el presupuesto.

El job conserva un estado canónico grueso y `current_stage`; el item conserva
estado técnico y resultado separados. Perder el lease invalida cualquier
escritura terminal del handler. La recuperación de leases vencidos y los
reconciliadores son idempotentes. Sólo los tests pueden registrar un handler de
prueba; Fase 0 no inventa un tipo de job de producción.

Cada claim se audita dentro de la misma operación durable que asigna el lease.
El heartbeat distingue `renewed`, `cancel_requested` y `lease_lost`: al observar
cancelación, el runner aborta cooperativamente el handler y sólo confirma
`cancelled` en un boundary seguro con el `lease_token` vigente. El token es el
fencing credential; `worker_id` conserva procedencia durable y `version` es una
revisión monotónica observable, no un CAS de ownership. El evento de auditoría
contiene IDs técnicos/estado, nunca payload fiscal.

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
- Reinicio y shutdown seguro no pierden autoridad ni consumen retry; se prueba
  que más de cuatro ciclos shutdown/reclaim siguen siendo reclamables.
- Fairness evita monopolio por un tenant.
- Redis disponible reduce latencia; Redis apagado conserva progreso.
- Los reconciliadores convergen al ejecutarse repetidamente.

## Evolución por fase

Fase 0 implementó la maquinaria, probes y un registro de handlers vacío en
producción. Fase 1 registra el handler productivo `manual_xml` sobre esa misma
cola durable; ZIP, SAT y exportación permanecen `NOT_STARTED` hasta su fase
correspondiente.
