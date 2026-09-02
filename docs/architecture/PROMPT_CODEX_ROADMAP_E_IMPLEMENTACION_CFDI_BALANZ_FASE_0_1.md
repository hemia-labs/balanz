# Prompt maestro para Codex
## Roadmap integral e implementación de la Fase 0–1 del dominio CFDI de Balanz

Quiero que trabajes como una combinación de:

- Product Owner técnico con autoridad para cerrar decisiones de ejecución ya aprobadas.
- Arquitecto Staff de SaaS B2B multi-tenant.
- Backend Staff Engineer especializado en NestJS, TypeORM y PostgreSQL.
- Arquitecto de workers durables, concurrencia e idempotencia.
- Especialista en RLS y seguridad de datos fiscales.
- Especialista en almacenamiento privado de objetos, KMS y ciclo de vida.
- Especialista en procesamiento seguro de XML y archivos comprimidos.
- Frontend Staff Engineer en React/Next.js.
- QA Automation Engineer para PostgreSQL, seguridad, concurrencia y E2E.
- SRE responsable de observabilidad, recuperación y operación del pipeline.

Esta instrucción tiene dos resultados obligatorios:

1. Crear y dejar versionado un **plan maestro completo por etapas**, desde la fundación fiscal hasta la carga manual XML, ZIP, e.firma, descarga SAT, mesa mensual, exportaciones y preparación para piloto.
2. Ejecutar en esta misma tarea únicamente:
   - **Fase 0: plataforma fiscal compartida**.
   - **Fase 1: un XML individual end-to-end**.

No empieces la Fase 2 de ZIP durante esta ejecución.

---

# 1. Regla principal: no dejar deuda técnica deliberada

No quiero una prueba de concepto, un happy path aislado ni una implementación temporal que después deba rehacerse para ZIP o SAT.

La secuencia por fases sirve para controlar tamaño y riesgo, no para posponer fundamentos.

## 1.1 Qué debe quedar completo desde la Fase 0–1

La primera vertical debe incluir desde ahora:

- PostgreSQL como autoridad durable de los trabajos.
- Worker separado dentro del mismo monolito y repositorio.
- Lease, heartbeat, recuperación y reconciliación.
- Redis como **wakeup opcional ya implementado**, nunca como autoridad.
- Polling de PostgreSQL como fallback obligatorio cuando Redis no exista o falle.
- Object storage mediante puerto real.
- Adapter local privado para desarrollo.
- Adapter S3-compatible privado para ambientes administrados.
- Cuarentena.
- Scanner mediante puerto real.
- Adapter ClamAV de producción.
- Bypass del scanner únicamente en desarrollo y de forma explícita.
- Parser XML endurecido.
- RLS desde la primera tabla fiscal.
- FKs compuestas, checks, uniques e índices completos.
- Idempotencia durable.
- Modelo de procedencia.
- Dedupe transaccional.
- Política de mismo UUID con hash diferente.
- Auditoría.
- Métricas.
- Health/readiness.
- Logs estructurados y redacción.
- Contratos HTTP estables.
- Frontend real conectado.
- Pruebas unitarias, integración, E2E, concurrencia, archivos hostiles y cross-tenant.
- Migraciones ejecutadas en desarrollo.
- Documentación y runbooks.

No está permitido dejar para después:

```text
RLS
índices
scanner de producción
adapter S3
durabilidad del worker
idempotencia
reconciliación
métricas
health checks
pruebas cross-tenant
pruebas de reinicio
manejo de errores estable
eliminación del fallback demo
```

## 1.2 Qué sí puede pertenecer a fases posteriores

Una capacidad futura no se considera deuda si:

1. Está fuera del alcance funcional de la fase actual.
2. La arquitectura actual no tendrá que rehacerse para incorporarla.
3. Está registrada en el plan maestro con:
   - ID;
   - fase objetivo;
   - dependencia;
   - entregable;
   - criterio de entrada;
   - criterio de salida;
   - riesgo;
   - prueba requerida.
4. No existe un TODO oculto en código simulando que la capacidad está terminada.

Ejemplos válidos de secuenciación:

- ZIP se implementa en Fase 2 sobre el mismo `stored_object`, job, worker, parser y dominio CFDI.
- e.firma y reautenticación se implementan antes de SAT.
- SAT se implementa después, pero entrega paquetes a la misma tubería.
- Cierre mensual se implementa después de que exista un dominio CFDI confiable.

## 1.3 Política de deuda al cerrar una fase

Una fase no puede marcarse `DONE` si existe:

- un defecto conocido sin corregir;
- una migración no ejecutada;
- un test deshabilitado;
- un control de seguridad apagado fuera de desarrollo;
- un flujo demo como fallback silencioso;
- un `TODO`, `FIXME`, `HACK` o stub sin un ID de fase futura;
- una dependencia futura sin etapa asignada;
- una decisión abierta que afecte la corrección de la fase;
- una prueba importante marcada como “manual” cuando puede automatizarse razonablemente.

Cada fase debe terminar con:

```text
TECHNICAL_DEBT: 0
KNOWN_DEFECTS: 0
DEFERRED_PRODUCT_CAPABILITIES: sólo IDs del roadmap
```

---

# 2. Contexto y estado actual

Balanz es un SaaS B2B multi-tenant para contadores y despachos pequeños en México.

Ya existen, al menos, los dominios y flujos de:

- autenticación;
- sesiones opacas mediante cookie HttpOnly;
- MFA TOTP;
- organizaciones;
- membresías;
- roles y permisos;
- cuentas cliente;
- entidades fiscales/RFC;
- asignaciones;
- ejercicios;
- doce períodos;
- auditoría;
- frontend de clientes.

La auditoría previa confirmó que actualmente no existen de forma ejecutable:

- tablas CFDI;
- tablas de objetos;
- trabajos de ingesta;
- worker durable;
- object storage;
- parser XML;
- extractor ZIP;
- integración SAT;
- endpoints CFDI;
- conexión real de las pantallas CFDI.

Las pantallas CFDI actuales son estructura visual o demo y no cuentan como implementación.

---

# 3. Documentos obligatorios y jerarquía de autoridad

Antes de modificar código, localiza y lee completos:

