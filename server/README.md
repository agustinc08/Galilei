# Galilei API

Backend NestJS 12 del workspace pnpm. Prisma administra el schema PostgreSQL; PostgreSQL es la fuente de verdad y OpenSearch entrega el read model de búsqueda.

## Desarrollo local

Desde la raíz del repositorio, `pnpm dev` inicia la API en `http://127.0.0.1:4000` y el cliente Vite en `http://localhost:4001`. La API comprueba su estado en `GET /api/health`. Para levantar o detener los servicios de datos, comprobar puertos y resolver fallos de conexión, seguí [`docs/uat/technical-runbook.md`](../docs/uat/technical-runbook.md).

La configuración local se guarda en `server/.env.development.local`, ignorado por Git. Partí de `.env.example`, completá secretos sólo en el archivo local y no los pegues en tickets, reportes o terminales compartidas. Para desarrollo, el guard de DB acepta únicamente `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`.

## Comandos

```powershell
pnpm --filter back prisma:generate
pnpm --filter back prisma:validate
pnpm --filter back lint
pnpm --filter back typecheck
pnpm --filter back test
pnpm --filter back build
```

`test` omite por defecto las suites `*.integration.spec.ts`; éstas requieren servicios QA aislados explícitos. Nunca ejecutes E2E mutantes contra la base DEV principal. Antes de una migración local, validá la identidad exacta de la DB y usá `node scripts/with-dev-db-guard.cjs prisma-migrate-status`; no uses `prisma migrate dev` como rutina de arranque. Una migración sólo se aplica cuando existe una migración pendiente revisada y la operación está aprobada para ese entorno.

## Límites de datos

- PostgreSQL DEV: `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, rol `bjc_dev`.
- OpenSearch DEV: HTTP `127.0.0.1:9200`, transporte `127.0.0.1:9300`.
- Corpus DEV: `C:\proyecto triple\_dev-corpus-storage`; es persistente y no es un directorio de pruebas.
- No apuntes herramientas locales a producción ni a servidores institucionales. Mantén cuentas, blobs y servicios de prueba en un runtime QA separado.

El contrato de operación y recuperación de Search está documentado en [`docs/integracion/123-SEARCH-MIGRATION-OPERATIONS.md`](../docs/integracion/123-SEARCH-MIGRATION-OPERATIONS.md).
