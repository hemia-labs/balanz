# Reglas del repositorio

Estas instrucciones aplican a todo el monorepo. Las instrucciones de un directorio pueden
añadir restricciones, pero no relajar estas reglas. Ante un conflicto, prevalecen los
requisitos explícitos del usuario y las garantías de seguridad, privacidad, integridad de
datos, contabilidad y accesibilidad.

## Antes de modificar

- Revisa el estado Git y conserva cambios ajenos a la tarea.
- Lee el `AGENTS.md` más cercano y la documentación normativa del área afectada.
- Recorre el flujo real y busca implementaciones existentes antes de crear código.
- Si documentación y código difieren, no copies ninguno a ciegas: determina la intención y
  corrige la divergencia dentro del alcance solicitado o repórtala.

## Implementación mínima

- Implementa sólo lo solicitado y corrige la causa en el punto compartido más cercano.
- Prefiere, en orden: eliminar, reutilizar código existente, plataforma o biblioteca estándar,
  dependencia ya instalada y finalmente el código nuevo mínimo.
- No agregues dependencias, workspaces, directorios raíz ni patrones arquitectónicos sin una
  necesidad actual demostrable y aprobación explícita.
- No crees interfaces con una implementación, factories para un caso, repositorios genéricos,
  servicios base, wrappers, buses de eventos, capas o flags de configuración "por si acaso".
- Una abstracción nueva debe reducir duplicación real o encapsular una frontera real. Dos
  implementaciones hipotéticas no cuentan.
- Mantén el diff enfocado: sin refactors, renombres o formateo no relacionados.

## Límites del sistema

- El producto es un monolito modular NestJS con un frontend Next.js y un worker separado dentro
  del mismo monorepo y release.
- Terraform y Ansible, administrados fuera de este repositorio, son responsables de provisionar
  y configurar la infraestructura. No agregues aquí bootstrap del VPS, instalación de paquetes,
  usuarios, firewall ni configuración del sistema operativo.
- GitHub Actions compila, valida, transfiere y activa releases; no debe duplicar Terraform o
  Ansible. Los manifiestos locales de `infra/` existen sólo para desarrollo y validación local.
- PostgreSQL es la fuente durable. Redis es una optimización prescindible, no una autoridad ni
  una cola durable.

## Garantías que no se simplifican

- Valida toda entrada en límites de confianza.
- Conserva autenticación, autorización, aislamiento por tenant, protección de secretos y PII.
- Los cambios de esquema requieren una migración nueva; nunca uses `synchronize: true` ni edites
  una migración ya aplicada.
- No ejecutes migraciones ni mutaciones de datos o servicios externos salvo solicitud explícita.
- No elimines manejo de errores que prevenga pérdida o corrupción de datos.
- La lógica no trivial debe incluir la comprobación automatizada más pequeña que detecte una
  regresión real.

## Definición de terminado

- Ejecuta lint, typecheck, tests y build aplicables al área modificada.
- No corrijas fallos preexistentes fuera de alcance; repórtalos separadamente.
- Resume archivos modificados, verificaciones ejecutadas y cualquier limitación restante.