- todos los `AGENTS.md` aplicables;
- `control_mensual_cfdi.md`, versión 3.3 o la más reciente;
- `ARCHITECTURE.md`;
- `docs/architecture/CORRECTED_POSTGRESQL_DATA_MODEL.md`;
- `docs/architecture/CFDI_DOWNLOAD_INGESTION_CURRENT_STATE.md`;
- `docs/architecture/CFDI_DOWNLOAD_INGESTION_DECISION_INPUTS.md`;
- reportes del módulo de clientes;
- documentación de navegación;
- design system;
- README de raíz, API y frontend;
- configuración de TypeORM;
- migraciones y seeds;
- configuración de Redis;
- configuración de Vault/secrets;
- cliente HTTP del frontend;
- rutas y componentes CFDI;
- código legacy únicamente como referencia de campos y casos de prueba.

## 3.1 Orden de autoridad

1. Esta instrucción y sus decisiones bloqueadas.
2. Código, migraciones y pruebas para conocer el estado real.
3. `control_mensual_cfdi` vigente para alcance de producto.
4. `ARCHITECTURE.md` para reglas del backend.
5. El plan maestro que crearás en esta tarea.
6. Modelo PostgreSQL corregido, sujeto a las correcciones aprobadas aquí.
7. UI actual para contrato visual.
8. Legacy sólo como antecedente.

No asumas que algo está implementado porque exista en un Markdown.

---

# 4. Decisiones bloqueadas

No vuelvas a pedir aprobación sobre estas decisiones.

## 4.1 Alcance funcional

- XML individual, ZIP y descarga SAT on-demand pertenecen al P0.
- En esta ejecución sólo se implementan fundaciones y XML individual.
- El MVP no se considera completo sin SAT durable y recuperable.
- PDF está fuera del P0.
- XML es la fuente primaria.
- El original es inmutable.
- El producto no determina deducibilidad, ingreso acumulable ni impuesto definitivo.
- PUE no prueba pago.
- PPD sin complemento es una advertencia dependiente de fecha de corte.
- Nómina requiere permiso separado.
- SAT programado/desatendido pertenece a P1.

## 4.2 Arquitectura base

- Monolito modular NestJS.
- Worker como proceso separado dentro del mismo monorepo y release.
- PostgreSQL es la autoridad durable.
- No BullMQ.
- No microservicios.
- No CQRS.
- No bus genérico.
- No repositorio genérico.
- Redis sólo despierta al worker y acelera latencia.
- El worker debe seguir funcionando con Redis apagado.
- El worker reclama con `FOR UPDATE SKIP LOCKED` o función atómica equivalente.
- Lease: 90 segundos.
- Heartbeat: cada 20 segundos.
- Recuperación después de lease vencido.
- Máximo de 3 intentos automáticos.
- Backoff: 10 s, 30 s y 120 s con jitter.
- Polling PostgreSQL garantiza recuperación.
- Redis wakeup se implementa desde la Fase 0; no queda pendiente.

## 4.3 Transferencia

- XML individual: `multipart/form-data`, streaming a través de API.
- ZIP: URL firmada hacia object storage en Fase 2.
- Paquete SAT: adaptador SAT guarda directamente en object storage.
- No se permite selección múltiple de XML.
- Para múltiples XML se utiliza ZIP.

## 4.4 Object storage

Implementar:

```text
ObjectStoragePort
├── LocalFilesystemObjectStorageAdapter
└── S3ObjectStorageAdapter
```

Reglas:

- privado;
- sin ACL pública;
- object keys opacas;
- nombres físicos generados;
- ningún RFC, razón social o nombre original en el path;
- adapter local fuera de `public`;
- producción usa S3-compatible;
- SSE-KMS para objetos fiscales;
- URLs de acceso de vida corta;
- configuración segura mediante el sistema de secretos;
- filesystem local prohibido en producción.

## 4.5 Scanner

Implementar:

```text
MalwareScannerPort
└── ClamAvScannerAdapter
```

Reglas:

- usar protocolo `INSTREAM`;
- no construir comandos shell;
- producción fail-closed;
- producción no arranca con scanner deshabilitado;
- bypass sólo en desarrollo mediante configuración explícita;
- health check y timeout;
- XML también se escanea;
- `MALWARE_DETECTED` es terminal y no reintentable.

## 4.6 RLS

RLS se implementa desde la primera vertical fiscal.

- `ENABLE ROW LEVEL SECURITY`.
- `FORCE ROW LEVEL SECURITY`.
- Política mínima por `organization_id`.
- RLS no sustituye permisos, asignación ni FKs.
- API y worker no deben depender de `BYPASSRLS`.
- Cada operación fiscal normal usa transacción con:

```sql
SET LOCAL app.organization_id = 'uuid';
SET LOCAL app.membership_id = 'uuid';
```

- GUC ausente o inválida falla cerrado.
- Nunca usar `SET` de sesión persistente en una conexión del pool.
- Para reclamar jobs entre tenants, implementa una función mínima `SECURITY DEFINER`:
  - `search_path` fijo;
  - privilegios mínimos;
  - sólo reclama un job;
  - actualiza lease/worker;
  - devuelve el scope necesario;
  - no permite consultar datos fiscales arbitrarios.
- Después del claim, el procesamiento ocurre bajo RLS con el tenant del job.
- Agrega pruebas que confirmen que table owner, API y worker no evaden la política.

## 4.7 Identidad y procedencia

Existe una sola entidad lógica por:

```text
legal_entity_id + UUID normalizado
```

El mismo documento puede observarse por:

- manual XML;
- manual ZIP;
- paquete SAT;
- metadata.

Cada observación debe conservarse.

Manual primero y SAT después no crean otro CFDI.

## 4.8 UUID y hash

| Caso | Resultado |
|---|---|
| UUID nuevo + XML válido | `incorporated` |
| UUID existente + mismo hash | `duplicate` |
| UUID existente + hash diferente | `invalid` + `CFDI_UUID_HASH_CONFLICT` |
| UUID ausente/inválido | `invalid` |
| RFC ajeno | `foreign` |
| Versión raíz no soportada | `unsupported` |

Nunca reemplazar el original.

Un conflicto de hash:

- conserva el CFDI previo;
- no mezcla campos;
- crea incidente de severidad alta;
- deja el objeto conflictivo en cuarentena;
- no muestra hashes al usuario normal;
- registra mensaje accionable.

## 4.9 Estados canónicos

### Objeto

```text
pending_upload
uploaded
quarantined
available
rejected
deleted
```

### Job

```text
awaiting_upload
queued
processing
completed
completed_with_issues
failed_retryable
failed_final
cancel_requested
cancelled
```

### Etapa

```text
scanning
extracting
parsing
persisting
```

### Item técnico

```text
pending
processing
terminal
```

