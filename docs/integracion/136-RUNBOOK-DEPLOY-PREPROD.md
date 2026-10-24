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
4. Desde `server`, ejecutar `node scripts/with-preprod-db-guard.cjs check`; debe pasar y decir `NO_DATABASE_CONNECTION=TRUE`. Si aborta, no corregir a mano la URL ni continuar: resolver el manifest aprobado.
5. Ejecutar `node scripts/with-preprod-db-guard.cjs migrate-status`; verificar que Prisma sólo ve la DB PREPROD autorizada. Revisar el diff de migraciones y el fix-forward/rollback aprobado; sólo entonces ejecutar `node scripts/with-preprod-db-guard.cjs migrate-deploy` y repetir `migrate-status`. El guard construye la conexión Prisma desde la identidad validada; no copiar ni sobrescribir `DATABASE_URL` alrededor del guard. No `migrate reset`, no `db push`, no restore sobre una DB viva.
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
5. Ejecutar `check` sin conexión; revisar host/puerto/base/rol y que `DATABASE_URL` de entrada use TLS `sslmode=verify-full` y la CA aprobada. Después ejecutar `target-verify` y sólo continuar si prueba identidad real. La guardia rechaza DEV, loopback y destino ambiguo.
6. Confirmar CORS con origins HTTPS explícitos, `BJC_API_BIND_HOST=127.0.0.1`, `SEARCH_ENGINE=opensearch`, OpenSearch HTTPS autenticado, alias `galilei-preprod-search-active`, prefijo `galilei-preprod-search`, storage absoluto persistente, flags diagnóstico apagados y OCR deshabilitado.
7. Desde `server`, ejecutar `node scripts/with-preprod-db-guard.cjs migrate-status`, revisar el diff de migraciones y el rollback/fix-forward aprobado, y sólo entonces ejecutar `node scripts/with-preprod-db-guard.cjs migrate-deploy` contra la DB PREPROD aislada. El guard valida la identidad y deriva la URL Prisma del objeto aprobado para cada proceso; no copiar ni sobrescribir `DATABASE_URL` alrededor del guard. Nunca migrar en startup, usar `db push`, `migrate reset` ni restaurar encima de DB viva.
8. Construir backend y frontend con commit/build IDs registrados; iniciar DB/OpenSearch/storage, API detrás del proxy local y luego frontend. Confirmar readiness, projection verify y smoke preprod. Registrar evidencia sanitizada.
9. Si falla un gate, detener el release, conservar logs sanitizados y aplicar rollback de aplicación compatible; cambios de schema requieren fix-forward o restore a DB reemplazo ensayada.

La plantilla del backend requiere `sslmode=verify-full`, `sslrootcert` coincidente con `BJC_PREPROD_DB_CA_PATH`, identidad DB explícita y valores reales únicamente desde vault. El guard valida una vez y conserva el objeto de identidad aprobado. Sólo `target-verify` contra el host provisionado demuestra la identidad efectiva y la negociación TLS del adapter `pg`. El runtime y los helpers `pg` usan campos explícitos, CA y `rejectUnauthorized=true`; los procesos hijos reciben esos campos por stdin y no reparsean una URL Prisma como libpq. Para Prisma CLI, el guard deriva de la identidad aprobada una URL con `sslmode=require`, `sslcert` (CA) y `sslaccept=strict`. En Prisma CLI 7.8.0, una prueba negra local con listener PostgreSQL TLS sintético comprobó que `strict` permite un certificado confiable con SAN coincidente y rechaza antes del StartupMessage tanto un hostname incorrecto con CA confiable como una CA no confiable. Es evidencia del comportamiento de esa versión/configuración bajo el harness local; **no demuestra el handshake contra la infraestructura institucional PREPROD**, que sigue pendiente de un target aprobado. `sslmode=verify-full` por sí solo no reemplaza el contrato Prisma probado. El guard valida y construye la URL en cada invocación de `migrate-status`/`migrate-deploy`; no copiar ni reemplazar `DATABASE_URL` manualmente. No se imprime ni registra la URL. La plantilla PREPROD requiere también la referencia reservada `BJC_PRODUCTION_CORPUS_STORAGE_PATH`; si falta, o si PREPROD se solapa con DEV/PROD por igualdad, ancestro, descendiente o alias resoluble del filesystem, la validación aborta. Las referencias no existentes se comparan mediante el padre existente más el sufijo; esto prueba la ruta declarada, no la existencia ni la identidad futura del volumen.

