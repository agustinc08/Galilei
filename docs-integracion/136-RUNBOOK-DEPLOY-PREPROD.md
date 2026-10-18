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

La plantilla del backend requiere `sslmode=verify-full`, `sslrootcert` coincidente con `BJC_PREPROD_DB_CA_PATH`, identidad DB explícita y valores reales únicamente desde vault. El guard aprueba una identidad declarada; sólo `target-verify` contra el host provisionado demuestra la identidad efectiva y la negociación TLS. El runtime usa un `pg.Pool` explícito con CA y `rejectUnauthorized=true`; las operaciones Prisma CLI reciben una URL canónica producida por el guard, con host/puerto/base/rol aprobados y exactamente un parámetro por control TLS. No se imprime ni registra esa URL. La plantilla del frontend exige `NEXT_PUBLIC_API_URL=https://<api-aprobada>/api`; `scripts/preprod-build-env.mjs` impide bundles que apunten a HTTP, loopback/local, origen distinto o rutas no aprobadas.

## PREPROD-FIX-1 — contrato de ejecución revisado

La rama `feature/preprod-uat-fix` exige `NODE_ENV=production` y `BJC_DEPLOYMENT_ENV=preprod` concordantes antes de `NestFactory.create`; un marcador ausente, inválido o discordante aborta antes de inicializar providers y sus hooks. `production` aplica su propio esquema obligatorio, sin alias/prefijo Search DEV por defecto. Desarrollo conserva `galilei-search-active` y `galilei-search`.

La URL PostgreSQL acepta únicamente `sslmode=verify-full`, `sslrootcert` y `sslcert` absolutos iguales, por `realpath`, a la CA configurada, además de `sslaccept=strict` para Prisma CLI. Rechaza parámetros duplicados, identidad/host/servicio/opciones alternativos, CA no confiable y nombres DEV. Los clientes de aplicación, target-verify, db-report y proyección se construyen desde el `pgConfig` aprobado con CA y `rejectUnauthorized=true`; Prisma CLI recibe sólo la URL canónica generada por la misma validación, usando su parámetro de CA `sslcert` y `sslaccept=strict`. `pg_dump` recibe host/puerto/base/rol como argumentos explícitos, `PGSSLMODE=verify-full`, `PGSSLROOTCERT` y `PGPASSFILE`; se limpian overrides `PG*` heredados. Nunca pasar contraseña por argumentos. El plan de backup verifica configuración/target antes de invocar libpq. El manifiesto registra `tlsMode=verify-full`; el restore sigue **NOT PROVEN**.

Antes de iniciar backend, confirmar DB y OpenSearch aprobados/healthy, storage PREPROD montado y ACL correctas, TLS/proxy listos, backup reciente con manifest, migraciones en estado revisado y ventana aprobada. El startup **no es read-only**: puede marcar `SourceScanRun` QUEUED/RUNNING como FAILED, marcar fuentes como ERROR, recuperar jobs OCR stale y arrancar el worker de sincronización OpenSearch/outbox. No iniciar sobre una restauración/importación incompleta ni asumir que la proyección queda quieta. Prisma migrations son explícitas y no se ejecutan al iniciar Nest.

Topología elegida y soportada por la configuración PREPROD: backend en el host y API en `127.0.0.1`, detrás de reverse proxy TLS **en el mismo host**. La operación en host real todavía no está certificada. Reverse proxy separado en contenedor no está certificado ni es compatible con el bind loopback actual; requiere un diseño de red/bind privado revisado. No cambiar a `0.0.0.0` como ajuste de despliegue.

Storage PREPROD se compara por rutas canónicas/`realpath`, incluyendo ancestros y descendientes; la raíz PREPROD debe existir. En Windows se normalizan mayúsculas y se siguen symlinks/junctions existentes; para raíces aún inexistentes el guard canonicaliza el padre existente y añade el sufijo esperado.

El contrato de variables está en `.env.preprod.example` y `.env.production.example`: DEV conserva defaults locales; PREPROD/PROD requieren marcador, aprobación, identidad DB/TLS/CA, namespace Search, storage, HTTPS, JWT y límites runtime explícitos. `NEXT_PUBLIC_API_URL` es build-time; credenciales DB/OpenSearch/JWT y rutas de storage son runtime. Ningún ejemplo contiene secretos utilizables.

No declarar READY por build local: la recuperación actual sólo aporta preparación/código y plan; restore, host, smoke en el target y UAT siguen sin evidencia.
