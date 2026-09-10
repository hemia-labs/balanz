# Nota para integraciones — Fase 4
Los workflows .github/workflows/ci.yml y .github/workflows/deploy-dev.yml permanecen intactos. No se agrega otra ejecución de migraciones, build o arranque. Se reutiliza release:prepare → db:prepare → migration:preflight → migration:run → seed:run. Una migración nueva: 1787691100000-PhaseFourSatOnDemand; las históricas se conservan. Ningún secreto, rol runtime remoto o trust bundle se aprovisiona por migración/seed.

Mantener SAT_ENABLED=false y EFIRMA_ENABLED=false en ambientes administrados. Esta entrega no autoriza activación real ni despliegue. Las pruebas controladas requieren NODE_ENV=test, SAT_QA_ISOLATED=true, EFIRMA_QA_ISOLATED=true y la configuración F3 aislada (DB test_*, endpoints loopback, sin Vault KV compartido). SAT_CONTROLLED_ENDPOINT es sólo del servidor de pruebas; jamás fallback de producción. Se mantiene rechazo de activación administrada incluso si se establece el flag.

Para futura habilitación aprobada: egress HTTPS exacto hacia cfdidescargamasivasolicitud.clouda.sat.gob.mx (autenticación, solicitud y verificación) y cfdidescargamasiva.clouda.sat.gob.mx (descarga); reloj sincronizado. No redirecciones ni endpoints del cliente. Contrato real del adaptador implementado, sin llamadas autenticadas reales realizadas.

Reutilizar bucket privado y SSE/SSE-KMS, streaming/range/multipart/abort/delete de objetos opacos. No necesita CORS de browser para descarga SAT: worker recibe los paquetes. No exponer bucket, cert/key, tokens ni URLs firmadas. Metadata y XML siguen en objetos privados. Límites SAT Hemia 50/250 MiB; ClamAV real y límites compatibles.

Vault F3: preparador wrap + Transit encrypt; consumidor Transit decrypt + unwrap; limpieza revoke-accessor; AppRoles separados, sin KV cache para secreto one-time, sin root/admin/export de claves. Generación de custodia fuera del snapshot y rotación obligatoria al restore. En esta tarea sólo se aprovisionó Vault desechable de pruebas.

Pendiente externo: bundle real versionado con raíces, hashes, fuentes y generaciones e.firma/CSD verificadas; aprobación operativa/legal de custodia cifrada temporal, backups/versionado, borrado físico y restauración. DB/WAL, snapshots Vault y versiones de storage pueden conservar copias históricas. Delete marker no acredita borrar versiones. No se cierran gates heredados PostgreSQL/Vault ni reportes históricos por el deploy vigente.

Validación/reversión: probar con identidades restringidas y servidor controlado; desactivar SAT_ENABLED para impedir llamadas nuevas. Conservar esquema/folios/paquetes y ejecutar cleanup específico autorizado; no revertir migraciones aplicadas ni restaurar workflows retirados. No se realizó despliegue ni merge.