El frontend Vite usa `VITE_API_URL=https://<api-aprobada>/api` durante el build. `server/scripts/deploy-preprod.ps1` lo deriva de `BJC_PREPROD_API_ORIGIN` si no fue definido explícitamente; `scripts/preprod-build-env.mjs` aborta si el bundle apunta a HTTP, loopback/local, un origen distinto o una ruta no aprobada.

En un checkout limpio, `deploy-preprod.ps1` genera explícitamente el cliente Prisma antes de compilar el preflight Nest; Prisma 7 coloca ese cliente en una ruta ignorada por Git. La generación no conecta a la base. El guard de destino, el estado de migraciones y la aplicación revisada de migraciones siguen ejecutándose después de esa compilación.

## PREPROD-FIX-2 — revalidación del contrato y backup

La identidad DB se valida una vez y se adapta separadamente a `pg`, Prisma ORM 7 y libpq; los hijos no vuelven a parsear una URL de otro consumidor. DEV rechaza query strings y fragmentos, y su `pg.Client` se construye con host, puerto, base, rol y TLS explícitos. PREPROD requiere referencias de storage DEV y PROD; PROD requiere DEV y PREPROD. Si una referencia falta o las rutas se tocan, la validación falla cerradamente. Para un destino que aún no existe, se resuelve el padre existente más los componentes declarados; eso demuestra separación de las rutas configuradas, no existencia ni identidad futura del volumen.

Antes de cualquier conexión, el preflight de backup valida `check` y reserva una ruta absoluta fuera de los storage DEV, PREPROD y PROD, incluyendo ancestros/descendientes y alias de filesystem resolubles. El plan seco deriva `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE=verify-full`, `PGSSLROOTCERT` y `PGPASSFILE`; elimina overrides `PG*` heredados y nunca agrega el password a argv. El script requiere que el vault provisionó un passfile existente, pero no inspecciona su contenido ni verifica las ACL locales. El formato libpq es `host:port:database:user:password`; escapar `:` y `\` dentro de campos con `\`, usar valores exactos y no comodines para el destino, y mantener el archivo fuera del repositorio, logs, backups y roots de Corpus. En Windows libpq asume que el directorio está protegido y no verifica permisos especiales; el owner/vault debe restringir la ACL y gestionar rotación/eliminación. **ACL efectiva, `pg_dump` real y restore no están probados en este equipo.** [Formato oficial del passfile PostgreSQL](https://www.postgresql.org/docs/17/libpq-pgpass.html).

El rollback de un alias también queda acotado al namespace del ambiente y al schema físico actual (`v003` en este corte); se rechazan targets de otro ambiente, versiones incompatibles o listas ambiguas. El índice v1 del DEV queda retenido como evidencia histórica, no como fallback operativo v3. Esta comprobación no mutó ningún alias real.

## PREPROD-FIX-3 — TLS Prisma CLI y configuración PostgreSQL de Search

El proveedor Search obtiene una sola configuración `pg` del resolver de ambiente: DEV usa exclusivamente `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; PREPROD/PROD usan la identidad aprobada del perfil activo, CA y `rejectUnauthorized=true`. El mismo objeto se inyecta a OpenSearch runtime/document repository y a los hidratadores de Jurisprudencia y Corpus. Sus constructores no reciben ni reinterpretan la `DATABASE_URL` cruda en PREPROD/PROD. Las pruebas construyen los providers Nest para DEV, PREPROD y PROD sin abrir sockets PostgreSQL y rechazan identidades DEV cruzadas.

