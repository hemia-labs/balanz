# Nota para despliegue — Fase 3

`.github/workflows/ci.yml` y `.github/workflows/deploy-dev.yml` **permanecen intactos**. No se requieren pasos nuevos indispensables: los tests API usan el runner existente, los nuevos tests web están registrados en `apps/web/package.json` y las migraciones de Fase 3 pasan por `release:prepare → db:prepare → migration:preflight → migration:run → seed:run`. No hay segunda ejecución, bootstrap de VPS ni cambio a S3 del equipo.

Integrar código no habilita custodia: `EFIRMA_ENABLED` permanece false. API/frontend/worker deben seguir funcionando sin Vault Transit cuando está desactivada. No activar en develop administrado ni cargar e.firmas reales: aprobación legal/operativa pendiente y perfil SAT real no implementado/verificado.

Para QA aislado, configurar los dos perfiles y las tres identidades AppRole de la [matriz](CFDI_PHASE_3_CONFIGURATION.md): Vault dedicado loopback, mount Transit/key derivados no exportables, políticas wrap/encrypt, decrypt/unwrap y revoke-accessor separadas; archivo de generación fuera de snapshots; manifiesto de confianza de fixtures sintéticos; PostgreSQL `test_*` con API/worker restringidos; storage privado con SSE. No persistir contraseñas de llaves en Vault/KV. El bucket usa las capacidades existentes de PUT/GET/DELETE; no necesita CORS de upload firmado para credenciales.

Dos migraciones de Fase 3: la original `1787691000000-PhaseThreeEfirmaCustody` y la correctiva append-only `1787691010000-PhaseThreeCustodyReconciliation`. La segunda responde a la revisión de PR #24: separa los lotes de reconciliación y purga e indexa el orden real. Se conserva la original porque ya fue compartida; el runner omite las migraciones registradas y aplica sólo las pendientes. No se modifican migraciones ya aplicadas, incluida Fase 2. Provisionar mounts/roles/secret IDs y permisos de archivos corresponde al mecanismo externo existente. No introducir secretos en SQL, seeds, logs ni GitHub comments.

Validación previa a cualquier habilitación futura: integración sintética con identidades restringidas, restore con generación nueva, cleanup y revisión de retención/versiones/backups. Reversión funcional: desactivar capacidad/consumidores, conservar generación segura, revocar intenciones, completar cleanup; no revertir historial SQL ni restaurar snapshots con generación antigua.

Esta nota no cierra los pendientes PostgreSQL API/worker compartidos, secretos runtime en Vault ni gates históricos de Fases 0/1/2. La evidencia local sintética se reporta por separado.

## Correcciones de revisión de PR #24

Sin nuevos secretos, variables, permisos de infraestructura ni pasos de CI. La migración correctiva ajusta el índice de pendientes y agrega una función de selección de metadata con EXECUTE exclusivo del worker, usando el propietario restringido existente. Ejecutar el release habitual antes de iniciar el worker actualizado. No editar registros de migraciones ni usar synchronize. La reversión de esquema es forward-only mediante otra migración revisada; no revertir la migración original compartida.

Expiración y leases de reconciliación/claim se deciden en PostgreSQL. Los clientes Vault son singleton por capacidad e identidad; sólo reutilizan el login AppRole durante su lease, con reloj monotónico y un login concurrente. No cachean ni reintentan unwrap. Se mantienen separados preparador, consumidor y limpieza.
