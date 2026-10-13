# 136 — Runbook de deploy a preproducción

**Estado:** procedimiento condicionado, no ejecutable en este workspace mientras falten host, credenciales y base preprod autorizados. Las referencias a comandos Prisma describen la secuencia; nunca ejecutarlos contra DEV como sustituto.

## Gate previo (todos obligatorios)

- Aprobación de IT/owner del host privado, acceso, ventana y responsable de rollback.
- DB nueva e independiente identificada y verificada: host/puerto/base/rol autorizados, fuera de DEV y fuera de producción.
- Corpus/manifest aprobado, ACL/visibilidad/anonimización/retención acordadas; storage persistente aprobado.
- Secretos cargados por vault/mecanismo institucional, sin archivos versionados; CORS/TLS/proxy/IP/rate limit definidos.
- Backup previo de DB y storage con SHA y restore drill aislado; RPO/RTO y disco aceptados.
- Build ID y artifacts auditados; migraciones revisadas; plan de rollback específico de cada migración.

## Secuencia aprobada para completar en el host

1. Congelar release y registrar build/commit ID; tomar y verificar backup de DB **y storage**.
2. Provisionar variables desde el mecanismo aprobado; validar configuración fail-closed y destino DB exacto.
3. Desplegar artefactos backend/frontend y verificar dependencias; backend requiere `NODE_ENV=production` y `BJC_DEPLOYMENT_ENV=preprod`.
4. Desde `JurisprudenciaN\back`, ejecutar `node scripts/with-preprod-db-guard.cjs check`; debe pasar y decir `NO_DATABASE_CONNECTION=TRUE`. Si aborta, no corregir a mano la URL ni continuar: resolver el manifest aprobado.
5. Ejecutar `node scripts/with-preprod-db-guard.cjs migrate-status`; verificar que Prisma sólo ve la DB preprod autorizada. Luego `node scripts/with-preprod-db-guard.cjs migrate-deploy` y repetir `migrate-status`. El wrapper valida la identidad antes de cada acción y sólo permite esas dos operaciones. No `migrate reset`, no `db push`, no restore sobre una DB viva.
6. Importar paquete sólo con autorización, precedido por manifest/hash y dry-run; reconstruir/verificar proyección sólo si está justificado y dentro de ventana.
7. Iniciar servicios detrás de proxy/TLS privado; comprobar CORS y trust proxy; readiness.
8. Smoke: health, login/logout, Search y casos del doc 132, viewer, permisos, curaduría, Digesto, audit, disable/role change y backup status.
9. Registrar errores/P0/P1, métricas, hora y responsables; detener UAT si ACL/visibilidad incorrecta.

## Rollback

Restaurar versión de aplicación compatible sólo según estrategia ensayada. Una migración aplicada no se revierte prometiendo downgrade automático: decidir fix-forward o restore aislado según impacto/datos y aprobación del owner. Si se requiere restore, usar DB de reemplazo temporal verificada, no sobrescribir a ciegas. Conservar logs/auditoría según política.
