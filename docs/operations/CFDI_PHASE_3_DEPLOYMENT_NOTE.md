# Nota para despliegue — Fase 3

`.github/workflows/ci.yml` y `.github/workflows/deploy-dev.yml` **permanecen intactos**. No se requieren pasos nuevos indispensables: los tests API usan el runner existente, los nuevos tests web están registrados en `apps/web/package.json` y la única migración nueva pasa por `release:prepare → db:prepare → migration:preflight → migration:run → seed:run`. No hay segunda ejecución, bootstrap de VPS ni cambio a S3 del equipo.

Integrar código no habilita custodia: `EFIRMA_ENABLED` permanece false. API/frontend/worker deben seguir funcionando sin Vault Transit cuando está desactivada. No activar en develop administrado ni cargar e.firmas reales: aprobación legal/operativa pendiente y perfil SAT real no implementado/verificado.

Para QA aislado, configurar los dos perfiles y las tres identidades AppRole de la [matriz](CFDI_PHASE_3_CONFIGURATION.md): Vault dedicado loopback, mount Transit/key derivados no exportables, políticas wrap/encrypt, decrypt/unwrap y revoke-accessor separadas; archivo de generación fuera de snapshots; manifiesto de confianza de fixtures sintéticos; PostgreSQL `test_*` con API/worker restringidos; storage privado con SSE. No persistir contraseñas de llaves en Vault/KV. El bucket usa las capacidades existentes de PUT/GET/DELETE; no necesita CORS de upload firmado para credenciales.

Una migración: `1787691000000-PhaseThreeEfirmaCustody`. No se modifican migraciones ya aplicadas, incluida Fase 2. Provisionar mounts/roles/secret IDs y permisos de archivos corresponde al mecanismo externo existente. No introducir secretos en SQL, seeds, logs ni GitHub comments.

Validación previa a cualquier habilitación futura: integración sintética con identidades restringidas, restore con generación nueva, cleanup y revisión de retención/versiones/backups. Reversión funcional: desactivar capacidad/consumidores, conservar generación segura, revocar intenciones, completar cleanup; no revertir historial SQL ni restaurar snapshots con generación antigua.

Esta nota no cierra los pendientes PostgreSQL API/worker compartidos, secretos runtime en Vault ni gates históricos de Fases 0/1/2. La evidencia local sintética se reporta por separado.