### Resultado de item

```text
incorporated
duplicate
foreign
invalid
unsupported
internal_error
```

Reglas:

- `duplicate` no es error operativo.
- Un job de un solo XML termina `completed` si el resultado es `incorporated` o `duplicate`.
- Termina `completed_with_issues` si el item queda `foreign`, `invalid` o `unsupported`.
- Un `internal_error` se reintenta según política; al agotar intentos, el job queda `failed_final`.
- Un retry manual crea un job nuevo con `retry_of_job_id`.

## 4.10 Idempotencia

No crear un ledger genérico.

Usa idempotencia por operación en:

- upload directo;
- upload intent;
- confirmación;
- creación de job;
- solicitud SAT futura.

Cada registro debe conservar:

```text
idempotency_key
request_fingerprint
response_status
response_reference
created_at
expires_at
```

Reglas:

- misma key + mismo fingerprint: replay determinista;
- misma key + fingerprint distinto: `409 IDEMPOTENCY_CONFLICT`;
- concurrencia protegida por `UNIQUE`;
- no se crean dos objetos ni jobs.

## 4.11 Progreso

P0 usa polling.

- `ETag`.
- `If-None-Match`.
- `304`.
- `Retry-After`.
- `updatedAt`.
- `progress`.
- `canRetry`.
- `canCancel`.

Cadencia:

```text
0–30 s: cada 2 s
después: cada 5 s
pestaña no visible: cada 15 s
estado terminal: detener
```

## 4.12 Versiones CFDI de la primera vertical

Soportar:

```text
CFDI 4.0
Timbre Fiscal Digital 1.1
Complemento de Pagos 2.0
Nómina 1.2
Tipos I, E, T, N y P
```

Reglas:

- allowlist por namespace + versión;
- XSD/catálogos oficiales versionados;
- registrar URL, versión y SHA-256;
- no descargar esquemas en runtime;
- complemento desconocido sobre CFDI 4.0:
  - incorporar core;
  - conservar original;
  - incidente `COMPLEMENT_UNSUPPORTED`;
- versión raíz no soportada:
  - resultado `unsupported`;
  - no crear CFDI fiscal;
- CFDI 3.3 pertenece a una expansión posterior explícita.

## 4.13 Límites técnicos P0

| Recurso | Límite |
|---|---:|
| XML individual | 5 MiB |
| XML por carga directa | 1 |
| ZIP comprimido | 50 MiB |
| ZIP descomprimido | 250 MiB |
| Entradas ZIP | 2,000 |
| Ratio compresión | 50:1 |
| Profundidad ZIP | 2 |
| Path normalizado | 240 caracteres |
| ZIP anidado | Prohibido |
| ZIP cifrado | Prohibido |
| Symlink/hard link | Prohibido |
| Profundidad XML | 64 |
| Nodos XML | 200,000 |
| Atributos XML totales | 100,000 |
| Atributos por elemento | 128 |
| Texto por nodo | 1 MiB |
| Parsing por XML | 5 s |
| Memoria objetivo worker | 256 MiB |
| Jobs activos por usuario | 2 |
| Jobs activos por tenant | 4 |
| Retries automáticos | 3 |
| Cuarentena normal | 7 días |

Todos los valores deben vivir en configuración validada.

## 4.14 Permisos iniciales

Agregar de forma ejecutable:

```text
ingestion.view
ingestion.create
ingestion.retry
ingestion.cancel
processes.view
processes.retry
processes.cancel
cfdi.view
cfdi.download
incidents.view
incidents.manage
```

Defaults:

| Acción | owner | accountant | collaborator |
|---|:---:|:---:|:---:|
| `ingestion.view` | Sí | Sí | Asignadas |
| `ingestion.create` | Sí | Sí | Asignadas |
| `ingestion.retry` | Sí | Sí | Sólo trabajos propios y asignados |
| `ingestion.cancel` | Sí | Sí | Sólo trabajos propios y asignados |
| `processes.view` | Tenant | Asignadas | Asignadas |
| `cfdi.view` | Sí | Sí | Asignadas |
| `cfdi.download` | Sí | Sí | Asignadas |
| `incidents.view` | Sí | Sí | Asignadas |
| `incidents.manage` | Sí | Sí | Asignadas |

`cfdi.download` exige MFA.

Carga manual no exige reautenticación.

Platform admin no obtiene acceso fiscal.

## 4.15 Reautenticación futura

Antes de SAT debe existir una reautenticación de 10 minutos ligada a:

```text
session_id
organization_id
purpose
verified_at
expires_at
```

No se implementa en Fase 1, porque ninguna acción de Fase 1 la requiere. Debe quedar completamente especificada en la fase correspondiente del plan.

## 4.16 Participación en períodos

| Documento/evento | Regla |
|---|---|
| I, E, T | Mes de `Comprobante.Fecha` |
| P | Mes de cada `Pago.FechaPago` |
| N | Mes de `Nomina.FechaPago` |
| Estado SAT futuro | Mes de detección como `status_update` |
| Relación posterior | `related_update` en períodos afectados |
| Decisión manual futura | En participación, no en CFDI global |

- Zona de entidad/despacho.
- Fallback: `America/Mexico_City`.
- Persistir policy version y zona.
- Si no existe ejercicio:
  - incorporar CFDI;
  - crear incidente `FISCAL_PERIOD_NOT_CONFIGURED`;
  - no crear ejercicio automáticamente.
- La carga desde una pantalla mensual no obliga el CFDI a ese mes.
- Un CFDI puede participar en varios períodos.

## 4.17 Retención

| Recurso | Política |
|---|---|
| XML incorporado | 5 ejercicios para cliente activo |
| ZIP procesado | 30 días |
| Paquete SAT | 30 días |
| Upload incompleto | 24 h |
| Byte redundante de duplicate | 24 h |
| Unsupported | 30 días |
| Invalid/foreign | 7 días |
| Hash conflict | 7 días, ampliable a 30 por hold |
| Malware | 7 días en cuarentena |
| Temporal extraído | Eliminación inmediata |
| Organización cancelada | 45 días para exportar |

La Fase 0 debe modelar y ejecutar lifecycle básico; las políticas comerciales completas se conectan en la fase de exportación/retención.

---

# 5. Plan maestro obligatorio

Antes de programar, crea:

```text
docs/roadmaps/CFDI_P0_MASTER_IMPLEMENTATION_PLAN.md
```

Ese archivo será la fuente de verdad operativa de todo el programa CFDI.

