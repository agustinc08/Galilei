# Runbook local — Galilei

Este runbook sirve para desarrollo y UAT local controlada. No contiene credenciales. No uses información personal ni documentos institucionales en las pruebas.

## Requisitos

- Windows 10/11, Node.js `>=24.15 <25`, pnpm `12.15.0`.
- PostgreSQL 16 y OpenSearch 2.19.6 instalados y configurados como instancias locales.
- Variables locales copiadas de `server/.env.example` a `server/.env.development.local`; nunca agregues ese archivo al repositorio.
- El corpus DEV persistente es `C:\proyecto triple\_dev-corpus-storage`.

## Puertos de desarrollo

| Servicio | Dirección local | Comprobación |
| --- | --- | --- |
| API NestJS | `127.0.0.1:4000` | `GET /api/health` |
| Vite | `localhost:4001` | abrir `/login` |
| PostgreSQL DEV | `127.0.0.1:55432` | identidad DB, rol y `SELECT 1` |
| OpenSearch DEV | `127.0.0.1:9200` (HTTP), `9300` (transporte) | `/_cluster/health` |

Playwright QA usa puertos separados (`4001` API, `4002` frontend, `55434` PostgreSQL, `19200/19300` OpenSearch) y exige `BJC_E2E_RUNTIME_ROOT` absoluto. Sus usuarios, storage, traces, capturas y resultados permanecen dentro de ese runtime.

## Instalar, iniciar y comprobar

```powershell
pnpm install --frozen-lockfile
pnpm --filter back prisma:generate
pnpm dev
```

En otra terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/health
Invoke-RestMethod http://127.0.0.1:9200/_cluster/health
```

Antes de cualquier comando Prisma que lea o escriba el DEV real, confirmá que su URL resuelva a `127.0.0.1:55432/buscador_juridico_civil_dev` con rol `bjc_dev`. Usa `server/scripts/with-dev-db-guard.cjs prisma-migrate-status` para estado read-only. No apliques migraciones como parte del arranque. No ejecutes flujos mutantes de Playwright contra estos puertos.

Para pruebas funcionales, configurá una DB QA, un OpenSearch QA y un storage QA bajo una ruta exclusiva; la configuración Playwright aborta sin `BJC_E2E_RUNTIME_ROOT`. Consultá `client/playwright.config.ts` y `client/tests/qa-credentials.ts` para el contrato de aislamiento. Las credenciales QA se generan en archivos locales ignorados por Git, no se imprimen y se eliminan al terminar.

## Detener

Detené `pnpm dev` con `Ctrl+C`. Detené sólo los procesos QA que escuchan en los puertos QA antes de borrar su runtime. Para los servicios persistentes DEV, usá los comandos de administración de la instalación local y verificá PID/PGDATA o ruta de datos antes de detenerlos; nunca borres sus directorios de datos.

## Calidad y builds

Desde la raíz:

```powershell
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

La suite backend predeterminada omite `*.integration.spec.ts`; la ejecución de integración requiere la configuración QA aislada. Para una certificación Prisma read-only, usá `prisma:generate`, `prisma:validate` y `prisma-migrate-status` con el guard de DEV. Los comandos de importación, reconstrucción de Search y migración tienen efectos de escritura y no forman parte del smoke de usuario.
