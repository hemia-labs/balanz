# Nota para integraciones — Fase 4
Los workflows .github/workflows/ci.yml y .github/workflows/deploy-dev.yml permanecen intactos. No se agrega otra ejecución de migraciones, build o arranque. Se reutiliza release:prepare → db:prepare → migration:preflight → migration:run → seed:run. Una migración nueva: 1787691100000-PhaseFourSatOnDemand; las históricas se conservan. Ningún secreto, rol runtime remoto o trust bundle se aprovisiona por migración/seed.

Mantener SAT_ENABLED=false y EFIRMA_ENABLED=false en ambientes administrados. Esta entrega no autoriza activación real ni despliegue. Las pruebas controladas requieren NODE_ENV=test, SAT_QA_ISOLATED=true, EFIRMA_QA_ISOLATED=true y la configuración F3 aislada (DB test_*, endpoints loopback, sin Vault KV compartido). SAT_CONTROLLED_ENDPOINT es sólo del servidor de pruebas; jamás fallback de producción. El cierre PR25 prepara el modo administrado real_pilot separado; los flags por sí solos no bastan. No hay autorización operativa ni bundle de titular suministrado, y continúa desactivado.

Para futura habilitación aprobada: egress HTTPS exacto hacia cfdidescargamasivasolicitud.clouda.sat.gob.mx (autenticación, solicitud y verificación) y cfdidescargamasiva.clouda.sat.gob.mx (descarga); reloj sincronizado. No redirecciones ni endpoints del cliente. Contrato real del adaptador implementado, sin llamadas autenticadas reales realizadas.

Reutilizar bucket privado y SSE/SSE-KMS, streaming/range/multipart/abort/delete de objetos opacos. No necesita CORS de browser para descarga SAT: worker recibe los paquetes. No exponer bucket, cert/key, tokens ni URLs firmadas. Metadata y XML siguen en objetos privados. Límites SAT Hemia 50/250 MiB; ClamAV real y límites compatibles.

Vault F3: preparador wrap + Transit encrypt; consumidor Transit decrypt + unwrap; limpieza revoke-accessor; AppRoles separados, sin KV cache para secreto one-time, sin root/admin/export de claves. Generación de custodia fuera del snapshot y rotación obligatoria al restore. La integración inicial del 2026-09-10 utilizó Vault desechable de pruebas; este cierre no aprovisionó infraestructura.

Pendiente externo: bundle real versionado con raíces, hashes, fuentes y generaciones e.firma/CSD verificadas; aprobación operativa/legal de custodia cifrada temporal, backups/versionado, borrado físico y restauración. DB/WAL, snapshots Vault y versiones de storage pueden conservar copias históricas. Delete marker no acredita borrar versiones. No se cierran gates heredados PostgreSQL/Vault ni reportes históricos por el deploy vigente.

Validación/reversión: probar con identidades restringidas y servidor controlado; desactivar SAT_ENABLED para impedir llamadas nuevas. Conservar esquema/folios/paquetes y ejecutar cleanup específico autorizado; no revertir migraciones aplicadas ni restaurar workflows retirados. No se realizó despliegue ni merge.


## Configuración futura del piloto XML (código preparado, no activación autorizada)
CI y deploy-dev siguen intactos. No hay nueva migración ni dependencia en este cierre. No deben cambiar los workflows para habilitarlo.

- Mantener SAT_ENABLED=false / EFIRMA_ENABLED=false hasta autorización humana separada.
- Futuro modo: NODE_ENV=production, EFIRMA_RUNTIME_MODE=real_pilot, EFIRMA_CERTIFICATE_PROFILE=sat_efirma_v1. Rechaza EFIRMA_QA_ISOLATED, SAT_QA_ISOLATED, SAT_CONTROLLED_ENDPOINT y confianza sintética. Los endpoints SAT se componen exclusivamente con la allowlist oficial; no se aceptan URLs de petición.
- EFIRMA_VAULT_ADDR HTTPS, AppRoles PREPARER/CONSUMER/CLEANUP separados y paths Transit existentes. Inyectar las referencias/credenciales por el mecanismo operativo seguro; no se aprovisionan mounts, políticas o secretos desde CI/migración. Producción mantiene S3 HTTPS/SSE-KMS y ClamAV del validador vigente.
- EFIRMA_SAT_TRUST_FILE: ruta absoluta al bundle mínimo revisado, con reglas de una generación acreditada. El archivo público de CA del repositorio es evidencia, no ese bundle.
- EFIRMA_REAL_PILOT_AUTHORIZATION_FILE: ruta absoluta a JSON externo, máximo8KiB, version1, purpose sat_xml_pilot, organizationId, legalEntityId, authorizationReference, notBefore, expiresAt, generation y trustBundleSha256. Ventana de habilitación del piloto máximo24h (límite Hemia); no renueva los diez minutos de custodia. Debe ser de sólo lectura para runtimes y modificable únicamente por operaciones autorizadas. No se genera en esta PR. authorizationReference remite a una decisión humana registrada; su presencia no constituye un dictamen legal del sistema.
- El archivo se verifica al preparar/consumir y antes de nuevas llamadas por autoridad vigente. Borrarlo, vencerlo, cambiar el hash del bundle o rotar la generación deniega nuevos usos. La API conserva consulta y cancelación de procesos con permisos vigentes. No se conserva token SAT en DB/Redis.

Antes de instalarlo: arquitectura/seguridad aportan el perfil positivo e.firma/CSD de una generación y su bundle; operaciones verifica identidades, egress, reloj, SSE/retención/versionado y restore; responsables legal/operativo deciden uso real y custodia/backups. Si el discriminador oficial no es el policyOid actualmente previsto, falta implementar esa regla concreta antes de habilitar. No basta editar variables para acreditar compatibilidad.

Reversión del piloto: desactivar SAT_ENABLED y retirar el artefacto operativo; conservar procesos/folios y permitir cleanup. Cambiar bundle o restaurar exige generación externa nueva y nueva autorización operativa antes de consumidores. No revertir esquema ni copiar permisos/fixtures de QA.