Debe incluir:

1. Metadatos, rama, SHA y fecha.
2. Contexto.
3. Decisiones bloqueadas.
4. Diagrama de arquitectura objetivo.
5. Límites de módulos.
6. Diagrama de datos.
7. Diagrama de trabajo durable.
8. Dependencias entre fases.
9. Matriz de permisos.
10. Matriz MFA/reauth.
11. Configuración.
12. Migraciones.
13. APIs.
14. Frontend.
15. Seguridad.
16. Operación.
17. Pruebas.
18. Riesgos.
19. Registro de capacidades diferidas.
20. Registro de deuda técnica.
21. Estado por fase.
22. Evidencia para marcar una fase terminada.

Estados permitidos:

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
DONE
```

## 5.1 Estructura obligatoria de cada fase

Para cada fase incluye:

```text
ID
Objetivo
Valor de producto
Dependencias
Alcance
Fuera de alcance
Tablas/migraciones
Backend
Worker
Frontend
Seguridad
Operación
Configuración
Métricas
Pruebas
Datos de QA
Entregables
Criterios de entrada
Criterios de salida
Riesgos
Rollback
Estado
Evidencia
```

---

# 6. Roadmap que debes registrar

No cambies este orden sin una incompatibilidad demostrada.

## Fase 0 — Plataforma fiscal compartida

Objetivo:

Construir las fundaciones correctas que utilizarán XML, ZIP, SAT y exportaciones.

Incluye:

- ADRs.
- Threat model.
- Catálogo de errores.
- Nuevos permisos/seeds.
- RLS.
- Object storage local + S3.
- Scanner ClamAV.
- Tablas de objetos, uploads, jobs e items.
- Idempotencia.
- Worker.
- Lease/heartbeat/reconciler.
- Redis wakeup + polling fallback.
- Health/readiness.
- Métricas.
- Logs estructurados.
- Test infrastructure.
- Configuración validada.
- Runbook del worker.
- Lifecycle inicial.

No se marca DONE con un worker en memoria.

## Fase 1 — XML individual end-to-end

Objetivo:

Un usuario autorizado carga un XML CFDI, cierra la pantalla, el worker lo procesa, el resultado se persiste y el usuario puede consultar el CFDI real.

Incluye:

- multipart streaming;
- progreso de upload;
- job 202;
- polling;
- scanner;
- parser seguro;
- CFDI 4.0;
- TFD 1.1;
- Pagos 2.0;
- Nómina 1.2 core;
- tipos I/E/T/N/P;
- dedupe;
- hash conflict;
- conceptos;
- impuestos;
- relaciones;
- pagos múltiples;
- participación de períodos;
- incidentes;
- lista y detalle;
- descarga autorizada del XML;
- UI real;
- pruebas completas.

Ésta es la fase que debes implementar en esta ejecución.

## Fase 2 — ZIP y éxito parcial

Incluye:

- upload intent;
- URL firmada;
- confirmación;
- extracción segura;
- 2,000 entries;
- límites;
- ZIP bomb;
- traversal;
- nested/encrypted denied;
- un item por entrada;
- objetos individuales para XML aceptados;
- éxito parcial;
- resultados y filtros;
- cancelación entre items;
- retry sólo de fallos transitorios;
- UI de ZIP.

No debe cambiar parser ni dominio CFDI.

## Fase 3 — Reautenticación y custodia de e.firma

Incluye:

- `POST /auth/reauthenticate`;
- grant purpose-bound de 10 minutos;
- invalidación;
- metadata de .cer/.key;
- validación de RFC, par y vigencia;
- objetos clase credential;
- cifrado por envoltura/KMS;
- password nunca persistida;
- secreto temporal por trabajo en Vault con response wrapping/TTL;
- acceso one-time del worker;
- destrucción y auditoría;
- UI de credencial;
- rotación/revocación;
- pruebas de ausencia de secretos.

No se permite usar Redis o DB como almacenamiento en claro del material privado.

## Fase 4 — Descarga SAT on-demand

Incluye:

- snapshot versionado de especificación oficial;
- autenticación;
- firma;
- solicitud;
- verificación;
- paquetes;
- descarga antes de expiración;
- estado interno separado del estado oficial;
- folio, códigos y mensajes oficiales;
- backoff;
- idempotencia;
- paquetes en object storage;
- entrega a la misma ingesta;
- metadata-only;
- fecha de corte;
- reauth;
- e.firma;
- UI y centro de procesos;
- contract tests;
- reinicio y recuperación.

No incluye programación recurrente.

## Fase 5 — Mesa mensual y decisiones

Incluye:

- CFDI por período;
- emitidos/recibidos;
- pagos;
- nómina restringida;
- traslado;
- PUE/PPD;
- revisión;
- clasificación;
- inclusión/exclusión;
- comentarios;
- acciones masivas;
- incidentes;
- checklist;
- lease de edición;
- cierre versionado;
- novedades;
- reapertura.

No se modifica el XML original.

## Fase 6 — Exportación, portabilidad y retención

Incluye:

- Excel/CSV;
- ZIP básico de XML;
- jobs asíncronos;
- permisos;
- MFA/reauth según alcance;
- URLs temporales;
- lifecycle;
- retención de cinco ejercicios;
- ventana de cancelación de 45 días;
- purgado verificable;
- auditoría;
- exportación sin recaptura.

## Fase 7 — Operación integral y producto global

Incluye:

- centro global de procesos;
- notificaciones;
- dashboards reales;
- alertas;
- reconciliadores;
- capacidad y fairness;
- métricas de negocio;
- runbooks;
- soporte JIT para diagnóstico sin secretos.

Redis wakeup ya debe existir desde Fase 0; aquí sólo se mide y ajusta, no se introduce.

## Fase 8 — Hardening, piloto y producción

Incluye:

- capacity test;
- fault injection;
- backup/restore;
- disaster recovery;
- retención real;
- prueba de restart;
- pentest;
- dependency audit;
- runbooks de incidentes;
- SLO;
- alertas;
- cero hallazgos críticos;
- piloto con casos reales anonimizados;
- gate de salida del MVP.

## Después de P0

Registrar, sin implementar ahora:

- SAT programado;
- bóveda persistente de firma;
- CFDI 3.3/histórico;
- PDF/anexos;
- reglas recurrentes;
- vistas guardadas;
- expediente enriquecido;
- exportadores específicos.

Cada uno debe tener ID y condición de entrada.

---

# 7. Entregables documentales de la Fase 0

Crea o actualiza:

```text
docs/roadmaps/CFDI_P0_MASTER_IMPLEMENTATION_PLAN.md
docs/architecture/decisions/ADR-CFDI-001-DURABLE-JOBS.md
docs/architecture/decisions/ADR-CFDI-002-OBJECT-STORAGE.md
docs/architecture/decisions/ADR-CFDI-003-RLS.md
docs/architecture/decisions/ADR-CFDI-004-IDEMPOTENCY-PROVENANCE.md
docs/architecture/decisions/ADR-CFDI-005-XML-PARSER.md
docs/security/CFDI_INGESTION_THREAT_MODEL.md
docs/contracts/CFDI_INGESTION_API.md
docs/operations/CFDI_WORKER_RUNBOOK.md
docs/qa/CFDI_PHASE_1_VALIDATION_REPORT.md
```

Si la estructura real usa rutas equivalentes, conserva la convención y documenta el mapeo.

Actualiza en el mismo cambio:

- `ARCHITECTURE.md`;
- modelo PostgreSQL corregido;
- documentación de navegación si cambia el contrato real;
- README de API y web;
- `.env.example` sin secretos.

No dupliques decisiones incompatibles entre documentos.

---

# 8. Diseño modular requerido

Estructura candidata:

```text
apps/api/src/modules/object-storage/
  object-storage.module.ts
  ports/
  adapters/local-filesystem/
  adapters/s3/
  entities/
  services/

