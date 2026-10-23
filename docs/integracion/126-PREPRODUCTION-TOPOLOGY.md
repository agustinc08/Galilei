# 126 — Topología de preproducción controlada

**Corte:** 2026-10-08 · **Estado:** diseño preparado; entorno preproductivo no identificado ni desplegado.

## Inventario observado

| Capa | Estado comprobado | Decisión |
|---|---|---|
| Host | `AGUSTINNOTEBOOK`, Windows; equipo de desarrollo local | No es host institucional ni destino de preproducción autorizado. |
| Frontend/backend | Repositorio local en `C:\proyecto triple\JurisprudenciaN\{front,back}` | Sin despliegue de Sprint 13. |
| PostgreSQL | Sólo DEV confirmado: `127.0.0.1:55432`, `buscador_juridico_civil_dev`, rol `bjc_dev` | Prohibido reutilizarlo como preprod. No se encontró destino autorizado separado. |
| Storage | DEV local content-addressed `_dev-corpus-storage` | Sin volumen de preprod ni política institucional de backup/retención. |
| Proxy/TLS | No configurados para BJC en un host compartido | Requieren topología e IT institucional. |
| Backup | Backup DEV verificado en docs 90 y 123; no backup/restore de preprod | Requiere destino y almacenamiento aprobados. |
| Red | No se identificó origen institucional autorizado | Mantener servicios accesibles sólo por loopback. |

La inspección de listeners mostró PostgreSQL en loopback `127.0.0.1:55432` y `::1:55432`; no se identificó un listener BJC autorizado para usuarios de UAT. No se hizo escaneo de red remota.

## Validación de configuración implementada

`src/config/preprod-config.ts` aplica un chequeo fail-closed antes de que Nest abra sockets o Prisma conecte cuando `NODE_ENV=production` y `BJC_DEPLOYMENT_ENV=preprod`. Requiere aprobación explícita e identidad de base esperada (host/puerto/base/rol), valida que la URL coincida y no sea DEV, exige JWT secret/expiración explícita, origins HTTPS, storage absoluto existente fuera de DEV, rate limit habilitado/configurado, una sola réplica (el limiter es por proceso) y timeout Search acotado. No imprime URL, password ni secret. `src/config/preprod-config.spec.ts` prueba configuraciones sintéticas sin conectar a DB.

`scripts/with-preprod-db-guard.cjs` valida la identidad PREPROD antes de sus acciones `target-verify`, `backup-plan`, `migrate-status`, `migrate-deploy`, `db-report` y `projection-{rebuild,verify,repair}`; `check` no abre conexión. Las migraciones siguen limitadas a `migrate-status` y `migrate-deploy`. El guard DEV permanece limitado a la DB DEV; no se agregó acción PREPROD al guard DEV.

Desde PREPROD-FIX-3, Search también usa esa identidad de ambiente: `BusquedaModule` resuelve una sola configuración PostgreSQL aprobada y la inyecta a OpenSearch runtime/document repository y a los hidratadores de Jurisprudencia y Corpus. La construcción de los providers para DEV/PREPROD/PROD se prueba sin abrir conexiones a PostgreSQL; no requiere un bypass ni una ruta Search especial en startup. Prisma CLI recibe la URL construida por el guard con `sslmode=require`, `sslcert` y `sslaccept=strict`. La prueba TLS local demuestra rechazo de hostname incorrecto y CA no confiable antes del StartupMessage para Prisma 7.8.0; el handshake con la infraestructura PREPROD real permanece pendiente.

El runtime production rechaza que falte `BJC_DEPLOYMENT_ENV`; otras modalidades de deployment no cambian el contrato existente. En esta máquina no se ejecutó un startup `preprod` con valores institucionales porque no existe un target autorizado. El validator comprueba configuración declarada, no reemplaza la aprobación humana de host, DB, ACL o infraestructura. `LOG_LEVEL` todavía no está aplicado por el logger y requiere decisión/implementación antes de usarlo como control operativo. Rate limit sigue en memoria por proceso, por lo que sólo una instancia puede usarlo sin otro limitador compartido.

Por lo anterior, los ficheros/configuración DEV no son plantilla de deploy. Completar los valores reales en un mecanismo seguro, obtener aprobación institucional, ejecutar validación negativa/positiva en host autorizado y cerrar logging/distribución de rate limit antes de abrir UAT compartida.

## Topología objetivo (pendiente de IT)

Completar antes del deploy: propietario del host, FQDN privado, sistema operativo/runtime, límites de CPU/RAM/disco, subred y clientes permitidos, terminación TLS, proxy y encabezados confiables, origen CORS exacto, servicio backend, frontend, PostgreSQL independiente, volumen persistente de PDFs, monitoreo, backup y responsable de guardia. No inferir valores de DEV.

## Configuración objetivo

Separar por entorno `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `STORAGE_ROOT`, `LOG_LEVEL`, límites de API, timeout de Search, configuración de proxy/TLS y build identifier. Cargar secretos desde el mecanismo institucional aprobado; no incorporarlos al repositorio, documentación, logs, artefactos ni chat. No copiar `.env.development.local`.

## Gate de despliegue

Precondiciones: host y owner autorizados; DB nueva identificada como `buscador_juridico_civil_preprod` o equivalente y credenciales segregadas; origen de datos aprobado; ACL/anonimización/retención resueltas para el lote; TLS/CORS/proxy definidos; backup de DB y storage y restore drill probados; ventana y rollback aprobados. Hasta entonces, ningún comando de migración/import se dirige a un supuesto destino.
