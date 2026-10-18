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

## Revisión PREPROD-UAT-PREP-1 (2026-10-18)

Este procedimiento sigue **condicionado**: la PC no tiene un target institucional y no se hizo deploy. El paquete de software no sustituye host, DB, TLS, DNS, storage, backup/restore ni autorizaciones.

### Gates y orden de ejecución

1. Congelar SHA de 40 hex y exigir checkout limpio; `GIT_COMMIT_SHA` debe coincidir exactamente con `git rev-parse HEAD`.
2. Confirmar por ticket/owner que host, puerto, DB, rol, storage, OpenSearch, proxy y ambiente son PREPROD. No usar DEV `127.0.0.1:55432/buscador_juridico_civil_dev`, rol `bjc_dev`, ni puertos locales 5432/5433 como destino.
3. Tomar backup verificado de DB **y** storage en ubicación separada; comprobar SHA-256 y que el manifiesto target coincide con DB/rol aprobados. El script aborta si artefactos no existen o no coinciden.
4. Inyectar secretos sólo desde vault. `BJC_PREPROD_DATABASE_APPROVED=true` es una aprobación explícita adicional, no sustituye la autorización del owner.
5. Ejecutar `check` sin conexión; revisar host/puerto/base/rol y `DATABASE_URL` PostgreSQL TLS `sslmode=verify-full`. Después ejecutar `target-verify` y sólo continuar si prueba identidad real. La guardia rechaza DEV, loopback y destino ambiguo.
6. Confirmar CORS con origins HTTPS explícitos, `BJC_API_BIND_HOST=127.0.0.1`, `SEARCH_ENGINE=opensearch`, OpenSearch HTTPS autenticado, alias `galilei-preprod-search-active`, prefijo `galilei-preprod-search`, storage absoluto persistente, flags diagnóstico apagados y OCR deshabilitado.
7. Revisar `migrate-status`, el diff de migraciones y el rollback/fix-forward aprobado. Sólo entonces `migrate-deploy` en DB aislada. Nunca migrar en startup, usar `db push`, `migrate reset` ni restaurar encima de DB viva.
8. Construir backend y frontend con commit/build IDs registrados; iniciar DB/OpenSearch/storage, API detrás del proxy local y luego frontend. Confirmar readiness, projection verify y smoke preprod. Registrar evidencia sanitizada.
9. Si falla un gate, detener el release, conservar logs sanitizados y aplicar rollback de aplicación compatible; cambios de schema requieren fix-forward o restore a DB reemplazo ensayada.

La plantilla del backend requiere `sslmode=verify-full`, identidad DB explícita y valores reales únicamente desde vault. El guard de arranque valida TLS completo para PostgreSQL, host no loopback, base/rol aprobados, storage separado y OpenSearch seguro. La plantilla del frontend exige `NEXT_PUBLIC_API_URL=https://<api-aprobada>/api`; `scripts/preprod-build-env.cjs` impide bundles que apunten a localhost, HTTP, origen distinto o rutas no aprobadas.

No declarar READY por build local: la recuperación actual sólo aporta preparación/código y plan; restore, host, smoke en el target y UAT siguen sin evidencia.