apps/api/src/modules/malware-scanner/
  malware-scanner.module.ts
  ports/
  adapters/clamav/

apps/api/src/modules/ingestion/
  ingestion.module.ts
  ingestion.controller.ts
  ingestion-query.controller.ts
  services/
  entities/
  dtos/
  mappers/
  state-machine/
  workers/
  reconciliation/

apps/api/src/modules/cfdi/
  cfdi.module.ts
  cfdi.controller.ts
  services/
  parsers/
  schemas/
  entities/
  dtos/
  mappers/
  period-policy/

apps/api/src/worker.ts
```

Puedes adaptar nombres a la convención real.

No concentres el pipeline en un único servicio gigante.

No crees repositorios genéricos.

Usa repositorios TypeORM inyectados y `EntityManager` dentro de transacciones.

---

# 9. Modelo físico mínimo de Fase 0–1

Revisa el modelo documental, pero implementa al menos estas entidades.

## 9.1 `stored_objects`

Debe conservar:

- `id`.
- scope completo:
  - `organization_id`;
  - `client_account_id`;
  - `legal_entity_id`.
- kind.
- storage provider.
- bucket/container.
- object key.
- original filename seguro.
- MIME declarado.
- MIME detectado.
- size.
- SHA-256.
- encryption class.
- lifecycle state.
- quarantine reason.
- retention until.
- created/updated/deleted timestamps.
- version.
- composite candidate keys.

Los bytes son inmutables una vez confirmados.

## 9.2 `ingestion_uploads`

Debe modelar:

- workflow.
- scope.
- tipo `manual_xml` o `manual_zip`.
- idempotency key.
- request fingerprint.
- object id.
- state.
- expected size/checksum.
- actual size/checksum.
- upload expiration.
- confirmed at.
- response reference.
- created by membership.
- timestamps/version.

Debe soportar ahora XML directo y después init/confirm de ZIP sin rediseño.

## 9.3 `ingestion_jobs`

Debe incluir:

- scope completo.
- source type.
- root object.
- requested by.
- retry of.
- idempotency/fingerprint.
- status.
- current stage.
- counters.
- attempt count.
- next attempt.
- locked by.
- lease expires.
- heartbeat.
- cancel requested.
- started/completed.
- last error code.
- correlation id.
- timestamps/version.

## 9.4 `ingestion_items`

Debe incluir:

- job.
- object.
- ordinal.
- safe filename.
- technical status.
- product result.
- detected version.
- parser version.
- UUID candidate.
- emitter/receiver RFC candidates.
- hash.
- cfdi id nullable.
- error code.
- safe error details.
- attempts.
- observed at.
- processed at.
- unique job+ordinal.
- checks resultado → cfdi/error.

## 9.5 `cfdis`

Debe incluir:

- scope completo.
- normalized UUID.
- first seen source.
- first seen at.
- last observed at.
- XML object id.
- XML SHA-256.
- parser/schema versions.
- CFDI version.
- type.
- direction.
- emitter/receptor.
- series/folio.
- dates.
- currency/exchange rate.
- subtotal/discount/total.
- payment method/form.
- place of issue.
- TFD metadata.
- SAT fields separados y nullable.
- record status.
- timestamps/version.

Unique:

```text
legal_entity_id + normalized_uuid
```

## 9.6 Detalles CFDI

Implementa tablas explícitas para:

- `cfdi_concepts`;
- `cfdi_taxes`;
- `cfdi_relations`;
- `cfdi_payments`;
- `cfdi_payment_documents`;
- detalle core de nómina;
- observaciones/procedencia si `ingestion_items` no cubre toda la necesidad.

No uses `float`.

Usa `numeric`.

No uses JSONB libre para evitar modelar el dominio.

JSONB sólo se permite para metadata estrictamente versionada, allowlisted y no consultada como dominio.

## 9.7 `period_cfdis`

Debe incluir:

- scope completo.
- period.
- cfdi.
- participation type.
- policy version.
- timezone.
- source date.
- automatic/manual.
- created by.
- timestamps.
- uniqueness acorde al tipo de participación.

## 9.8 `incidents`

Debe soportar scope:

- legal entity;
- period opcional;
- CFDI opcional;
- ingestion job opcional;
- ingestion item opcional;
- SAT job futuro.

Debe exigir un sujeto técnico válido sin inventar período.

## 9.9 Constraints obligatorias

- FKs compuestas same-tenant/same-account/same-entity.
- Un objeto no puede moverse a otro RFC.
- Un item no puede referenciar CFDI de otro scope.
- Unique active RFC existente se conserva.
- UUID normalizado.
- Inmutabilidad del original mediante servicio y, cuando sea viable, constraint/trigger mínimo.
- Checks de estados.
- Índices para:
  - worker claim;
  - listados;
  - polling;
  - dedupe;
  - búsqueda UUID/RFC;
  - jobs por tenant/usuario/status;
  - period participation;
  - retention cleanup.

No escribas una migración hasta terminar el diagrama de constraints.

---

# 10. Worker y reconciliación

## 10.1 Entrypoint

Agrega scripts equivalentes:

```text
start:worker
start:worker:dev
test:integration:fiscal
test:e2e:fiscal
```

## 10.2 Claim

- Claim atómico.
- `SKIP LOCKED`.
- Lease.
- Worker ID.
- Heartbeat.
- Máximo configurable de concurrencia.
- Fairness por tenant.
- No dos workers sobre el mismo job.
- Recuperación del lease vencido.

## 10.3 Redis wakeup

Implementa desde ahora:

- canal con prefijo por ambiente;
- publish best-effort después de commit;
- subscribe del worker;
- polling de PostgreSQL siempre activo como fallback;
- caída de Redis no cambia corrección;
- readiness del worker no falla únicamente por Redis;
- test con Redis disponible;
- test con Redis apagado;
- no usar `KEYS`;
- no usar Redis para payload fiscal ni secreto.

## 10.4 Reconciliadores

Implementa:

- uploads expirados;
- objetos pendientes sin confirmación;
- objetos confirmados sin job;
- jobs con lease vencido;
- counters inconsistentes;
- objetos redundantes por duplicate;
- lifecycle/retention de objetos de Fase 1.

Los reconciliadores deben ser idempotentes.

---

# 11. Upload XML individual

Endpoint candidato:

```text
POST /legal-entities/:legalEntityId/ingestions/xml
```

Contrato:

- sesión;
- tenant;
- asignación;
- `ingestion.create`;
- `Idempotency-Key` obligatorio;
- `multipart/form-data`;
- field `file`;
- exactamente un XML;
- máximo 5 MiB;
- streaming;
- no buffer completo;
- hash durante stream;
- MIME/magic detectado;
- object key generado por servidor;
- `202 Accepted`;
- respuesta con:
  - `uploadId`;
  - `objectId`;
  - `jobId`;
  - status;
  - links de polling;
  - correlationId.

El flujo debe tolerar:

- cliente reintenta tras timeout;
- storage termina y DB confirm falla;
- DB crea intención y storage falla;
- cliente abandona;
- API reinicia;
- worker reinicia.

Ningún caso debe crear dos jobs ni perder trazabilidad.

---

# 12. Pipeline de un XML

Orden obligatorio:

1. Scope y permiso en API.
2. Crear intención/objeto pending.
3. Stream a storage privado.
4. Calcular hash/tamaño/MIME.
5. Confirmar objeto.
6. Crear job durable.
7. Commit.
8. Redis wakeup best-effort.
9. Worker claim.
10. Scope RLS del job.
11. Scanner.
12. Verificación de MIME/magic.
13. Rechazo DTD/DOCTYPE antes de parsear.
14. Parser con red deshabilitada.
15. Límites de profundidad/nodos/atributos/texto/tiempo.
16. Detectar namespace/versión.
17. Extraer TFD y UUID.
18. Comprobar RFC:
    - emisor o receptor debe coincidir con la entidad fiscal.
19. Normalizar UUID.
20. Dedupe y lock.
21. Aplicar política de hash.
22. Persistir core/detalles/observación.
23. Crear participaciones.
24. Crear incidentes.
25. Auditoría transaccional.
26. Marcar item.
27. Reconciliar counters.
28. Terminar job.
29. UI observa estado terminal.

No realices llamadas externas dentro de la transacción fiscal.

---

# 13. Parser seguro

## 13.1 Dependencias

Puedes agregar dependencias sólo si son necesarias.

Antes de instalarlas documenta:

- paquete;
- versión;
- licencia;
- mantenimiento;
- CVEs conocidos;
- alternativas;
- impacto de bundle/runtime;
- por qué Node/Nest actual no basta.

No uses el parser legacy.

## 13.2 Esquemas oficiales

Crea un manifiesto versionado:

```text
namespace
version
official_url
retrieved_at
sha256
local_path
```

Usa únicamente fuentes oficiales del SAT.

No hagas fetch en runtime.

Si no puedes obtener un artefacto oficial, no inventes una copia: marca ese subcaso como bloqueado y no declares soporte.

## 13.3 Reglas

- DTD prohibido.
- Entidades externas prohibidas.
- Red prohibida.
- Entity expansion prohibida.
- Namespace por URI, no por prefijo.
- No usar `parseFloat`.
- No asumir un solo Pago.
- No asumir un solo DoctoRelacionado.
- No inferir cancelación desde XML.
- No autoexcluir por UsoCFDI.
- Conservar importes exactos.
- Errores seguros sin fragmentos XML.
- Parser versionado.
- Fixtures de todas las variantes soportadas.

---

# 14. API de consulta

Implementa al menos:

```text
GET  /ingestions/:ingestionJobId
GET  /ingestions/:ingestionJobId/items
POST /ingestions/:ingestionJobId/retry
POST /ingestions/:ingestionJobId/cancel
GET  /processes
GET  /legal-entities/:legalEntityId/cfdis
GET  /cfdis/:cfdiId
POST /cfdis/:cfdiId/access-url
```

Reglas:

- paginación.
- sort allowlist.
- filtros allowlist.
- no dynamic includes.
- tenant derivado de sesión.
- assignment.
- 404 no enumerante.
- `cfdi.download` + MFA para access URL.
- URL corta y revocable.
- adapter local usa token de un solo uso.
- no exponer hash interno.
- no devolver XML dentro de JSON.

---

# 15. Catálogo de errores

Implementa códigos estables, como mínimo:

```text
RESOURCE_NOT_FOUND
PERMISSION_REQUIRED
MFA_SETUP_REQUIRED
MFA_REQUIRED
IDEMPOTENCY_KEY_REQUIRED
IDEMPOTENCY_CONFLICT
INGESTION_FILE_REQUIRED
INGESTION_UNSUPPORTED_MEDIA_TYPE
INGESTION_FILE_TOO_LARGE
INGESTION_TOO_MANY_FILES
OBJECT_HASH_MISMATCH
OBJECT_STORAGE_UNAVAILABLE
MALWARE_DETECTED
XML_MALFORMED
XML_SECURITY_VIOLATION
CFDI_VERSION_UNSUPPORTED
COMPLEMENT_UNSUPPORTED
CFDI_UUID_INVALID
CFDI_RFC_FOREIGN
CFDI_DUPLICATE
CFDI_UUID_HASH_CONFLICT
FISCAL_PERIOD_NOT_CONFIGURED
JOB_LEASE_LOST
JOB_NOT_RETRYABLE
JOB_STATE_CONFLICT
PARSER_INTERNAL_ERROR
```

Para cada código documenta:

- HTTP o result.
- retryable.
- texto de UI.
- log level.
- auditoría.
- acción recomendada.

---

# 16. Frontend Fase 1

No rediseñes el sistema.

Conecta el diseño existente.

## 16.1 Carga

La acción debe ser:

```text
Cargar XML
```

ZIP y SAT deben estar ocultos o claramente deshabilitados sin fingir funcionamiento.

Flujo:

1. Seleccionar un XML.
2. Validar extensión/tamaño como ayuda, nunca como única defensa.
3. Mostrar progreso real de transferencia.
4. Permitir cancelar upload.
5. Recibir 202.
6. Cambiar a progreso de procesamiento.
7. Polling.
8. Mostrar resultado:
   - incorporado;
   - duplicado;
   - ajeno;
   - inválido;
   - no soportado;
   - error interno.
9. Abrir CFDI o incidente.
10. Recuperar el job después de recarga.

Como `fetch` no ofrece upload progress de forma suficiente, se permite un helper XHR específico dentro de la feature, conservando:

- cookies;
- CSRF;
- abort;
- idempotency;
- errores compartidos;
- tenant activo.

No crees un segundo sistema general de HTTP.

## 16.2 CFDI real

Conecta:

- lista por entidad;
- filtros básicos;
- detalle;
- conceptos;
- impuestos;
- relaciones;
- pagos;
- origen;
- fechas;
- período;
- incidentes;
- descarga XML autorizada.

No uses demo fallback.

## 16.3 Estados

Implementa:

- loading;
- uploading;
- queued;
- processing;
- empty;
- success;
- partial;
- error;
- cancelled;
- stale tenant;
- access revoked;
- not found.

Cambiar tenant cancela upload/polling y limpia estado.

---

# 17. Observabilidad

## 17.1 Métricas

Como mínimo:

```text
ingestion_jobs_created_total
ingestion_jobs_completed_total
ingestion_jobs_failed_total
ingestion_jobs_recovered_total
ingestion_items_total
ingestion_items_by_result
ingestion_duration_seconds
ingestion_queue_age_seconds
ingestion_upload_bytes_total
ingestion_hash_conflicts_total
ingestion_cross_tenant_denials_total
ingestion_scanner_failures_total
ingestion_parser_failures_total
worker_active_jobs
worker_heartbeat_lag_seconds
worker_lease_reclaims_total
object_storage_failures_total
redis_wakeup_failures_total
```

No uses RFC, UUID fiscal, nombres o PII como labels.

## 17.2 Logs

- estructurados;
- correlation ID;
- job ID;
- item ID;
- object ID;
- tenant ID sólo como ID técnico;
- etapa;
- duración;
- resultado;
- sin XML;
- sin nombres;
- sin RFC en texto abierto;
- sin URLs firmadas;
- sin cookies;
- sin secretos.

## 17.3 Health

API:

```text
/liveness
/readiness
```

Worker:

- proceso vivo;
- PostgreSQL;
- object storage;
- scanner;
- Redis informativo/opcional.

PostgreSQL, storage y scanner requerido sí afectan readiness.

Redis no afecta readiness.

---

# 18. Seguridad y pruebas hostiles

Crea corpus de fixtures sintéticos, no reales.

Prueba:

- XML 4.0 válido.
- Ingreso.
- Egreso.
- Traslado.
- Pago con múltiples Pagos.
- Pago con múltiples DoctoRelacionado.
- Nómina.
- Complemento desconocido.
- Versión raíz no soportada.
- XML truncado.
- XML malformado.
- DOCTYPE.
- XXE.
- entity expansion.
- profundidad extrema.
- demasiados nodos.
- atributos excesivos.
- texto enorme.
- MIME falso.
- extensión falsa.
- UUID inválido.
- RFC ajeno.
- duplicate mismo hash.
- hash conflict.
- falta de ejercicio.
- período cerrado.
- tenant B.
- cuenta no asignada.
- revocación durante job.
- session/tenant switch.
- scanner caído.
- storage caído.
- Redis caído.
- worker muerto.
- lease vencido.
- retry concurrente.
- cancelación concurrente.
- misma idempotency key.
- misma key con fingerprint distinto.

No ejecutes payloads peligrosos contra una infraestructura compartida.

---

# 19. Pruebas de persistencia y concurrencia

Usa PostgreSQL real aislado.

Prueba:

- RLS sin GUC.
- RLS tenant A/B.
- table owner.
- API.
- worker.
- composite FKs.
- rollback de auditoría.
- unique UUID.
- same UUID concurrente.
- same idempotency key concurrente.
- claim por dos workers.
- heartbeat.
- lease recovery.
- cancel boundary.
- counters.
- reconciler.
- lifecycle.
- no partial domain.

No reemplaces estas pruebas por mocks.

---

# 20. Infraestructura de desarrollo

Agrega, si no existe, una forma reproducible y aislada de levantar:

- PostgreSQL.
- Redis.
- MinIO o servicio S3-compatible para probar el adapter.
- ClamAV.

Puede ser Docker Compose u otra convención del repositorio.

No sustituyas la base de desarrollo existente sin autorización.

Para E2E usa DB/schema inequívocamente aislado.

No versionar secretos.

---

# 21. Migraciones

La base configurada es de desarrollo y el usuario autoriza ejecutar migraciones ahí.

Antes:

1. `git status`.
2. backup o schema dump cuando sea posible.
3. `migration:show`.
4. preflight.
5. revisar datos incompatibles.

Reglas:

- append-only.
- `synchronize: false`.
- no editar migración aplicada.
- nombres deterministas.
- `timestamptz`.
- `numeric`.
- seeds idempotentes.
- ejecutar dos veces seeds.
- inspeccionar esquema aplicado.
- comparar entities vs DB.
- ejecutar RLS tests después de migrar.

No hacer `DROP DATABASE` ni reset general.

---

# 22. Cancelación y retry

Cancelar:

- no revierte CFDI ya incorporado;
- detiene pendiente en boundary seguro;
- el worker comprueba `cancel_requested`;
- un item en commit termina su transacción;
- terminal → `409 JOB_STATE_CONFLICT`.

Retry:

- nuevo job;
- `retry_of_job_id`;
- reutiliza objeto si sigue disponible;
- sólo errores transitorios/internal;
- invalid/foreign/unsupported/duplicate no se reintentan automáticamente.

---

# 23. Revocación durante trabajo

- El solicitante pierde inmediatamente polling, cancel, retry y descarga.
- El worker continúa como identidad de servicio si:
  - organización activa;
  - cuenta activa;
  - entidad activa;
  - scope intacto.
- Si tenant/cuenta/entidad se suspenden:
  - job se pausa o falla seguro;
  - no crea nuevos CFDI.
- Auditoría obligatoria.
- No conservar acceso del usuario revocado.

---

# 24. Definition of Done de Fase 0

Fase 0 sólo queda `DONE` si:

- roadmap creado;
- ADRs creados;
- threat model creado;
- permisos/seed ejecutables;
- tablas foundation migradas;
- RLS activo;
- claim seguro;
- worker inicia;
- lease/heartbeat funcionan;
- reconciler funciona;
- Redis wakeup funciona;
- Redis apagado no rompe;
- local storage funciona;
- S3 adapter compila y tiene integración contra MinIO/S3-compatible;
- ClamAV adapter funciona;
- producción falla si scanner deshabilitado;
- health/readiness funciona;
- métricas existen;
- configuración validada;
- runbook existe;
- pruebas de foundation pasan;
- sin TODO técnico;
- debt register vacío.

---

# 25. Definition of Done de Fase 1

Fase 1 sólo queda `DONE` si:

1. Usuario puede cargar un XML real sintético desde UI.
2. Upload es streaming.
3. Progreso es real.
4. API devuelve 202.
5. Cerrar/recargar no pierde job.
6. Reiniciar API no pierde job.
7. Reiniciar worker no pierde job.
8. Redis apagado no pierde ni retrasa más allá del polling configurado.
9. Scanner se ejecuta.
10. Parser rechaza XXE/DTD.
11. CFDI 4.0 se persiste.
12. TFD 1.1 se persiste.
13. Pagos 2.0 soporta múltiples pagos y documentos.
14. Nómina 1.2 core se persiste y queda protegida.
15. Tipos I/E/T/N/P se distinguen.
16. UUID+RFC se validan.
17. Duplicate mismo hash no duplica.
18. Hash conflict no reemplaza.
19. Foreign/invalid/unsupported no entran al dominio.
20. Period participations se crean según policy.
21. Falta de período crea incidente.
22. Lista y detalle usan API real.
23. XML se descarga mediante acceso autorizado y temporal.
24. `cfdi.download` exige MFA.
25. Tenant B no accede.
26. No asignado no accede.
27. RLS bloquea.
28. FKs bloquean cruces same-tenant.
29. Idempotency funciona concurrentemente.
30. Cancel/retry funcionan.
31. Auditoría no contiene XML.
32. Logs no contienen PII/secreto.
33. Métricas existen.
34. Unit, integration, E2E, frontend y build pasan.
35. Migraciones y seeds pasan sobre desarrollo.
36. QA manual guiado completado o claramente listo.
37. No existe demo fallback.
38. `TECHNICAL_DEBT = 0`.
39. `KNOWN_DEFECTS = 0`.
40. Sólo quedan capacidades asignadas a Fases 2–8.

---

# 26. Comandos de validación

Descubre scripts reales y ejecuta equivalentes a:

```bash
bun run --cwd apps/api format
bun run --cwd apps/api lint
bun run --cwd apps/api test
bun run --cwd apps/api test:integration:fiscal
bun run --cwd apps/api test:e2e:fiscal
bun run --cwd apps/api build