Prisma CLI 7.8.0 recibe del guard una URL derivada de la identidad ya aprobada con `sslmode=require`, `sslcert` y `sslaccept=strict`. La prueba TLS negra loopback confirma verificación de cadena e identidad hostname antes del PostgreSQL StartupMessage. `verify-full` de la entrada validada, `rejectUnauthorized=true` de `pg` y `sslaccept=strict` de Prisma son contratos de consumidores distintos. No se ejecutaron `migrate-status` ni `migrate-deploy` contra una DB institucional: PREPROD permanece sin provisionar y el handshake real todavía requiere verificación en su host aprobado.

## PREPROD-FIX-1 — contrato de ejecución revisado

La rama `feature/preprod-uat-fix` exige `NODE_ENV=production` y `BJC_DEPLOYMENT_ENV=preprod` concordantes antes de `NestFactory.create`; un marcador ausente, inválido o discordante aborta antes de inicializar providers y sus hooks. `production` aplica su propio esquema obligatorio, sin alias/prefijo Search DEV por defecto. Desarrollo conserva `galilei-search-active` y `galilei-search`.

La URL PostgreSQL de entrada acepta únicamente `sslmode=verify-full` y `sslrootcert` absoluto, idéntico por `realpath` a la CA configurada. Rechaza parámetros duplicados, identidad/host/servicio/opciones alternativos, CA no confiable y nombres DEV. El objeto aprobado se convierte de forma independiente a `pgConfig` explícito con CA y `rejectUnauthorized=true`, a URL Prisma ORM 7 (`sslmode=require`, `sslcert`) y a variables libpq (`PGSSLMODE=verify-full`, `PGSSLROOTCERT`). No se reinterpreta la URL de Prisma como una URL de entrada/libpq. `pg_dump` recibe host/puerto/base/rol como argumentos explícitos y `PGPASSFILE`; se limpian overrides `PG*` heredados. Nunca pasar contraseña por argumentos. El plan de backup verifica configuración/target antes de invocar libpq. El manifiesto registra `tlsMode=verify-full`; el restore sigue **NOT PROVEN**.

Antes de iniciar backend, confirmar DB y OpenSearch aprobados/healthy, storage PREPROD montado y ACL correctas, TLS/proxy listos, backup reciente con manifest, migraciones en estado revisado y ventana aprobada. El startup **no es read-only**: puede marcar `SourceScanRun` QUEUED/RUNNING como FAILED, marcar fuentes como ERROR, recuperar jobs OCR stale y arrancar el worker de sincronización OpenSearch/outbox. No iniciar sobre una restauración/importación incompleta ni asumir que la proyección queda quieta. Prisma migrations son explícitas y no se ejecutan al iniciar Nest.

Topología elegida y soportada por la configuración PREPROD: backend en el host y API en `127.0.0.1`, detrás de reverse proxy TLS **en el mismo host**. La operación en host real todavía no está certificada. Reverse proxy separado en contenedor no está certificado ni es compatible con el bind loopback actual; requiere un diseño de red/bind privado revisado. No cambiar a `0.0.0.0` como ajuste de despliegue.

Storage PREPROD se compara por rutas canónicas/`realpath` contra las referencias obligatorias DEV y PROD, incluyendo igualdad, ancestros y descendientes; la raíz PREPROD debe existir. En Windows se normalizan mayúsculas y se siguen symlinks/junctions existentes; para referencias aún inexistentes el guard canonicaliza el padre existente y añade el sufijo esperado. En ese caso se compara la ruta declarada, pero no se afirma que el volumen futuro exista o tenga la identidad esperada.

El contrato de variables está en `.env.preprod.example` y `.env.production.example`: DEV conserva defaults locales; PREPROD/PROD requieren marcador, aprobación, identidad DB/TLS/CA, namespace Search, storage, HTTPS, JWT y límites runtime explícitos. `VITE_API_URL` es build-time y se deriva de `BJC_PREPROD_API_ORIGIN`; credenciales DB/OpenSearch/JWT y rutas de storage son runtime. Ningún ejemplo contiene secretos utilizables.

No declarar READY por build local: la recuperación actual sólo aporta preparación/código y plan; restore, host, smoke en el target y UAT siguen sin evidencia.