bun run --cwd apps/web lint
bun run --cwd apps/web typecheck
bun run --cwd apps/web test
bun run --cwd apps/web build

bun run --cwd apps/api typeorm migration:show
bun run --cwd apps/api migration:run
bun run --cwd apps/api seed:run

git diff --check
```

No uses `--fix` global sobre código ajeno.

Distingue baseline de regresión.

Los archivos nuevos/modificados deben estar limpios.

---

# 27. Forma de trabajo

1. Inspecciona el repo y worktree.
2. No reviertas cambios del usuario.
3. Crea el plan maestro.
4. Crea ADRs/threat model/contrato.
5. Actualiza estado de Fase 0 a `IN_PROGRESS`.
6. Implementa Fase 0.
7. Valida Fase 0.
8. Marca Fase 0 `DONE` sólo si cumple su gate.
9. Actualiza Fase 1 a `IN_PROGRESS`.
10. Implementa XML individual.
11. Ejecuta migraciones en desarrollo.
12. Ejecuta pruebas.
13. Ejecuta QA de navegador cuando el entorno lo permita.
14. Corrige todos los defectos encontrados.
15. Actualiza documentación.
16. Marca Fase 1 `DONE` o `BLOCKED`.
17. No empieces ZIP.
18. Entrega reporte.

No pauses para preguntar decisiones ya bloqueadas.

Si aparece una incompatibilidad real:

- demuestra evidencia;
- registra bloqueo;
- propone la corrección mínima;
- continúa con trabajo no bloqueado;
- no inventa.

---

# 28. Reporte final

Al terminar responde con:

## 1. Veredicto

```text
PHASE_0_AND_1_DONE
PHASE_0_DONE_PHASE_1_BLOCKED
PARTIALLY_COMPLETE
NOT_READY
```

## 2. Plan maestro

- ruta;
- fases;
- estado.

## 3. Arquitectura implementada

- módulos;
- worker;
- Redis;
- storage;
- scanner;
- RLS;
- parser;
- DB.

## 4. Migraciones

- nombres;
- preflight;
- ejecución;
- schema verification.

## 5. Flujo XML

- endpoint;
- etapas;
- UI;
- resultado.

## 6. Seguridad

- cross-tenant;
- assignment;
- RLS;
- XXE;
- scanner;
- idempotency;
- secrets;
- logs.

## 7. Pruebas

Tabla:

```text
Comando | Resultado | Casos | Observación
```

## 8. Defectos encontrados y corregidos

- síntoma;
- causa;
- cambio;
- test.

## 9. Registro de deuda

Debe mostrar:

```text
TECHNICAL_DEBT
KNOWN_DEFECTS
DEFERRED_PRODUCT_CAPABILITIES
```

No ocultes defectos como capacidades futuras.

## 10. Próxima fase

Debe indicar exactamente:

```text
NEXT_PHASE: PHASE_2_ZIP
ENTRY_CRITERIA: ...
```

## 11. Git

Incluye:

```bash
git status --short
git diff --stat
git diff --name-status
git ls-files --others --exclude-standard
```

No hagas commit ni push.

No afirmes que algo pasó si no lo ejecutaste.
